"""
handwritten_ocr.py
Standalone ML & AI Vision Engine for Reading & Extracting Handwritten Text,
Addresses, and Notes from Images of Paper, Envelopes, and Signs.

Features:
1. Handwriting Pre-processing (Contrast enhancement, sharpening, grayscale conversion)
2. Deep Learning Multimodal Vision Model Extraction via Gemini AI (cursive & manuscript recognition)
3. Structured Address & Contact Info Parsing (Street, City, Postal Code, Recipient Name, Notes)
4. Fallback Local OCR Support (pytesseract / OpenCV)
5. Spoken Audio Synthesis for Visually Impaired Users via gTTS
6. Interactive Streamlit Interface for Direct Testing
"""

import sys
import os
import io
import json
import logging
from typing import Dict, Any, Optional, Tuple, List
from PIL import Image, ImageEnhance, ImageFilter

import cv2
import numpy as np
from dotenv import load_dotenv

# Try importing pytesseract for local OCR fallback if installed
try:
    import pytesseract
    PYTESSERACT_AVAILABLE = True
except ImportError:
    PYTESSERACT_AVAILABLE = False

from google import genai
from google.genai import types
from gtts import gTTS

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), ".")))

from config import GEMINI_API_KEY, GEMINI_MODEL

load_dotenv()
logger = logging.getLogger("visionmate.handwritten_ocr")


class HandwritingImagePreprocessor:
    """OpenCV & PIL Image Enhancement pipeline optimized for handwritten text legibility."""

    @staticmethod
    def enhance_handwriting(image_bytes: bytes) -> Tuple[Image.Image, bytes]:
        """
        Applies grayscale, contrast boost, sharpening, and adaptive thresholding
        to improve legibility of handwritten ink on paper.

        Returns:
            (enhanced_pil_image, enhanced_jpeg_bytes)
        """
        try:
            pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except Exception as e:
            raise ValueError(f"Failed to open image for handwriting preprocessing: {e}") from e

        # Convert PIL to OpenCV BGR array
        open_cv_img = np.array(pil_img)[:, :, ::-1].copy()

        # 1. Grayscale Conversion
        gray = cv2.cvtColor(open_cv_img, cv2.COLOR_BGR2GRAY)

        # 2. Denoising
        denoised = cv2.fastNlMeansDenoising(gray, h=10)

        # 3. Contrast Limited Adaptive Histogram Equalization (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        equalized = clahe.apply(denoised)

        # 4. Sharpening Kernel
        sharpen_kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
        sharpened = cv2.filter2D(equalized, -1, sharpen_kernel)

        # Convert back to PIL Image
        enhanced_pil = Image.fromarray(sharpened)

        # Enhance contrast further using PIL
        enhancer = ImageEnhance.Contrast(enhanced_pil)
        enhanced_pil = enhancer.enhance(1.8)

        buf = io.BytesIO()
        enhanced_pil.save(buf, format="JPEG", quality=95)
        return enhanced_pil, buf.getvalue()


