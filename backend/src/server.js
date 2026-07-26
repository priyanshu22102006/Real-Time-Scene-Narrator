// Real-Time Scene Narrator - Express Backend Server
// Provides API endpoints for Gemini Vision analysis, ElevenLabs TTS, and GPS directions

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { describeScene } from './routes/describeScene.js';
import { extractAddress } from './routes/extractAddress.js';
import { getDirections } from './routes/directions.js';
import { generateTTS } from './routes/tts.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.FRONTEND_URL || 'http://localhost:5173',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30,             // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again after a minute.',
    status: 429,
  },
});

const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many TTS requests, please try again after a minute.',
    status: 429,
  },
});

const directionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again after a minute.',
    status: 429,
  },
});

// ─── Multer Configuration ──────────────────────────────────────────────────────
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed.'));
    }
  },
});

// ─── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    vision_provider: 'Google Gemini 2.5 Flash Vision API',
    tts_provider: 'ElevenLabs AI Text-to-Speech (Turbo v2)',
    directions_provider: 'OpenStreetMap Nominatim + OSRM',
  });
});

// POST /api/describe-scene
app.post('/api/describe-scene', apiLimiter, upload.single('image'), describeScene);

// POST /api/extract-address
app.post('/api/extract-address', apiLimiter, upload.single('image'), extractAddress);

// POST /api/tts (ElevenLabs Audio)
app.post('/api/tts', ttsLimiter, generateTTS);

// GET /api/directions
app.get('/api/directions', directionsLimiter, getDirections);

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message || err);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Image too large. Maximum size is 10MB.', status: 413 });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    status: err.status || 500,
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Real-Time Scene Narrator Backend running on port ${PORT}`);
  console.log(`   Vision API: Google Gemini 2.5 Flash`);
  console.log(`   TTS Engine: ElevenLabs AI Voice Studio`);
  console.log(`   Directions: Nominatim (geocoding) + OSRM (routing)`);
  console.log(`   Health check: http://localhost:${PORT}/health\n`);
});

export default app;
