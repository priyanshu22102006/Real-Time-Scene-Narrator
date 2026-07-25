"""
scene_ai.py
Uses Google's Gemini multimodal model (via the official `google-genai` SDK)
to turn a single JPEG frame into either:
  - a spoken-style scene description (feature 4), or
  - extracted address/landmark text plus a geocoding-ready guess (feature 3).
"""

import sys
import os
import io
import json
import logging
from typing import Dict, Any, Optional
from PIL import Image

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from google import genai
from google.genai import types
from config import GEMINI_API_KEY, GEMINI_MODEL

logger = logging.getLogger("visionmate.scene_ai")


def _get_client(api_key: Optional[str] = None) -> genai.Client:
    key = api_key or GEMINI_API_KEY
    if not key or key == "YOUR_GEMINI_API_KEY":
        raise ValueError("GEMINI_API_KEY is not set. Please configure a valid Gemini API key.")
    return genai.Client(api_key=key)


def validate_image_bytes(image_bytes: bytes) -> None:
    """Validate that image_bytes is a valid image readable by PIL."""
    if not image_bytes:
        raise ValueError("Uploaded image file is empty")
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()
    except Exception as e:
        raise ValueError(f"Invalid image content: {e}") from e


def _image_part(image_bytes: bytes) -> types.Part:
    return types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")


FALLBACK_MODELS = [GEMINI_MODEL, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"]


def generate_content_with_fallback(client: genai.Client, contents: Any, preferred_model: Optional[str] = None, config: Any = None) -> Any:
    """Tries primary model, then falls back through alternative Gemini models on 429 QuotaExceeded."""
    models_to_try = []
    if preferred_model:
        models_to_try.append(preferred_model)
    for m in FALLBACK_MODELS:
        if m not in models_to_try:
            models_to_try.append(m)

    last_error = None
    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config,
            )
            if response and response.text:
                return response
        except Exception as e:
            err_msg = str(e)
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "Quota" in err_msg:
                logger.warning("Gemini model %s hit rate/quota limit (429). Retrying fallback model...", model_name)
                last_error = e
                continue
            else:
                raise e

    if last_error:
        raise last_error
    raise RuntimeError("All Gemini model candidates failed to respond.")


def describe_scene(image_bytes: bytes, api_key: Optional[str] = None) -> str:
    """
    Feature 4: Given raw JPEG bytes, return a concise, spoken-style
    description of the scene aimed at a blind or low-vision listener.
    """
    validate_image_bytes(image_bytes)
    client = _get_client(api_key)

    prompt = (
        "You are describing a scene to a person who is blind or visually "
        "impaired, speaking directly to them as 'you'. Prioritize, in order: "
        "1) immediate hazards or obstacles in their path, 2) the general "
        "layout (indoors/outdoors, open/crowded, stairs, curbs), "
        "3) people and roughly where they are (left/right/ahead), "
        "4) notable objects, signs, or landmarks. Keep the whole answer "
        "under 100 words of plain, clear, spoken language. Do not describe "
        "the image as an image — describe the scene as if you are standing "
        "there with the person."
    )

    try:
        response = generate_content_with_fallback(client, contents=[prompt, _image_part(image_bytes)])
        if not response or not response.text:
            return "Unable to generate scene description from image."
        return response.text.strip()
    except Exception as e:
        logger.error("Gemini describe_scene failed: %s", e)
        err_str = str(e)
        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota" in err_str:
            return "Gemini API request limit reached. Please wait 30 seconds before trying again."
        return f"Unable to analyze scene right now: {e}"


def extract_address_and_landmarks(image_bytes: bytes, api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Feature 3: Given raw JPEG bytes (e.g. a photo of a street sign,
    storefront, or building entrance), extract any readable address-like
    text and landmark names.
    """
    validate_image_bytes(image_bytes)
    client = _get_client(api_key)

    prompt = (
        "Look at this image and extract anything that could help identify "
        "a location: street names, house/building numbers, shop names, "
        "signboards, or landmarks. Respond ONLY with a single strict JSON "
        "object — no markdown fences, no commentary — with exactly these "
        "keys: "
        '"raw_text" (string, all readable text found, empty string if none), '
        '"possible_address" (string or null, your best guess at a full or '
        "partial postal address), "
        '"landmarks" (array of strings, notable landmark names, empty '
        "array if none), "
        '"confidence" (one of "high", "medium", "low").'
    )

    try:
        response = generate_content_with_fallback(
            client,
            contents=[prompt, _image_part(image_bytes)],
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
    except Exception as e:
        logger.error("Gemini extract_address_and_landmarks failed: %s", e)
        err_str = str(e)
        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota" in err_str:
            return {
                "raw_text": "",
                "possible_address": None,
                "landmarks": [],
                "confidence": "low",
                "notice": "Gemini API rate limit reached. Please wait a few seconds before retrying."
            }
        return {
            "raw_text": "",
            "possible_address": None,
            "landmarks": [],
            "confidence": "low",
            "notice": f"AI service error: {e}"
        }

    text = response.text.strip() if response and response.text else "{}"
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        cleaned = text.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            data = {
                "raw_text": text,
                "possible_address": None,
                "landmarks": [],
                "confidence": "low",
            }

    data.setdefault("raw_text", "")
    data.setdefault("possible_address", None)
    data.setdefault("landmarks", [])
    data.setdefault("confidence", "low")
    return data


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("scene_ai module loaded successfully.")
