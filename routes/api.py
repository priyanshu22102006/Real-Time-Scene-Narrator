"""
routes/api.py
API endpoints for VisionMate services:
1. /api/navigate
2. /api/detect_objects
3. /api/read_address
4. /api/describe_scene
5. /api/audio/<filename>
6. /health & /api/v1/health
"""

import logging

import cv2
import numpy as np
from flask import Blueprint, request, jsonify, send_file, current_app, Response

from modules.scene_ai import describe_scene, extract_address_and_landmarks
from modules.navigator import geocode_address, get_walking_route, build_narration
from modules.guidance_fusion import ActiveGuidanceSystem
from modules.assistant_ai import ask_ai_assistant
from modules.tts_engine import synthesize_speech
from doc_navigator import extract_address, geocode_address_gps




api_bp = Blueprint("api", __name__, url_prefix="/api")
health_bp = Blueprint("health", __name__)

logger = logging.getLogger("visionmate.api")


def _speak_helper(text: str) -> str:
    """Helper to synthesize `text` to MP3 bytes via audio_manager and return its URL."""
    audio_mgr = current_app.config["AUDIO_MANAGER"]
    try:
        audio_bytes = synthesize_speech(text)
        filename = audio_mgr.save_audio(audio_bytes)
        return f"/api/audio/{filename}"
    except Exception as e:
        logger.error("TTS synthesis error in _speak_helper: %s", e)
        return None


# ---------------------------------------------------------------- Health Probes
@health_bp.route("/health", methods=["GET"])
@api_bp.route("/v1/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy",
        "service": "visionmate",
        "version": "2.0.0"
    }), 200


