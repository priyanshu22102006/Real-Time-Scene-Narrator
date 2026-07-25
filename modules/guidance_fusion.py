"""
guidance_fusion.py
Active Guidance System: fuses turn-by-turn GPS navigation instructions
with real-time camera visual analysis (hazards, obstacles, sidewalk layout)
to provide unified, calm, and actionable sighted-guide audio narration for visually impaired users.
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

logger = logging.getLogger("visionmate.guidance_fusion")


class ActiveGuidanceSystem:
    """Fuses GPS navigation instructions with real-time visual camera analysis."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        self.api_key = api_key or GEMINI_API_KEY
        self.model_name = model_name or GEMINI_MODEL
        if not self.api_key or self.api_key == "YOUR_GEMINI_API_KEY":
            logger.warning("Gemini API key is not configured for ActiveGuidanceSystem.")
            self._client = None
        else:
            self._client = genai.Client(api_key=self.api_key)

    def get_fused_guidance(
        self,
        image_bytes: bytes,
        gps_instruction: str = "Walk straight",
        personal_context: str = ""
    ) -> str:
        """
        Fuses a GPS navigation instruction with real-time visual analysis of the camera frame.

        Parameters:
            image_bytes: Raw JPEG image bytes captured from camera.
            gps_instruction: Current turn-by-turn walking instruction (e.g. "Turn right in 15 meters").
            personal_context: Optional context (e.g. "Carrying a white cane" or "Guide dog user").

        Returns:
            Spoken-style fused guidance string.
        """
        if not self._client:
            raise ValueError("GEMINI_API_KEY is not configured for guidance fusion.")

        if not image_bytes:
            raise ValueError("Image frame data cannot be empty.")

        # Validate image format
        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.verify()
        except Exception as e:
            raise ValueError(f"Invalid image format for guidance fusion: {e}") from e

        image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")

        prompt = f"""
PERSONAL CONTEXT: {personal_context if personal_context else "Visually impaired pedestrian walking safely"}
GPS NAVIGATION INSTRUCTION: {gps_instruction}

TASK: You are a Virtual Sighted Guide for a blind person walking on the street.
1. Analyze the camera frame for immediate hazards (cars, poles, construction, people, curbs, steps).
2. Combine the GPS instruction with the visual reality directly in front of the user.
3. Provide a concise, actionable instruction under 50 words that ensures safety.

FORMAT: Be direct, calm, and reassuring. Use spatial terms (left, right, straight ahead).
EXAMPLE: "Continue straight for 10 meters, but stay to the left to avoid a parked car on the sidewalk."
"""

        try:
            response = self._client.models.generate_content(
                model=self.model_name,
                contents=[prompt, image_part],
            )
            if not response or not response.text:
                return "Proceed with caution. Unable to analyze camera stream clearly."
            return response.text.strip()
        except Exception as e:
            logger.error("Error generating fused guidance: %s", e)
            raise RuntimeError(f"Guidance AI service error: {e}") from e


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("ActiveGuidanceSystem module loaded successfully.")
