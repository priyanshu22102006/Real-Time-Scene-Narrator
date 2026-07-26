// YOLOv11n ONNX Local Inference & Intelligent Priority Narration Engine
// Runs 100% locally using onnxruntime-node. No external API keys or paid services required.

import fs from 'fs';
import path from 'path';
import ort from 'onnxruntime-node';
import jpeg from 'jpeg-js';
import {
  estimateDistance,
  loadDistanceConfig,
  formatDistanceForSpeech,
  formatDistanceShort,
} from './distanceCalculator.js';

// Load narration configuration JSON
const configPath = path.resolve(process.cwd(), 'config/narration.json');
const narrationConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const {
  confidenceThreshold,
  cooldownMs,
  maxDetectionsPerFrame = 10,
  objectPriorities,
  positionRanges,
  cocoClasses,
} = narrationConfig;

// Initialize distance calculation engine from config
loadDistanceConfig();

// Absolute path to yolo11n.onnx model
const MODEL_PATH = path.resolve(process.cwd(), 'models/yolo11n.onnx');

let ortSession = null;
let isModelLoading = false;

// Tracker state to prevent duplicate announcements within speech cooldown
let lastAnnounceTime = 0;
let lastAnnouncedKey = '';

// Temporal smoothing state for stable detections across frames
const trackState = new Map();
let nextTrackId = 1;
const TRACK_IOU_THRESHOLD = 0.3;
const TRACK_MAX_MISSED = 3;
const TRACK_SMOOTH_ALPHA = 0.4;

/**
 * Initializes ONNX Runtime session with yolo11n.onnx model
 */
export async function initYoloModel() {
  if (ortSession) return ortSession;
  if (isModelLoading) return null;

  isModelLoading = true;
  try {
    console.log(`[YOLOv11] Loading ONNX model from ${MODEL_PATH}...`);
    ortSession = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });
    console.log('[YOLOv11] ONNX model loaded successfully!');
    return ortSession;
  } catch (err) {
    console.error('[YOLOv11] Failed to load ONNX model:', err.message);
    throw err;
  } finally {
    isModelLoading = false;
  }
}

/**
 * Preprocesses JPEG buffer into 1x3x640x640 Float32 tensor with letterbox resize.
 * Preserves aspect ratio and pads with gray (114/255) to avoid bbox distortion.
 */
function preprocessJpeg(jpegBuffer, targetW = 640, targetH = 640) {
  const rawImage = jpeg.decode(jpegBuffer, { useTArray: true });
  const { width: origW, height: origH, data } = rawImage;

  const scale = Math.min(targetW / origW, targetH / origH);
  const scaledW = Math.round(origW * scale);
  const scaledH = Math.round(origH * scale);
  const padX = Math.floor((targetW - scaledW) / 2);
  const padY = Math.floor((targetH - scaledH) / 2);

  const float32Data = new Float32Array(3 * targetW * targetH);
  const padValue = 114 / 255;

  // Fill with pad color
  for (let i = 0; i < float32Data.length; i++) {
    float32Data[i] = padValue;
  }

  // Bilinear-ish resize into letterboxed region
  for (let y = 0; y < scaledH; y++) {
    const srcY = Math.min(origH - 1, Math.floor((y / scaledH) * origH));
    for (let x = 0; x < scaledW; x++) {
      const srcX = Math.min(origW - 1, Math.floor((x / scaledW) * origW));
      const srcIdx = (srcY * origW + srcX) * 4;

      const r = data[srcIdx] / 255.0;
      const g = data[srcIdx + 1] / 255.0;
      const b = data[srcIdx + 2] / 255.0;

      const destX = padX + x;
      const destY = padY + y;
      const destIdx = destY * targetW + destX;

      float32Data[destIdx] = r;
      float32Data[targetW * targetH + destIdx] = g;
      float32Data[2 * targetW * targetH + destIdx] = b;
    }
  }

  return {
    tensor: new ort.Tensor('float32', float32Data, [1, 3, targetH, targetW]),
    origW,
    origH,
    scale,
    padX,
    padY,
  };
}

/**
 * Calculates Position (Left, Center, Right) based on bounding box x-center
 */
function getPosition(cxNorm) {
  if (cxNorm < positionRanges.left.maxX) {
    return { posKey: 'left', label: positionRanges.left.label };
  }
  if (cxNorm > positionRanges.right.minX) {
    return { posKey: 'right', label: positionRanges.right.label };
  }
  return { posKey: 'center', label: positionRanges.center.label };
}

/**
 * Calculates metric distance using the monocular distance estimation engine (v2).
 * Now passes bbox width and Y position for multi-cue accuracy.
 *
 * @param {string} className       - COCO class name
 * @param {number} bboxHeightNorm  - Normalized bounding box height (0–1)
 * @param {number} bboxWidthNorm   - Normalized bounding box width (0–1)
 * @param {number} bboxYNorm       - Normalized bounding box top-Y (0–1)
 * @param {number} origH           - Original image height in pixels
 * @param {number} origW           - Original image width in pixels
 */
