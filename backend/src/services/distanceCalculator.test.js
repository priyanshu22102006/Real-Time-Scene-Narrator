// Unit tests for distanceCalculator.js (v3)
// Run: node backend/src/services/distanceCalculator.test.js

import {
  estimateDistance,
  classifyDistanceZone,
  formatDistanceForSpeech,
  formatDistanceShort,
  estimateAllDistances,
  loadDistanceConfig,
  REFERENCE_HEIGHTS,
} from './distanceCalculator.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

console.log('\n═══ Distance Calculator v3 Unit Tests ═══\n');

try {
  loadDistanceConfig();
} catch {
  console.log('  ℹ️ Config load skipped\n');
}

// --- Test 1: Reference heights ---
console.log('─── Reference Heights ───');
assert(REFERENCE_HEIGHTS['person'] === 1.70, 'Person height is 1.70m');
assert(REFERENCE_HEIGHTS['car'] === 1.50, 'Car height is 1.50m');
assert(REFERENCE_HEIGHTS['bottle'] === 0.25, 'Bottle height is 0.25m');

// --- Test 2: Person Distance Estimation ---
console.log('\n─── Person Distance Estimation & Truncation (640x480 frame) ───');

// Person standing close (~1.1m) with cropped upper body filling ~360px height, top-Y = 10px
const personNearUpperBody = estimateDistance('person', 360, 480, 640, 200, 10);
assert(personNearUpperBody.meters !== null, 'Upper body person: non-null meters');
assert(personNearUpperBody.meters >= 0.9 && personNearUpperBody.meters <= 1.3,
  `Near upper-body person (360px): ${personNearUpperBody.meters}m should be ~1.1m (between 0.9m and 1.3m)`);

// Person further back (100px bbox, full body)
const personFar = estimateDistance('person', 100, 480, 640, 50, 150);
assert(personFar.meters > personNearUpperBody.meters,
  `Far person (${personFar.meters}m) should be > near person (${personNearUpperBody.meters}m)`);

// --- Test 3: Near-Field Speech Formatting ---
console.log('\n─── Near-Field Speech Formatting ───');

assert(formatDistanceForSpeech(1.1) === 'about 1 meter away', `1.1m → "${formatDistanceForSpeech(1.1)}"`);
assert(formatDistanceForSpeech(1.5) === 'about 1.5 meters away', `1.5m → "${formatDistanceForSpeech(1.5)}"`);
assert(formatDistanceForSpeech(2.1) === 'about 2.1 meters away', `2.1m → "${formatDistanceForSpeech(2.1)}"`);
assert(formatDistanceForSpeech(5.7) === 'roughly 6 meters away', `5.7m → "${formatDistanceForSpeech(5.7)}"`);

// --- Test 4: Short UI Label ---
console.log('\n─── Short Label Formatting ───');
assert(formatDistanceShort(1.1) === '1.1m', `1.1m → "${formatDistanceShort(1.1)}"`);
assert(formatDistanceShort(2.3) === '2.3m', `2.3m → "${formatDistanceShort(2.3)}"`);
assert(formatDistanceShort(12.0) === '~12m', `12.0m → "${formatDistanceShort(12.0)}"`);

// --- Test 5: Edge cases & Clamping ---
console.log('\n─── Edge Cases ───');
assert(estimateDistance('person', 0, 480, 640).meters === null, 'Zero bbox height returns null meters');
assert(estimateDistance('ufo', 200, 480, 640).meters !== null, 'Unknown class returns distance');

console.log('\n═══════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
