"""
audio_manager.py
Manages generated TTS MP3 audio file storage, caching, and TTL lifecycle cleanup.
"""

import os
import time
import logging
import threading
from typing import Optional

logger = logging.getLogger("visionmate.audio_manager")


class AudioManager:
    """Handles audio file persistence and automatic TTL-based garbage collection."""

    def __init__(self, storage_dir: str, ttl_seconds: int = 900):
        self.storage_dir = storage_dir
        self.ttl_seconds = ttl_seconds
        self._lock = threading.Lock()

        os.makedirs(self.storage_dir, exist_ok=True)
        self.cleanup_expired_files()

    def save_audio(self, audio_bytes: bytes, prefix: str = "tts") -> str:
        """Saves raw audio bytes to a file in the storage directory and returns the filename."""
        if not audio_bytes:
            raise ValueError("audio_bytes cannot be empty")

        filename = f"{prefix}_{int(time.time() * 1000)}_{os.urandom(4).hex()}.mp3"
        file_path = os.path.join(self.storage_dir, filename)

        with self._lock:
            with open(file_path, "wb") as f:
                f.write(audio_bytes)

        logger.debug("Saved audio file: %s (%d bytes)", filename, len(audio_bytes))
        return filename

    def get_audio_path(self, filename: str) -> Optional[str]:
        """Returns full path to filename if it exists and is within storage_dir, else None."""
        # Prevent directory traversal attacks
        safe_filename = os.path.basename(filename)
        file_path = os.path.join(self.storage_dir, safe_filename)

        if os.path.exists(file_path) and os.path.isfile(file_path):
            return file_path
        return None

    def cleanup_expired_files(self):
        """Deletes files older than ttl_seconds from storage_dir."""
        now = time.time()
        deleted_count = 0
        try:
            with self._lock:
                for entry in os.scandir(self.storage_dir):
                    if entry.is_file() and entry.name.endswith(".mp3"):
                        file_age = now - entry.stat().st_mtime
                        if file_age > self.ttl_seconds:
                            try:
                                os.remove(entry.path)
                                deleted_count += 1
                            except OSError as e:
                                logger.warning("Failed to delete expired audio file %s: %s", entry.path, e)
        except Exception as e:
            logger.error("Error during audio directory cleanup: %s", e)

        if deleted_count > 0:
            logger.info("Cleaned up %d expired audio files from %s", deleted_count, self.storage_dir)
