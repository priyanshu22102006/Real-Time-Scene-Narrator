"""
assistant_ai.py
Interactive AI Vision Assistant: processes user questions about camera frames,
surroundings, objects, text labels, or safety hazards using Google's Gemini multimodal AI.
"""

import sys
import os
import io
import logging
from typing import Optional
from PIL import Image

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from google import genai
from google.genai import types
from config import GEMINI_API_KEY, GEMINI_MODEL

logger = logging.getLogger("visionmate.assistant_ai")


def _get_client(api_key: Optional[str] = None) -> genai.Client:
    key = api_key or GEMINI_API_KEY
    if not key or key == "YOUR_GEMINI_API_KEY":
        raise ValueError("GEMINI_API_KEY is not configured.")
    return genai.Client(api_key=key)


def validate_image_bytes(image_bytes: bytes) -> None:
    """Validate that image_bytes is a valid image readable by PIL."""
    if not image_bytes:
        raise ValueError("Image frame data cannot be empty.")
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()
    except Exception as e:
        raise ValueError(f"Invalid image content: {e}") from e


def ask_ai_assistant(
    image_bytes: bytes,
    user_question: str,
    api_key: Optional[str] = None
) -> str:
    """
    Answers any user question about their surroundings or camera frame.

    Parameters:
        image_bytes: Raw JPEG image bytes captured from camera or upload.
        user_question: Free-text question asked by user (e.g. "What is in front of me?").
        api_key: Optional Gemini API key override.

    Returns:
        Spoken-style concise AI response string.
    """
    if not user_question or not user_question.strip():
        user_question = "What is in front of me?"

    validate_image_bytes(image_bytes)
    client = _get_client(api_key)

    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")

    prompt = f"""
You are VisionMate, an intelligent, empathetic, and highly accurate AI Vision Assistant for a person who is blind or visually impaired.

USER'S QUESTION: "{user_question.strip()}"

INSTRUCTIONS:
1. Carefully analyze the camera frame to answer the user's question directly and accurately.
2. Prioritize user safety, obstacle locations (left/right/ahead), text on signs/labels, or specific items requested.
3. Speak directly to the user as 'you' in plain, clear, conversational language.
4. Keep your answer direct and under 60 words so it can be comfortably listened to aloud.

Do not mention that you are analyzing an image — answer as if standing right next to the user.
"""

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[prompt, image_part],
        )
        if not response or not response.text:
            return "I am unable to clearly see an answer to your question in this view."
        return response.text.strip()
    except Exception as e:
        logger.error("Gemini ask_ai_assistant error: %s", e)
        raise RuntimeError(f"AI Assistant service error: {e}") from e


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("assistant_ai module loaded successfully.")
