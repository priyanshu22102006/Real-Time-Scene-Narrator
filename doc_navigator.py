"""
doc_navigator.py
Standalone Document Processing & Image-to-GPS Navigation System.

Features:
1. Multi-format Document Processing:
   - Images (.jpg, .jpeg, .png, .webp): PIL.Image
   - PDFs (.pdf): pdf2image page conversion
   - Word Documents (.docx): python-docx text extraction
2. Address Extraction via Gemini AI (extract_address(file))
3. GPS Geocoding via Google Maps API (googlemaps client with Nominatim fallback)
4. Interactive Auto-Locate UI with Streamlit:
   - Button: "📖 Read Address & Start Navigation"
"""

import os
import io
import json
import logging
from typing import Optional, Dict, Any, Union, List, Tuple
from PIL import Image

import streamlit as st
from dotenv import load_dotenv

# Document Processing Libraries
try:
    from pdf2image import convert_from_bytes
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False

try:
    import docx
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

# Google Maps API & Geocoding Fallback
try:
    import googlemaps
    GOOGLEMAPS_AVAILABLE = True
except ImportError:
    GOOGLEMAPS_AVAILABLE = False

try:
    from geopy.geocoders import Nominatim
    GEOPY_AVAILABLE = True
except ImportError:
    GEOPY_AVAILABLE = False

# Gemini AI & Text-To-Speech
from google import genai
from google.genai import types
from gtts import gTTS

load_dotenv()

logger = logging.getLogger("visionmate.doc_navigator")

# Environment Keys & Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyCJYEAaMaqQrV_BCR6ltw5CecH2yrNymUA")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


# ---------------------------------------------------------------- Document Processing
class DocumentProcessor:
    """Handles multi-format document parsing (Images, PDFs, Word docs)."""

    @staticmethod
    def process_file(file_bytes: bytes, filename: str) -> Dict[str, Any]:
        """
        Parses `file_bytes` based on extension or mime type into data ready for Gemini.
        Returns:
            {
              "type": "image" | "text",
              "images": List[Image.Image],
              "text": str
            }
        """
        ext = filename.lower().split(".")[-1] if "." in filename else ""

        # 1. Images
        if ext in ["jpg", "jpeg", "png", "webp", "bmp"]:
            try:
                img = Image.open(io.BytesIO(file_bytes))
                return {"type": "image", "images": [img], "text": ""}
            except Exception as e:
                raise ValueError(f"Failed to open image file: {e}") from e

        # 2. PDF Documents
        elif ext == "pdf":
            if not PDF2IMAGE_AVAILABLE:
                raise RuntimeError("pdf2image library is not installed.")
            try:
                # Convert PDF pages to PIL Images
                images = convert_from_bytes(file_bytes)
                if not images:
                    raise ValueError("PDF file contains no renderable pages.")
                return {"type": "image", "images": images, "text": ""}
            except Exception as e:
                raise ValueError(
                    f"PDF processing error (ensure Poppler is installed): {e}"
                ) from e

        # 3. Word Documents (.docx)
        elif ext == "docx":
            if not DOCX_AVAILABLE:
                raise RuntimeError("python-docx library is not installed.")
            try:
                doc = docx.Document(io.BytesIO(file_bytes))
                full_text = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
                if not full_text.strip():
                    raise ValueError("Word document (.docx) contains no readable text.")
                return {"type": "text", "images": [], "text": full_text}
            except Exception as e:
                raise ValueError(f"Word document processing error: {e}") from e

        # Default Fallback: Attempt PIL Image
        else:
            try:
                img = Image.open(io.BytesIO(file_bytes))
                return {"type": "image", "images": [img], "text": ""}
            except Exception:
                raise ValueError(f"Unsupported file format '.{ext}'. Supported: JPG, PNG, WEBP, PDF, DOCX")


# ---------------------------------------------------------------- Address Extraction Logic
def extract_address(file_bytes: bytes, filename: str, api_key: Optional[str] = None) -> Dict[str, Any]:
    """
    Uses Gemini AI to find and extract postal addresses, building names, and landmarks from
    Images, PDFs, or Word documents.
    """
    key = api_key or GEMINI_API_KEY
    if not key or key == "YOUR_GEMINI_API_KEY":
        raise ValueError("GEMINI_API_KEY is not configured.")

    client = genai.Client(api_key=key)
    parsed = DocumentProcessor.process_file(file_bytes, filename)

    prompt = (
        "Extract any geographical address, building/storefront name, or landmark mentioned "
        "in this document/image. Respond ONLY with a valid JSON object matching this schema:\n"
        "{\n"
        '  "extracted_address": "full postal address or best guess",\n'
        '  "building_or_place_name": "name of building/business or null",\n'
        '  "landmark": "nearby landmark or null",\n'
        '  "confidence": "high" | "medium" | "low"\n'
        "}"
    )

    contents = [prompt]

    if parsed["type"] == "image" and parsed["images"]:
        # Convert first image to bytes for Gemini
        img = parsed["images"][0]
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        img_part = types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg")
        contents.append(img_part)
    elif parsed["type"] == "text":
        contents.append(f"\nDOCUMENT CONTENT:\n{parsed['text']}")

    from config import FALLBACK_GEMINI_MODELS

    models_to_try = [GEMINI_MODEL] + [m for m in FALLBACK_GEMINI_MODELS if m != GEMINI_MODEL]
    response = None
    last_error = None

    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            if response and response.text:
                break
        except Exception as e:
            err_msg = str(e)
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "Quota" in err_msg:
                logger.warning("Gemini model %s hit rate limit (429). Retrying fallback model...", model_name)
                last_error = e
                continue
            else:
                logger.error("Gemini address extraction error: %s", e)
                raise RuntimeError(f"Gemini address extraction error: {e}") from e

    if not response and last_error:
        err_str = str(last_error)
        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota" in err_str:
            return {
                "extracted_address": "",
                "building_or_place_name": None,
                "landmark": None,
                "confidence": "low",
                "notice": "Gemini API rate limit reached. Please wait a moment before trying again."
            }

    raw_response = response.text.strip() if response and response.text else "{}"
    try:
        data = json.loads(raw_response)
    except json.JSONDecodeError:
        cleaned = raw_response.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            data = {
                "extracted_address": raw_response,
                "building_or_place_name": None,
                "landmark": None,
                "confidence": "low",
            }

    data.setdefault("extracted_address", "")
    data.setdefault("building_or_place_name", None)
    data.setdefault("landmark", None)
    data.setdefault("confidence", "low")
    return data


