// Route: POST /api/extract-address
// High-Precision OCR & Address Extraction Engine using Google Gemini Vision API.
// Extracts visible text, street signs, document contents, and physical addresses.

import fetch from 'node-fetch';

// Valid Gemini API models in fallback order
const MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-pro',
];

// Expanded international address recognition patterns
const ADDRESS_PATTERNS = [
  // US / UK / International standard street addresses
  /\b\d{1,5}\s+[A-Za-z0-9\s.,#-]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Highway|Hwy|Pkwy|Alley|Aly|Arcade|Arc|Square|Sq)\b[^\n]*/gi,
  
  // Apartment / Flat / Door / Suite / Building numbers
  /\b(?:Flat|Apartment|Apt|Suite|Ste|Unit|Door|No|#)\s*[\w-]+\s*,?\s*[^\n]+/gi,

  // Indian / South Asian address formats (e.g. #12, 4th Cross, Indiranagar, Bangalore 560038)
  /\b(?:#?\d+[\w-]*\s*,?\s*)?(?:\d+(?:st|nd|rd|th)\s+(?:Cross|Main|Block|Sector|Phase|Stage|Layout)\s*,?\s*)+[A-Za-z\s,]+\d{5,6}\b/gi,

  // Postal / Zip code patterns (US 5-digit, UK alphanumeric, India 6-digit)
  /\b[A-Za-z\s.,#-]+(?:[A-Z]{2}\s+\d{5}|\b\d{6}\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b)/gi,

  // Generic Street / Road / Avenue occurrences
  /\b[A-Z][a-z0-9\s.,#-]+(?:Road|Rd|Street|St|Avenue|Ave|Lane|Ln|Drive|Dr|Nagar|Marg|Chowk|Parkway)\b/gi,
];

/**
 * Extracts a physical address from raw text using regex patterns if Gemini didn't explicitly tag one.
 */
function extractAddressFromText(text) {
  if (!text) return null;
  for (const pattern of ADDRESS_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      const cleanest = matches[0].trim().replace(/^[:,\s]+|[:,\s]+$/g, '');
      if (cleanest.length >= 5) {
        return cleanest;
      }
    }
  }
  return null;
}

export async function extractAddress(req, res) {
  console.log('\n[POST /api/extract-address] Image received for OCR text extraction');

  if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
    console.warn('[extract-address] ⚠️ Empty or invalid image file uploaded.');
    return res.status(400).json({
      extractedText: 'No image file provided. Please capture or upload a clear photo.',
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
  console.log(`[extract-address] Processing image payload (${base64Image.length} base64 chars)`);

  const prompt = `Perform high-accuracy OCR for a visually impaired user. 
Extract ALL visible text from this image carefully (signs, documents, packaging, street names, notices, addresses).

Instructions:
1. First, list all detected text clearly line by line.
2. If a street address, house number, location, or building name is present, add a line at the end formatted exactly as:
ADDRESS: <full extracted address>

If no text is visible, reply with: "No readable text found in this image."`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: req.file.mimetype || 'image/jpeg',
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1, // Low temperature for factual OCR precision
      maxOutputTokens: 450,
    },
  };

  for (const model of MODELS) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      console.log(`[extract-address] 🚀 Querying Gemini model: ${model}...`);

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(18000),
      });

      if (response.ok) {
        const data = await response.json();
        let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

        // Clean formatting artifacts
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

        if (rawText) {
          let address = null;
          
          // Check for explicit "ADDRESS:" tag from Gemini prompt
          const addressMatch = rawText.match(/ADDRESS:\s*([^\n]+)/i);
          if (addressMatch) {
            address = addressMatch[1].trim();
            // Remove the ADDRESS line from the main text
            rawText = rawText.replace(/ADDRESS:\s*[^\n]+/i, '').trim();
          } else {
            // Fallback to pattern matching
            address = extractAddressFromText(rawText);
          }

          const extractedText = rawText || 'Text extracted from image.';

          console.log(`[extract-address] ✅ SUCCESS (${model}): "${extractedText.substring(0, 80)}..." (Address: ${address || 'none'})`);

          return res.json({
            extractedText,
            address,
            rawDescription: extractedText,
            provider: `Google ${model} Vision OCR`,
          });
        }
      } else {
        const errText = await response.text();
        console.warn(`[extract-address] ⚠️ ${model} HTTP ${response.status}:`, errText);
        if (response.status === 403 && errText.includes('leaked')) {
          return res.status(403).json({
            error: 'Your GEMINI_API_KEY in backend/.env was reported as leaked by Google. Please generate a new key at https://aistudio.google.com/apikey and update backend/.env.',
            extractedText: 'GEMINI_API_KEY is invalid or leaked. Please update backend/.env with a new key from Google AI Studio.',
            address: null,
          });
        }
      }
    } catch (err) {
      console.warn(`[extract-address] ⚠️ ${model} error:`, err.message);
    }
  }

  // Graceful fallback if Gemini API fails or encounters errors
  console.warn('[extract-address] ⚠️ All Gemini OCR models unavailable, returning friendly guidance.');
  return res.json({
    extractedText: 'Could not extract text. Please ensure the camera is steady, well-lit, and focused directly on the text.',
    address: null,
    rawDescription: 'No text extracted.',
    provider: 'Local Fallback Guidance',
  });
}
