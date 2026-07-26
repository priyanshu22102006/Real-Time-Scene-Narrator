import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';
import {
  createTrackMap,
  isObstacleBlockingPath,
  isTrackApproaching,
  resetTrackMap,
  updateDetectionTracks,
  type TrackedDetection,
  type TrackMap,
} from '../utils/detectionTracker';

interface Detection {
  class: string;
  score: number;
  bbox: [number, number, number, number];
  id?: number;
}

interface AmbientModeProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isCameraActive: boolean;
  isMirrored?: boolean;
  onTrackedDetections?: (detections: TrackedDetection[]) => void;
}

const HAZARD_CLASSES = new Set([
  'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
  'dog', 'cat', 'traffic light', 'stop sign', 'chair', 'couch',
  'dining table', 'table', 'bench', 'backpack', 'suitcase',
  'door', 'potted plant', 'tv', 'laptop', 'bottle', 'cup',
]);

const CONFIDENCE_THRESHOLD = 0.35;
const DETECTION_INTERVAL_MS = 350;
const MAX_DETECTIONS = 15;

function getApproachDirection(cx: number, isMirrored: boolean): string {
  const effectiveCx = isMirrored ? 1 - cx : cx;
  if (effectiveCx < 0.33) return 'on your left';
  if (effectiveCx > 0.67) return 'on your right';
  return 'ahead';
}

// Category-aware obstacle dictation — produces rich spoken descriptions per object type
function buildObstacleDictation(
  className: string,
  direction: string,
  isApproaching: boolean,
  isBlocking: boolean
): string {
  const name = className.toLowerCase();
  const vehicleSet = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);
  const pedestrianSet = new Set(['person', 'dog', 'cat']);
  const furnitureSet = new Set(['chair', 'couch', 'dining table', 'table', 'bench']);
  const groundSet = new Set(['backpack', 'suitcase', 'bottle', 'cup', 'potted plant']);
  const signSet = new Set(['traffic light', 'stop sign']);

  if (vehicleSet.has(name)) {
    return isApproaching
      ? `Caution! A ${name} is moving towards you ${direction}!`
      : `Warning! A parked ${name} is in your path ${direction}.`;
  }
  if (pedestrianSet.has(name)) {
    return isApproaching
      ? `Notice! A ${name} is walking ${direction}!`
      : `A ${name} is detected ${direction}.`;
  }
  if (furnitureSet.has(name)) {
    return isBlocking
      ? `Warning! A ${name} is blocking your walking path ${direction}!`
      : `Caution! There is a ${name} obstacle ${direction}.`;
  }
  if (groundSet.has(name)) {
    return `Watch your step! There is a ${name} on the ground ${direction}.`;
  }
  if (signSet.has(name)) {
    return `Attention! A ${name} is detected ${direction}.`;
  }
  return isBlocking
    ? `Warning! A ${className} obstacle is blocking your path ${direction}!`
    : `Notice! There is a ${className} ${direction}.`;
}

function speakAlert(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.15;
  utterance.pitch = 1.2;
  utterance.volume = 1.0;
  window.speechSynthesis.speak(utterance);
}