# ---------------------------------------------------------------- GPS Geocoding (Google Maps & Fallback)
def geocode_address_gps(address: str, maps_api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Geocodes an address string to precise GPS coordinates (lat, lng).
    Uses Google Maps Client if API key is provided, with fallback to Nominatim (geopy).
    """
    key = maps_api_key or GOOGLE_MAPS_API_KEY or os.getenv("GOOGLE_MAPS_API_KEY", "")

    # Primary: Google Maps API Client
    if key and GOOGLEMAPS_AVAILABLE:
        try:
            gmaps = googlemaps.Client(key=key)
            geocode_result = gmaps.geocode(address)
            if geocode_result:
                loc = geocode_result[0]["geometry"]["location"]
                formatted = geocode_result[0].get("formatted_address", address)
                return {
                    "lat": loc["lat"],
                    "lng": loc["lng"],
                    "formatted_address": formatted,
                    "provider": "google_maps",
                }
        except Exception as e:
            logger.warning("Google Maps geocoding failed: %s. Falling back to Nominatim.", e)

    # Fallback: Nominatim / geopy
    if GEOPY_AVAILABLE:
        try:
            geolocator = Nominatim(user_agent="visionmate-doc-navigator/1.0")
            location = geolocator.geocode(address)
            if location:
                return {
                    "lat": location.latitude,
                    "lng": location.longitude,
                    "formatted_address": location.address,
                    "provider": "nominatim_geopy",
                }
        except Exception as e:
            logger.error("Nominatim geocoding failed: %s", e)

    return None


# ---------------------------------------------------------------- Audio Synthesis
def synthesize_audio(text: str) -> Optional[str]:
    """Synthesizes text into spoken MP3 audio file using gTTS."""
    if not text or not text.strip():
        return None
    try:
        tts = gTTS(text=text, lang="en")
        audio_file = "doc_navigation_audio.mp3"
        tts.save(audio_file)
        return audio_file
    except Exception as e:
        logger.error("TTS Audio Synthesis Error: %s", e)
        return None


# ---------------------------------------------------------------- Auto-Locate Streamlit UI
def run_doc_navigator_ui():
    st.set_page_config(page_title="Document Reader & GPS Navigator", layout="wide")
    st.title("📖 Image & Document to GPS Navigation")
    st.caption("Upload an Image, PDF, or Word (.docx) file to extract addresses and launch GPS navigation.")
    st.markdown("---")

    col1, col2 = st.columns([1, 1])

    with col1:
        st.subheader("📄 Document Upload")
        uploaded_file = st.file_uploader(
            "Upload Image, PDF, or Word Document",
            type=["jpg", "jpeg", "png", "webp", "pdf", "docx"],
            help="Upload a street sign photo, invoice PDF, or Word document containing an address."
        )

        btn_auto_locate = st.button("📖 Read Address & Start Navigation", type="primary", use_container_width=True)

    with col2:
        st.subheader("📍 Navigation & Map State")

        if btn_auto_locate:
            if not uploaded_file:
                st.warning("Please upload an Image, PDF, or Word document first.")
            else:
                with st.spinner("Extracting address using Gemini AI..."):
                    file_bytes = uploaded_file.read()
                    filename = uploaded_file.name

                    try:
                        extraction = extract_address(file_bytes, filename)
                        extracted_addr = extraction.get("extracted_address", "")

                        if not extracted_addr or extracted_addr == "null":
                            st.error("Could not confidently identify an address in the uploaded document.")
                        else:
                            st.success(f"**Extracted Address:** {extracted_addr}")
                            if extraction.get("building_or_place_name"):
                                st.info(f"**Place Name:** {extraction['building_or_place_name']}")

                            # GPS Geocoding Step
                            with st.spinner("Geocoding coordinates via GPS Link..."):
                                gps_result = geocode_address_gps(extracted_addr, maps_api_key=GOOGLE_MAPS_API_KEY)

                                if gps_result:
                                    lat, lng = gps_result["lat"], gps_result["lng"]
                                    st.write(f"**GPS Coordinates:** Lat `{lat}`, Lng `{lng}`")
                                    st.caption(f"Provider: `{gps_result['provider']}`")

                                    # Update Map State in Streamlit
                                    map_data = [{"lat": lat, "lon": lng}]
                                    st.map(map_data, zoom=15)

                                    # Voice Narration
                                    speech_text = f"Address identified as {extracted_addr}. GPS location updated to latitude {lat:.4f}, longitude {lng:.4f}."
                                    audio_path = synthesize_audio(speech_text)
                                    if audio_path:
                                        st.audio(audio_path)
                                else:
                                    st.warning("Address extracted successfully, but could not derive GPS coordinates.")

                    except Exception as err:
                        st.error(f"Error processing document: {err}")
        else:
            st.info("Upload a document and click '📖 Read Address & Start Navigation' to process.")


if __name__ == "__main__":
    run_doc_navigator_ui()