# ---------------------------------------------------------------- Feature 4
@api_bp.route("/describe_scene", methods=["POST"])
def api_describe_scene():
    """Given a JPEG upload, describe the whole scene out loud."""
    if "image" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FILE", "message": "No image uploaded (multipart field name: 'image')"}
        }), 400

    image_file = request.files["image"]
    if not image_file.filename:
        return jsonify({
            "success": False,
            "error": {"code": "EMPTY_FILE", "message": "Uploaded image file is empty"}
        }), 400

    try:
        image_bytes = image_file.read()
        description = describe_scene(image_bytes)
        audio_url = _speak_helper(description)

        return jsonify({
            "success": True,
            "description": description,
            "audio_url": audio_url
        }), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": {"code": "INVALID_INPUT", "message": str(ve)}}), 400
    except Exception as e:
        logger.exception("Error in /api/describe_scene: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(e)}}), 500


# ---------------------------------------------------------------- Feature 3
@api_bp.route("/read_address", methods=["POST"])
def api_read_address():
    """Given a JPEG upload (street sign or storefront), extract address/landmarks and geocode it."""
    if "image" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FILE", "message": "No image uploaded (multipart field name: 'image')"}
        }), 400

    image_file = request.files["image"]
    if not image_file.filename:
        return jsonify({
            "success": False,
            "error": {"code": "EMPTY_FILE", "message": "Uploaded image file is empty"}
        }), 400

    try:
        image_bytes = image_file.read()
        extracted = extract_address_and_landmarks(image_bytes)

        geocoded = None
        if extracted.get("possible_address"):
            geocoded = geocode_address(extracted["possible_address"])

        parts = []
        if extracted.get("possible_address"):
            parts.append(f"I believe this location is {extracted['possible_address']}.")
        if extracted.get("landmarks"):
            parts.append("Nearby landmarks include " + ", ".join(extracted["landmarks"]) + ".")
        if not parts:
            parts.append("I could not confidently identify an address in this image.")
        speech_text = " ".join(parts)

        audio_url = _speak_helper(speech_text)

        return jsonify({
            "success": True,
            "extracted": extracted,
            "geocoded": geocoded,
            "speech": speech_text,
            "audio_url": audio_url,
        }), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": {"code": "INVALID_INPUT", "message": str(ve)}}), 400
    except Exception as e:
        logger.exception("Error in /api/read_address: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(e)}}), 500


# ---------------------------------------------------------------- Feature 2
@api_bp.route("/detect_objects", methods=["POST"])
def api_detect_objects():
    """
    Given a single video frame (JPEG), return hazard alerts for moving vehicles.
    Uses session tracking via X-Client-ID header or session_id payload to isolate users.
    """
    if "frame" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FILE", "message": "No frame uploaded (multipart field name: 'frame')"}
        }), 400

    # Extract session identifier for thread/user state isolation
    session_id = request.headers.get("X-Client-ID", request.args.get("session_id", "default_session"))
    detector_mgr = current_app.config["DETECTOR_MANAGER"]
    detector = detector_mgr.get_detector(session_id)

    try:
        file_bytes = np.frombuffer(request.files["frame"].read(), np.uint8)
        if len(file_bytes) == 0:
            return jsonify({
                "success": False,
                "error": {"code": "EMPTY_FRAME", "message": "Uploaded video frame is empty"}
            }), 400

        frame = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        if frame is None:
            return jsonify({
                "success": False,
                "error": {"code": "DECODE_ERROR", "message": "Could not decode uploaded image frame"}
            }), 400

        _, alerts = detector.process_frame(frame)

        audio_url = None
        if alerts:
            combined_message = " ".join(a["message"] for a in alerts)
            audio_url = _speak_helper(combined_message)

        return jsonify({
            "success": True,
            "session_id": session_id,
            "alerts": alerts,
            "audio_url": audio_url
        }), 200
    except Exception as e:
        logger.exception("Error in /api/detect_objects: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(e)}}), 500


# ---------------------------------------------------------------- Feature 1 (GPS Navigation with Voice Commands)
@api_bp.route("/navigate", methods=["POST"])
def api_navigate():
    """
    Given a start and destination (text address or [lat, lon]), return turn-by-turn voice guidance.
    """
    payload = request.get_json(force=True, silent=True) or {}
    start = payload.get("start")
    destination = payload.get("destination")
    if not start or not destination:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_PARAMETERS", "message": "'start' and 'destination' are required fields"}
        }), 400

    try:
        from gps_navigator import GPSNavigator
        navigator = GPSNavigator()

        route_info = navigator.get_route_guidance(start, destination)
        narration = route_info.get("narration", "")
        audio_url = _speak_helper(narration)

        return jsonify({
            "success": True,
            "route": route_info,
            "narration": narration,
            "voice_commands": route_info.get("voice_commands", []),
            "total_distance": route_info.get("total_distance"),
            "total_duration": route_info.get("total_duration"),
            "maps_url": route_info.get("maps_url"),
            "audio_url": audio_url
        }), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": {"code": "GEOCODE_FAILED", "message": str(ve)}}), 400
    except Exception as e:
        logger.exception("Error in /api/navigate: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(e)}}), 500


# ---------------------------------------------------------------- Feature 5 (Fused Sighted Guide)
@api_bp.route("/fused_guidance", methods=["POST"])
def api_fused_guidance():
    """
    Given a camera frame JPEG + GPS instruction string + optional personal context,
    return fused real-time sighted-guide narration that combines navigation with visual safety alerts.
    """
    if "image" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FILE", "message": "No image uploaded (multipart field name: 'image')"}
        }), 400

    image_file = request.files["image"]
    gps_instruction = request.form.get("gps_instruction", "Walk straight")
    personal_context = request.form.get("personal_context", "")

    try:
        image_bytes = image_file.read()
        guidance_sys = ActiveGuidanceSystem()
        fused_narration = guidance_sys.get_fused_guidance(
            image_bytes=image_bytes,
            gps_instruction=gps_instruction,
            personal_context=personal_context
        )
        audio_url = _speak_helper(fused_narration)

        return jsonify({
            "success": True,
            "guidance": fused_narration,
            "audio_url": audio_url
        }), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": {"code": "INVALID_INPUT", "message": str(ve)}}), 400
    except Exception as e:
        logger.exception("Error in /api/fused_guidance: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(e)}}), 500


# ---------------------------------------------------------------- Feature 6 (Document & Image-to-GPS Navigator)
@api_bp.route("/process_document", methods=["POST"])
def api_process_document():
    """
    Given an uploaded document (Image, PDF, or Word .docx file), extract an address via Gemini AI,
    geocode its GPS coordinates, and generate audio narration.
    """
    if "file" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FILE", "message": "No document uploaded (multipart field name: 'file')"}
        }), 400

    doc_file = request.files["file"]
    if not doc_file.filename:
        return jsonify({
            "success": False,
            "error": {"code": "EMPTY_FILE", "message": "Uploaded document file is empty"}
        }), 400

    maps_api_key = request.form.get("google_maps_key", "")

    try:
        file_bytes = doc_file.read()
        filename = doc_file.filename

        extraction = extract_address(file_bytes, filename)
        extracted_addr = extraction.get("extracted_address", "")

        geocoded = None
        if extracted_addr and extracted_addr != "null":
            geocoded = geocode_address_gps(extracted_addr, maps_api_key=maps_api_key)

        speech_text = ""
        if extracted_addr:
            speech_text = f"Address identified as {extracted_addr}."
            if geocoded:
                speech_text += f" GPS coordinates: latitude {geocoded['lat']:.4f}, longitude {geocoded['lng']:.4f}."
        else:
            speech_text = "Could not identify an address in the uploaded document."

        audio_url = _speak_helper(speech_text)

        return jsonify({
            "success": True,
            "filename": filename,
            "extraction": extraction,
            "geocoded": geocoded,
            "speech": speech_text,
            "audio_url": audio_url
        }), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": {"code": "INVALID_INPUT", "message": str(ve)}}), 400
    except Exception as e:
        logger.exception("Error in /api/process_document: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(e)}}), 500


# ---------------------------------------------------------------- Feature 7 (Interactive AI Vision Voice Assistant)
@api_bp.route("/ask_assistant", methods=["POST"])
def api_ask_assistant():
    """
    Given a camera frame JPEG upload and a user question, return a spoken AI answer.
    """
    if "image" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FILE", "message": "No image frame uploaded (multipart field name: 'image')"}
        }), 400

    image_file = request.files["image"]
    question = request.form.get("question", "What is in front of me?")

    try:
        image_bytes = image_file.read()
        answer = ask_ai_assistant(image_bytes=image_bytes, user_question=question)
        audio_url = _speak_helper(answer)

        return jsonify({
            "success": True,
            "question": question,
            "answer": answer,
            "audio_url": audio_url
        }), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": {"code": "INVALID_INPUT", "message": str(ve)}}), 400
    except Exception as e:
        logger.exception("Error in /api/ask_assistant: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_ERROR", "message": str(e)}}), 500





# ---------------------------------------------------------------- Audio File Serving
@api_bp.route("/audio/<filename>", methods=["GET"])
def serve_audio(filename):
    """Safely serve generated TTS audio files."""
    audio_mgr = current_app.config["AUDIO_MANAGER"]
    file_path = audio_mgr.get_audio_path(filename)

    if not file_path:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "Audio file not found or expired"}
        }), 404

    return send_file(file_path, mimetype="audio/mpeg", as_attachment=False)