class HandwrittenTextExtractor:
    """
    Multimodal ML & AI engine specialized in reading handwritten text,
    notes, and written addresses on paper, whiteboards, or mail envelopes.
    """

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        self.api_key = api_key or GEMINI_API_KEY
        self.model_name = model_name or GEMINI_MODEL

        if self.api_key and self.api_key != "YOUR_GEMINI_API_KEY":
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None
            logger.warning("Gemini API key not configured for HandwrittenTextExtractor.")

    def extract_from_written_image(
        self,
        image_bytes: bytes,
        preprocess: bool = True
    ) -> Dict[str, Any]:
        """
        Reads and extracts information from an image containing handwritten text/address.

        Parameters:
            image_bytes: Raw JPEG/PNG image bytes of handwritten sheet or note.
            preprocess: Whether to run contrast/sharpening enhancements first.

        Returns:
            Dict containing raw text, structured address fields, recipient name, notes, legibility score, and spoken summary.
        """
        if not image_bytes:
            raise ValueError("Image bytes cannot be empty.")

        # Preprocess image for maximum handwriting clarity
        target_bytes = image_bytes
        if preprocess:
            try:
                _, target_bytes = HandwritingImagePreprocessor.enhance_handwriting(image_bytes)
            except Exception as pe:
                logger.warning("Handwriting preprocessing failed, using original frame: %s", pe)
                target_bytes = image_bytes

        # Primary Extraction via Gemini AI Vision Model
        if self.client:
            return self._extract_via_gemini(target_bytes)

        # Fallback to local Tesseract OCR if Gemini API key is missing
        if PYTESSERACT_AVAILABLE:
            return self._extract_via_tesseract(target_bytes)

        raise RuntimeError("No AI Vision client or Tesseract OCR available for handwriting extraction.")

    def _extract_via_gemini(self, image_bytes: bytes) -> Dict[str, Any]:
        """Extracts handwritten text using Gemini Multimodal AI."""
        image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")

        prompt = """
ACT AS: An expert handwriting recognition and OCR document analysis system.
TASK: Read all handwritten text in this image (e.g. written address on paper, sticky note, envelope, or card).
Extract all written text and structure any geographical address or contact information found.

Respond ONLY with a valid JSON object matching this schema:
{
  "raw_text": "complete transcript of all handwritten words",
  "has_address": true | false,
  "extracted_address": "full postal address string or null",
  "address_components": {
    "street_address": "street number and name or null",
    "city": "city or town or null",
    "state_or_region": "state/province/region or null",
    "postal_code": "ZIP or postal code or null",
    "country": "country or null"
  },
  "recipient_name": "name of person/business or null",
  "additional_notes": "any other handwritten notes/numbers or null",
  "handwriting_legibility": "high" | "medium" | "low",
  "confidence": 0.95
}
"""

        from config import FALLBACK_GEMINI_MODELS

        models_to_try = [self.model_name] + [m for m in FALLBACK_GEMINI_MODELS if m != self.model_name]
        response = None
        last_error = None

        for model_name in models_to_try:
            try:
                response = self.client.models.generate_content(
                    model=model_name,
                    contents=[prompt, image_part],
                    config=types.GenerateContentConfig(response_mime_type="application/json")
                )
                if response and response.text:
                    break
            except Exception as e:
                err_msg = str(e)
                if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "Quota" in err_msg:
                    logger.warning("Handwritten OCR AI model %s hit rate limit (429). Retrying fallback model...", model_name)
                    last_error = e
                    continue
                else:
                    logger.error("Gemini handwriting extraction error: %s", e)
                    raise RuntimeError(f"Handwriting AI Vision service error: {e}") from e

        if not response and last_error:
            if PYTESSERACT_AVAILABLE:
                return self._extract_via_tesseract(image_bytes)
            return {
                "raw_text": "Gemini API rate limit reached.",
                "has_address": False,
                "extracted_address": None,
                "address_components": {},
                "recipient_name": None,
                "additional_notes": None,
                "handwriting_legibility": "low",
                "confidence": 0.0,
                "spoken_summary": "Gemini API rate limit reached. Please wait a few seconds before trying again."
            }

        raw_json = response.text.strip() if response and response.text else "{}"
        data = json.loads(raw_json)

        # Ensure default keys
        data.setdefault("raw_text", "")
        data.setdefault("has_address", False)
        data.setdefault("extracted_address", None)
        data.setdefault("address_components", {})
        data.setdefault("recipient_name", None)
        data.setdefault("additional_notes", None)
        data.setdefault("handwriting_legibility", "medium")
        data.setdefault("confidence", 0.85)

        # Build spoken summary
        spoken_summary = self.build_spoken_summary(data)
        data["spoken_summary"] = spoken_summary
        return data

    def _extract_via_tesseract(self, image_bytes: bytes) -> Dict[str, Any]:
        """Local OCR fallback using PyTesseract."""
        try:
            pil_img = Image.open(io.BytesIO(image_bytes))
            raw_text = pytesseract.image_to_string(pil_img)
            clean_text = raw_text.strip()

            data = {
                "raw_text": clean_text,
                "has_address": len(clean_text) > 10,
                "extracted_address": clean_text if len(clean_text) > 10 else None,
                "address_components": {"street_address": clean_text},
                "recipient_name": None,
                "additional_notes": None,
                "handwriting_legibility": "medium",
                "confidence": 0.60,
                "provider": "tesseract_local"
            }
            data["spoken_summary"] = self.build_spoken_summary(data)
            return data
        except Exception as e:
            logger.error("Tesseract OCR fallback failed: %s", e)
            raise RuntimeError(f"Tesseract local OCR error: {e}") from e

    @staticmethod
    def build_spoken_summary(data: Dict[str, Any]) -> str:
        """Constructs a calm, spoken voice narration string for visually impaired users."""
        parts = []
        if data.get("extracted_address"):
            parts.append(f"Handwritten address read as: {data['extracted_address']}.")
        elif data.get("raw_text"):
            parts.append(f"Handwritten text reads: {data['raw_text']}.")
        else:
            return "Could not read any clear handwritten text on the paper."

        if data.get("recipient_name"):
            parts.append(f"Addressed to: {data['recipient_name']}.")

        if data.get("additional_notes"):
            parts.append(f"Additional notes: {data['additional_notes']}.")

        return " ".join(parts)

    def speak(self, text: str) -> Optional[str]:
        """Synthesizes voice summary to MP3 audio file."""
        if not text or not text.strip():
            return None
        try:
            tts = gTTS(text=text.strip(), lang="en")
            output_path = "handwritten_reading.mp3"
            tts.save(output_path)
            return output_path
        except Exception as e:
            logger.error("TTS audio synthesis error in HandwrittenTextExtractor: %s", e)
            return None


