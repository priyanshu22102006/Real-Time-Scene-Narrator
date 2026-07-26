import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { speakText, stopSpeech } from '../utils/tts';
import InteractiveRouteMap from '../components/InteractiveRouteMap';
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

interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  location: { lat: number; lng: number };
  stepIndex: number;
}

interface AlternativeRoute {
  id: number;
  distance: number;
  duration: number;
  polyline: [number, number][];
}

interface RouteData {
  steps: RouteStep[];
  totalDistance: number;
  totalDuration: number;
  origin?: { lat: number; lng: number };
  destination: {
    displayName: string;
    lat: number;
    lng: number;
  };
  polyline?: [number, number][];
  alternativeRoutes?: AlternativeRoute[];
  totalCandidatePaths?: number;
}

interface GPSNavigationProps {
  initialDestination?: string;
  videoRef?: React.RefObject<HTMLVideoElement>;
  isCameraActive?: boolean;
  isMirrored?: boolean;
  onTrackedDetections?: (detections: TrackedDetection[]) => void;
}

const HAZARD_CLASSES = new Set([
  'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
  'dog', 'cat', 'traffic light', 'stop sign', 'chair', 'couch',
  'dining table', 'table', 'bench', 'backpack', 'suitcase',
  'door', 'potted plant', 'tv', 'laptop', 'bottle', 'cup',
]);

const STEP_TRIGGER_DISTANCE_M = 100;
const CONFIDENCE_THRESHOLD = 0.35;
const DETECTION_INTERVAL_MS = 350;

function getApproachDirection(cx: number, isMirrored: boolean): string {
  const effectiveCx = isMirrored ? 1 - cx : cx;
  if (effectiveCx < 0.33) return 'on your left';
  if (effectiveCx > 0.67) return 'on your right';
  return 'ahead';
}

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
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

