import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { speakText, stopSpeech } from '../utils/tts';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface DetectionItem {
  class: string;
  confidence: number;
  position: string;
  distance: string;
}

interface NarratorState {
  isRunning: boolean;
  isPaused: boolean;
  lastDescription: string;
  detections: DetectionItem[];
  errorMessage: string | null;
  frameCount: number;
  isLoading: boolean;
}

interface CameraToVoiceProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isCameraActive: boolean;
}

// ─── CameraToVoice Component ───────────────────────────────────────────────────
export default function CameraToVoice({ videoRef, isCameraActive }: CameraToVoiceProps) {
  const [state, setState] = useState<NarratorState>({
    isRunning: false,
    isPaused: false,
    lastDescription: '',
    detections: [],
    errorMessage: null,
    frameCount: 0,
    isLoading: false,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestInFlightRef = useRef(false);

  const CAPTURE_INTERVAL_MS = 3000;

  /**
   * Robust frame capture that handles video element dimensions safely
   */
  const captureFrame = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || video.readyState < 2) {
        console.warn('[CameraToVoice] Video element not ready yet');
        resolve(null);
        return;
      }

      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      try {
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size === 0) {
              console.warn('[CameraToVoice] Empty image blob generated');
              resolve(null);
            } else {
              resolve(blob);
            }
          },
          'image/jpeg',
          0.85
        );
      } catch (err) {
        console.error('[CameraToVoice] Error drawing canvas frame:', err);
        resolve(null);
      }
    });
  }, [videoRef]);

  const [aiProvider, setAiProvider] = useState<string>('Google Gemini Vision AI');
  const describeFrameRef = useRef<() => Promise<void>>();

  const describeFrame = useCallback(async () => {
    if (requestInFlightRef.current) return;
    if (!isCameraActive) return;

    requestInFlightRef.current = true;
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const blob = await captureFrame();
      if (!blob) {
        console.warn('[CameraToVoice] Frame capture returned empty blob, retrying next tick');
        requestInFlightRef.current = false;
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      const formData = new FormData();
      formData.append('image', blob, 'frame.jpg');

      const response = await axios.post<{
        description: string;
        detections?: DetectionItem[];
        timestamp: string;
        provider?: string;
      }>(
        '/api/describe-scene',
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 15000,
        }
      );

      const { description, detections, provider } = response.data;

      if (provider) {
        setAiProvider(provider);
      }

      setState(prev => ({
        ...prev,
        lastDescription: description,
        detections: detections || [],
        errorMessage: null,
        frameCount: prev.frameCount + 1,
        isLoading: false,
      }));

      // Speak description
      if (description) {
        speakText(description);
      }

    } catch (err: unknown) {
      let message = 'Failed to describe scene. Please verify backend is running.';
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error) {
          message = err.response.data.error;
        } else if (err.code === 'ECONNABORTED') {
          message = 'Scene analysis timed out. Retrying...';
        }
      }
      console.error('[CameraToVoice] API error:', message);
      setState(prev => ({ ...prev, errorMessage: message, isLoading: false }));
    } finally {
      requestInFlightRef.current = false;
    }
  }, [captureFrame, isCameraActive]);

  useEffect(() => {
    describeFrameRef.current = describeFrame;
  }, [describeFrame]);

  const startNarration = useCallback(() => {
    if (!isCameraActive) {
      speakText('Please start camera first.');
      return;
    }
    setState(prev => ({ ...prev, isRunning: true, isPaused: false, errorMessage: null }));
    speakText('Narration started.');
    describeFrame();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (describeFrameRef.current) describeFrameRef.current();
    }, CAPTURE_INTERVAL_MS);
  }, [isCameraActive, describeFrame]);

  const stopNarration = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stopSpeech();
    setState(prev => ({ ...prev, isRunning: false, isPaused: false, isLoading: false }));
    speakText('Narration stopped.');
  }, []);

  const togglePause = useCallback(() => {
    setState(prev => {
      if (prev.isPaused) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
          if (describeFrameRef.current) describeFrameRef.current();
        }, CAPTURE_INTERVAL_MS);
        speakText('Narration resumed.');
        return { ...prev, isPaused: false };
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        stopSpeech();
        speakText('Narration paused.');
        return { ...prev, isPaused: true };
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      stopSpeech();
    };
  }, []);

  useEffect(() => {
    if (!isCameraActive && state.isRunning) {
      stopNarration();
    }
  }, [isCameraActive, state.isRunning, stopNarration]);

  return (
    <div className="flex flex-col gap-6" role="region" aria-label="Camera to Voice narration module">
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {/* Status bar */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-gray-100 dark:bg-dark-800">
        <div className="flex items-center gap-3">
          <div className={state.isRunning && !state.isPaused ? 'status-dot-active' : 'status-dot-inactive'} aria-hidden="true" />
          <span className="font-medium text-sm text-gray-700 dark:text-gray-300">
            {state.isRunning
              ? state.isPaused
                ? '⏸ Paused'
                : state.isLoading
                ? '🔄 AI Analyzing Scene...'
                : '🎙️ Narrating'
              : '⏹ Stopped'}
          </span>
        </div>
        {state.frameCount > 0 && (
          <span className="text-xs text-gray-400">{state.frameCount} scenes described</span>
        )}
      </div>

      {/* Error display */}
      <AnimatePresence>
        {state.errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between"
          >
            <span>⚠️ {state.errorMessage}</span>
            <button
              onClick={() => setState(prev => ({ ...prev, errorMessage: null }))}
              className="text-xs font-bold underline ml-2"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recognized Objects List */}
      {state.detections.length > 0 && (
        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
          <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-2">
            🎯 Recognized Objects ({state.detections.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {state.detections.map((det, i) => (
              <span
                key={`${det.class}-${i}`}
                className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-800/50 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-700"
              >
                {det.class.charAt(0).toUpperCase() + det.class.slice(1)} ({det.confidence}%) · {det.position}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Last description display */}
      <AnimatePresence mode="wait">
        {state.lastDescription && (
          <motion.div
            key={state.lastDescription}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-5 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800"
            aria-live="assertive"
            aria-label="Latest scene description"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-primary-500 dark:text-primary-400 uppercase tracking-wide">
                Live Scene Narration
              </p>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded-full">
                ✓ {aiProvider}
              </span>
            </div>
            <p className="text-gray-800 dark:text-gray-200 text-base leading-relaxed font-medium">
              "{state.lastDescription}"
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Control buttons */}
      <div className="flex flex-wrap gap-3" role="group" aria-label="Narration controls">
        {!state.isRunning ? (
          <button
            onClick={startNarration}
            disabled={!isCameraActive}
            className="flex-1 flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed"
          >
            🎙️ Start Narration
          </button>
        ) : (
          <>
            <button
              onClick={togglePause}
              className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 hover:scale-105"
            >
              {state.isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              onClick={stopNarration}
              className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 hover:scale-105"
            >
              ⏹ Stop
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        Powered by <strong>Google Gemini AI</strong> &amp; <strong>Voice Studio</strong>.
      </p>
    </div>
  );
}