def main():
    """Standalone Streamlit interface for testing handwriting extraction on paper images."""
    import streamlit as st
    st.set_page_config(page_title="Handwritten Paper & Address Reader", layout="wide")
    st.title("📝 Handwritten Image & Paper Address Extractor")
    st.caption("Machine Learning & AI Vision system to read handwritten notes, letters, and paper addresses.")
    st.markdown("---")

    extractor = HandwrittenTextExtractor()

    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("📷 Upload Handwritten Image")
        uploaded_file = st.file_uploader(
            "Select an image of paper, sticky note, or envelope",
            type=["jpg", "jpeg", "png", "webp"]
        )

        enable_preprocess = st.checkbox("Enhance Contrast & Sharpen Handwriting", value=True)

        if uploaded_file:
            st.image(uploaded_file, caption="Uploaded Handwritten Document", use_container_width=True)

    with col2:
        st.subheader("🧠 Extracted Information")
        if uploaded_file:
            if st.button("🔍 Extract Handwritten Text & Address", type="primary"):
                with st.spinner("Processing handwriting with AI Vision..."):
                    img_bytes = uploaded_file.read()
                    try:
                        result = extractor.extract_from_written_image(img_bytes, preprocess=enable_preprocess)

                        st.success("Handwriting Extracted Successfully!")
                        st.write(f"**Spoken Narration:** {result.get('spoken_summary')}")

                        if result.get("extracted_address"):
                            st.info(f"**Full Address:** {result['extracted_address']}")

                        if result.get("raw_text"):
                            st.markdown("### 📝 Full Raw Transcript:")
                            st.text_area("Raw Text", result["raw_text"], height=120)

                        st.markdown("### 📊 Json Structure:")
                        st.json(result)

                        audio_path = extractor.speak(result.get("spoken_summary"))
                        if audio_path and os.path.exists(audio_path):
                            st.audio(audio_path)

                    except Exception as e:
                        st.error(f"Extraction error: {e}")
        else:
            st.info("Upload an image of a handwritten paper or note on the left to begin.")


if __name__ == "__main__":
    main()
