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

export default function DetectionOverlay({ detections }: DetectionOverlayProps) {
  if (detections.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {detections.map(det => {
        const [nx, ny, nw, nh] = det.normBbox;
        const isHazard = HAZARD_CLASSES.has(det.class);
        const isBlocking = isObstacleBlockingPath(det.normBbox);

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
            <div
              className={`w-full h-full border-2 rounded-md ${
                isBlocking
                  ? 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]'
                  : isHazard
                  ? 'border-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                  : 'border-cyan-400/80'
              }`}
            />
            <span
              className={`absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                isBlocking
                  ? 'bg-red-600 text-white'
                  : isHazard
                  ? 'bg-amber-500/90 text-white'
                  : 'bg-cyan-600/90 text-white'
              }`}
            >
              {isBlocking ? '⚠️ OBSTACLE: ' : ''}{det.class} {Math.round(det.score * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
