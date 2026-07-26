// IoU-based multi-object tracker with EMA bbox smoothing and temporal persistence.

export interface RawDetection {
  class: string;
  score: number;
  bbox: [number, number, number, number]; // [x, y, width, height] in pixels
}

export interface TrackedDetection extends RawDetection {
  id: number;
  /** Normalized bbox [x, y, w, h] relative to frame dimensions (0–1) */
  normBbox: [number, number, number, number];
}

interface InternalTrack {
  id: number;
  class: string;
  bbox: [number, number, number, number];
  score: number;
  missedFrames: number;
  prevArea: number;
  approachFrames: number;
}

const IOU_MATCH_THRESHOLD = 0.15;
const MAX_MISSED_FRAMES = 6;
const SMOOTHING_ALPHA = 0.40;
const APPROACH_AREA_DELTA = 0.020;
const APPROACH_FRAMES_REQUIRED = 2;

let nextTrackId = 1;

function calculateIoU(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;

  const interX1 = Math.max(ax, bx);
  const interY1 = Math.max(ay, by);
  const interX2 = Math.min(ax + aw, bx + bw);
  const interY2 = Math.min(ay + ah, by + bh);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  const union = aw * ah + bw * bh - interArea;
  return union > 0 ? interArea / union : 0;
}

function calculateCentroidDistance(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const acx = a[0] + a[2] / 2;
  const acy = a[1] + a[3] / 2;
  const bcx = b[0] + b[2] / 2;
  const bcy = b[1] + b[3] / 2;
  const dx = acx - bcx;
  const dy = acy - bcy;
  return Math.sqrt(dx * dx + dy * dy);
}

function smoothBbox(
  prev: [number, number, number, number],
  next: [number, number, number, number],
  alpha: number
): [number, number, number, number] {
  return [
    prev[0] * (1 - alpha) + next[0] * alpha,
    prev[1] * (1 - alpha) + next[1] * alpha,
    prev[2] * (1 - alpha) + next[2] * alpha,
    prev[3] * (1 - alpha) + next[3] * alpha,
  ];
}

function bboxArea(bbox: [number, number, number, number]): number {
  return bbox[2] * bbox[3];
}

function toNormBbox(
  bbox: [number, number, number, number],
  frameW: number,
  frameH: number
): [number, number, number, number] {
  return [bbox[0] / frameW, bbox[1] / frameH, bbox[2] / frameW, bbox[3] / frameH];
}

/**
 * Updates tracker state with new frame detections.
 * Returns smoothed, stable tracks including briefly missed objects.
 */
