import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useTheme } from '../App';
import CameraToVoice from '../modules/CameraToVoice';
import AmbientMode from '../modules/AmbientMode';
import TaskMode from '../modules/TaskMode';
import GPSNavigation from '../modules/GPSNavigation';
import DetectionOverlay from '../components/DetectionOverlay';
import type { TrackedDetection } from '../utils/detectionTracker';

// ─── Mode definitions ──────────────────────────────────────────────────────────
type AppMode = 'camera-voice' | 'ambient' | 'task' | 'gps';

const modes: { id: AppMode; label: string; icon: string; description: string; color: string }[] = [
  {
    id: 'camera-voice',
    label: 'Camera-to-Voice',
    icon: '📷',
    description: 'Live scene narration',
    color: 'from-indigo-500 to-purple-600',
  },
  {
    id: 'ambient',
    label: 'Ambient Mode',
    icon: '⚡',
    description: 'Obstacle detection alerts',
    color: 'from-cyan-500 to-blue-600',
  },
  {
    id: 'task',
    label: 'Task Mode',
    icon: '📋',
    description: 'Read text & addresses',
    color: 'from-violet-500 to-pink-600',
  },
  {
    id: 'gps',
    label: 'GPS Navigation',
    icon: '🗺️',
    description: 'Turn-by-turn directions',
    color: 'from-emerald-500 to-teal-600',
  },
];

// ─── Camera Device Interface ──────────────────────────────────────────────────
export interface VideoDevice {
  deviceId: string;
  label: string;
  isCamo: boolean;
  isVirtual: boolean;
}

// ─── Camera Hook with Device Selection & Advanced Controls ────────────────────
function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRequestingCamera, setIsRequestingCamera] = useState(false);
  
  // Available video input devices (Built-in, Camo Studio, OBS, external webcams)
  const [devices, setDevices] = useState<VideoDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  // Advanced Camera Controls State
  const [resolution, setResolution] = useState<'1080p' | '720p' | '480p'>('720p');
  const [isMirrored, setIsMirrored] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number }>({ min: 1, max: 5, step: 0.1 });

  /**
   * Enumerates all video input devices connected to the system.
   * Identifies Camo Studio, OBS Virtual Camera, and default device cameras.
   */
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const deviceInfos = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = deviceInfos
        .filter(d => d.kind === 'videoinput')
        .map((d, index) => {
          const label = d.label || `Camera ${index + 1}`;
          const lower = label.toLowerCase();
          const isCamo = lower.includes('camo') || lower.includes('reincubate');
          const isVirtual = isCamo || lower.includes('virtual') || lower.includes('obs') || lower.includes('epoccam');
          return {
            deviceId: d.deviceId,
            label,
            isCamo,
            isVirtual,
          };
        });

      setDevices(videoInputs);

      // Auto-select Camo Studio if available, otherwise default device
      if (videoInputs.length > 0 && !selectedDeviceId) {
        const camoDevice = videoInputs.find(d => d.isCamo);
        if (camoDevice) {
          setSelectedDeviceId(camoDevice.deviceId);
        } else {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      }
    } catch (err) {
      console.warn('[Camera] Failed to enumerate devices:', err);
    }
  }, [selectedDeviceId]);

  /**
   * Starts camera with selected device ID and resolution constraints.
   */
  const startCamera = useCallback(async (overrideDeviceId?: string) => {
    setIsRequestingCamera(true);
    setCameraError(null);

    // Stop existing stream if any
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }

    const deviceToUse = overrideDeviceId || selectedDeviceId;

    // Determine target resolution constraints
    const resMap = {
      '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
      '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
      '480p': { width: { ideal: 640 }, height: { ideal: 480 } },
    };
    const targetRes = resMap[resolution];

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceToUse
          ? { deviceId: { exact: deviceToUse }, ...targetRes }
          : { facingMode: { ideal: 'environment' }, ...targetRes },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsCameraActive(true);

      // Inspect track capabilities for advanced hardware controls (e.g. Zoom)
      const track = stream.getVideoTracks()[0];
      if (track && 'getCapabilities' in track) {
        const caps = (track as any).getCapabilities();
        if (caps.zoom) {
          setZoomSupported(true);
          setZoomRange({
            min: caps.zoom.min || 1,
            max: caps.zoom.max || 5,
            step: caps.zoom.step || 0.1,
          });
        } else {
          setZoomSupported(false);
        }
      }

      // Re-enumerate to ensure device labels are populated after permission grant
      refreshDevices();

    } catch (err: unknown) {
      let message = 'Could not access selected camera device.';
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          message = 'Camera permission denied. Please allow camera access in browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          message = 'Selected camera device is not available. Try selecting default camera.';
        } else if (err.name === 'NotReadableError') {
          message = 'Camera device is in use by another app (e.g. Zoom or Camo Studio Desktop).';
        }
      }
      setCameraError(message);
      setIsCameraActive(false);
    } finally {
      setIsRequestingCamera(false);
    }
  }, [selectedDeviceId, resolution, refreshDevices]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  /**
   * Applies zoom level constraint to active video track if supported
   */
  const applyZoom = useCallback(async (zoomValue: number) => {
    setZoomLevel(zoomValue);
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && 'applyConstraints' in track) {
      try {
        await (track as any).applyConstraints({ advanced: [{ zoom: zoomValue }] });
      } catch (err) {
        console.warn('[Camera] Zoom constraint not accepted by device:', err);
      }
    }
  }, []);

  // Initial device enumeration on mount
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // Clean up stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return {
    videoRef,
    isCameraActive,
    cameraError,
    isRequestingCamera,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    resolution,
    setResolution,
    isMirrored,
    setIsMirrored,
    zoomLevel,
    zoomSupported,
    zoomRange,
    applyZoom,
    startCamera,
    stopCamera,
    refreshDevices,
  };
}