export default function AmbientMode({
  videoRef,
  isCameraActive,
  isMirrored = false,
  onTrackedDetections,
}: AmbientModeProps) {
  const [isActive, setIsActive] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const isRunningRef = useRef(false);
  const detectionInFlightRef = useRef(false);
  const tracksRef = useRef<TrackMap>(createTrackMap());
  const lastAlertTimeRef = useRef<Map<string, number>>(new Map());
  const isMirroredRef = useRef(isMirrored);
  const onTrackedDetectionsRef = useRef(onTrackedDetections);

  useEffect(() => {
    isMirroredRef.current = isMirrored;
  }, [isMirrored]);

  useEffect(() => {
    onTrackedDetectionsRef.current = onTrackedDetections;
  }, [onTrackedDetections]);

  const loadModel = useCallback(async () => {
    if (modelRef.current || modelLoading) return;
    setModelLoading(true);
    setModelLoadError(null);
    try {
      modelRef.current = await cocoSsd.load({ base: 'mobilenet_v2' });
      setModelLoaded(true);
    } catch (err) {
      console.error('[AmbientMode] Failed to load COCO-SSD mobilenet_v2 model:', err);
      try {
        modelRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        setModelLoaded(true);
      } catch (fallbackErr) {
        setModelLoadError('Failed to load object detection model. Check your connection.');
      }
    } finally {
      setModelLoading(false);
    }
  }, [modelLoading]);

  const runDetectionLoop = useCallback(async () => {
    while (isRunningRef.current) {
      const loopStart = Date.now();

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !modelRef.current || detectionInFlightRef.current) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      detectionInFlightRef.current = true;
      try {
        const predictions = await modelRef.current.detect(video, MAX_DETECTIONS, CONFIDENCE_THRESHOLD);

        if (!isRunningRef.current) break;

        const videoW = video.videoWidth || 640;
        const videoH = video.videoHeight || 480;

        const rawDetections = predictions.map(p => ({
          class: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
        }));

        const tracked = updateDetectionTracks(tracksRef.current, rawDetections, videoW, videoH);

        setDetections(tracked.map(t => ({
          id: t.id,
          class: t.class,
          score: t.score,
          bbox: t.bbox,
        })));

        onTrackedDetectionsRef.current?.(tracked);

        const newAlerts: string[] = [];
        const mirrored = isMirroredRef.current;
        const now = Date.now();
        let announcedThisCycle = false;

        // ── Pass 1: High-priority — blocking or actively approaching obstacles ──
        for (const track of tracked) {
          if (announcedThisCycle) break;
          if (!HAZARD_CLASSES.has(track.class)) continue;

          const isApproaching = isTrackApproaching(tracksRef.current, track.id);
          const isBlocking = isObstacleBlockingPath(track.normBbox);
          if (!isApproaching && !isBlocking) continue;

          const cx = track.normBbox[0] + track.normBbox[2] / 2;
          const direction = getApproachDirection(cx, mirrored);
          const className = track.class.charAt(0).toUpperCase() + track.class.slice(1);
          const alertText = buildObstacleDictation(className, direction, isApproaching, isBlocking);
          const alertKey = `${track.class}_active`;
          const lastAlert = lastAlertTimeRef.current.get(alertKey) || 0;

          if (now - lastAlert > 4000) {
            newAlerts.push(alertText);
            lastAlertTimeRef.current.set(alertKey, now);
            speakAlert(alertText);
            announcedThisCycle = true;
          }
        }

        // ── Pass 2: Announce ALL other detected objects (even stationary) ──
        for (const track of tracked) {
          if (announcedThisCycle) break;
          if (!HAZARD_CLASSES.has(track.class)) continue;

          const cx = track.normBbox[0] + track.normBbox[2] / 2;
          const direction = getApproachDirection(cx, mirrored);
          const className = track.class.charAt(0).toUpperCase() + track.class.slice(1);
          // Gentle announcement for detected-but-not-blocking objects
          const alertText = `Detected: ${className} ${direction}.`;
          const alertKey = `${track.class}_detected`;
          const lastAlert = lastAlertTimeRef.current.get(alertKey) || 0;

          if (now - lastAlert > 8000) {
            newAlerts.push(alertText);
            lastAlertTimeRef.current.set(alertKey, now);
            speakAlert(alertText);
            announcedThisCycle = true;
          }
        }

        if (newAlerts.length > 0) {
          setAlerts(prev => [...newAlerts, ...prev].slice(0, 5));
        }
      } catch (err) {
        console.error('[AmbientMode] Detection error:', err);
      } finally {
        detectionInFlightRef.current = false;
      }

      const elapsed = Date.now() - loopStart;
      const waitMs = Math.max(0, DETECTION_INTERVAL_MS - elapsed);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }, [videoRef]);

  const startDetection = useCallback(async () => {
    if (!modelRef.current) {
      await loadModel();
    }
    if (!modelRef.current) return;

    resetTrackMap(tracksRef.current);
    lastAlertTimeRef.current.clear();
    setIsActive(true);
    isRunningRef.current = true;
    speakAlert('Ambient mode activated. Monitoring for obstacles.');
    runDetectionLoop();
  }, [modelLoaded, loadModel, runDetectionLoop]);

  const stopDetection = useCallback(() => {
    isRunningRef.current = false;
    resetTrackMap(tracksRef.current);
    onTrackedDetectionsRef.current?.([]);
    setIsActive(false);
    setDetections([]);
    window.speechSynthesis.cancel();
    speakAlert('Ambient mode deactivated.');
  }, []);

  useEffect(() => {
    return () => {
      isRunningRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isCameraActive && isActive) stopDetection();
  }, [isCameraActive, isActive, stopDetection]);

  return (
    <div className="flex flex-col gap-6" role="region" aria-label="Ambient obstacle detection mode">
      <div className="flex items-center justify-between p-4 rounded-xl bg-gray-100 dark:bg-dark-800">
        <div className="flex items-center gap-3">
          <div
            className={isActive ? 'status-dot-active' : modelLoading ? 'status-dot-warning' : 'status-dot-inactive'}
            aria-hidden="true"
          />
          <span className="font-medium text-sm text-gray-700 dark:text-gray-300">
            {modelLoading ? '⏳ Loading AI model...' : isActive ? '👁 Monitoring active' : '⏹ Monitoring stopped'}
          </span>
        </div>
        {modelLoaded && !modelLoading && (
          <span className="text-xs text-emerald-500 font-medium">✓ COCO-SSD ready</span>
        )}
      </div>

      {modelLoadError && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          ⚠️ {modelLoadError}
        </div>
      )}

      {isActive && detections.length > 0 && (
        <div
          className="p-4 rounded-xl bg-gray-50 dark:bg-dark-800 border border-gray-200 dark:border-white/10"
          aria-live="polite"
          aria-label="Currently detected objects"
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
            Detected Objects ({detections.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {detections.map(det => (
              <span
                key={det.id ?? det.class}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-opacity duration-200 ${
                  HAZARD_CLASSES.has(det.class)
                    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                    : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400'
                }`}
              >
                {det.class} ({Math.round(det.score * 100)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {alerts.length > 0 && (
          <div
            className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
            aria-live="assertive"
            aria-label="Obstacle alerts"
            role="log"
          >
            <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-3 uppercase tracking-wide">
              ⚠️ Recent Alerts
            </p>
            <ul className="flex flex-col gap-2">
              {alerts.map((alert, i) => (
                <motion.li
                  key={`${alert}-${i}`}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`text-sm font-medium ${
                    i === 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-500'
                  }`}
                >
                  {i === 0 ? '🔴' : '⚪'} {alert}
                </motion.li>
              ))}
            </ul>
          </div>
        )}
      </AnimatePresence>

      <div className="flex gap-3" role="group" aria-label="Ambient mode controls">
        <button
          onClick={isActive ? stopDetection : startDetection}
          disabled={!isCameraActive || modelLoading}
          className={`flex-1 flex items-center justify-center gap-2 font-semibold py-3 px-6 rounded-xl transition-all duration-200 hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed ${
            isActive
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white'
          }`}
          aria-label={isActive ? 'Stop ambient monitoring' : 'Start ambient monitoring'}
          aria-pressed={isActive}
          aria-disabled={!isCameraActive || modelLoading}
        >
          {modelLoading ? '⏳ Loading model...' : isActive ? '⏹ Stop Monitoring' : '👁 Start Monitoring'}
        </button>
      </div>

      <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
        <p className="font-semibold mb-1">ℹ️ How Ambient Mode Works</p>
        <p>TensorFlow.js COCO-SSD runs entirely in your browser — no data sent to servers.
          Objects are tracked frame-to-frame with smoothed bounding boxes for stable detection.
          Hazard alerts trigger only when an object is consistently approaching.</p>
      </div>
    </div>
  );
}
