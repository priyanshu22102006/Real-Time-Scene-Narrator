"""
tts_engine.py
Text-To-Speech engine wrapping ElevenLabs API with fallback to gTTS (Google Text-to-Speech).
Ensures speech synthesis remains reliable even during API failure or missing keys.
"""

import io
import sys
import os
import logging
from typing import Optional

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from gtts import gTTS
from config import ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID


logger = logging.getLogger("visionmate.tts_engine")


class TTSError(Exception):
    """Custom exception raised when all TTS backends fail."""
    pass


def _synthesize_elevenlabs(text: str, api_key: str, voice_id: str, model_id: str) -> bytes:
    """Attempt synthesis using ElevenLabs official SDK."""
    from elevenlabs.client import ElevenLabs
    from elevenlabs import VoiceSettings

    client = ElevenLabs(api_key=api_key)
    audio_stream = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id=model_id,
        voice_settings=VoiceSettings(
            stability=0.45,
            similarity_boost=0.75,
        ),
    )
    # Collect iterator chunks
    audio_bytes = b"".join(chunk for chunk in audio_stream if chunk)
    if not audio_bytes:
        raise ValueError("ElevenLabs returned empty audio output")
    return audio_bytes


def _synthesize_gtts(text: str, lang: str = "en") -> bytes:
    """Fallback synthesis using gTTS (Google Text-to-Speech)."""
    tts = gTTS(text=text, lang=lang)
    fp = io.BytesIO()
    tts.write_to_fp(fp)
    fp.seek(0)
    audio_bytes = fp.read()
    if not audio_bytes:
        raise ValueError("gTTS returned empty audio output")
    return audio_bytes


def synthesize_speech(
    text: str,
    output_path: Optional[str] = None,
    api_key: Optional[str] = None,
    voice_id: Optional[str] = None,
    model_id: Optional[str] = None,
) -> bytes:
    """
    Convert `text` to speech MP3 bytes.
    Tries ElevenLabs API first if API key is present.
    Falls back to gTTS on failure or missing key.
    """
    if not text or not text.strip():
        raise ValueError("synthesize_speech: text must not be empty")

    text = text.strip()
    key = api_key or ELEVENLABS_API_KEY
    v_id = voice_id or ELEVENLABS_VOICE_ID
    m_id = model_id or ELEVENLABS_MODEL_ID

    audio_bytes = None

    # Primary: ElevenLabs
    if key and key != "YOUR_ELEVENLABS_API_KEY":
        try:
            logger.debug("Attempting TTS synthesis via ElevenLabs...")
            audio_bytes = _synthesize_elevenlabs(text, key, v_id, m_id)
            logger.info("ElevenLabs TTS synthesis successful (%d bytes)", len(audio_bytes))
        except Exception as e:
            logger.warning("ElevenLabs TTS failed: %s. Falling back to gTTS.", e)

    # Fallback: gTTS
    if audio_bytes is None:
        try:
            logger.debug("Attempting TTS synthesis via gTTS fallback...")
            audio_bytes = _synthesize_gtts(text)
            logger.info("gTTS fallback synthesis successful (%d bytes)", len(audio_bytes))
        except Exception as e:
            logger.error("gTTS synthesis failed: %s", e)
            raise TTSError(f"All TTS synthesis engines failed. Details: {e}") from e

    if output_path:
        with open(output_path, "wb") as f:
            f.write(audio_bytes)

    return audio_bytes


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sample_text = "VisionMate production TTS test. System functioning normally."
    res = synthesize_speech(sample_text)
    print(f"Synthesized {len(res)} bytes of audio.")
