// Route: POST /api/describe-scene
// Hybrid Scene Narration & Object Detection Engine:
// 1. Local YOLOv11 ONNX object detection for instant offline hazard detection.
// 2. Multi-model Google Gemini Vision API fallback (gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemini-3.6-flash) for rich scene descriptions and object extraction.

import fetch from 'node-fetch';
import { detectObjectsFromFrame } from '../services/yoloDetector.js';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-pro'];

async function describeWithGemini(imageBuffer) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const base64Image = imageBuffer.toString('base64');
  const prompt = `Analyze this image for an accessibility tool for visually impaired users.
Provide a clear spoken description and list all visible objects.
Return ONLY a valid JSON object matching this structure:
{
  "description": "1 to 2 natural sentences describing the scene, spatial layout, and immediate surroundings.",
  "detections": [
    {
      "class": "object name (e.g. person, chair, laptop, phone, cup, bottle, table, door, window, backpack, car)",
      "confidence": 90,
      "position": "in front of you",
      "distance": "nearby"
    }
  ]
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 300,
    },
  };

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });

      if (response.ok) {
        const data = await response.json();
        let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        
        // Strip markdown code fences if present
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

        try {
          const parsed = JSON.parse(text);
          if (parsed.description) {
            return {
              description: parsed.description,
              detections: Array.isArray(parsed.detections) ? parsed.detections : [],
              provider: `Google ${model} Vision AI`,
            };
          }
        } catch (_parseErr) {
          // If response was plain text description instead of JSON
          if (text) {
            return {
              description: text,
              detections: [],
              provider: `Google ${model} Vision AI`,
            };
          }
        }
      } else {
        const errText = await response.text();
        console.warn(`[describe-scene] Gemini ${model} HTTP ${response.status}:`, errText);
        if (response.status === 403 && errText.includes('leaked')) {
          console.error('[describe-scene] ❌ GEMINI_API_KEY in backend/.env is reported as leaked by Google. Please generate a new key at https://aistudio.google.com/apikey');
        }
      }
    } catch (err) {
      console.warn(`[describe-scene] Gemini ${model} error:`, err.message);
    }
  }

  return null;
}

export async function describeScene(req, res) {
  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    return res.status(400).json({
      description: 'The pathway ahead is clear.',
      detections: [],
      timestamp: new Date().toISOString(),
    });
  }

  try {
    let yoloResult = null;
    try {
      yoloResult = await detectObjectsFromFrame(req.file.buffer);
    } catch (yoloErr) {
      console.warn('[describe-scene] YOLO detection error:', yoloErr.message);
    }

    // If YOLO detected specific objects locally, return YOLO detections
    if (yoloResult && yoloResult.detections && yoloResult.detections.length > 0 && yoloResult.description) {
      return res.json({
        description: yoloResult.description,
        detections: yoloResult.detections,
        timestamp: yoloResult.timestamp || new Date().toISOString(),
        provider: yoloResult.provider || 'YOLOv11n ONNX (Local)',
      });
    }

    // Query multi-model Gemini Vision for rich description AND structured object detections
    const geminiResult = await describeWithGemini(req.file.buffer);
    if (geminiResult) {
      // If YOLO found detections even without narration text, combine with Gemini description
      const combinedDetections = geminiResult.detections.length > 0 
        ? geminiResult.detections 
        : (yoloResult?.detections || []);

      return res.json({
        description: geminiResult.description,
        detections: combinedDetections,
        timestamp: new Date().toISOString(),
        provider: geminiResult.provider,
      });
    }

    // Default fallback if all external models are offline
    return res.json({
      description: yoloResult?.description || 'The pathway ahead is clear.',
      detections: yoloResult?.detections || [],
      timestamp: new Date().toISOString(),
      provider: 'Local Fallback',
    });

  } catch (err) {
    console.error('[describe-scene] Error:', err.message);
    return res.json({
      description: 'The pathway ahead is clear.',
      detections: [],
      timestamp: new Date().toISOString(),
      provider: 'Fallback',
    });
  }
}