export function updateDetectionTracks(
  tracks: Map<number, InternalTrack>,
  rawDetections: RawDetection[],
  frameW: number,
  frameH: number
): TrackedDetection[] {
  const unmatchedDetections = [...rawDetections];
  const matchedTrackIds = new Set<number>();
  const usedDetIndices = new Set<number>();

  // Pass 1: Greedy IoU matching
  const candidates: { trackId: number; detIdx: number; iou: number }[] = [];
  for (const [trackId, track] of tracks) {
    unmatchedDetections.forEach((det, detIdx) => {
      if (det.class !== track.class) return;
      const iou = calculateIoU(track.bbox, det.bbox);
      if (iou >= IOU_MATCH_THRESHOLD) {
        candidates.push({ trackId, detIdx, iou });
      }
    });
  }
  candidates.sort((a, b) => b.iou - a.iou);

  for (const { trackId, detIdx } of candidates) {
    if (matchedTrackIds.has(trackId) || usedDetIndices.has(detIdx)) continue;

    const track = tracks.get(trackId)!;
    const det = unmatchedDetections[detIdx];
    const smoothed = smoothBbox(track.bbox, det.bbox, SMOOTHING_ALPHA);
    const area = bboxArea(smoothed);
    const areaDelta = area - track.prevArea;
    const normalizedDelta = track.prevArea > 0 ? areaDelta / track.prevArea : 0;

    let approachFrames = track.approachFrames;
    if (normalizedDelta > APPROACH_AREA_DELTA) {
      approachFrames += 1;
    } else {
      approachFrames = Math.max(0, approachFrames - 1);
    }

    tracks.set(trackId, {
      ...track,
      bbox: smoothed,
      score: det.score * SMOOTHING_ALPHA + track.score * (1 - SMOOTHING_ALPHA),
      missedFrames: 0,
      prevArea: area,
      approachFrames,
    });

    matchedTrackIds.add(trackId);
    usedDetIndices.add(detIdx);
  }

  // Pass 2: Centroid distance fallback for fast moving objects
  const maxCentroidDist = Math.hypot(frameW, frameH) * 0.25;
  for (const [trackId, track] of tracks) {
    if (matchedTrackIds.has(trackId)) continue;

    let bestDetIdx = -1;
    let minDist = Infinity;

    unmatchedDetections.forEach((det, detIdx) => {
      if (usedDetIndices.has(detIdx) || det.class !== track.class) return;
      const dist = calculateCentroidDistance(track.bbox, det.bbox);
      if (dist < minDist && dist < maxCentroidDist) {
        minDist = dist;
        bestDetIdx = detIdx;
      }
    });

    if (bestDetIdx !== -1) {
      const det = unmatchedDetections[bestDetIdx];
      const smoothed = smoothBbox(track.bbox, det.bbox, SMOOTHING_ALPHA);
      const area = bboxArea(smoothed);
      tracks.set(trackId, {
        ...track,
        bbox: smoothed,
        score: det.score * SMOOTHING_ALPHA + track.score * (1 - SMOOTHING_ALPHA),
        missedFrames: 0,
        prevArea: area,
      });
      matchedTrackIds.add(trackId);
      usedDetIndices.add(bestDetIdx);
    }
  }

  // Increment missed frames for unmatched tracks
  for (const [trackId, track] of tracks) {
    if (matchedTrackIds.has(trackId)) continue;
    const missedFrames = track.missedFrames + 1;
    if (missedFrames > MAX_MISSED_FRAMES) {
      tracks.delete(trackId);
    } else {
      tracks.set(trackId, { ...track, missedFrames });
    }
  }

  // Create new tracks for unmatched detections
  unmatchedDetections.forEach((det, detIdx) => {
    if (usedDetIndices.has(detIdx)) return;
    const id = nextTrackId++;
    tracks.set(id, {
      id,
      class: det.class,
      bbox: det.bbox,
      score: det.score,
      missedFrames: 0,
      prevArea: bboxArea(det.bbox),
      approachFrames: 0,
    });
  });

  return Array.from(tracks.values())
    .map(t => ({
      id: t.id,
      class: t.class,
      score: t.score,
      bbox: t.bbox,
      normBbox: toNormBbox(t.bbox, frameW, frameH),
    }));
}

/** Returns true when a track has been consistently approaching for enough frames. */
export function isTrackApproaching(tracks: Map<number, InternalTrack>, trackId: number): boolean {
  const track = tracks.get(trackId);
  return !!track && track.approachFrames >= APPROACH_FRAMES_REQUIRED;
}

/** Returns true when an object is directly blocking the central walking path. */
export function isObstacleBlockingPath(normBbox: [number, number, number, number]): boolean {
  const [nx, ny, nw, nh] = normBbox;
  const cx = nx + nw / 2;
  const area = nw * nh;
  const isCentered = cx >= 0.25 && cx <= 0.75;
  const isSubstantialSize = area >= 0.04;
  return isCentered && isSubstantialSize;
}

export type TrackMap = Map<number, InternalTrack>;

export function createTrackMap(): TrackMap {
  return new Map();
}

export function resetTrackMap(tracks: TrackMap): void {
  tracks.clear();
  nextTrackId = 1;
}
