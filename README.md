# 👁 Real-Time Scene Narrator

An AI-powered accessibility tool that converts a live camera feed into spoken narration for visually impaired users. Combines AI vision, real-time object detection, text extraction, and GPS navigation — all powered by free, open-source APIs.

---

## ✨ Features

- **Camera-to-Voice** — Captures camera frames every 2 seconds and speaks AI-generated scene descriptions
- **Ambient Mode** — In-browser TensorFlow.js COCO-SSD detects approaching obstacles (cars, people, cyclists) and alerts instantly
- **Task Mode** — Point at signs or documents; AI extracts text and addresses, reads them aloud, and can auto-launch GPS navigation
- **GPS Navigation** — Turn-by-turn voice guidance using OpenStreetMap routing; speaks instructions as you approach each waypoint

---

## 🛠 Tech Stack

| Layer | Technology | License |
|-------|-----------|---------|
| Frontend | React 18 + TypeScript + Vite | MIT |
| Styling | Tailwind CSS v3 | MIT |
| Animations | Framer Motion | MIT |
| Object Detection | TensorFlow.js COCO-SSD (in-browser) | Apache 2.0 |
| Text-to-Speech | Web Speech API (browser built-in) | Browser native |
| Camera Access | MediaDevices getUserMedia API | Browser native |
| Backend | Node.js + Express | MIT |
| **Vision API** | **Hugging Face Inference API (BLIP + TrOCR)** | **Free tier** |
| **Geocoding** | **OpenStreetMap Nominatim** | **Free, no key** |
| **Routing** | **OSRM (Open Source Routing Machine)** | **Free, no key** |

---

## 📋 Prerequisites

