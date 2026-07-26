import React from 'react';
import type { TrackedDetection } from '../utils/detectionTracker';
import { isObstacleBlockingPath } from '../utils/detectionTracker';

const HAZARD_CLASSES = new Set([
  'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
  'dog', 'cat', 'traffic light', 'stop sign', 'chair', 'couch',
  'dining table', 'table', 'bench', 'backpack', 'suitcase',
  'door', 'potted plant', 'tv', 'laptop', 'bottle', 'cup',
]);

interface DetectionOverlayProps {
  detections: TrackedDetection[];
}

/**
 * Returns border and glow styles based on distance zone and hazard status.
 * Red (<2m), amber (2–4m), cyan (>4m). Blocking obstacles always red.
 */
function getDistanceStyles(det: TrackedDetection, isBlocking: boolean) {
  if (isBlocking) {
    return {
      border: 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]',
      badge: 'bg-red-600 text-white',
    };
  }

  const meters = det.distanceMeters;
  if (meters !== null && meters <= 2.0) {
    return {
      border: 'border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.5)]',
      badge: 'bg-red-500/90 text-white',
    };
  }
  if (meters !== null && meters <= 4.0) {
    return {
      border: 'border-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]',
      badge: 'bg-amber-500/90 text-white',
    };
  }
  if (HAZARD_CLASSES.has(det.class)) {
    return {
      border: 'border-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]',
      badge: 'bg-amber-500/90 text-white',
    };
  }
  return {
    border: 'border-cyan-400/80',
    badge: 'bg-cyan-600/90 text-white',
  };
}

export default function DetectionOverlay({ detections }: DetectionOverlayProps) {
  if (detections.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {detections.map(det => {
        const [nx, ny, nw, nh] = det.normBbox;
        const isBlocking = isObstacleBlockingPath(det.normBbox);
        const styles = getDistanceStyles(det, isBlocking);

        // Build label: "person 95% · 3.2m"
        const confidence = Math.round(det.score * 100);
        const distPart = det.distanceShortLabel ? ` · ${det.distanceShortLabel}` : '';
        const label = `${isBlocking ? '⚠️ OBSTACLE: ' : ''}${det.class} ${confidence}%${distPart}`;

        return (
          <div
            key={det.id}
            className="absolute transition-all duration-150 ease-out"
            style={{
              left: `${nx * 100}%`,
              top: `${ny * 100}%`,
              width: `${nw * 100}%`,
              height: `${nh * 100}%`,
            }}
          >
            <div className={`w-full h-full border-2 rounded-md ${styles.border}`} />
            <span
              className={`absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${styles.badge}`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

