"""
object_detection.py
Instant Object Detection & Real-Time Risk Alert System.

Features:
1. Real-Time Local Risk Monitor (YOLOv8 deep neural network object & hazard detector)
2. Intelligent Deep Hazard Analysis via Gemini Multimodal AI (google-genai SDK)
3. Spoken Audio Warnings via gTTS
4. Streamlit WebRTC Interface
"""

import os
import io
import logging
from typing import Optional
from PIL import Image

import cv2
import numpy as np
import streamlit as st
from dotenv import load_dotenv

try:
    import av
    from streamlit_webrtc import webrtc_streamer, WebRtcMode, RTCConfiguration
    WEBRTC_AVAILABLE = True
except ImportError:
    WEBRTC_AVAILABLE = False

from google import genai
from google.genai import types
from gtts import gTTS
from ultralytics import YOLO

from config import GEMINI_API_KEY, GEMINI_MODEL, YOLO_MODEL_PATH

load_dotenv()

logger = logging.getLogger("visionmate.object_detection")

# WebRTC Configuration for Camera
RTC_CONFIGURATION = RTCConfiguration(
    {"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}
) if WEBRTC_AVAILABLE else None

TARGET_CLASSES = {
    0: "PERSON",
    1: "BICYCLE",
    2: "CAR",
    3: "MOTORCYCLE",
    5: "BUS",
    6: "TRAIN",
    7: "TRUCK",
    15: "CAT",
    16: "DOG",
    24: "BACKPACK",
    26: "HANDBAG",
    39: "BOTTLE",
    41: "CUP",
    46: "BANANA",
    47: "APPLE",
    49: "ORANGE",
    56: "CHAIR",
    57: "COUCH",
    58: "POTTED PLANT",
    62: "TV",
    63: "LAPTOP",
    67: "CELL PHONE",
}


class ObjectDetector:
    """Combines fast real-time YOLOv8 risk detection with deep Gemini AI hazard scanning."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or GEMINI_API_KEY
        if self.api_key and self.api_key != "YOUR_GEMINI_API_KEY":
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None

        # Load YOLOv8 deep neural network model
        try:
            self.yolo = YOLO(YOLO_MODEL_PATH)
        except Exception as e:
            logger.error("Failed to load YOLO model: %s", e)
            self.yolo = None

    def local_detect(self, frame: np.ndarray) -> np.ndarray:
        """Fast local detection using YOLOv8 deep neural network (high confidence threshold)."""
        if frame is None or frame.size == 0 or self.yolo is None:
            return frame

        try:
            # Require conf >= 0.50 to eliminate false positive background detections
            results = self.yolo.predict(frame, verbose=False, conf=0.50)[0]
            if results.boxes is not None and len(results.boxes) > 0:
                boxes = results.boxes.xyxy.cpu().numpy()
                class_ids = results.boxes.cls.cpu().numpy().astype(int)
                confidences = results.boxes.conf.cpu().numpy()

                for box, cls_id, conf in zip(boxes, class_ids, confidences):
                    if cls_id not in TARGET_CLASSES:
                        continue
                    if conf < 0.50:
                        continue

                    label_name = TARGET_CLASSES[cls_id].upper()
                    x1, y1, x2, y2 = map(int, box)

                    # Highlight high-risk hazards (people, vehicles) in red, ambient objects in yellow
                    color = (0, 0, 255) if cls_id in [0, 1, 2, 3, 5, 6, 7] else (0, 215, 255)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
                    text = f"{label_name} {int(conf * 100)}%"
                    cv2.putText(
                        frame,
                        text,
                        (x1, max(y1 - 10, 25)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        color,
                        2,
                    )
        except Exception as e:
            logger.error("YOLO predict error in local_detect: %s", e)

        return frame

    def ai_hazard_analysis(self, image: Image.Image) -> str:
        """Intelligent deep hazard analysis using Gemini AI."""
        if not self.client:
            return "Gemini API Key is not configured. Please check your environment configuration."

        prompt = """
        ACT AS: A real-time safety assistant for a blind or visually impaired person walking.
        TASK: Identify the 3 most critical hazards in this image (e.g. approaching vehicles, obstacles, construction, stairs, people, curbs).
        OUTPUT: Provide a concise, urgent spoken warning for each hazard. Keep total answer under 50 words.
        EXAMPLE: "Warning: A car is parked on your right sidewalk 2 meters ahead."
        """

        img_byte_arr = io.BytesIO()
        image.save(img_byte_arr, format="JPEG")
        img_bytes = img_byte_arr.getvalue()
        image_part = types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")

        from config import FALLBACK_GEMINI_MODELS

        models_to_try = [GEMINI_MODEL] + [m for m in FALLBACK_GEMINI_MODELS if m != GEMINI_MODEL]
        last_error = None

        for model_name in models_to_try:
            try:
                response = self.client.models.generate_content(
                    model=model_name,
                    contents=[prompt, image_part],
                )
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                err_msg = str(e)
                if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "Quota" in err_msg:
                    logger.warning("Gemini hazard scan model %s hit rate limit (429). Retrying fallback model...", model_name)
                    last_error = e
                    continue
                else:
                    logger.error("Gemini AI hazard analysis error: %s", e)
                    return f"AI Hazard Analysis Error: {e}"

        if last_error:
            err_str = str(last_error)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota" in err_str:
                return "Gemini AI rate limit reached. Please wait 30 seconds before requesting another AI hazard scan."

        return "Unable to perform deep hazard scan from camera snapshot."

    def speak(self, text: str) -> Optional[str]:
        """Convert text alert to spoken MP3 audio."""
        if not text or not text.strip():
            return None
        try:
            tts = gTTS(text=text.strip(), lang="en")
            audio_file = "alert.mp3"
            tts.save(audio_file)
            return audio_file
        except Exception as e:
            logger.error("TTS conversion error in ObjectDetector: %s", e)
            return None


def main():
    st.set_page_config(page_title="Instant Object Detection & Risk Alert", layout="wide")
    st.title("🚨 Instant Object Detection & Risk Alert")
    st.markdown("---")

    detector = ObjectDetector()

    col1, col2 = st.columns([2, 1])

    with col1:
        st.subheader("🎥 Real-Time Risk Monitor")
        st.info("Real-time YOLOv8 object & risk monitor active. People, vehicles, and path hazards are highlighted in RED.")

        if WEBRTC_AVAILABLE:
            class VideoProcessor:
                def recv(self, frame):
                    img = frame.to_ndarray(format="bgr24")
                    processed_img = detector.local_detect(img)
                    return av.VideoFrame.from_ndarray(processed_img, format="bgr24")

            webrtc_streamer(
                key="detector",
                mode=WebRtcMode.SENDRECV,
                rtc_configuration=RTC_CONFIGURATION,
                video_processor_factory=VideoProcessor,
                media_stream_constraints={"video": True, "audio": False},
                async_processing=True,
            )
        else:
            st.warning("streamlit-webrtc is unavailable. Use AI Snapshot Scan on the right.")

    with col2:
        st.subheader("🧠 Deep Hazard Scan")
        st.markdown("Capture a snapshot for a detailed Gemini AI safety assessment.")

        img_file = st.camera_input("Snapshot for AI")

        if img_file:
            image = Image.open(img_file)
            if st.button("🔍 Scan for Hazards", type="primary"):
                with st.spinner("Analyzing surroundings for hazards..."):
                    analysis = detector.ai_hazard_analysis(image)
                    st.error(analysis)

                    audio = detector.speak(analysis)
                    if audio:
                        st.audio(audio)

        st.markdown("""
        ### 📋 Detection Guide:
        - **Local Mode**: High FPS YOLOv8 model (conf >= 0.50). Detects people, cars, bikes, chairs, animals, and obstacles in real-time.
        - **AI Mode**: Comprehensive Gemini analysis. Best for complex street scenes, construction zones, or stairs.
        """)


if __name__ == "__main__":
    main()
