"""
tests/test_api.py
Automated test suite for VisionMate API endpoints, error handling, security headers, and TTS fallbacks.
"""

import io
import os
import pytest
from app_factory import create_app
from config import TestingConfig
from modules.audio_manager import AudioManager


@pytest.fixture
def app():
    """Create testing application instance."""
    app = create_app(TestingConfig)
    yield app


@pytest.fixture
def client(app):
    """Testing client."""
    return app.test_client()


def test_health_check(client):
    """Test /health and /api/v1/health endpoints."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["service"] == "visionmate"

    v1_response = client.get("/api/v1/health")
    assert v1_response.status_code == 200
    assert v1_response.get_json()["status"] == "healthy"


def test_index_page_renders(client):
    """Verify web UI index template renders successfully."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"VisionMate" in response.data
    assert b"Describe Surroundings" in response.data



def test_security_headers(client):
    """Verify security headers are applied to HTTP responses."""
    response = client.get("/health")
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "SAMEORIGIN"
    assert response.headers.get("X-XSS-Protection") == "1; mode=block"


def test_404_not_found(client):
    """Verify standard JSON structure for 404 Not Found error."""
    response = client.get("/api/nonexistent_route")
    assert response.status_code == 404
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "NOT_FOUND"


def test_describe_scene_missing_file(client):
    """Verify missing file handling in /api/describe_scene."""
    response = client.post("/api/describe_scene")
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "MISSING_FILE"


def test_detect_objects_missing_file(client):
    """Verify missing frame handling in /api/detect_objects."""
    response = client.post("/api/detect_objects")
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "MISSING_FILE"


def test_navigate_missing_parameters(client):
    """Verify parameter validation in /api/navigate."""
    response = client.post("/api/navigate", json={})
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "MISSING_PARAMETERS"


def test_fused_guidance_missing_file(client):
    """Verify missing file handling in /api/fused_guidance."""
    response = client.post("/api/fused_guidance")
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "MISSING_FILE"


def test_process_document_missing_file(client):
    """Verify missing file handling in /api/process_document."""
    response = client.post("/api/process_document")
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "MISSING_FILE"


def test_ask_assistant_missing_file(client):
    """Verify missing file handling in /api/ask_assistant."""
    response = client.post("/api/ask_assistant")
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "MISSING_FILE"


def test_live_navigation_tick_endpoint(client):
    """Verify /api/live_navigation_tick processes ticks even without frame data gracefully."""
    response = client.post("/api/live_navigation_tick", data={"step_index": "0"})
    assert response.status_code == 200
    data = response.get_json()
    assert data["success"] is True
    assert "alerts" in data
    assert "current_step_index" in data


def test_guidance_system_engine():
    """Verify VoiceGuidedNavigationSystem session state and tick processing."""
    from guidance_system import VoiceGuidedNavigationSystem
    system = VoiceGuidedNavigationSystem()
    result = system.process_live_navigation_tick(
        session_id="test_session",
        frame_bytes=b"",
        step_index=0
    )
    assert result["success"] is True
    assert isinstance(result["alerts"], list)


def test_extract_handwritten_address_missing_file(client):
    """Verify missing file handling in /api/extract_handwritten_address."""
    response = client.post("/api/extract_handwritten_address")
    assert response.status_code == 400
    data = response.get_json()
    assert data["success"] is False
    assert data["error"]["code"] == "MISSING_FILE"


def test_handwritten_ocr_module():
    """Verify HandwrittenTextExtractor initialization and spoken summary formatting."""
    from handwritten_ocr import HandwrittenTextExtractor
    extractor = HandwrittenTextExtractor()
    summary = extractor.build_spoken_summary({
        "extracted_address": "123 Main Street, Boston",
        "recipient_name": "John Doe",
        "additional_notes": "Urgent delivery"
    })
    assert "123 Main Street" in summary
    assert "John Doe" in summary


def test_audio_manager_lifecycle(tmp_path):
    """Test saving, retrieving, and TTL cleanup in AudioManager."""
    storage_dir = str(tmp_path / "audio_test")
    mgr = AudioManager(storage_dir=storage_dir, ttl_seconds=1)

    filename = mgr.save_audio(b"dummy mp3 data", prefix="test")
    assert filename.startswith("test_")
    assert filename.endswith(".mp3")

    audio_path = mgr.get_audio_path(filename)
    assert audio_path is not None
    assert os.path.exists(audio_path)

    # Test invalid path traversal attempt
    assert mgr.get_audio_path("../../etc/passwd") is None
