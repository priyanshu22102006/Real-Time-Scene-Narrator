// Route: POST /api/extract-address
// Uses Google Gemini Vision API to extract text and physical addresses from images.

import fetch from 'node-fetch';

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];

const ADDRESS_PATTERNS = [
  /\d+\s+[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Highway|Hwy|Pkwy)\b[\s,]*(?:[A-Za-z\s]+,\s*)?(?:[A-Z]{2}\s+\d{5})?/gi,
  /\b\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
];

function extractAddressFromText(text) {
  if (!text) return null;
  for (const pattern of ADDRESS_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      return matches[0].trim();
    }
  }
  return null;
}

export async function extractAddress(req, res) {
  console.log('\n[POST /api/extract-address] Image received for text extraction');

  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    console.warn('[extract-address] ⚠️ Empty or invalid image file uploaded.');
    return res.status(400).json({
      extractedText: 'No image file uploaded.',
      address: null,
      rawDescription: '',
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[extract-address] ❌ GEMINI_API_KEY missing in backend .env');
    return res.status(500).json({
      error: 'GEMINI_API_KEY is missing in backend .env file.',
      extractedText: 'Please configure GEMINI_API_KEY in backend .env.',
      address: null,
    });
  }

  const base64Image = req.file.buffer.toString('base64');
  console.log(`[extract-address] Image converted to Base64 (${base64Image.length} characters)`);

  const prompt = `Read and extract all visible text from this image for a visually impaired user. 
List the text clearly. If a street address, house number, building name, or physical location is visible, write on a new line: "ADDRESS: <address>".`;

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

  for (const model of MODELS) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      console.log(`[extract-address] 🚀 Sending to Gemini model: ${model}...`);

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const data = await response.json();
        let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

        rawText = rawText.replace(/[*_#`]/g, '').trim();

        if (rawText) {
          let address = null;
          const addressMatch = rawText.match(/ADDRESS:\s*([^\n]+)/i);
          if (addressMatch) {
            address = addressMatch[1].trim();
            rawText = rawText.replace(/ADDRESS:\s*[^\n]+/i, '').trim();
          } else {
            address = extractAddressFromText(rawText);
          }

          const extractedText = rawText || 'Text read from image.';

          console.log(`[extract-address] ✅ SUCCESS (${model}): "${extractedText}" (Address: ${address || 'none'})`);

          return res.json({
            extractedText,
            address,
            rawDescription: extractedText,
            provider: `Google ${model}`,
          });
        }
      } else {
        const errText = await response.text();
        console.error(`[extract-address] ❌ ${model} HTTP ${response.status}: ${errText}`);
      }
    } catch (err) {
      console.error(`[extract-address] ❌ ${model} error:`, err.message);
    }
  }

  console.error('[extract-address] ❌ All Gemini models failed.');
  return res.status(500).json({
    error: 'Gemini API failed to process the image for text extraction.',
    extractedText: 'No text could be extracted from this image. Please verify camera view or image quality.',
    address: null,
  });
}