function getDistance(className, bboxHeightNorm, bboxWidthNorm, bboxYNorm, origH, origW) {
  const bboxHeightPx = bboxHeightNorm * origH;
  const bboxWidthPx = bboxWidthNorm * origW;
  const bboxYPx = bboxYNorm * origH;
  const result = estimateDistance(className, bboxHeightPx, origH, origW, bboxWidthPx, bboxYPx);
  return {
    distKey: result.zone,
    label: result.label,
    meters: result.meters,
    urgency: result.urgency,
    confidence: result.confidence,
  };
}

/**
 * Calculates IoU (Intersection over Union) between two bounding boxes [x, y, w, h]
 */
function calculateIoU(box1, box2) {
  const [x1, y1, w1, h1] = box1;
  const [x2, y2, w2, h2] = box2;

  const interX1 = Math.max(x1, x2);
  const interY1 = Math.max(y1, y2);
  const interX2 = Math.min(x1 + w1, x2 + w2);
  const interY2 = Math.min(y1 + h1, y2 + h2);

  const interWidth = Math.max(0, interX2 - interX1);
  const interHeight = Math.max(0, interY2 - interY1);
  const interArea = interWidth * interHeight;

  const area1 = w1 * h1;
  const area2 = w2 * h2;

  const unionArea = area1 + area2 - interArea;
  if (unionArea <= 0) return 0;

  return interArea / unionArea;
}

/**
 * Maps model-space bbox (640x640 letterboxed) to normalized original-image coords.
 */
function mapBboxToOriginal(cx, cy, w, h, scale, padX, padY, origW, origH) {
  const x1 = (cx - w / 2 - padX) / scale;
  const y1 = (cy - h / 2 - padY) / scale;
  const bw = w / scale;
  const bh = h / scale;

  return [
    Math.max(0, Math.min(1, x1 / origW)),
    Math.max(0, Math.min(1, y1 / origH)),
    Math.max(0, Math.min(1, bw / origW)),
    Math.max(0, Math.min(1, bh / origH)),
  ];
}

function smoothBbox(prev, next, alpha) {
  return [
    prev[0] * (1 - alpha) + next[0] * alpha,
    prev[1] * (1 - alpha) + next[1] * alpha,
    prev[2] * (1 - alpha) + next[2] * alpha,
    prev[3] * (1 - alpha) + next[3] * alpha,
  ];
}

/**
 * Applies temporal IoU tracking + EMA smoothing to stabilize detections across frames.
 */
function smoothDetectionsOverTime(detections) {
  const matchedTrackIds = new Set();
  const usedDetIndices = new Set();

  const candidates = [];
  for (const [trackId, track] of trackState) {
    detections.forEach((det, detIdx) => {
      if (det.class !== track.class) return;
      const iou = calculateIoU(track.bbox, det.bbox);
      if (iou >= TRACK_IOU_THRESHOLD) {
        candidates.push({ trackId, detIdx, iou });
      }
    });
  }
  candidates.sort((a, b) => b.iou - a.iou);

  const smoothed = detections.map(d => ({ ...d }));

  for (const { trackId, detIdx } of candidates) {
    if (matchedTrackIds.has(trackId) || usedDetIndices.has(detIdx)) continue;

    const track = trackState.get(trackId);
    const det = smoothed[detIdx];
    const newBbox = smoothBbox(track.bbox, det.bbox, TRACK_SMOOTH_ALPHA);
    const cx = newBbox[0] + newBbox[2] / 2;
    const area = newBbox[2] * newBbox[3];

    trackState.set(trackId, {
      ...track,
      bbox: newBbox,
      score: det.score * TRACK_SMOOTH_ALPHA + track.score * (1 - TRACK_SMOOTH_ALPHA),
      missedFrames: 0,
    });

    det.bbox = newBbox;
    det.cx = cx;
    det.cy = newBbox[1] + newBbox[3] / 2;
    det.w = newBbox[2];
    det.h = newBbox[3];
    det.area = area;
    det.position = getPosition(cx);
    det.distance = getDistance(area);
    det.trackId = trackId;

    matchedTrackIds.add(trackId);
    usedDetIndices.add(detIdx);
  }

  for (const [trackId, track] of trackState) {
    if (matchedTrackIds.has(trackId)) continue;
    const missedFrames = track.missedFrames + 1;
    if (missedFrames > TRACK_MAX_MISSED) {
      trackState.delete(trackId);
    } else {
      trackState.set(trackId, { ...track, missedFrames });
    }
  }

  smoothed.forEach((det, detIdx) => {
    if (usedDetIndices.has(detIdx)) return;
    const id = nextTrackId++;
    trackState.set(id, {
      id,
      class: det.class,
      bbox: det.bbox,
      score: det.score,
      missedFrames: 0,
    });
    det.trackId = id;
  });

  return smoothed;
}

/**
 * Post-processes YOLOv11 output tensor into detected objects with IoU NMS
 */
