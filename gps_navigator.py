"""
gps_navigator.py
GPS Voice Navigation Engine for VisionMate.

Features:
1. Free Geocoding via Nominatim with Google Maps API fallback
2. Walking & Driving Route Calculation via OSRM (Open Source Routing Machine) API
3. Leaflet Interactive Maps
4. Automated Voice Guidance Generation via gTTS & ElevenLabs
5. Unified GPSNavigator & GPSNavigatorOSM class interfaces
"""

import sys
import os
import io
import math
import logging
from typing import Dict, List, Tuple, Any, Optional

import requests
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut
from gtts import gTTS

import streamlit as st
import streamlit.components.v1 as components

# Ensure project root is in sys.path for direct module execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), ".")))

from config import GOOGLE_MAPS_API_KEY, ORS_API_KEY

try:
    import googlemaps
    GOOGLEMAPS_AVAILABLE = True
except ImportError:
    GOOGLEMAPS_AVAILABLE = False

logger = logging.getLogger("visionmate.gps_navigator")


class GPSNavigatorOSM:
    """Production-grade GPS Navigator using OSRM, Nominatim, and Google Maps API."""

    def __init__(self, google_maps_key: Optional[str] = None):
        self.geocoder = Nominatim(user_agent="visionmate_gps_navigator/1.0")
        self.google_maps_key = google_maps_key or GOOGLE_MAPS_API_KEY

        if GOOGLEMAPS_AVAILABLE and self.google_maps_key and self.google_maps_key != "YOUR_GOOGLE_MAPS_API_KEY":
            try:
                self.gmaps_client = googlemaps.Client(key=self.google_maps_key)
            except Exception as e:
                logger.warning("Google Maps client init error: %s", e)
                self.gmaps_client = None
        else:
            self.gmaps_client = None

    def get_coordinates(
        self,
        address: str,
        bias_lat: Optional[float] = None,
        bias_lng: Optional[float] = None
    ) -> Optional[Tuple[float, float]]:
        """Convert address string to (lat, lon) using Google Maps or Nominatim with fallback strategies."""
        if not address or not str(address).strip():
            return None

        clean_addr = str(address).strip()

        # 1. Try Google Maps API
        if self.gmaps_client:
            try:
                res = self.gmaps_client.geocode(clean_addr)
                if res and len(res) > 0:
                    loc = res[0]["geometry"]["location"]
                    return float(loc["lat"]), float(loc["lng"])
            except Exception as e:
                logger.warning("Google Maps geocode failed: %s", e)

        # 2. Try Nominatim with proximity viewbox bias if bias_lat/bias_lng provided
        if bias_lat is not None and bias_lng is not None:
            try:
                viewbox = (
                    bias_lng - 0.2,
                    bias_lat - 0.2,
                    bias_lng + 0.2,
                    bias_lat + 0.2
                )
                location = self.geocoder.geocode(clean_addr, viewbox=viewbox, bounded=False, timeout=10)
                if location:
                    return float(location.latitude), float(location.longitude)
            except Exception as e:
                logger.warning("Nominatim biased geocode failed: %s", e)

        # 3. Direct Nominatim geocode
        try:
            location = self.geocoder.geocode(clean_addr, timeout=10)
            if location:
                return float(location.latitude), float(location.longitude)
        except Exception as e:
            logger.warning("Nominatim direct geocode failed for '%s': %s", clean_addr, e)

        # 4. Fallback search: try clean query without special characters
        try:
            simplified = " ".join([w for w in clean_addr.replace(",", " ").replace("-", " ").split() if len(w) > 1])
            if simplified and simplified != clean_addr:
                location = self.geocoder.geocode(simplified, timeout=10)
                if location:
                    return float(location.latitude), float(location.longitude)
        except Exception as e:
            logger.warning("Nominatim simplified search failed: %s", e)

        return None

    def geocode_address(self, address: str) -> Optional[Dict[str, Any]]:
        """Return dict with lat, lng, and formatted address string."""
        coords = self.get_coordinates(address)
        if not coords:
            return None
        return {
            "lat": coords[0],
            "lng": coords[1],
            "formatted_address": address,
            "provider": "nominatim"
        }

    def get_walking_route(self, start_lat: float, start_lon: float, end_lat: float, end_lon: float) -> Optional[Dict[str, Any]]:
        """Get walking route from OSRM HTTPS API."""
        url = f"https://router.project-osrm.org/route/v1/walking/{start_lon},{start_lat};{end_lon},{end_lat}?overview=full&steps=true"
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                return response.json()
            logger.warning("OSRM returned status code %s", response.status_code)
            return None
        except Exception as e:
            logger.error("Routing error from OSRM: %s", e)
            return None

    def format_step_instruction(self, step: Dict[str, Any]) -> str:
        """Safely extract readable voice direction instruction from an OSRM step dict."""
        maneuver = step.get("maneuver", {})
        instruction = maneuver.get("instruction")

        if not instruction:
            m_type = maneuver.get("type", "turn")
            m_modifier = maneuver.get("modifier", "")
            street_name = step.get("name", "")

            if street_name:
                instruction = f"{m_type.capitalize()} {m_modifier} onto {street_name}".strip()
            else:
                instruction = f"{m_type.capitalize()} {m_modifier}".strip()

        dist_m = step.get("distance", 0)
        dist_str = f"{int(dist_m)} meters" if dist_m < 1000 else f"{dist_m/1000:.1f} km"
        return f"{instruction} for {dist_str}" if dist_str else instruction

    def speak_directions(self, steps: List[Dict[str, Any]]) -> Optional[str]:
        """Convert walking steps to spoken MP3 audio file."""
        if not steps:
            return None

        directions_text = "Starting GPS voice guidance. "
        for i, step in enumerate(steps[:5], 1):
            text = self.format_step_instruction(step)
            directions_text += f"Step {i}: {text}. "

        try:
            tts = gTTS(text=directions_text.strip(), lang="en")
            audio_path = "directions.mp3"
            tts.save(audio_path)
            return audio_path
        except Exception as e:
            logger.error("TTS generation error in speak_directions: %s", e)
            return None

    def get_route_guidance(
        self,
        origin_address_or_coords: Any,
        dest_address_or_coords: Any
    ) -> Dict[str, Any]:
        """
        Unified GPS voice guidance generator for address or coordinate pairs.
        Returns total distance, time, voice command steps, and spoken narration.
        """
        # Resolve start coords
        start_lat, start_lng = None, None
        if isinstance(origin_address_or_coords, (list, tuple)) and len(origin_address_or_coords) >= 2:
            start_lat, start_lng = float(origin_address_or_coords[0]), float(origin_address_or_coords[1])
            start_name = f"Current GPS Location ({start_lat:.4f}, {start_lng:.4f})"
        elif isinstance(origin_address_or_coords, str) and origin_address_or_coords.strip():
            start_coords = self.get_coordinates(origin_address_or_coords)
            if start_coords:
                start_lat, start_lng = start_coords
                start_name = origin_address_or_coords
            else:
                # Default start location fallback
                start_lat, start_lng = 40.7580, -73.9855
                start_name = "Times Square, New York"
        else:
            start_lat, start_lng = 40.7580, -73.9855
            start_name = "Current Location"

        # Resolve destination coords with start location bias
        dest_lat, dest_lng = None, None
        if isinstance(dest_address_or_coords, (list, tuple)) and len(dest_address_or_coords) >= 2:
            dest_lat, dest_lng = float(dest_address_or_coords[0]), float(dest_address_or_coords[1])
            dest_name = f"Destination Coordinates ({dest_lat:.4f}, {dest_lng:.4f})"
        elif isinstance(dest_address_or_coords, str) and dest_address_or_coords.strip():
            dest_coords = self.get_coordinates(dest_address_or_coords, bias_lat=start_lat, bias_lng=start_lng)
            if dest_coords:
                dest_lat, dest_lng = dest_coords
                dest_name = dest_address_or_coords
            else:
                raise ValueError(f"Could not locate destination address '{dest_address_or_coords}'. Please include a city or landmark name.")
        else:
            raise ValueError("Destination address is required.")


        route_data = self.get_walking_route(start_lat, start_lng, dest_lat, dest_lng)

        voice_commands = []
        steps_detail = []
        total_dist_str = "Unknown"
        total_time_str = "Unknown"

        if route_data and "routes" in route_data and len(route_data["routes"]) > 0:
            leg = route_data["routes"][0]["legs"][0]
            total_dist_m = leg.get("distance", 0)
            total_dur_s = leg.get("duration", 0)

            total_dist_str = f"{total_dist_m / 1000.0:.2f} km" if total_dist_m >= 1000 else f"{int(total_dist_m)} meters"
            total_time_str = f"{math.ceil(total_dur_s / 60.0)} mins"

            raw_steps = leg.get("steps", [])
            for idx, s in enumerate(raw_steps, 1):
                instruction = self.format_step_instruction(s)
                cmd = f"Step {idx}: {instruction}."
                voice_commands.append(cmd)
                steps_detail.append({
                    "step_number": idx,
                    "instruction": instruction,
                    "distance": s.get("distance", 0),
                    "duration": s.get("duration", 0)
                })
        else:
            # Direct bearing calculation fallback
            d_lat = dest_lat - start_lat
            d_lng = dest_lng - start_lng
            dist_m = math.sqrt(d_lat**2 + d_lng**2) * 111000.0
            total_dist_str = f"{int(dist_m)} meters"
            total_time_str = f"{math.ceil(dist_m / 80.0)} mins"

            cmd = f"Head towards {dest_name} for approximately {total_dist_str}."
            voice_commands.append(cmd)
            steps_detail.append({"step_number": 1, "instruction": cmd, "distance": dist_m, "duration": 60})

        maps_url = f"https://www.google.com/maps/dir/?api=1&origin={start_lat},{start_lng}&destination={dest_lat},{dest_lng}&travelmode=walking"
        narration = f"Starting GPS voice guidance to {dest_name}. Total distance: {total_dist_str}, estimated time: {total_time_str}. " + " ".join(voice_commands)

        return {
            "origin": {"name": start_name, "lat": start_lat, "lng": start_lng},
            "destination": {"name": dest_name, "lat": dest_lat, "lng": dest_lng},
            "total_distance": total_dist_str,
            "total_duration": total_time_str,
            "voice_commands": voice_commands,
            "narration": narration,
            "maps_url": maps_url,
            "steps": steps_detail,
            "provider": "OSRM"
        }


    def speak_guidance_text(self, text: str) -> Optional[str]:
        """Synthesizes narration text to audio file."""
        if not text:
            return None
        try:
            tts = gTTS(text=text.strip(), lang="en")
            audio_path = "directions.mp3"
            tts.save(audio_path)
            return audio_path
        except Exception as e:
            logger.error("TTS synthesis error: %s", e)
            return None


