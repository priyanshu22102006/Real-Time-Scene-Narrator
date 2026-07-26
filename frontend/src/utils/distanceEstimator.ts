// Client-side Monocular Distance Estimation Engine — v3 (Near-Field & Truncation Calibrated)
// Mirrors backend distanceCalculator.js logic for in-browser COCO-SSD detection.
//
// Key fixes:
//  1. Frame Truncation Handling — detects cropped upper-body shots (1m–1.5m) and adapts reference height
//  2. FoV calibrated for webcams / smartphones (72° default)
//  3. Precise speech & UI formatting for near-field distances (<2m)

export interface ReferenceObject {
  h: number;
  w: number;
  expectedAR: number;
  calibration: number;
}

const REFERENCE_OBJECTS: Record<string, ReferenceObject> = {
  // People & Animals
  person:    { h: 1.70, w: 0.50, expectedAR: 0.40, calibration: 1.0 },
  bird:      { h: 0.20, w: 0.25, expectedAR: 1.20, calibration: 1.0 },
  cat:       { h: 0.30, w: 0.45, expectedAR: 1.50, calibration: 1.0 },
  dog:       { h: 0.50, w: 0.65, expectedAR: 1.30, calibration: 1.0 },
  horse:     { h: 1.60, w: 2.00, expectedAR: 1.25, calibration: 1.0 },
  sheep:     { h: 0.75, w: 0.90, expectedAR: 1.20, calibration: 1.0 },
  cow:       { h: 1.40, w: 1.80, expectedAR: 1.29, calibration: 1.0 },
  elephant:  { h: 3.20, w: 4.00, expectedAR: 1.25, calibration: 1.0 },
  bear:      { h: 1.50, w: 1.20, expectedAR: 0.80, calibration: 1.0 },
  zebra:     { h: 1.45, w: 2.00, expectedAR: 1.38, calibration: 1.0 },
  giraffe:   { h: 5.50, w: 1.50, expectedAR: 0.27, calibration: 1.0 },

  // Vehicles
  bicycle:    { h: 1.10, w: 1.70, expectedAR: 1.55, calibration: 1.0 },
  car:        { h: 1.50, w: 4.20, expectedAR: 2.80, calibration: 0.95 },
  motorcycle: { h: 1.15, w: 2.00, expectedAR: 1.74, calibration: 1.0 },
  airplane:   { h: 4.00, w: 12.0, expectedAR: 3.00, calibration: 1.0 },
  bus:        { h: 3.20, w: 10.0, expectedAR: 3.13, calibration: 1.0 },
  train:      { h: 3.50, w: 12.0, expectedAR: 3.43, calibration: 1.0 },
  truck:      { h: 2.80, w: 6.00, expectedAR: 2.14, calibration: 1.0 },
  boat:       { h: 1.80, w: 4.00, expectedAR: 2.22, calibration: 1.0 },

  // Street Furniture & Signs
  'traffic light': { h: 0.90, w: 0.35, expectedAR: 0.39, calibration: 1.0 },
  'fire hydrant':  { h: 0.60, w: 0.30, expectedAR: 0.50, calibration: 1.0 },
  'stop sign':     { h: 0.75, w: 0.75, expectedAR: 1.00, calibration: 1.0 },
  'parking meter': { h: 1.20, w: 0.30, expectedAR: 0.25, calibration: 1.0 },
  bench:           { h: 0.85, w: 1.50, expectedAR: 1.76, calibration: 1.0 },

  // Personal Items
  backpack:  { h: 0.50, w: 0.35, expectedAR: 0.70, calibration: 1.0 },
  umbrella:  { h: 1.00, w: 1.00, expectedAR: 1.00, calibration: 1.0 },
  handbag:   { h: 0.35, w: 0.30, expectedAR: 0.86, calibration: 1.0 },
  tie:       { h: 0.55, w: 0.08, expectedAR: 0.15, calibration: 1.0 },
  suitcase:  { h: 0.60, w: 0.45, expectedAR: 0.75, calibration: 1.0 },

  // Sports Equipment
  frisbee:         { h: 0.03, w: 0.27, expectedAR: 9.00, calibration: 1.0 },
  skis:            { h: 1.70, w: 0.10, expectedAR: 0.06, calibration: 1.0 },
  snowboard:       { h: 0.30, w: 1.55, expectedAR: 5.17, calibration: 1.0 },
  'sports ball':   { h: 0.22, w: 0.22, expectedAR: 1.00, calibration: 1.0 },
  kite:            { h: 0.80, w: 1.00, expectedAR: 1.25, calibration: 1.0 },
  'baseball bat':  { h: 0.85, w: 0.07, expectedAR: 0.08, calibration: 1.0 },
  'baseball glove':{ h: 0.25, w: 0.30, expectedAR: 1.20, calibration: 1.0 },
  skateboard:      { h: 0.12, w: 0.80, expectedAR: 6.67, calibration: 1.0 },
  surfboard:       { h: 0.60, w: 2.00, expectedAR: 3.33, calibration: 1.0 },
  'tennis racket': { h: 0.68, w: 0.27, expectedAR: 0.40, calibration: 1.0 },

  // Kitchen / Dining
  bottle:      { h: 0.25, w: 0.07, expectedAR: 0.28, calibration: 1.0 },
  'wine glass':{ h: 0.22, w: 0.08, expectedAR: 0.36, calibration: 1.0 },
  cup:         { h: 0.12, w: 0.10, expectedAR: 0.83, calibration: 1.0 },
  fork:        { h: 0.02, w: 0.19, expectedAR: 9.50, calibration: 1.0 },
  knife:       { h: 0.02, w: 0.25, expectedAR: 12.5, calibration: 1.0 },
  spoon:       { h: 0.02, w: 0.18, expectedAR: 9.00, calibration: 1.0 },
  bowl:        { h: 0.10, w: 0.18, expectedAR: 1.80, calibration: 1.0 },

  // Food
  banana:   { h: 0.05, w: 0.20, expectedAR: 4.00, calibration: 1.0 },
  apple:    { h: 0.08, w: 0.08, expectedAR: 1.00, calibration: 1.0 },
  sandwich: { h: 0.08, w: 0.15, expectedAR: 1.88, calibration: 1.0 },
  orange:   { h: 0.08, w: 0.08, expectedAR: 1.00, calibration: 1.0 },
  broccoli: { h: 0.15, w: 0.12, expectedAR: 0.80, calibration: 1.0 },
  carrot:   { h: 0.04, w: 0.20, expectedAR: 5.00, calibration: 1.0 },
  'hot dog':{ h: 0.05, w: 0.18, expectedAR: 3.60, calibration: 1.0 },
  pizza:    { h: 0.05, w: 0.30, expectedAR: 6.00, calibration: 1.0 },
  donut:    { h: 0.05, w: 0.10, expectedAR: 2.00, calibration: 1.0 },
  cake:     { h: 0.15, w: 0.20, expectedAR: 1.33, calibration: 1.0 },

  // Furniture
  chair:         { h: 0.90, w: 0.50, expectedAR: 0.56, calibration: 0.90 },
  couch:         { h: 0.85, w: 2.00, expectedAR: 2.35, calibration: 0.90 },
  'potted plant':{ h: 0.50, w: 0.35, expectedAR: 0.70, calibration: 1.0 },
  bed:           { h: 0.60, w: 2.00, expectedAR: 3.33, calibration: 1.0 },
  'dining table':{ h: 0.76, w: 1.50, expectedAR: 1.97, calibration: 0.90 },
  toilet:        { h: 0.45, w: 0.40, expectedAR: 0.89, calibration: 1.0 },

  // Electronics
  tv:           { h: 0.50, w: 0.90, expectedAR: 1.80, calibration: 1.0 },
  laptop:       { h: 0.25, w: 0.35, expectedAR: 1.40, calibration: 1.0 },
  mouse:        { h: 0.04, w: 0.06, expectedAR: 1.50, calibration: 1.0 },
  remote:       { h: 0.20, w: 0.05, expectedAR: 0.25, calibration: 1.0 },
  keyboard:     { h: 0.04, w: 0.45, expectedAR: 11.3, calibration: 1.0 },
  'cell phone': { h: 0.15, w: 0.07, expectedAR: 0.47, calibration: 1.0 },
  'mobile phone':{ h: 0.15, w: 0.07, expectedAR: 0.47, calibration: 1.0 },

  // Appliances
  microwave:    { h: 0.30, w: 0.50, expectedAR: 1.67, calibration: 1.0 },
  oven:         { h: 0.60, w: 0.60, expectedAR: 1.00, calibration: 1.0 },
  toaster:      { h: 0.20, w: 0.30, expectedAR: 1.50, calibration: 1.0 },
  sink:         { h: 0.35, w: 0.60, expectedAR: 1.71, calibration: 1.0 },
  refrigerator: { h: 1.70, w: 0.70, expectedAR: 0.41, calibration: 1.0 },

  // Miscellaneous
  book:         { h: 0.25, w: 0.18, expectedAR: 0.72, calibration: 1.0 },
  clock:        { h: 0.30, w: 0.30, expectedAR: 1.00, calibration: 1.0 },
  vase:         { h: 0.30, w: 0.15, expectedAR: 0.50, calibration: 1.0 },
  scissors:     { h: 0.18, w: 0.08, expectedAR: 0.44, calibration: 1.0 },
  'teddy bear': { h: 0.35, w: 0.25, expectedAR: 0.71, calibration: 1.0 },
  'hair drier':  { h: 0.25, w: 0.20, expectedAR: 0.80, calibration: 1.0 },
  toothbrush:   { h: 0.18, w: 0.02, expectedAR: 0.11, calibration: 1.0 },
};