function postprocessYolo(outputTensor, origW, origH, scale, padX, padY) {
  const dims = outputTensor.dims; // [1, 84, 8400]
  const data = outputTensor.data;

  const numChannels = dims[1]; // 84
  const numAnchors = dims[2];  // 8400

  const rawDetections = [];
  const effectiveThreshold = confidenceThreshold || 0.25;

  for (let i = 0; i < numAnchors; i++) {
    let maxScore = 0;
    let maxClassId = -1;

    for (let c = 0; c < 80; c++) {
      const score = data[(4 + c) * numAnchors + i];
      if (score > maxScore) {
        maxScore = score;
        maxClassId = c;
      }
    }

    if (maxScore >= effectiveThreshold) {
      const cxModel = data[0 * numAnchors + i];
      const cyModel = data[1 * numAnchors + i];
      const wModel = data[2 * numAnchors + i];
      const hModel = data[3 * numAnchors + i];

      const bbox = mapBboxToOriginal(cxModel, cyModel, wModel, hModel, scale, padX, padY, origW, origH);
      const cx = bbox[0] + bbox[2] / 2;
      const cy = bbox[1] + bbox[3] / 2;
      const w = bbox[2];
      const h = bbox[3];

      const className = cocoClasses[maxClassId] || 'object';
      const priority = objectPriorities[className] || 6;
      const area = w * h;

      const position = getPosition(cx);
      const distance = getDistance(className, h, w, bbox[1], origH, origW);

      rawDetections.push({
        class: className,
        score: maxScore,
        priority,
        bbox,
        cx,
        cy,
        w,
        h,
        area,
        position,
        distance,
      });
    }
  }

  // Sort by confidence score descending
  rawDetections.sort((a, b) => b.score - a.score);

  // IoU-based Non-Maximum Suppression (NMS)
  const finalDetections = [];
  const iouThreshold = 0.45;

  for (const det of rawDetections) {
    let keep = true;
    for (const existing of finalDetections) {
      if (existing.class === det.class && calculateIoU(existing.bbox, det.bbox) > iouThreshold) {
        keep = false;
        break;
      }
    }
    if (keep) {
      finalDetections.push(det);
    }
    if (finalDetections.length >= maxDetectionsPerFrame || finalDetections.length >= 10) break;
  }

  return finalDetections;
}

/**
 * Priority Narration Engine: Formulates intelligent speech narration
 * Now includes metric distance estimates in spoken output.
 */
function generateNarrationText(detections) {
  if (!detections || detections.length === 0) {
    return null;
  }

  const primary = detections[0]; // Highest confidence detection
  const now = Date.now();

  const currentKey = `${primary.class}-${primary.position.posKey}-${primary.distance.distKey}`;

  // Enforce speech cooldown unless high-priority hazard
  if (now - lastAnnounceTime < cooldownMs && currentKey === lastAnnouncedKey && primary.priority > 1) {
    return null;
  }

  lastAnnounceTime = now;
  lastAnnouncedKey = currentKey;

  const article = ['a', 'e', 'i', 'o', 'u'].includes(primary.class[0].toLowerCase()) ? 'An' : 'A';
  const distLabel = primary.distance.label || 'nearby';

  if (detections.length === 1) {
    return `There is ${article.toLowerCase()} ${primary.class} ${primary.position.label}, ${distLabel}.`;
  }

  const uniqueClasses = Array.from(new Set(detections.map(d => d.class)));
  if (uniqueClasses.length === 1) {
    const groupDist = primary.distance.meters
      ? `, ${formatDistanceForSpeech(primary.distance.meters)}`
      : '';
    return `Detected ${detections.length} ${primary.class}s ${primary.position.label}${groupDist}.`;
  }

  const topItems = detections.slice(0, 3).map(d => {
    const dLabel = d.distance.meters ? `, ${formatDistanceForSpeech(d.distance.meters)}` : '';
    return `${d.class} ${d.position.label}${dLabel}`;
  }).join(' and ');
  return `Detected ${topItems}.`;
}

/**
 * Main inference function called by backend routes
 */
export async function detectObjectsFromFrame(imageBuffer) {
  const session = await initYoloModel();
  if (!session) {
    return {
      description: 'YOLOv11 model initializing...',
      detections: [],
      timestamp: new Date().toISOString(),
    };
  }

  const { tensor, origW, origH, scale, padX, padY } = preprocessJpeg(imageBuffer);

  // Run ONNX model inference
  const outputMap = await session.run({ images: tensor });
  const outputTensor = outputMap[Object.keys(outputMap)[0]];

  const rawDetections = postprocessYolo(outputTensor, origW, origH, scale, padX, padY);
  const detections = smoothDetectionsOverTime(rawDetections);
  const narration = generateNarrationText(detections);

  return {
    description: narration,
    detections: detections.map(d => ({
      class: d.class,
      confidence: Math.round(d.score * 100),
      position: d.position.label,
      distance: d.distance.label,
      distanceMeters: d.distance.meters || null,
      distanceZone: d.distance.distKey || 'far',
      distanceUrgency: d.distance.urgency || 'info',
      priority: d.priority,
      bbox: d.bbox,
    })),
    timestamp: new Date().toISOString(),
    provider: 'YOLOv11n ONNX (Local)',
  };
}

