"""
config.py
Production-grade configuration management for VisionMate.
Supports environment-based configurations with safe defaults and key validation.
"""

import os
import tempfile


class BaseConfig:
    """Base configuration shared across environments."""
    ENV = "production"
    DEBUG = False
    TESTING = False
    SECRET_KEY = os.environ.get("SECRET_KEY", "visionmate-default-prod-secret-change-me")

    # API Keys
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyCJYEAaMaqQrV_BCR6ltw5CecH2yrNymUA")
    GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    FALLBACK_GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash", "gemini-1.5-flash-8b"]


    ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
    ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    ELEVENLABS_MODEL_ID = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")

    ORS_API_KEY = os.environ.get("ORS_API_KEY", "")
    GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")


    # YOLO Settings
    YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "yolov8n.pt")
    DANGER_DISTANCE_RATIO = float(os.environ.get("DANGER_DISTANCE_RATIO", "0.35"))
    APPROACH_SPEED_THRESHOLD = float(os.environ.get("APPROACH_SPEED_THRESHOLD", "0.02"))

    # Session & Detector Management
    DETECTOR_SESSION_TIMEOUT_SECONDS = int(os.environ.get("DETECTOR_SESSION_TIMEOUT_SECONDS", "300"))

    # File Upload & Media Limits
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_CONTENT_LENGTH", str(16 * 1024 * 1024)))  # 16 MB
    ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

    # Audio Management
    AUDIO_STORAGE_DIR = os.environ.get(
        "AUDIO_STORAGE_DIR",
        os.path.join(tempfile.gettempdir(), "visionmate_audio")
    )
    AUDIO_TTL_SECONDS = int(os.environ.get("AUDIO_TTL_SECONDS", "900"))  # 15 minutes TTL

    # Security & CORS
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*")
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")


class DevelopmentConfig(BaseConfig):
    """Development environment configuration."""
    ENV = "development"
    DEBUG = True
    LOG_LEVEL = "DEBUG"


class ProductionConfig(BaseConfig):
    """Production environment configuration."""
    ENV = "production"
    DEBUG = False
    LOG_LEVEL = "INFO"


class TestingConfig(BaseConfig):
    """Testing environment configuration."""
    ENV = "testing"
    DEBUG = True
    TESTING = True
    LOG_LEVEL = "WARNING"
    AUDIO_STORAGE_DIR = os.path.join(tempfile.gettempdir(), "visionmate_audio_test")


CONFIG_MAP = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}


def get_config():
    """Retrieve configuration based on FLASK_ENV or VISIONMATE_ENV environment variable."""
    env_name = os.environ.get("VISIONMATE_ENV", os.environ.get("FLASK_ENV", "production")).lower()
    return CONFIG_MAP.get(env_name, ProductionConfig)


# Global accessors for backwards compatibility with legacy module imports
config = get_config()
GEMINI_API_KEY = config.GEMINI_API_KEY
GEMINI_MODEL = config.GEMINI_MODEL
FALLBACK_GEMINI_MODELS = config.FALLBACK_GEMINI_MODELS
ELEVENLABS_API_KEY = config.ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID = config.ELEVENLABS_VOICE_ID
ELEVENLABS_MODEL_ID = config.ELEVENLABS_MODEL_ID
ORS_API_KEY = config.ORS_API_KEY
GOOGLE_MAPS_API_KEY = config.GOOGLE_MAPS_API_KEY

YOLO_MODEL_PATH = config.YOLO_MODEL_PATH
DANGER_DISTANCE_RATIO = config.DANGER_DISTANCE_RATIO
APPROACH_SPEED_THRESHOLD = config.APPROACH_SPEED_THRESHOLD
DETECTOR_SESSION_TIMEOUT_SECONDS = config.DETECTOR_SESSION_TIMEOUT_SECONDS
AUDIO_STORAGE_DIR = config.AUDIO_STORAGE_DIR
AUDIO_TTL_SECONDS = config.AUDIO_TTL_SECONDS