- **Node.js** v18 or higher ([Download](https://nodejs.org))
- **npm** v9+ (included with Node.js)
- A modern browser with camera access (Chrome, Firefox, Edge, Safari)
- A **free** Hugging Face account (for the Vision API key)

---

## 🔑 API Keys

### Hugging Face (Vision API) — Free Tier

1. Go to [https://huggingface.co/join](https://huggingface.co/join) and create a free account
2. Navigate to [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
3. Click **"New token"** → Name it `scene-narrator` → Role: `Read` → Create
4. Copy the token (starts with `hf_...`)
5. Paste it as `VISION_API_KEY` in your `.env` file

**Free tier limits:**
- ~30,000 API calls/month on the free tier
- Models may have a "cold start" delay of 20–30 seconds after inactivity (you'll see a "model loading" message)
- Rate limit enforced in our backend: 10 vision requests/minute per IP

### Directions API — No Key Required

We use **OpenStreetMap Nominatim** and **OSRM** — both are completely free with no account needed:
- Nominatim: max 1 request/second per IP (our rate limiter ensures this)
- OSRM: public demo server, no key, generous limits for non-commercial use

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd real-time-scene-narrator
```

### 2. Set up the backend

```bash
cd backend
npm install
cp ../.env.example .env
# Edit .env and add your VISION_API_KEY
```

### 3. Set up the frontend

```bash
cd ../frontend
npm install
```

---

## ⚙️ Configuration

Edit `backend/.env`:

```env
VISION_API_KEY=hf_your_token_here
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

---

## ▶️ Running the App

Open **two terminal windows**:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
```
The backend will start on `http://localhost:5000`

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```
The frontend will start on `http://localhost:5173`

Open `http://localhost:5173` in your browser.

---

## 🌐 How to Use

### Landing Page (`/`)
The marketing page explains all features with animated cards and demonstrations.
Click **"Try Live Demo"** to open the app.

### App (`/app`)

1. **Start Camera** — Click "Start Camera" and allow browser camera permission
2. **Select a Mode** using the tab buttons:
   - **Camera-to-Voice**: Click "Start Narration" to begin 2-second interval narration
   - **Ambient Mode**: Click "Start Monitoring" to load COCO-SSD and begin threat detection
   - **Task Mode**: Capture or upload a photo to extract text and addresses
   - **GPS Navigation**: Enter a destination address (or let Task Mode fill it automatically)
3. All speech output uses the **Web Speech API** — works offline once the page is loaded

### Keyboard Shortcuts
- `?` — Toggle help panel
- `Esc` — Close help panel
- `Tab` — Navigate between all interactive elements
- `Enter` — Activate focused button

---

## 🏗 Build for Production

```bash
# Build frontend
cd frontend
npm run build

# The built files are in frontend/dist/
# Serve them with any static file server or CDN

# Start backend in production
cd ../backend
NODE_ENV=production npm start
```

### Environment variables for production:
```env
NODE_ENV=production
FRONTEND_URL=https://your-deployed-frontend.com
VISION_API_KEY=hf_your_token_here
```

---

## 📁 Project Structure

```
real-time-scene-narrator/
├── .env.example               # Environment variable template
├── README.md                  # This file
│
├── backend/
│   ├── package.json           # Backend dependencies
│   └── src/
│       ├── server.js          # Express server, middleware, routes
│       └── routes/
│           ├── describeScene.js    # POST /api/describe-scene (Hugging Face BLIP)
│           ├── extractAddress.js   # POST /api/extract-address (BLIP + TrOCR)
│           └── directions.js       # GET /api/directions (Nominatim + OSRM)
│
└── frontend/
    ├── package.json           # Frontend dependencies
    ├── vite.config.ts         # Vite + API proxy config
    ├── tailwind.config.js     # Tailwind dark mode + custom colors
    ├── postcss.config.js      # PostCSS with Tailwind + Autoprefixer
    ├── tsconfig.json          # TypeScript config
    ├── index.html             # HTML entry point
    └── src/
        ├── main.tsx           # React entry point
        ├── App.tsx            # Router + dark mode context
        ├── index.css          # Global styles + Tailwind
        ├── pages/
        │   ├── LandingPage.tsx   # Marketing landing page
        │   └── AppPage.tsx       # Main application with camera + modules
        └── modules/
            ├── CameraToVoice.tsx  # Module 1: frame capture + AI narration
            ├── AmbientMode.tsx    # Module 2: COCO-SSD object detection
            ├── TaskMode.tsx       # Module 3: text/address extraction
            └── GPSNavigation.tsx  # Module 4: turn-by-turn GPS navigation
```

---

## ⚠️ Known Limitations

### Hugging Face Free Tier
- **Cold start**: Models sleep after inactivity. First request may take 20–30 seconds with a "503 Model Loading" response. Retry after the wait.
- **Rate limits**: Free tier allows ~30,000 requests/month. Our 10 req/min backend limiter stays well within this.
- **Model accuracy**: BLIP-large is excellent for scene description but limited for reading small text. For better OCR, consider upgrading to a paid Vision API.

### TrOCR (Text Extraction)
- Works best on **printed, clearly legible text**. Handwriting accuracy varies.
- May not detect text in low-light or blurry images.

### GPS Navigation
- **Indoor accuracy**: GPS is less accurate indoors. Works best outdoors.
- **OSRM demo server**: The public OSRM server is for testing. For production, consider self-hosting OSRM or using another free routing API.
- Navigation proximity trigger is 100m — may need adjustment for dense urban areas.

### Object Detection (COCO-SSD)
- Detects 80 object classes from the COCO dataset.
- "Approaching" detection uses bounding box area growth as a proxy for 3D approach.
- May generate false positives in cluttered scenes.

### Browser Compatibility
- Web Speech API: Chrome/Edge have the best voices. Firefox and Safari have limited voice options.
- TensorFlow.js: May be slow on older mobile CPUs. Reduce detection interval if needed.
- Camera access: Requires HTTPS in production (or localhost for development).

---

## 🔮 Future Improvements

- [ ] Add support for Google Cloud Vision API (higher OCR accuracy)
- [ ] Self-hosted OSRM instance for production routing
- [ ] Offline mode using on-device vision models (e.g., MobileNet variants)
- [ ] Custom voice selection in settings
- [ ] Multi-language narration support
- [ ] Haptic feedback integration for mobile users
- [ ] Progressive Web App (PWA) for offline use

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 🙏 Credits

- [Hugging Face](https://huggingface.co) — Free AI model hosting (BLIP, TrOCR)
- [OpenStreetMap](https://openstreetmap.org) — Free map data via Nominatim
- [OSRM](https://project-osrm.org) — Open Source Routing Machine
- [TensorFlow.js](https://tensorflow.org/js) — In-browser ML (COCO-SSD)
- [Framer Motion](https://framer.com/motion) — React animations
- [Tailwind CSS](https://tailwindcss.com) — Utility-first CSS framework
