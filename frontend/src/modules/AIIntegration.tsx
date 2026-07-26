import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface AIIntegrationProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isCameraActive: boolean;
  onSpeakText?: (text: string) => void;
}

interface PerceptionResult {
  status: string;
  provider?: string;
  timestamp?: string;
  object_detection: {
    total_objects: number;
    detections: Array<{
      label: string;
      confidence: number;
      box?: number[];
      position: string;
    }>;
    safety_warnings: string[];
  };
  scene_analysis: {
    scene_description: string;
    detected_counts: Record<string, number>;
    lighting_condition: string;
    environmental_hazards: string[];
    narrator_audio_script: string;
  };
  gps_navigation: {
    distance_meters: number;
    bearing_degrees: number;
    heading_direction: string;
    navigation_audio_guidance: string;
    visual_perception_fused_alerts: string[];
  };
  mood_and_emergency: {
    detected_mood: string;
    posture_state: string;
    emergency_assessment: {
      medical_emergency: boolean;
      emergency_level: string;
      idle_duration_seconds: number;
      alert_message: string;
    };
  };
}

export default function AIIntegration({
  videoRef,
  isCameraActive,
  onSpeakText
}: AIIntegrationProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoRun, setAutoRun] = useState(true);
  const [idleTimer, setIdleTimer] = useState(0);
  const [idleThreshold, setIdleThreshold] = useState(180);
  const [result, setResult] = useState<PerceptionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // GPS Coordinate state
  const [currentLat, setCurrentLat] = useState('37.7749');
  const [currentLon, setCurrentLon] = useState('-122.4194');
  const [targetLat, setTargetLat] = useState('37.7752');
  const [targetLon, setTargetLon] = useState('-122.4180');

  const idleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const idleTimerRef = useRef(0);

  // Keep idleTimerRef updated
  useEffect(() => {
    idleTimerRef.current = idleTimer;
  }, [idleTimer]);

  // Idle Timer Increment Logic
  useEffect(() => {
    idleIntervalRef.current = setInterval(() => {
      setIdleTimer(prev => prev + 1);
    }, 1000);

    return () => {
      if (idleIntervalRef.current) clearInterval(idleIntervalRef.current);
    };
  }, []);

  // Master All-in-One AI Execution Function
  const runAllAIFeatures = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('currentLat', currentLat);
      formData.append('currentLon', currentLon);
      formData.append('targetLat', targetLat);
      formData.append('targetLon', targetLon);
      formData.append('idleThresholdSeconds', idleThreshold.toString());
      formData.append('idleDurationSeconds', idleTimerRef.current.toString());
      formData.append('timestamp', (Date.now() / 1000).toString());

      // Capture frame from video element if active
      if (isCameraActive && videoRef.current) {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85));
          if (blob) {
            formData.append('image', blob, 'frame.jpg');
          }
        }
      }

      const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000';
      const res = await axios.post(`${API_BASE}/api/ai-inference`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 15000
      });

      if (res.data && res.data.status === 'success') {
        setResult(res.data);
        setErrorMsg(null);

        // Speak scene description if speech handler is provided
        const audioScript = res.data.scene_analysis?.narrator_audio_script || res.data.scene_analysis?.scene_description;
        if (audioScript && onSpeakText) {
          onSpeakText(audioScript);
        }

        // Trigger alarm audio/speech if medical emergency occurs
        if (res.data.mood_and_emergency?.emergency_assessment?.medical_emergency) {
          const emergencyText = "CRITICAL MEDICAL EMERGENCY ALERT: Person sitting idle for too long! Assistance required.";
          if (onSpeakText) onSpeakText(emergencyText);
        }
      }
    } catch (err: any) {
      if (err.response?.status === 429) {
        console.warn('[AIIntegration] Rate limit throttled. Retrying shortly...');
      } else {
        console.error('[AIIntegration] Execution error:', err);
        setErrorMsg(err.response?.data?.error || 'Failed to complete AI perception run. Verify backend connection.');
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, currentLat, currentLon, targetLat, targetLon, idleThreshold, isCameraActive, videoRef, onSpeakText]);

  // Auto-run continuous loop
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (autoRun && isCameraActive) {
      runAllAIFeatures();
      interval = setInterval(() => {
        runAllAIFeatures();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRun, isCameraActive, runAllAIFeatures]);

  const resetIdleTimer = () => {
    setIdleTimer(0);
  };

  const isEmergency = result?.mood_and_emergency?.emergency_assessment?.medical_emergency || idleTimer >= idleThreshold;

  return (
    <div className="space-y-6">
      {/* ─── Header & Master Control Bar ────────────────────────────────────────── */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 text-white shadow-lg">
                Dedicated AI Hub
              </span>
              <h2 className="text-2xl font-black text-white flex items-center gap-2">
                🤖 VisionMate AI Integration (All-in-One)
              </h2>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Executes Object Detection, Visual Scene Narration, GPS Context Fusion, and Mood & Sitting Idle Medical Emergency Alerting simultaneously.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Continuous Real-Time Processing Status */}
            <button
              onClick={() => setAutoRun(!autoRun)}
              className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition-all flex items-center gap-2 border ${
                autoRun
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-lg shadow-cyan-500/10'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${autoRun ? 'bg-cyan-400 animate-ping' : 'bg-slate-500'}`} />
              {autoRun ? 'Real-Time AI Processing Active' : 'Real-Time AI Processing Paused'}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Medical Emergency Flashing Alert Banner ──────────────────────────────── */}
      <AnimatePresence>
        {isEmergency && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="p-5 rounded-2xl bg-rose-950/90 border-2 border-rose-500 text-white shadow-2xl animate-pulse"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-4xl animate-bounce">🚨</span>
                <div>
                  <h3 className="text-xl font-black text-rose-200 tracking-wide uppercase">
                    Critical Medical Emergency Alert!
                  </h3>
                  <p className="text-rose-100 text-sm mt-1 font-medium">
                    Person has been detected sitting idle for over <strong className="text-yellow-300 font-extrabold">3 minutes ({idleTimer} seconds)</strong> (exceeding maximum safety threshold of {idleThreshold}s / 3 min). Potential medical distress or unresponsiveness detected!
                  </p>
                </div>
              </div>
              <button
                onClick={resetIdleTimer}
                className="px-4 py-2 bg-white text-rose-950 font-black text-xs uppercase tracking-wider rounded-lg shadow hover:bg-rose-100 active:scale-95 transition-all"
              >
                Reset Idle Timer
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Error Notification ─────────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-amber-950/80 border border-amber-500/50 text-amber-200 text-sm">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* ─── 4 Feature Subsystem Cards Grid ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Subsystem 1: Scene Narration & Audio Script */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>📷</span> Scene Perception & Narration
              </h3>
              <span className="text-xs px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                Visual Narrative
              </span>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 min-h-[90px]">
              {result?.scene_analysis?.scene_description || 'Click "Run All AI Features" to describe scene surroundings.'}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Lighting: <strong className="text-slate-200">{result?.scene_analysis?.lighting_condition || 'Normal'}</strong></span>
            {result?.provider && <span className="text-indigo-400 font-medium">Provider: {result.provider}</span>}
          </div>
        </div>

        {/* Subsystem 2: Object Detection & Visual Hazards */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🎯</span> Object Detections & Hazards
              </h3>
              <span className="text-xs px-2.5 py-1 rounded-md bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30">
                Count: {result?.object_detection?.total_objects || 0}
              </span>
            </div>

            <div className="space-y-2 min-h-[90px]">
              {result?.object_detection?.detections && result.object_detection.detections.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {result.object_detection.detections.map((det, i) => (
                    <div key={i} className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-center gap-2">
                      <span className="font-semibold text-cyan-300">{det.label}</span>
                      <span className="text-slate-400">({Math.round(det.confidence * 100)}%)</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 uppercase">{det.position}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 text-sm bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                  No objects detected yet.
                </p>
              )}
            </div>
          </div>

          {result?.object_detection?.safety_warnings && result.object_detection.safety_warnings.length > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs font-semibold">
              ⚠️ {result.object_detection.safety_warnings.join(', ')}
            </div>
          )}
        </div>

        {/* Subsystem 3: GPS Visual Fusion Guidance */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🗺️</span> GPS Visual Fusion Guidance
              </h3>
              <span className="text-xs px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                Turn-by-Turn + Visual
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Current Lat/Lon</label>
                <div className="flex gap-1 mt-1">
                  <input
                    type="text"
                    value={currentLat}
                    onChange={e => setCurrentLat(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                  />
                  <input
                    type="text"
                    value={currentLon}
                    onChange={e => setCurrentLon(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Target Lat/Lon</label>
                <div className="flex gap-1 mt-1">
                  <input
                    type="text"
                    value={targetLat}
                    onChange={e => setTargetLat(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                  />
                  <input
                    type="text"
                    value={targetLon}
                    onChange={e => setTargetLon(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                  />
                </div>
              </div>
            </div>

            <p className="text-slate-300 text-sm bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
              {result?.gps_navigation?.navigation_audio_guidance || 'GPS route visual context ready.'}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <span>Distance: <strong className="text-emerald-400">{result?.gps_navigation?.distance_meters || 0}m</strong></span>
            <span>Bearing: <strong className="text-emerald-400">{result?.gps_navigation?.bearing_degrees || 0}° ({result?.gps_navigation?.heading_direction || 'N/A'})</strong></span>
          </div>
        </div>

        {/* Subsystem 4: Mood & Medical Emergency Monitor */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🚨</span> Mood & Medical Emergency Monitor
              </h3>
              <span className={`text-xs px-2.5 py-1 rounded-md font-bold uppercase tracking-wider ${
                isEmergency ? 'bg-rose-500 text-white animate-pulse' : 'bg-emerald-500/20 text-emerald-300'
              }`}>
                {isEmergency ? 'EMERGENCY' : 'MONITORING'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 uppercase font-semibold block">Detected Mood</span>
                <span className="text-sm font-bold text-purple-300 capitalize mt-0.5 block">
                  {result?.mood_and_emergency?.detected_mood?.replace('_', ' ') || 'calm neutral'}
                </span>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 uppercase font-semibold block">Posture State</span>
                <span className="text-sm font-bold text-amber-300 capitalize mt-0.5 block">
                  {result?.mood_and_emergency?.posture_state?.replace('_', ' ') || 'sitting idle'}
                </span>
              </div>
            </div>

            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 font-medium">Idle Duration Counter:</span>
                <div className="text-2xl font-black text-yellow-400 mt-0.5">{idleTimer} seconds</div>
              </div>
              <button
                onClick={resetIdleTimer}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all"
              >
                Reset Counter
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-slate-400">Alert Threshold: <strong className="text-slate-200">{idleThreshold}s</strong></span>
            <span className={isEmergency ? "text-rose-400 font-bold" : "text-slate-400"}>
              Status: {result?.mood_and_emergency?.emergency_assessment?.alert_message || "Active monitoring"}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