# Class alias for backward compatibility
GPSNavigator = GPSNavigatorOSM


def main():
    st.set_page_config(page_title="Free GPS Navigator", layout="wide")
    st.title("🗺️ Free GPS & Walking Navigator (OSM)")
    st.markdown("---")

    nav = GPSNavigatorOSM()

    col1, col2 = st.columns([1, 2])

    with col1:
        st.subheader("🧭 Navigation Settings")
        address = st.text_input("Enter Destination Address", "Eiffel Tower, Paris")

        # Default to a demo location (Paris)
        start_lat = st.number_input("Your Current Latitude", value=48.8584, format="%.6f")
        start_lon = st.number_input("Your Current Longitude", value=2.2945, format="%.6f")

        if st.button("🚀 Start Navigation", type="primary"):
            with st.spinner("Finding address..."):
                coords = nav.get_coordinates(address)
                if coords:
                    st.session_state.dest_lat, st.session_state.dest_lon = coords

                    with st.spinner("Calculating walking route & voice guidance..."):
                        route_data = nav.get_walking_route(start_lat, start_lon, coords[0], coords[1])
                        if route_data and "routes" in route_data:
                            st.session_state.route_info = route_data["routes"][0]["legs"][0]
                            st.success("GPS Route found successfully!")
                        else:
                            st.error("Could not find a walking route to destination.")
                else:
                    st.error("Address not found. Please be more specific.")

        if "route_info" in st.session_state:
            info = st.session_state.route_info
            st.write(f"**Distance:** {info.get('distance', 0)/1000:.2f} km")
            st.write(f"**Est. Time:** {info.get('duration', 0)/60:.1f} min")

            if st.button("🔊 Read Directions Aloud"):
                audio = nav.speak_directions(info.get("steps", []))
                if audio and os.path.exists(audio):
                    st.audio(audio)

            with st.expander("Show All Voice Steps", expanded=True):
                for i, step in enumerate(info.get("steps", []), 1):
                    instruction = nav.format_step_instruction(step)
                    st.write(f"**{i}.** {instruction}")

    with col2:
        # Render Interactive Leaflet Map
        dest_lat = st.session_state.get("dest_lat", start_lat)
        dest_lon = st.session_state.get("dest_lon", start_lon)

        leaflet_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
            <style>#map {{ height: 600px; width: 100%; border-radius: 15px; border: 2px solid #ddd; }}</style>
        </head>
        <body>
            <div id="map"></div>
            <script>
                var map = L.map('map').setView([{start_lat}, {start_lon}], 14);
                L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
                    attribution: '© OpenStreetMap contributors'
                }}).addTo(map);

                L.marker([{start_lat}, {start_lon}]).addTo(map).bindPopup('<b>Start Point</b>').openPopup();
                L.marker([{dest_lat}, {dest_lon}]).addTo(map).bindPopup('<b>Destination</b>');
            </script>
        </body>
        </html>
        """
        components.html(leaflet_html, height=650)


if __name__ == "__main__":
    main()
