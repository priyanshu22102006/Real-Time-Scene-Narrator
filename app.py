"""
app.py
VisionMate — enterprise-grade web app and backend for visually impaired users.

Features:
  1. /api/navigate        - turn-by-turn walking directions (voice)
  2. /api/detect_objects  - live hazard alerts for moving vehicles
  3. /api/read_address    - read an image and derive an address + GPS point
  4. /api/describe_scene  - describe a whole scene from a JPEG

Run:
    python app.py
"""

import os
import time
import threading
import webbrowser
from app_factory import create_app

app = create_app()


def open_browser(url: str, delay: float = 1.2):
    """Wait briefly for server boot, then automatically launch browser."""
    time.sleep(delay)
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not open browser automatically: {e}")


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    local_url = f"http://localhost:{port}"

    print("=" * 65)
    print(f" VisionMate Server Running!")
    print(f" Access Website at: {local_url}")
    print(" Automatically launching browser tab...")
    print("=" * 65)

    # Launch browser automatically
    threading.Thread(target=open_browser, args=(local_url, 1.2), daemon=True).start()

    try:
        from waitress import serve
        serve(app, host=host, port=port, threads=8)
    except ImportError:
        app.run(host=host, port=port, debug=app.config.get("DEBUG", False))
