# VisionMate

A voice-guided web app for visually impaired users, covering four features:

1. **Live directions** — `/api/navigate`: turn-by-turn walking directions, narrated aloud.
2. **Moving-object hazard alerts** — `/api/detect_objects`: detects nearby vehicles (car, bus, truck, motorcycle, bicycle, train) from live camera frames and speaks warnings like *"Warning: a bus is ahead and very close. Stop and wait."*
3. **Address/sign reading + GPS** — `/api/read_address`: reads a photo of a sign/storefront, extracts an address, and geocodes it to GPS coordinates.
4. **Full scene description** — `/api/describe_scene`: given a JPEG, describes the whole scene in plain spoken language.

## Architecture

```
visionmate/
├── app.py                  # Flask app — all 4 API endpoints + web UI route
├── config.py                # API keys & tunable thresholds (reads env vars)
├── modules/
│   ├── scene_ai.py          # Gemini: scene description + address/text extraction
│   ├── tts_engine.py         # ElevenLabs: text -> speech (MP3)
│   ├── object_detector.py    # YOLOv8: vehicle detection + tracking + alerts
│   └── navigator.py          # geopy geocoding + OpenRouteService walking routes
├── templates/index.html      # Accessible front-end (large buttons, aria-live, camera)
├── static/style.css           # High-contrast styling
└── requirements.txt
```

**Why this split:** each AI capability lives in its own module so you can
swap providers later (e.g. a different TTS voice, a different vision model,
a different routing API) without touching the Flask routes.

## Setup

```bash
cd visionmate
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Set your API keys as environment variables (recommended over editing
`config.py` directly):

```bash
export GEMINI_API_KEY="your-gemini-key"
export ELEVENLABS_API_KEY="your-elevenlabs-key"
export ELEVENLABS_VOICE_ID="your-preferred-voice-id"   # optional
export ORS_API_KEY="your-openrouteservice-key"          # only needed for /api/navigate
```

`ORS_API_KEY` is a **free** key from [openrouteservice.org](https://openrouteservice.org/dev/#/signup) — Gemini and ElevenLabs don't do routing/directions, so this project uses OpenRouteService for turn-by-turn walking directions and OpenStreetMap Nominatim (via `geopy`, no key needed) for geocoding addresses.

Run it:

```bash
python app.py
```

Open `http://localhost:5000` in a browser. On first run, `yolov8n.pt`
(~6 MB) downloads automatically for object detection.

### Testing on a phone

Browsers only allow camera/microphone access over **HTTPS** or on
`localhost`. To test on a real phone on your network, either:
- use a tunnel like `ngrok http 5000`, or
- set up a local HTTPS cert (e.g. with `mkcert`) and run Flask with `ssl_context`.

## How "live" works here

True continuous video streaming to a cloud vision model is expensive and
often too slow for split-second hazard alerts. This project instead uses a
**hybrid approach**:

- **Hazard detection (feature 2)** runs locally and fast: YOLOv8 processes
  each captured frame directly in the Python backend (no external API call
  per frame), so it can run several times a second. The front-end captures a
  frame from the live camera every ~500ms and posts it to
  `/api/detect_objects`.
- **Scene description & sign reading (features 3 & 4)** call Gemini, which
  is much richer but slower/costlier — these are triggered on demand (button
  press) rather than continuously.
- **Navigation (feature 1)** computes the full route once, then narrates it;
  you can extend this to re-check the user's GPS position periodically and
  announce only the next turn (see "Next steps" below).

## Tuning hazard sensitivity

In `config.py`:
- `DANGER_DISTANCE_RATIO` — how large (as a fraction of frame height) a
  vehicle's bounding box must be before it's considered "close."
- `APPROACH_SPEED_THRESHOLD` — how fast that box must be growing
  frame-to-frame before it's flagged as "approaching quickly."

Lower these to get more (and earlier) alerts; raise them to reduce false
alarms. These are heuristics based on bounding-box size, not true physical
distance — for higher accuracy you'd add a depth sensor, stereo camera, or a
monocular depth-estimation model.

## Next steps / production considerations

- **Continuous turn-by-turn navigation:** poll `navigator.geolocation` on
  the client every few seconds, compare the user's position to the route's
  step coordinates, and only speak the next instruction when they're close
  to a turn (instead of reading the whole route at once).
- **Offline/edge object detection:** for a real mobile app, consider running
  YOLOv8 on-device (e.g. exported to CoreML/TFLite) to remove network
  latency from hazard alerts entirely — this matters a lot for a safety
  feature.
- **Rate limiting & cost control:** Gemini and ElevenLabs calls cost money
  per request; add caching/debouncing so a user mashing "Describe the scene"
  doesn't rack up unnecessary calls.
- **Error handling & connectivity loss:** add local fallback messages (e.g.
  cached "no internet" audio) since a visually impaired user especially
  needs to know when a feature has silently failed.
- **Privacy:** camera frames and photos are sent to Google (Gemini) and
  location data to OpenRouteService/Nominatim — disclose this clearly to
  users and avoid storing images/audio longer than necessary (this demo
  keeps generated audio in a temp directory only).
