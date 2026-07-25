"""
guidance_system.py
Voice-Assisted Audio Navigation System with Live Video, Object Detection, Surrounding Analysis & Risk Alerts.

Combines turn-by-turn OSRM GPS routing, real-time YOLOv8 object & hazard tracking,
Gemini multimodal AI surrounding visual analysis, and audio speech synthesis.
"""

import sys
import os
import io
import time
import logging
from typing import Dict, List, Tuple, Any, Optional
import cv2
import numpy as np

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), ".")))

from gps_navigator import GPSNavigatorOSM
from modules.object_detector import MovingObjectDetector, SessionObjectDetectorManager
from modules.guidance_fusion import ActiveGuidanceSystem
from modules.tts_engine import synthesize_speech

logger = logging.getLogger("visionmate.guidance_system")


class NavigationSessionState:
    """Tracks active navigation state per user session."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.origin: Optional[Dict[str, Any]] = None
        self.destination: Optional[Dict[str, Any]] = None
        self.total_distance: str = "0 meters"
        self.total_duration: str = "0 mins"
        self.steps: List[Dict[str, Any]] = []
        self.voice_commands: List[str] = []
        self.maps_url: str = ""
        self.current_step_index: int = 0
        self.is_active: bool = False
        self.last_tick_time: float = time.time()
        self.last_fusion_time: float = 0.0  # Cooldown for expensive Gemini visual analysis

    def update_route(self, route_info: Dict[str, Any]):
        """Populates state with new route guidance dict from GPSNavigatorOSM."""
        self.origin = route_info.get("origin")
        self.destination = route_info.get("destination")
        self.total_distance = route_info.get("total_distance", "Unknown")
        self.total_duration = route_info.get("total_duration", "Unknown")
        self.steps = route_info.get("steps", [])
        self.voice_commands = route_info.get("voice_commands", [])
        self.maps_url = route_info.get("maps_url", "")
        self.current_step_index = 0
        self.is_active = True
        self.last_tick_time = time.time()

    def get_current_instruction(self) -> str:
        """Returns string for the current active turn instruction."""
        if not self.voice_commands or self.current_step_index >= len(self.voice_commands):
            return "Proceed to your destination."
        return self.voice_commands[self.current_step_index]


class VoiceGuidedNavigationSystem:
    """
    Unified engine for live voice-assisted navigation with video object detection,
    surrounding visual analysis, and risk alerts.
    """

    def __init__(self, detector_manager: Optional[SessionObjectDetectorManager] = None):
        self.gps_navigator = GPSNavigatorOSM()
        self.detector_manager = detector_manager or SessionObjectDetectorManager()
        self.guidance_fusion = ActiveGuidanceSystem()
        self._sessions: Dict[str, NavigationSessionState] = {}

    def get_session(self, session_id: str) -> NavigationSessionState:
        """Retrieves or creates session state for session_id."""
        if session_id not in self._sessions:
            self._sessions[session_id] = NavigationSessionState(session_id)
        return self._sessions[session_id]

    def start_navigation(
        self,
        session_id: str,
        start: Any,
        destination: Any
    ) -> Dict[str, Any]:
        """
        Calculates walking route and initializes session state for voice navigation.
        """
        session = self.get_session(session_id)
        route_info = self.gps_navigator.get_route_guidance(start, destination)
        session.update_route(route_info)

        narration = route_info.get("narration", "")
        return {
            "session_id": session_id,
            "route": route_info,
            "narration": narration,
            "voice_commands": route_info.get("voice_commands", []),
            "total_distance": route_info.get("total_distance"),
            "total_duration": route_info.get("total_duration"),
            "maps_url": route_info.get("maps_url"),
            "current_step_index": 0,
            "current_instruction": session.get_current_instruction(),
        }

    def process_live_navigation_tick(
        self,
        session_id: str,
        frame_bytes: bytes,
        step_index: Optional[int] = None,
        perform_surrounding_analysis: bool = False
    ) -> Dict[str, Any]:
        """
        Processes a single live video frame tick during active voice navigation.

        1. Performs YOLOv8 object & risk detection on the video frame.
        2. Detects moving vehicles, pedestrians, and close path obstacles.
        3. Optionally triggers Gemini AI visual surrounding analysis fused with the current GPS instruction.
        4. Compiles real-time risk warning speech narration.
        """
        session = self.get_session(session_id)
        now = time.time()
        session.last_tick_time = now

        if step_index is not None and 0 <= step_index < len(session.voice_commands):
            session.current_step_index = step_index

        current_instruction = session.get_current_instruction()

        if not frame_bytes or len(frame_bytes) == 0:
            return {
                "success": True,
                "session_id": session_id,
                "alerts": [],
                "current_step_index": session.current_step_index,
                "current_instruction": current_instruction,
                "surrounding_analysis": None,
                "spoken_alert": None
            }

        # 1. Object & Hazard Detection via YOLO
        detector = self.detector_manager.get_detector(session_id)
        np_arr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        alerts = []
        if frame is not None:
            _, alerts = detector.process_frame(frame)

        # 2. Surrounding visual analysis via Gemini AI (if requested or on 15s interval)
        surrounding_analysis = None
        should_analyze = perform_surrounding_analysis or (now - session.last_fusion_time >= 15.0)

        if should_analyze and self.guidance_fusion._client is not None:
            try:
                surrounding_analysis = self.guidance_fusion.get_fused_guidance(
                    image_bytes=frame_bytes,
                    gps_instruction=current_instruction,
                    personal_context="Voice-guided pedestrian navigating live street view"
                )
                session.last_fusion_time = now
            except Exception as e:
                logger.warning("Surrounding analysis error during navigation tick: %s", e)
                surrounding_analysis = None

        # 3. Construct spoken narration
        spoken_parts = []
        if alerts:
            alert_messages = " ".join([a["message"] for a in alerts])
            spoken_parts.append(f"Hazard Alert: {alert_messages}")

        if surrounding_analysis:
            spoken_parts.append(f"Surroundings: {surrounding_analysis}")

        spoken_alert = " ".join(spoken_parts) if spoken_parts else None

        return {
            "success": True,
            "session_id": session_id,
            "alerts": alerts,
            "current_step_index": session.current_step_index,
            "current_instruction": current_instruction,
            "surrounding_analysis": surrounding_analysis,
            "spoken_alert": spoken_alert
        }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    system = VoiceGuidedNavigationSystem()
    print("VoiceGuidedNavigationSystem initialized successfully.")
