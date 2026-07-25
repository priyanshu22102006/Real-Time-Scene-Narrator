"""
navigator.py
Feature 1 (support code): converts addresses to coordinates and produces
turn-by-turn walking directions, which app.py then narrates via text-to-speech.

- Geocoding: geopy + OpenStreetMap Nominatim (with in-memory caching).
- Routing: OpenRouteService (requires ORS_API_KEY).
"""

import sys
import os
import logging
from functools import lru_cache
from typing import Optional, Dict, Tuple, Any

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import requests
from geopy.geocoders import Nominatim
from config import ORS_API_KEY

logger = logging.getLogger("visionmate.navigator")

_geolocator = Nominatim(user_agent="visionmate-navigation-assistant/2.0")
ORS_WALKING_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking"


@lru_cache(maxsize=256)
def geocode_address(address_text: str) -> Optional[Dict[str, Any]]:
    """
    Convert free-text address into {"lat", "lon", "display_name"}.
    Cached to respect Nominatim usage policies and avoid redundant network hits.
    Returns None if the address could not be found.
    """
    if not address_text or not address_text.strip():
        return None

    try:
        location = _geolocator.geocode(address_text.strip())
        if not location:
            logger.warning("Geocoding returned no results for: %s", address_text)
            return None

        return {
            "lat": location.latitude,
            "lon": location.longitude,
            "display_name": location.address,
        }
    except Exception as e:
        logger.error("Geocoding error for '%s': %s", address_text, e)
        return None


def get_walking_route(
    start_coords: Tuple[float, float],
    end_coords: Tuple[float, float],
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    start_coords / end_coords: (lat, lon) tuples.

    Returns:
        {
          "distance_m": float,
          "duration_s": float,
          "steps": [str, ...]   # plain-language turn-by-turn instructions
        }
    """
    key = api_key or ORS_API_KEY
    if not key:
        raise RuntimeError(
            "ORS_API_KEY is not set. Get a free key at "
            "https://openrouteservice.org/dev/#/signup and set it as the "
            "ORS_API_KEY environment variable."
        )

    headers = {
        "Authorization": key,
        "Content-Type": "application/json",
    }
    body = {
        "coordinates": [
            [start_coords[1], start_coords[0]],  # ORS requires [lon, lat]
            [end_coords[1], end_coords[0]],
        ]
    }

    try:
        resp = requests.post(ORS_WALKING_DIRECTIONS_URL, json=body, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        segment = data["routes"][0]["segments"][0]
        steps = [step["instruction"] for step in segment["steps"]]

        return {
            "distance_m": float(segment["distance"]),
            "duration_s": float(segment["duration"]),
            "steps": steps,
        }
    except requests.exceptions.RequestException as e:
        logger.error("OpenRouteService request error: %s", e)
        raise RuntimeError(f"Routing service error: {e}") from e


def build_narration(route_summary: Dict[str, Any]) -> str:
    """Turn a route summary into a single string ready for text-to-speech."""
    distance_km = route_summary["distance_m"] / 1000
    duration_min = route_summary["duration_s"] / 60
    intro = (
        f"Your route is {distance_km:.1f} kilometers and should take about "
        f"{duration_min:.0f} minutes on foot. Here are the directions: "
    )
    steps_text = ". ".join(route_summary["steps"])
    return intro + steps_text


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("navigator module loaded successfully.")