const DEFAULT_REFERENCE_HEIGHT = 0.50;
const BBOX_SHRINK_FACTOR = 0.95;

function autoDetectHFov(frameWidth: number, frameHeight: number): number {
  const ar = frameWidth / frameHeight;
  if (ar < 1.0) return 75;
  if (ar >= 1.5) return 72;
  return 70;
}

export interface DistanceZone {
  key: string;
  maxMeters: number;
  label: string;
  urgency: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

const DISTANCE_ZONES: DistanceZone[] = [
  { key: 'immediate',  maxMeters: 1.0,  label: 'right next to you',      urgency: 'critical' },
  { key: 'very_close', maxMeters: 2.0,  label: 'very close',             urgency: 'high' },
  { key: 'close',      maxMeters: 4.0,  label: 'close',                  urgency: 'medium' },
  { key: 'medium',     maxMeters: 8.0,  label: 'at a moderate distance', urgency: 'low' },
  { key: 'far',        maxMeters: 999,  label: 'far away',               urgency: 'info' },
];

function estimateFocalLength(frameWidth: number, hfovDeg: number): number {
  const hfovRad = (hfovDeg * Math.PI) / 180;
  return (frameWidth / 2) / Math.tan(hfovRad / 2);
}

export interface DistanceEstimate {
  meters: number | null;
  label: string;
  shortLabel: string;
  zone: string;
  urgency: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

function getEffectiveDimensions(
  className: string,
  bboxHeightPx: number,
  bboxWidthPx?: number,
  frameHeight: number = 480,
  bboxYPx?: number
) {
  const ref = REFERENCE_OBJECTS[className];
  if (!ref) {
    return {
      refSize: DEFAULT_REFERENCE_HEIGHT,
      bboxSize: bboxHeightPx * BBOX_SHRINK_FACTOR,
      isClipped: false,
    };
  }

  const bboxAR = (bboxWidthPx || bboxHeightPx) / bboxHeightPx;
  const normY1 = bboxYPx !== undefined && bboxYPx !== null ? bboxYPx / frameHeight : 0.1;
  const normY2 = bboxYPx !== undefined && bboxYPx !== null ? (bboxYPx + bboxHeightPx) / frameHeight : 0.9;

  const isClippedTop = normY1 < 0.04;
  const isClippedBottom = normY2 > 0.96;
  const isClipped = isClippedTop || isClippedBottom;

  if (className === 'person') {
    if (bboxAR > 0.75 || (isClippedTop && isClippedBottom)) {
      return {
        refSize: 0.55,
        bboxSize: bboxHeightPx * BBOX_SHRINK_FACTOR,
        isClipped,
      };
    }
    if (isClipped || bboxAR > 0.45 || (bboxHeightPx / frameHeight > 0.60)) {
      return {
        refSize: 0.85,
        bboxSize: bboxHeightPx * BBOX_SHRINK_FACTOR,
        isClipped,
      };
    }
  }

  if (ref.expectedAR > 1.5 && bboxAR > 1.2) {
    return {
      refSize: ref.w,
      bboxSize: (bboxWidthPx || bboxHeightPx) * BBOX_SHRINK_FACTOR,
      isClipped,
    };
  }

  return {
    refSize: ref.h,
    bboxSize: bboxHeightPx * BBOX_SHRINK_FACTOR,
    isClipped,
  };
}

function groundPlaneEstimate(normBboxBottomY: number, frameHeight: number, frameWidth: number): number | null {
  if (normBboxBottomY < 0.50 || normBboxBottomY > 0.97) return null;

  const hfov = autoDetectHFov(frameWidth, frameHeight);
  const vfov = hfov * (frameHeight / frameWidth);
  const vfovRad = (vfov * Math.PI) / 180;
  const cameraHeight = 1.2;

  const angleFromCenter = (normBboxBottomY - 0.5) * vfovRad;
  if (angleFromCenter <= 0.02) return null;

  const groundDist = cameraHeight / Math.tan(angleFromCenter);
  return Math.max(0.3, Math.min(15, groundDist));
}

export function estimateDistance(
  className: string,
  bboxHeightPx: number,
  frameHeight: number,
  frameWidth: number = 640,
  bboxWidthPx?: number,
  bboxYPx?: number
): DistanceEstimate {
  if (!bboxHeightPx || bboxHeightPx <= 0 || !frameHeight || frameHeight <= 0) {
    return {
      meters: null,
      label: 'unknown distance',
      shortLabel: '?m',
      zone: 'far',
      urgency: 'info',
      confidence: 'none',
    };
  }

  const fw = frameWidth || 640;
  const hfov = autoDetectHFov(fw, frameHeight);
  const focalLength = estimateFocalLength(fw, hfov);

  const { refSize, bboxSize, isClipped } = getEffectiveDimensions(className, bboxHeightPx, bboxWidthPx, frameHeight, bboxYPx);
  const ref = REFERENCE_OBJECTS[className];
  const calibration = ref ? ref.calibration : 1.0;

  const pinholeDist = (focalLength * refSize * calibration) / bboxSize;

  let groundDist: number | null = null;
  if (!isClipped && bboxYPx !== undefined && bboxYPx !== null) {
    const normBottomY = (bboxYPx + bboxHeightPx) / frameHeight;
    groundDist = groundPlaneEstimate(normBottomY, frameHeight, fw);
  }

  let meters: number;
  if (groundDist !== null && ref) {
    const groundObjects = new Set([
      'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
      'dog', 'cat', 'chair', 'bench', 'suitcase', 'backpack',
      'fire hydrant', 'stop sign', 'parking meter',
    ]);
    if (groundObjects.has(className)) {
      meters = pinholeDist * 0.80 + groundDist * 0.20;
    } else {
      meters = pinholeDist;
    }
  } else {
    meters = pinholeDist;
  }

  meters = Math.max(0.2, Math.min(50.0, meters));
  meters = Math.round(meters * 10) / 10;

  const bboxCoverage = bboxHeightPx / frameHeight;
  const isKnownClass = className in REFERENCE_OBJECTS;
  let confidence: 'high' | 'medium' | 'low' | 'none';
  if (!isKnownClass) {
    confidence = 'low';
  } else if (bboxCoverage > 0.8 || bboxCoverage < 0.015) {
    confidence = 'low';
  } else {
    confidence = 'high';
  }

  const zone = classifyDistanceZone(meters);

  return {
    meters,
    label: formatDistanceForSpeech(meters),
    shortLabel: formatDistanceShort(meters),
    zone: zone.key,
    urgency: zone.urgency,
    confidence,
  };
}

export function classifyDistanceZone(meters: number): DistanceZone {
  for (const zone of DISTANCE_ZONES) {
    if (meters <= zone.maxMeters) return zone;
  }
  return DISTANCE_ZONES[DISTANCE_ZONES.length - 1];
}

export function formatDistanceForSpeech(meters: number | null): string {
  if (meters === null || meters === undefined) return 'unknown distance';
  if (meters < 0.5) return "within arm's reach";
  if (meters < 0.9) return 'less than 1 meter away';
  if (meters <= 1.3) return `about 1 meter away`;
  if (meters <= 1.8) return `about 1.5 meters away`;
  if (meters <= 2.8) return `about ${meters.toFixed(1)} meters away`;
  if (meters < 10) return `roughly ${Math.round(meters)} meters away`;
  return `roughly ${Math.round(meters)} meters away`;
}

export function formatDistanceShort(meters: number | null): string {
  if (meters === null || meters === undefined) return '?m';
  if (meters < 10) return `${meters.toFixed(1)}m`;
  return `~${Math.round(meters)}m`;
}

export function estimateDistanceFromNormBbox(
  className: string,
  normBboxHeight: number,
  frameHeight: number,
  frameWidth: number,
  normBboxWidth?: number,
  normBboxY?: number
): DistanceEstimate {
  const bboxHeightPx = normBboxHeight * frameHeight;
  const bboxWidthPx = normBboxWidth !== undefined ? normBboxWidth * frameWidth : undefined;
  const bboxYPx = normBboxY !== undefined ? normBboxY * frameHeight : undefined;
  return estimateDistance(className, bboxHeightPx, frameHeight, frameWidth, bboxWidthPx, bboxYPx);
}