export default function GPSNavigation({
  initialDestination = '',
  videoRef,
  isCameraActive = false,
  isMirrored = false,
  onTrackedDetections,
}: GPSNavigationProps) {
  const [destination, setDestination] = useState(initialDestination);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [distanceToNext, setDistanceToNext] = useState<number | null>(null);
  const [obstacleScannerActive, setObstacleScannerActive] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastAnnouncedStepRef = useRef<number>(-1);

  // Obstacle detection model & tracking refs
  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const isRunningObstacleRef = useRef(false);
  const obstacleInFlightRef = useRef(false);
  const tracksRef = useRef<TrackMap>(createTrackMap());
  const lastObstacleAlertTimeRef = useRef<Map<string, number>>(new Map());
  const isMirroredRef = useRef(isMirrored);
  const onTrackedDetectionsRef = useRef(onTrackedDetections);

  useEffect(() => {
    isMirroredRef.current = isMirrored;
  }, [isMirrored]);

  const loadObstacleModel = useCallback(async () => {
    if (modelRef.current) return;
    try {
      modelRef.current = await cocoSsd.load({ base: 'mobilenet_v2' });
      setObstacleScannerActive(true);
    } catch (err) {
      console.warn('[GPS] Failed to load mobilenet_v2, trying fallback:', err);
      try {
        modelRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        setObstacleScannerActive(true);
      } catch (fallbackErr) {
        console.error('[GPS] Failed to load object detection model:', fallbackErr);
      }
    }
  }, []);


  const runObstacleLoop = useCallback(async () => {
    while (isRunningObstacleRef.current) {
      const loopStart = Date.now();

      const video = videoRef?.current;
      if (!video || video.readyState < 2 || !modelRef.current || obstacleInFlightRef.current) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      obstacleInFlightRef.current = true;
      try {
        const predictions = await modelRef.current.detect(video, 12, CONFIDENCE_THRESHOLD);
        if (!isRunningObstacleRef.current) break;

        const videoW = video.videoWidth || 640;
        const videoH = video.videoHeight || 480;

        const rawDetections = predictions.map(p => ({
          class: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
        }));

        const tracked = updateDetectionTracks(tracksRef.current, rawDetections, videoW, videoH);
        onTrackedDetectionsRef.current?.(tracked);

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
          const lastAlert = lastObstacleAlertTimeRef.current.get(alertKey) || 0;

          if (now - lastAlert > 4000) {
            lastObstacleAlertTimeRef.current.set(alertKey, now);
            speakText(alertText);
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
          const alertText = `Detected: ${className} ${direction}.`;
          const alertKey = `${track.class}_detected`;
          const lastAlert = lastObstacleAlertTimeRef.current.get(alertKey) || 0;

          if (now - lastAlert > 8000) {
            lastObstacleAlertTimeRef.current.set(alertKey, now);
            speakText(alertText);
            announcedThisCycle = true;
          }
        }
      } catch (err) {
        console.warn('[GPS] Obstacle scan error:', err);
      } finally {
        obstacleInFlightRef.current = false;
      }

      const elapsed = Date.now() - loopStart;
      const waitMs = Math.max(0, DETECTION_INTERVAL_MS - elapsed);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }, [videoRef]);

  useEffect(() => {
    if (isNavigating && isCameraActive) {
      isRunningObstacleRef.current = true;
      resetTrackMap(tracksRef.current);
      loadObstacleModel().then(() => {
        if (isRunningObstacleRef.current) {
          runObstacleLoop();
        }
      });
    } else {
      isRunningObstacleRef.current = false;
      resetTrackMap(tracksRef.current);
      onTrackedDetectionsRef.current?.([]);
      setObstacleScannerActive(false);
    }

    return () => {
      isRunningObstacleRef.current = false;
    };
  }, [isNavigating, isCameraActive, loadObstacleModel, runObstacleLoop]);

  const fetchDirections = useCallback(async (origin: { lat: number; lng: number }) => {
    if (!destination.trim()) {
      setErrorMessage('Please enter a destination address.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    speakText('Searching all available pathways and choosing the shortest route. Please wait.');

    try {
      const response = await axios.get<RouteData>('/api/directions', {
        params: {
          origin: `${origin.lat},${origin.lng}`,
          destination: destination.trim(),
        },
        timeout: 20000,
      });

      setRouteData(response.data);
      setSelectedRouteIndex(0);
      setCurrentStepIndex(0);
      lastAnnouncedStepRef.current = -1;

      const { totalDistance, totalDuration, steps, totalCandidatePaths = 1 } = response.data;
      const firstInstruction = steps[0]?.instruction || 'Starting navigation.';
      speakText(
        `Shortest route calculated from ${totalCandidatePaths} candidate paths. Distance: ${formatDistance(totalDistance)}. ` +
        `Estimated time: ${formatDuration(totalDuration)}. ` +
        firstInstruction
      );

    } catch (err: unknown) {
      let message = 'Failed to get directions.';
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 404) {
          message = 'Destination address not found.';
        } else if (err.response?.data?.error) {
          message = err.response.data.error;
        }
      }
      setErrorMessage(message);
      speakText('Error: ' + message);
    } finally {
      setIsLoading(false);
    }
  }, [destination]);

  const startNavigation = useCallback(() => {
    if (!navigator.geolocation) {
      setPositionError('Geolocation is not supported by your browser.');
      return;
    }

    setIsNavigating(true);
    setErrorMessage(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const origin = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setCurrentPosition(origin);

        fetchDirections(origin);

        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setCurrentPosition(userPos);
          },
          (err) => {
            console.warn('[GPS] Watch position error:', err.message);
            setPositionError('GPS signal lost. Please check location settings.');
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 5000,
          }
        );
      },
      (err) => {
        setIsNavigating(false);
        const messages: Record<number, string> = {
          1: 'Location access denied.',
          2: 'Position unavailable.',
          3: 'Location request timed out.',
        };
        setPositionError(messages[err.code] || 'Failed to get location.');
        speakText('Unable to access your location. ' + (messages[err.code] || ''));
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [fetchDirections]);

  const stopNavigation = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsNavigating(false);
    setRouteData(null);
    setCurrentStepIndex(0);
    setDistanceToNext(null);
    stopSpeech();
    speakText('Navigation stopped.');
  }, []);

  useEffect(() => {
    if (!currentPosition || !routeData || !isNavigating) return;

    const steps = routeData.steps;
    if (currentStepIndex >= steps.length) return;

    const nextStep = steps[currentStepIndex];
    const dist = haversineDistance(
      currentPosition.lat, currentPosition.lng,
      nextStep.location.lat, nextStep.location.lng
    );

    setDistanceToNext(Math.round(dist));

    if (dist <= STEP_TRIGGER_DISTANCE_M && lastAnnouncedStepRef.current !== currentStepIndex) {
      lastAnnouncedStepRef.current = currentStepIndex;
      speakText(nextStep.instruction);

      if (currentStepIndex + 1 < steps.length) {
        setCurrentStepIndex(prev => prev + 1);
      } else {
        speakText('You have arrived at your destination!');
        stopNavigation();
      }
    }
  }, [currentPosition, routeData, currentStepIndex, isNavigating, stopNavigation]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const currentStep = routeData?.steps[currentStepIndex];
  const remainingSteps = routeData ? routeData.steps.length - currentStepIndex : 0;

  return (
    <div className="flex flex-col gap-6" role="region" aria-label="GPS turn-by-turn navigation">
      <div className="flex flex-col gap-2">
        <label htmlFor="destination-input" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Destination Address / Goal
        </label>
        <div className="flex gap-2">
          <input
            id="destination-input"
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="e.g. Times Square, New York, NY"
            className="flex-1 px-4 py-3 rounded-xl border border-gray-300 dark:border-white/20 bg-white dark:bg-dark-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isNavigating) startNavigation();
            }}
            disabled={isNavigating}
          />
        </div>
      </div>

      <AnimatePresence>
        {(errorMessage || positionError) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm"
          >
            ⚠️ {errorMessage || positionError}
          </motion.div>
        )}
      </AnimatePresence>

      {isNavigating && (
        <div className="flex flex-col gap-2 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="status-dot-active" aria-hidden="true" />
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {isLoading ? '🔄 Calculating shortest route...' : '🧭 Navigating (Shortest Route Active)'}
              </span>
            </div>
            {currentPosition && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                GPS Active ✓
              </span>
            )}
          </div>
          <div className="flex items-center justify-between text-xs border-t border-emerald-200/60 dark:border-emerald-800/60 pt-2 mt-1">
            <span className="text-emerald-800 dark:text-emerald-200 font-medium flex items-center gap-1.5">
              👁 AI Camera Obstacle Scanner:
            </span>
            <span className={isCameraActive ? 'text-emerald-700 dark:text-emerald-300 font-bold' : 'text-amber-600 dark:text-amber-400 font-medium'}>
              {isCameraActive ? (obstacleScannerActive ? '✓ Active (MobileNetV2)' : '⏳ Loading Scanner...') : '⚠️ Connect camera for live obstacle alerts'}
            </span>
          </div>
        </div>
      )}

      {/* Interactive Map Display */}
      {isNavigating && routeData && (
        <InteractiveRouteMap
          origin={currentPosition || routeData.origin || null}
          destination={routeData.destination}
          destinationName={routeData.destination.displayName}
          primaryPolyline={routeData.polyline || []}
          alternativeRoutes={routeData.alternativeRoutes}
          currentPosition={currentPosition}
          selectedRouteIndex={selectedRouteIndex}
          onSelectRoute={setSelectedRouteIndex}
        />
      )}

      <AnimatePresence mode="wait">
        {currentStep && isNavigating && (
          <motion.div
            key={currentStepIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="p-5 rounded-xl bg-primary-50 dark:bg-primary-900/20 border-2 border-primary-200 dark:border-primary-700"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {currentStepIndex + 1}
              </div>
              <div className="flex-1">
                <p className="text-gray-800 dark:text-gray-200 font-semibold text-base leading-relaxed">
                  {currentStep.instruction}
                </p>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                  <span>{formatDistance(currentStep.distance)}</span>
                  <span>·</span>
                  <span>{formatDuration(currentStep.duration)}</span>
                  {distanceToNext !== null && (
                    <>
                      <span>·</span>
                      <span className={distanceToNext < 200 ? 'text-amber-500 font-semibold' : ''}>
                        {distanceToNext}m away
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {routeData && isNavigating && (
        <div className="p-4 rounded-xl bg-gray-50 dark:bg-dark-800 border border-gray-200 dark:border-white/10">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">
            Route Overview &amp; Candidate Paths
          </p>
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-gray-600 dark:text-gray-300 font-medium">
              📍 Goal: {routeData.destination.displayName.split(',').slice(0, 2).join(',')}
            </span>
          </div>
          <div className="flex gap-4 text-sm flex-wrap">
            <span className="text-gray-500">
              Total: <strong>{formatDistance(routeData.totalDistance)}</strong>
            </span>
            <span className="text-gray-500">
              Est Time: <strong>{formatDuration(routeData.totalDuration)}</strong>
            </span>
            <span className="text-primary-500 font-semibold">
              {remainingSteps} maneuvers left
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-3" role="group" aria-label="Navigation controls">
        {!isNavigating ? (
          <button
            onClick={startNavigation}
            disabled={!destination.trim() || isLoading}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 hover:scale-105 disabled:scale-100"
          >
            🧭 Start Navigation (Shortest Route)
          </button>
        ) : (
          <>
            <button
              onClick={() => currentStep && speakText(currentStep.instruction)}
              disabled={!currentStep}
              className="flex-1 flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 hover:scale-105 text-sm"
            >
              🔊 Repeat Step Speech
            </button>
            <button
              onClick={stopNavigation}
              className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 hover:scale-105 text-sm"
            >
              ⏹ Stop Navigation
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        OpenStreetMap Nominatim + OSRM Shortest Path Engine &amp; Interactive Map View.
      </p>
    </div>
  );
}
