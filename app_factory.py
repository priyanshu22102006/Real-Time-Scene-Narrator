"""
app_factory.py
Flask Application Factory for VisionMate.
Assembles configuration, middleware, CORS, security headers, modular blueprints, and background managers.
"""

import os
import logging
import threading
import time
from flask import Flask, jsonify
from flask_cors import CORS

from config import get_config
from modules.audio_manager import AudioManager
from modules.object_detector import SessionObjectDetectorManager
from routes.api import api_bp, health_bp
from routes.ui import ui_bp


def configure_logging(app: Flask):
    """Configure structured logging for VisionMate."""
    log_level = getattr(logging, app.config.get("LOG_LEVEL", "INFO").upper(), logging.INFO)
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "[%(asctime)s] [%(process)d] [%(levelname)s] [%(name)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S %z"
    )
    handler.setFormatter(formatter)

    root_logger = logging.getLogger("visionmate")
    root_logger.setLevel(log_level)
    root_logger.addHandler(handler)

    # Avoid duplicate logs from Flask default handler
    app.logger.handlers = root_logger.handlers
    app.logger.setLevel(log_level)


def configure_security_headers(app: Flask):
    """Add security headers to every HTTP response."""
    @app.after_request
    def apply_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


def configure_error_handlers(app: Flask):
    """Register custom JSON error handlers."""
    @app.errorhandler(400)
    def bad_request_error(e):
        return jsonify({"success": False, "error": {"code": "BAD_REQUEST", "message": str(e.description)}}), 400

    @app.errorhandler(404)
    def not_found_error(e):
        return jsonify({"success": False, "error": {"code": "NOT_FOUND", "message": "The requested resource was not found"}}), 404

    @app.errorhandler(413)
    def payload_too_large_error(e):
        return jsonify({"success": False, "error": {"code": "PAYLOAD_TOO_LARGE", "message": "File upload exceeds maximum allowable size (16MB)"}}), 413

    @app.errorhandler(500)
    def internal_server_error(e):
        app.logger.error("Unhandled Internal Server Error: %s", e)
        return jsonify({"success": False, "error": {"code": "INTERNAL_SERVER_ERROR", "message": "An unexpected internal server error occurred"}}), 500


def start_audio_cleanup_worker(audio_mgr: AudioManager, interval_seconds: int = 300):
    """Starts a background thread to periodically clean up expired audio files."""
    def worker():
        while True:
            time.sleep(interval_seconds)
            try:
                audio_mgr.cleanup_expired_files()
            except Exception as e:
                logging.getLogger("visionmate.audio_manager").error("Background audio cleanup failed: %s", e)

    thread = threading.Thread(target=worker, daemon=True, name="AudioCleanupWorker")
    thread.start()


def create_app(config_class=None) -> Flask:
    """Application factory for VisionMate Flask app."""
    app = Flask(__name__, template_folder="templates", static_folder="static")

    if config_class is None:
        config_class = get_config()

    app.config.from_object(config_class)

    # Logging
    configure_logging(app)
    app.logger.info("Initializing VisionMate in %s mode...", app.config.get("ENV"))

    # CORS
    CORS(app, resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS", "*")}})

    # Security Headers & Error Handlers
    configure_security_headers(app)
    configure_error_handlers(app)

    # Initialize Services/Managers
    audio_mgr = AudioManager(
        storage_dir=app.config["AUDIO_STORAGE_DIR"],
        ttl_seconds=app.config["AUDIO_TTL_SECONDS"]
    )
    detector_mgr = SessionObjectDetectorManager(
        model_path=app.config["YOLO_MODEL_PATH"],
        session_timeout=app.config["DETECTOR_SESSION_TIMEOUT_SECONDS"]
    )

    app.config["AUDIO_MANAGER"] = audio_mgr
    app.config["DETECTOR_MANAGER"] = detector_mgr

    # Background audio cleanup
    if not app.config.get("TESTING"):
        start_audio_cleanup_worker(audio_mgr)

    # Register Blueprints
    app.register_blueprint(ui_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(health_bp)

    app.logger.info("VisionMate application factory completed successfully.")
    return app