// ─── Status Bar Component ─────────────────────────────────────────────────────
function StatusBar({
  isCameraActive,
  currentMode,
  selectedDeviceLabel,
}: {
  isCameraActive: boolean;
  currentMode: AppMode;
  selectedDeviceLabel?: string;
}) {
  const modeInfo = modes.find(m => m.id === currentMode)!;
  return (
    <div
      className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-dark-800 rounded-xl text-xs font-medium"
      role="status"
      aria-label="Application status"
      aria-live="polite"
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className={isCameraActive ? 'status-dot-active' : 'status-dot-inactive'} aria-hidden="true" />
          <span className="text-gray-600 dark:text-gray-400">
            Camera: {isCameraActive ? (selectedDeviceLabel || 'Active') : 'Off'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={currentMode === 'gps' ? 'status-dot-active' : 'status-dot-inactive'} aria-hidden="true" />
          <span className="text-gray-600 dark:text-gray-400">GPS {currentMode === 'gps' ? 'Active' : 'Inactive'}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-gray-400 dark:text-gray-500">Mode:</span>
        <span className="text-gray-700 dark:text-gray-200 font-semibold">{modeInfo.icon} {modeInfo.label}</span>
      </div>
    </div>
  );
}

// ─── AppPage Component ────────────────────────────────────────────────────────
export default function AppPage() {
  const { isDark, toggleTheme } = useTheme();
  const [currentMode, setCurrentMode] = useState<AppMode>('camera-voice');
  const [gpsDestination, setGpsDestination] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [cameraSourceType, setCameraSourceType] = useState<'device' | 'camo'>('device');
  const [overlayDetections, setOverlayDetections] = useState<TrackedDetection[]>([]);

  useEffect(() => {
    if (currentMode !== 'ambient' && currentMode !== 'gps') {
      setOverlayDetections([]);
    }
  }, [currentMode]);

  const {
    videoRef,
    isCameraActive,
    cameraError,
    isRequestingCamera,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    resolution,
    setResolution,
    isMirrored,
    setIsMirrored,
    zoomLevel,
    zoomSupported,
    zoomRange,
    applyZoom,
    startCamera,
    stopCamera,
    refreshDevices,
  } = useCamera();

  const handleAddressFound = useCallback((address: string) => {
    setGpsDestination(address);
    setCurrentMode('gps');
  }, []);

  // Filter devices into Camo Studio / Third-Party vs Native Device Cameras
  const camoDevices = devices.filter(d => d.isCamo || d.isVirtual);
  const nativeDevices = devices.filter(d => !d.isCamo && !d.isVirtual);

  const activeDeviceObj = devices.find(d => d.deviceId === selectedDeviceId);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-dark-900 flex flex-col">
      {/* App Navbar */}
      <header className="bg-white dark:bg-dark-800 border-b border-gray-200 dark:border-white/10 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              aria-label="Go back to landing page"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xs">
                👁
              </div>
              <span className="font-display font-bold text-sm text-gray-900 dark:text-white hidden sm:block">
                Scene Narrator
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              {isDark ? '☀️' : '🌙'}
            </button>
            <button
              onClick={() => setShowHelp(prev => !prev)}
              aria-label="Toggle help panel"
              aria-expanded={showHelp}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors font-bold text-sm"
            >
              ?
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {/* Status bar */}
        <StatusBar
          isCameraActive={isCameraActive}
          currentMode={currentMode}
          selectedDeviceLabel={activeDeviceObj?.label}
        />

        {/* Camera Source Selector: Device Camera vs Camo Studio / External */}
        <div className="bg-white dark:bg-dark-800 p-4 rounded-2xl border border-gray-200 dark:border-white/10 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-base">📹</span>
              <h2 className="font-bold text-sm text-gray-900 dark:text-white">Camera Input Source</h2>
            </div>
            <button
              onClick={refreshDevices}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 font-medium"
            >
              🔄 Refresh Camera List
            </button>
          </div>

          {/* Source Tabs: Device Camera vs Camo Studio & Third-Party */}
          <div className="grid grid-cols-2 gap-2 bg-gray-100 dark:bg-dark-900 p-1 rounded-xl">
            <button
              onClick={() => {
                setCameraSourceType('device');
                const firstNative = nativeDevices[0]?.deviceId || '';
                if (firstNative) {
                  setSelectedDeviceId(firstNative);
                  if (isCameraActive) startCamera(firstNative);
                }
              }}
              className={`py-2 px-3 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
                cameraSourceType === 'device'
                  ? 'bg-white dark:bg-dark-800 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
              }`}
            >
              📱 Built-in / USB Camera
            </button>
            <button
              onClick={() => {
                setCameraSourceType('camo');
                const firstCamo = camoDevices[0]?.deviceId || devices[0]?.deviceId || '';
                if (firstCamo) {
                  setSelectedDeviceId(firstCamo);
                  if (isCameraActive) startCamera(firstCamo);
                }
              }}
              className={`py-2 px-3 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
                cameraSourceType === 'camo'
                  ? 'bg-white dark:bg-dark-800 text-purple-600 dark:text-purple-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'
              }`}
            >
              🎥 Camo Studio / Virtual Cam
            </button>
          </div>

          {/* Specific Device Dropdown & Quick Selection */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="flex-1 flex flex-col gap-1">
              <label htmlFor="camera-select" className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                Select Connected Camera Device:
              </label>
              <select
                id="camera-select"
                value={selectedDeviceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedDeviceId(id);
                  const chosen = devices.find(d => d.deviceId === id);
                  if (chosen?.isCamo || chosen?.isVirtual) {
                    setCameraSourceType('camo');
                  } else {
                    setCameraSourceType('device');
                  }
                  if (isCameraActive) startCamera(id);
                }}
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-white/20 bg-gray-50 dark:bg-dark-900 text-gray-900 dark:text-white text-xs font-medium focus:ring-2 focus:ring-primary-500"
              >
                {devices.length === 0 ? (
                  <option value="">No camera devices detected (Grant permission to list)</option>
                ) : (
                  devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.isCamo ? '🎥 [Camo Studio] ' : d.isVirtual ? '🔌 [Virtual Cam] ' : '📹 '}
                      {d.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Resolution Selector */}
            <div className="flex flex-col gap-1">
              <label htmlFor="res-select" className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                Quality / Resolution:
              </label>
              <select
                id="res-select"
                value={resolution}
                onChange={(e) => {
                  const res = e.target.value as '1080p' | '720p' | '480p';
                  setResolution(res);
                  if (isCameraActive) startCamera();
                }}
                className="px-3 py-2 rounded-xl border border-gray-300 dark:border-white/20 bg-gray-50 dark:bg-dark-900 text-gray-900 dark:text-white text-xs font-medium"
              >
                <option value="1080p">1080p Full HD</option>
                <option value="720p">720p HD (Recommended)</option>
                <option value="480p">480p Standard</option>
              </select>
            </div>
          </div>

          {/* Camo Studio specific notice & controls info */}
          {cameraSourceType === 'camo' && (
            <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-700 dark:text-purple-300 flex items-start gap-2">
              <span className="text-base">💡</span>
              <div>
                <p className="font-bold mb-0.5">Camo Studio &amp; Virtual Camera Access Enabled</p>
                <p>
                  To adjust lens zoom, lighting, depth effect, or color filters directly from Camo Studio, open the <strong>Camo Studio desktop application</strong> on your computer or phone while this stream is running.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Main grid: camera + controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Camera Viewport & Controls */}
          <div className="flex flex-col gap-4">
            {/* Video Feed */}
            <div
              className={`relative bg-black rounded-2xl overflow-hidden aspect-video transition-transform ${
                isMirrored ? 'scale-x-[-1]' : ''
              }`}
              aria-label="Live camera feed"
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                aria-label="Camera video stream"
              />

              {!isCameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900 gap-3">
                  <div className="text-5xl opacity-40">
                    {cameraSourceType === 'camo' ? '🎥' : '📷'}
                  </div>
                  <p className="text-gray-400 text-xs text-center px-4">
                    {cameraError || (selectedDeviceId ? `Ready to connect to ${activeDeviceObj?.label}` : 'Camera is off')}
                  </p>
                </div>
              )}

              {isCameraActive && <div className="scan-line" aria-hidden="true" />}

              {(currentMode === 'ambient' || currentMode === 'gps') && overlayDetections.length > 0 && (
                <DetectionOverlay detections={overlayDetections} />
              )}

              <div className="absolute top-2 left-2 w-5 h-5 border-l-2 border-t-2 border-primary-400 opacity-70" aria-hidden="true" />
              <div className="absolute top-2 right-2 w-5 h-5 border-r-2 border-t-2 border-primary-400 opacity-70" aria-hidden="true" />
              <div className="absolute bottom-2 left-2 w-5 h-5 border-l-2 border-b-2 border-primary-400 opacity-70" aria-hidden="true" />
              <div className="absolute bottom-2 right-2 w-5 h-5 border-r-2 border-b-2 border-primary-400 opacity-70" aria-hidden="true" />
            </div>

            {cameraError && (
              <div role="alert" className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                ⚠️ {cameraError}
              </div>
            )}

            {/* Quick Camera Action Bar */}
            <div className="flex gap-3" role="group" aria-label="Camera controls">
              {!isCameraActive ? (
                <button
                  onClick={() => startCamera()}
                  disabled={isRequestingCamera}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-semibold py-3 rounded-xl transition-all duration-200 hover:scale-[1.03] active:scale-[0.98] disabled:scale-100"
                >
                  {isRequestingCamera ? '⏳ Connecting...' : cameraSourceType === 'camo' ? '🎥 Connect Camo Studio' : '📷 Start Camera'}
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 rounded-xl transition-all duration-200 hover:scale-[1.03] active:scale-[0.98]"
                >
                  ⏹ Disconnect Camera
                </button>
              )}

              {/* Mirror Video Toggle */}
              <button
                onClick={() => setIsMirrored(prev => !prev)}
                className={`px-4 py-3 rounded-xl font-semibold text-xs border transition-colors flex items-center gap-1.5 ${
                  isMirrored
                    ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-400 text-primary-700 dark:text-primary-300'
                    : 'bg-white dark:bg-dark-800 border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300'
                }`}
                title="Mirror video display horizontally"
              >
                🪞 {isMirrored ? 'Mirrored' : 'Normal'}
              </button>
            </div>

            {/* Hardware Zoom Slider (If supported by video track) */}
            {isCameraActive && zoomSupported && (
              <div className="p-3 rounded-xl bg-white dark:bg-dark-800 border border-gray-200 dark:border-white/10 flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">🔍 Optical Zoom:</span>
                <input
                  type="range"
                  min={zoomRange.min}
                  max={zoomRange.max}
                  step={zoomRange.step}
                  value={zoomLevel}
                  onChange={(e) => applyZoom(parseFloat(e.target.value))}
                  className="flex-1 accent-primary-600"
                />
                <span className="text-xs font-bold text-gray-800 dark:text-gray-200">{zoomLevel.toFixed(1)}x</span>
              </div>
            )}
          </div>

          {/* Module Panel */}
          <div className="flex flex-col gap-4">
            <nav aria-label="Application mode selection">
              <div className="grid grid-cols-2 gap-2" role="tablist">
                {modes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setCurrentMode(mode.id)}
                    role="tab"
                    aria-selected={currentMode === mode.id}
                    className={`flex flex-col items-start gap-1 p-3 rounded-xl border-2 transition-all duration-200 text-left ${
                      currentMode === mode.id ? 'mode-tab-active' : 'mode-tab-inactive'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{mode.icon}</span>
                      <span className="font-semibold text-xs">
                        {mode.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{mode.description}</p>
                  </button>
                ))}
              </div>
            </nav>

            <div className="flex-1 bg-white dark:bg-dark-800 rounded-2xl p-5 border border-gray-200 dark:border-white/10">
              {/* Mode content — fade+slide-up on switch so user sees a clear state change */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentMode}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  {currentMode === 'camera-voice' && (
                    <CameraToVoice videoRef={videoRef} isCameraActive={isCameraActive} />
                  )}
                  {currentMode === 'ambient' && (
                    <AmbientMode
                      videoRef={videoRef}
                      isCameraActive={isCameraActive}
                      isMirrored={isMirrored}
                      onTrackedDetections={setOverlayDetections}
                    />
                  )}
                  {currentMode === 'task' && (
                    <TaskMode
                      videoRef={videoRef}
                      isCameraActive={isCameraActive}
                      onAddressFound={handleAddressFound}
                    />
                  )}
                  {currentMode === 'gps' && (
                    <GPSNavigation
                      initialDestination={gpsDestination}
                      videoRef={videoRef}
                      isCameraActive={isCameraActive}
                      isMirrored={isMirrored}
                      onTrackedDetections={setOverlayDetections}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center py-3 text-xs text-gray-400 dark:text-gray-600 border-t border-gray-200 dark:border-white/10">
        Real-Time Scene Narrator · Multi-Camera &amp; Camo Studio Support Enabled
      </footer>
    </div>
  );
}
