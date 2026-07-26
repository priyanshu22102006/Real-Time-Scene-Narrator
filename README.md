# 👁 Real-Time Scene Narrator

An AI-powered accessibility tool that converts a live camera feed into spoken narration for visually impaired users. Combines **Google Gemini Vision**, **ElevenLabs TTS**, real-time object detection, text extraction, and GPS navigation — all through a modern React interface.

---

## ✨ Features

- **🤖 Dedicated AI Integration (All-in-One)** — Single master button running Object Detection, Visual Scene Narration, GPS Visual Fusion, and Mood & Sitting Idle Medical Emergency Alerting simultaneously.
- **📷 Camera-to-Voice** — Captures camera frames every 2 seconds and speaks AI-generated scene descriptions via ElevenLabs.
- **⚡ Ambient Mode** — In-browser TensorFlow.js COCO-SSD detects approaching obstacles (cars, people, cyclists) and alerts instantly.
- **📋 Task Mode** — Point at signs or documents; AI extracts text and addresses, reads them aloud, and can auto-launch GPS navigation.
- **🗺️ GPS Navigation** — Turn-by-turn voice guidance using OpenStreetMap routing; speaks instructions as you approach each waypoint.
- **🚨 Medical Emergency Alerting** — Tracks human posture and sitting idle duration; flags critical medical distress alerts if unresponsive for >10s.

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18 + TypeScript + Vite | UI framework & dev server |
| Styling | Tailwind CSS v3 | Utility-first CSS |
| Animations | Framer Motion | Smooth transitions & effects |
| Object Detection | TensorFlow.js COCO-SSD | In-browser real-time detection |
| Maps | Leaflet.js | Interactive route maps |
| Backend | Node.js + Express | API server |
| **Python Edge AI** | **YOLOv8 Nano (Ultralytics)** | Custom fine-tuned edge AI & posture tracking (`train_model.py`, `ai_inference.py`) |
| **Vision API** | **Google Gemini 2.5 Flash** | Scene description & OCR |
| **Text-to-Speech** | **ElevenLabs (Turbo v2)** | Ultra-realistic AI voice output |
| **Geocoding** | **OpenStreetMap Nominatim** | Address → coordinates (free, no key) |
| **Routing** | **OSRM** | Turn-by-turn directions (free, no key) |

---

## 📋 Prerequisites

Before you begin, make sure you have the following installed on your system:

| Requirement | Version | How to Check | Download |
|-------------|---------|-------------|----------|
| **Node.js** | v18.0.0 or higher | `node --version` | [nodejs.org](https://nodejs.org) |
| **npm** | v9.0.0 or higher | `npm --version` | Bundled with Node.js |
| **Git** | Any recent version | `git --version` | [git-scm.com](https://git-scm.com) |

**Browser Requirements:**
- A modern browser with **camera access** support (Chrome, Firefox, Edge, or Safari)
- Camera access requires **HTTPS** in production (localhost is allowed for development)
- Chrome/Edge recommended for the best text-to-speech voice quality

---

## 🔑 API Keys Setup

You will need **two** API keys before running the app. Both have generous free tiers.

### 1. Google Gemini API Key (Vision & OCR)

The Gemini API powers scene description and text extraction from images.

| Step | Action |
|------|--------|
| 1 | Go to [Google AI Studio](https://aistudio.google.com/apikey) |
| 2 | Sign in with your Google account |
| 3 | Click **"Create API Key"** |
| 4 | Select or create a Google Cloud project |
| 5 | Copy the generated API key (starts with `AIza...`) |

> **Free tier limits:** 15 requests/minute, 1,500 requests/day, 1 million tokens/month — more than enough for personal use.

### 2. ElevenLabs API Key (Text-to-Speech)

ElevenLabs provides ultra-realistic AI voice narration.

| Step | Action |
|------|--------|
| 1 | Go to [elevenlabs.io/sign-up](https://elevenlabs.io/sign-up) and create a free account |
| 2 | Navigate to your [API Keys page](https://elevenlabs.io/app/settings/api-keys) |
| 3 | Click **"Create API Key"** |
| 4 | Name it `scene-narrator` and click **Create** |
| 5 | Copy the key (starts with `sk_...`) |

> **Free tier limits:** 10,000 characters/month with access to a selection of voices.

### 3. Directions API — No Key Required ✅

We use **OpenStreetMap Nominatim** (geocoding) and **OSRM** (routing) — both are completely free with no account needed:

- **Nominatim:** Max 1 request/second per IP (our backend rate limiter handles this)
- **OSRM:** Public demo server, no key required, generous limits for non-commercial use

## ⚡ Single Command Quick Start — Run Entire Application

To run the entire setup (backend + frontend) in a **single command**:

```bash
# 1. Set up backend environment file (first time only)
cp .env.example backend/.env

# 2. Run both Backend & Frontend simultaneously with ONE command:
npm run dev
```

> 🚀 **Backend runs on:** `http://localhost:5000`  
> 🌐 **Frontend runs on:** `http://localhost:5173`

---

### (Optional) Setup Python AI Perception Models:
```bash
pip install -r requirements_ai.txt
python train_model.py
```

---

## 🚀 Detailed Installation & Setup Guide

Follow these steps in order to get the project running locally.

### Step 1 — Clone the Repository

```bash
git clone https://github.com/priyanshu22102006/Real-Time-Scene-Narrator.git
cd Real-Time-Scene-Narrator
```

---

### Step 2 — Set Up Environment Variables

Create the backend `.env` file from the provided template:

```bash
cp .env.example backend/.env
```

Now open `backend/.env` in your editor and fill in your API keys:

```env
# ─── Server Configuration ──────────────────────────────────
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# ─── Google Gemini API Key (Required) ──────────────────────
# Used for: scene description, text/OCR extraction
# Get yours at: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# ─── ElevenLabs API Key (Required) ─────────────────────────
# Used for: ultra-realistic AI text-to-speech narration
# Get yours at: https://elevenlabs.io/app/settings/api-keys
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

> [!IMPORTANT]
> Replace `your_gemini_api_key_here` and `your_elevenlabs_api_key_here` with your actual API keys.
> The `ELEVENLABS_VOICE_ID` is pre-set to the "Rachel" voice — you can change this to any voice ID from your ElevenLabs account.

---

### Step 3 — Install Backend Dependencies

```bash
cd backend
npm install
```

This installs:
- `express` — Web server framework
- `axios` — HTTP client for API calls
- `dotenv` — Environment variable loader
- `multer` — Image upload handling
- `onnxruntime-node` — YOLO model inference
- `cors`, `express-rate-limit` — Security middleware
- `nodemon` (dev) — Auto-restart on file changes

---

### Step 4 — Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

This installs:
- `react`, `react-dom`, `react-router-dom` — UI framework & routing
- `@tensorflow/tfjs`, `@tensorflow-models/coco-ssd` — In-browser object detection
- `framer-motion` — Animations
- `leaflet` — Interactive maps
- `axios` — API calls to the backend
- `vite`, `typescript`, `tailwindcss` (dev) — Build tooling

---

### Step 5 — Start the Application

You need **two terminal windows** — one for the backend and one for the frontend.

**Terminal 1 — Start the Backend Server:**

```bash
cd backend
npm run dev        # Uses nodemon for auto-reload
# OR
npm start          # Uses plain node (no auto-reload)
```

✅ You should see:
```
🚀 Real-Time Scene Narrator Backend running on port 5000
   Vision API: Google Gemini 2.5 Flash
   TTS Engine: ElevenLabs AI Voice Studio
   Directions: Nominatim (geocoding) + OSRM (routing)
   Health check: http://localhost:5000/health
```

**Terminal 2 — Start the Frontend Dev Server:**

```bash
cd frontend
npm run dev
```

✅ You should see:
```
  VITE v5.x.x  ready in XXX ms
  ➜  Local:   http://localhost:5173/
```

---

### Step 6 — Open in Browser

Navigate to **[http://localhost:5173](http://localhost:5173)** in your browser.

> [!TIP]
> The Vite dev server automatically proxies all `/api/*` requests to `http://localhost:5000`, so both servers work together seamlessly in development.

---

## ✅ Verify Installation

After starting both servers, run these quick checks:

| Check | How | Expected Result |
|-------|-----|----------------|
| Backend is running | Open [http://localhost:5000/health](http://localhost:5000/health) | JSON with `"status": "ok"` |
| Frontend is running | Open [http://localhost:5173](http://localhost:5173) | Landing page loads |
| API proxy works | Open [http://localhost:5173/api/health](http://localhost:5173/api/health) via the browser console | Same JSON response as backend `/health` |
| Camera access | Click "Start Camera" on the app page | Browser asks for camera permission |

---

## 🌐 How to Use

### Landing Page (`/`)
The marketing page explains all features with animated cards and demonstrations.
Click **"Try Live Demo"** to open the app.

### App Page (`/app`)

1. **Start Camera** — Click "Start Camera" and allow browser camera permission
2. **Select a Mode** using the tab buttons:
   - **🤖 AI Integration (All-in-One)**: Click **"⚡ Run All AI Features"** to execute Object Detection, Scene Narration, GPS Context, and Sitting Idle Emergency Alerting simultaneously!
   - **Camera-to-Voice**: Click "Start Narration" to begin 2-second interval AI narration
   - **Ambient Mode**: Click "Start Monitoring" to load COCO-SSD and begin real-time threat detection
   - **Task Mode**: Capture or upload a photo to extract text and addresses
   - **GPS Navigation**: Enter a destination address (or let Task Mode fill it automatically)
3. All voice output is powered by **ElevenLabs** for natural, human-like speech

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `?` | Toggle help panel |
| `Esc` | Close help panel |
| `Tab` | Navigate between interactive elements |
| `Enter` | Activate focused button |

---

## 🏗 Build for Production

```bash
# 1. Build the frontend
cd frontend
npm run build
# Output: frontend/dist/ (deploy to any static host or CDN)

# 2. Start the backend in production mode
cd ../backend
NODE_ENV=production npm start
```

### Production Environment Variables

```env
NODE_ENV=production
PORT=5000
FRONTEND_URL=https://your-deployed-frontend.com
GEMINI_API_KEY=your_gemini_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

---

## 📁 Project Structure

```
Real-Time-Scene-Narrator/
├── .env.example                    # Environment variable template
├── README.md                       # This file
├── package.json                    # Root workspace dependencies
│
├── backend/
│   ├── .env                        # Your local environment variables (git-ignored)
│   ├── package.json                # Backend dependencies & scripts
│   ├── config/
│   │   └── narration.json          # Object detection thresholds & priorities
│   ├── models/
│   │   └── yolo11n.onnx            # YOLOv11 Nano model for object detection
│   └── src/
│       ├── server.js               # Express server — middleware, routes, error handling
│       ├── routes/
│       │   ├── describeScene.js    # POST /api/describe-scene  (Gemini Vision)
│       │   ├── extractAddress.js   # POST /api/extract-address (Gemini Vision + OCR)
│       │   ├── tts.js             # POST /api/tts             (ElevenLabs TTS)
│       │   └── directions.js      # GET  /api/directions      (Nominatim + OSRM)
│       └── services/
│           └── yoloDetector.js     # ONNX Runtime YOLOv11 inference service
│
└── frontend/
    ├── package.json                # Frontend dependencies & scripts
    ├── vite.config.ts              # Vite dev server + API proxy configuration
    ├── tailwind.config.js          # Tailwind CSS dark mode + custom theme
    ├── postcss.config.js           # PostCSS with Tailwind + Autoprefixer
    ├── tsconfig.json               # TypeScript configuration
    ├── index.html                  # HTML entry point
    └── src/
        ├── main.tsx                # React entry point
        ├── App.tsx                 # Router setup + dark mode context provider
        ├── index.css               # Global styles + Tailwind imports
        ├── pages/
        │   ├── LandingPage.tsx     # Marketing landing page with feature demos
        │   └── AppPage.tsx         # Main application — camera + all modules
        ├── modules/
        │   ├── CameraToVoice.tsx   # Module 1: frame capture + Gemini AI narration
        │   ├── AmbientMode.tsx     # Module 2: COCO-SSD real-time object detection
        │   ├── TaskMode.tsx        # Module 3: text/address extraction from images
        │   └── GPSNavigation.tsx   # Module 4: turn-by-turn GPS voice navigation
        ├── components/
        │   ├── DetectionOverlay.tsx # Bounding box overlay for object detection
        │   └── InteractiveRouteMap.tsx # Leaflet map for GPS route display
        └── utils/
            ├── tts.ts              # ElevenLabs TTS client utility
            └── detectionTracker.ts # Object proximity & tracking logic
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| `GET` | `/health` | Server health check | — |
| `POST` | `/api/describe-scene` | Describe a camera frame using Gemini Vision | 30/min |
| `POST` | `/api/extract-address` | Extract text & addresses from an image | 30/min |
| `POST` | `/api/tts` | Convert text to speech via ElevenLabs | 40/min |
| `GET` | `/api/directions?from=lat,lng&to=address` | Get turn-by-turn directions | 30/min |

---

## 🔧 Troubleshooting

### Common Issues

<details>
<summary><strong>❌ <code>npm install</code> fails with permission errors</strong></summary>

Try clearing the npm cache and reinstalling:
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```
</details>

<details>
<summary><strong>❌ <code>nodemon: Permission denied</code> when running <code>npm run dev</code></strong></summary>

Fix the executable permissions on the bin scripts:
```bash
chmod +x node_modules/.bin/*
```
Or use `npm start` instead (runs without nodemon).
</details>

<details>
<summary><strong>❌ Backend starts but API calls return errors</strong></summary>

1. Verify your `.env` file is in the `backend/` directory (not the project root)
2. Check that your `GEMINI_API_KEY` starts with `AIza...`
3. Check that your `ELEVENLABS_API_KEY` starts with `sk_...`
4. Test the health endpoint: `curl http://localhost:5000/health`
</details>

<details>
<summary><strong>❌ Camera doesn't work in the browser</strong></summary>

- Make sure you're accessing the app via `http://localhost:5173` (not an IP address)
- Camera access requires either `localhost` or `HTTPS`
- Check that no other app is using the camera
- Try a different browser (Chrome recommended)
</details>

<details>
<summary><strong>❌ "Model loading" or 503 errors from Gemini</strong></summary>

- Verify your API key is valid at [Google AI Studio](https://aistudio.google.com/apikey)
- Check your free tier quota hasn't been exceeded
- Wait a few seconds and retry — the first request may take longer
</details>

<details>
<summary><strong>❌ No audio output / TTS not working</strong></summary>

- Make sure your `ELEVENLABS_API_KEY` is set correctly in `backend/.env`
- Check your ElevenLabs free tier character quota at [elevenlabs.io](https://elevenlabs.io)
- Ensure the `ELEVENLABS_VOICE_ID` is valid (default `21m00Tcm4TlvDq8ikWAM` is the "Rachel" voice)
</details>

<details>
<summary><strong>❌ Port already in use</strong></summary>

Kill the process occupying the port:
```bash
# Find the process using port 5000
lsof -i :5000
# Kill it
kill -9 <PID>
```
Or change the `PORT` in `backend/.env`.
</details>

---

## ⚠️ Known Limitations

| Area | Limitation |
|------|-----------|
| **Gemini Vision** | Free tier has per-minute and daily request limits. Heavy usage may hit quotas. |
| **ElevenLabs TTS** | Free tier is limited to 10,000 characters/month. Consider upgrading for heavy use. |
| **Text Extraction** | Works best on printed, clearly legible text. Handwriting and low-light results vary. |
| **GPS Navigation** | GPS accuracy drops indoors. Best used outdoors. Proximity trigger is 100m. |
| **OSRM Routing** | Uses the public demo server. For production, self-host OSRM or use an alternative. |
| **COCO-SSD** | Detects 80 COCO object classes. May produce false positives in cluttered scenes. |
| **Browser TTS Fallback** | Web Speech API quality varies by browser; Chrome/Edge have the best voices. |
| **TensorFlow.js** | May be slow on older mobile CPUs. Consider reducing the detection interval. |

---

## 🔮 Future Improvements

- [ ] Offline mode using on-device vision models (MobileNet, etc.)
- [ ] Self-hosted OSRM instance for production routing
- [ ] Custom voice selection in settings
- [ ] Multi-language narration support
- [ ] Haptic feedback integration for mobile users
- [ ] Progressive Web App (PWA) for installable offline use
- [ ] WebSocket-based real-time streaming for lower latency

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 🙏 Credits

- [Google Gemini](https://ai.google.dev/) — Vision API for scene understanding & OCR
- [ElevenLabs](https://elevenlabs.io/) — Ultra-realistic AI text-to-speech
- [OpenStreetMap](https://openstreetmap.org) — Free map data via Nominatim
- [OSRM](https://project-osrm.org) — Open Source Routing Machine
- [TensorFlow.js](https://tensorflow.org/js) — In-browser ML (COCO-SSD)
- [Framer Motion](https://framer.com/motion) — React animations
- [Tailwind CSS](https://tailwindcss.com) — Utility-first CSS framework
- [Leaflet](https://leafletjs.com) — Interactive map library
