"""
object_detector.py
Feature 2: detects moving vehicles, pedestrians, animals, and path hazards in video frames,
tracks them across frames, estimates motion approach, and produces plain-language alerts.

Includes confidence filtering (conf >= 0.50), alert debouncing (cooldown), and SessionObjectDetectorManager for multi-user session isolation.
"""

import sys
import os
import time
import logging
import threading
from typing import Dict, Tuple, List, Any, Optional

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ultralytics import YOLO
from config import (
    YOLO_MODEL_PATH,
    DANGER_DISTANCE_RATIO,
    APPROACH_SPEED_THRESHOLD,
    DETECTOR_SESSION_TIMEOUT_SECONDS,
)

logger = logging.getLogger("visionmate.object_detector")

# COCO class ids for high-risk hazards & ambient path objects
HAZARD_OBJECT_CLASSES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    6: "train",
    7: "truck",
    15: "cat",
    16: "dog",
    24: "backpack",
    26: "handbag",
    39: "bottle",
    41: "cup",
    46: "banana",
    47: "apple",
    49: "orange",
    56: "chair",
    57: "couch",
    58: "potted plant",
    62: "tv",
    63: "laptop",
    67: "cell phone",
}

VEHICLE_CLASSES = HAZARD_OBJECT_CLASSES
ALERT_COOLDOWN_SECONDS = 5.0  # Prevent repeating the same alert within 5 seconds


class MovingObjectDetector:
    """
    Stateful detector: tracks objects across frames, calculates growth speed,
    and produces plain-language alerts only when an object is actively approaching or dangerously close.
    """

    def __init__(self, model_path: str = YOLO_MODEL_PATH):
        logger.info("Initializing YOLO model from %s...", model_path)
        self.model = YOLO(model_path)
        self._prev_height_ratio: Dict[int, float] = {}  # track_id -> height ratio
        self._last_alert_time: Dict[str, float] = {}   # alert_key -> timestamp
        self.last_accessed = time.time()

    def process_frame(self, frame) -> Tuple[Any, List[Dict[str, str]]]:
        """
        frame: BGR numpy array.
        Returns (annotated_frame, alerts).
        """
        now = time.time()
        self.last_accessed = now

        if frame is None or frame.size == 0:
            return frame, []

        frame_h, frame_w = frame.shape[:2]

        try:
            # Predict with high confidence threshold (conf >= 0.50) to prevent false detections
            results = self.model.track(frame, persist=True, verbose=False, conf=0.50)[0]
        except Exception as e:
            logger.error("YOLO model track error: %s", e)
            return frame, []

        alerts = []
        if results.boxes is None or len(results.boxes) == 0:
            return frame, alerts

        boxes = results.boxes.xyxy.cpu().numpy()
        class_ids = results.boxes.cls.cpu().numpy().astype(int)
        confidences = results.boxes.conf.cpu().numpy()

        if results.boxes.id is not None:
            track_ids = results.boxes.id.cpu().numpy().astype(int)
        else:
            track_ids = list(range(len(boxes)))

        for box, track_id, cls_id, conf in zip(boxes, track_ids, class_ids, confidences):
            if cls_id not in HAZARD_OBJECT_CLASSES:
                continue

            # Strict confidence check to ensure genuine detections
            if conf < 0.50:
                continue

            x1, y1, x2, y2 = box
            box_height_ratio = float((y2 - y1) / frame_h)
            center_x = (x1 + x2) / 2

            if center_x < frame_w / 3:
                position = "on your left"
            elif center_x > 2 * frame_w / 3:
                position = "on your right"
            else:
                position = "ahead of you"

            prev_ratio = self._prev_height_ratio.get(track_id, box_height_ratio)
            growth = box_height_ratio - prev_ratio
            self._prev_height_ratio[track_id] = box_height_ratio

            label = HAZARD_OBJECT_CLASSES[cls_id]

            # High risk dynamic targets (people, vehicles) vs room items
            is_dynamic_target = cls_id in [0, 1, 2, 3, 5, 6, 7]
            
            # An object is flagged ONLY if:
            # 1. It is actively approaching fast (growth > 0.02 and fills > 20% of frame)
            # 2. OR it is extremely close (fills > 55% of frame for dynamic targets, > 65% for furniture)
            extreme_proximity = 0.55 if is_dynamic_target else 0.65
            is_close = box_height_ratio > extreme_proximity
            is_approaching_fast = (growth > 0.02) and (box_height_ratio > 0.20)

            if is_close or is_approaching_fast:
                alert_key = f"{label}_{position}"
                last_time = self._last_alert_time.get(alert_key, 0)

                # Cooldown check: don't spam the user with identical alerts within 5 seconds
                if (now - last_time) >= ALERT_COOLDOWN_SECONDS:
                    self._last_alert_time[alert_key] = now
                    if is_close:
                        message = f"Warning: a {label} is {position} and very close. Stop and wait."
                    else:
                        message = f"Caution: a {label} is {position} and approaching quickly. Stay alert."

                    alerts.append({
                        "label": label,
                        "position": position,
                        "message": message,
                        "confidence": float(conf)
                    })

        annotated_frame = results.plot()
        return annotated_frame, alerts


class SessionObjectDetectorManager:
    """
    Manages isolated `MovingObjectDetector` instances per client session.
    Prevents concurrent user streams from interfering with each other's track IDs.
    """

    def __init__(self, model_path: str = YOLO_MODEL_PATH, session_timeout: int = DETECTOR_SESSION_TIMEOUT_SECONDS):
        self.model_path = model_path
        self.session_timeout = session_timeout
        self._sessions: Dict[str, MovingObjectDetector] = {}
        self._lock = threading.Lock()

    def get_detector(self, session_id: str = "default") -> MovingObjectDetector:
        """Retrieves or creates an isolated detector for session_id."""
        now = time.time()
        with self._lock:
            self._cleanup_stale_sessions_nolock(now)

            if session_id not in self._sessions:
                logger.info("Creating new object detector session: %s", session_id)
                detector = MovingObjectDetector(self.model_path)
                self._sessions[session_id] = detector
            else:
                detector = self._sessions[session_id]

            detector.last_accessed = now
            return detector

    def _cleanup_stale_sessions_nolock(self, now: float):
        """Purge sessions inactive for longer than session_timeout."""
        stale_ids = [
            sid for sid, det in self._sessions.items()
            if (now - det.last_accessed) > self.session_timeout
        ]
        for sid in stale_ids:
            logger.info("Purging inactive detector session: %s", sid)
            del self._sessions[sid]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    manager = SessionObjectDetectorManager()
    det = manager.get_detector("test_session")
    print(f"Obtained detector for test_session: {det}")
