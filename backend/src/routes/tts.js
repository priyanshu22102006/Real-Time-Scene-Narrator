// Route: POST /api/tts
// Uses ElevenLabs Text-to-Speech API to convert text into ultra-realistic audio.
// Includes fallback error handling so frontend can revert to browser SpeechSynthesis.

import fetch from 'node-fetch';

export async function generateTTS(req, res) {
  const { text, voiceId } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text parameter is required.', status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('[tts] ELEVENLABS_API_KEY missing in backend .env');
    return res.status(503).json({ error: 'ElevenLabs API key missing', fallback: true });
  }

  const selectedVoice = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`;

  try {
    const response = await fetch(elevenLabsUrl, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[tts] ElevenLabs API returned ${response.status}:`, errorText);
      return res.status(response.status).json({ error: 'ElevenLabs error', fallback: true });
    }

    const audioBuffer = await response.arrayBuffer();
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength,
    });
    return res.send(Buffer.from(audioBuffer));

  } catch (err) {
    console.warn('[tts] ElevenLabs error, signaling fallback to frontend:', err.message);
    return res.status(500).json({ error: 'TTS unavailable', fallback: true });
  }
}
