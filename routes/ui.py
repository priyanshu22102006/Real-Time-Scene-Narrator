"""
routes/ui.py
Web UI page routes for VisionMate application.
"""

from flask import Blueprint, render_template

ui_bp = Blueprint("ui", __name__)


@ui_bp.route("/")
def index():
    """Render high-contrast, accessible web interface."""
    return render_template("index.html")
