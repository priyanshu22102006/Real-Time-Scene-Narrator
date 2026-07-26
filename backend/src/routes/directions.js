// Route: GET /api/directions
// Provides turn-by-turn navigation using two completely free, no-key-required APIs:
//   1. OpenStreetMap Nominatim — geocoding (address → lat/lng coordinates)
//      Docs: https://nominatim.openstreetmap.org/search
//   2. OSRM (Open Source Routing Machine) — routing (lat/lng → turn-by-turn steps)
//      Docs: https://router.project-osrm.org/route/v1/driving
// Both are free, open-source, and require no API key.

import fetch from 'node-fetch';

// Nominatim free geocoding API (OpenStreetMap)
// Rate limit: max 1 request/second per IP (enforced by our rate limiter)
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';

// OSRM public routing API (Open Source Routing Machine)
// Uses real road network data from OpenStreetMap
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

/**
 * Converts an address string to {lat, lng} coordinates using Nominatim geocoding.
 * @param {string} address - Human-readable address to geocode
 * @returns {Promise<{lat: number, lng: number}>}
 */
async function geocodeAddress(address) {
  console.log(`[directions] Geocoding address via Nominatim: "${address}"`);

  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`;

  const response = await fetch(url, {
    headers: {
      // Nominatim requires a valid User-Agent to identify the application
      'User-Agent': 'RealTimeSceneNarrator/1.0 (accessibility tool)',
      'Accept-Language': 'en',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Nominatim API returned status ${response.status}`);
  }

  const data = await response.json();

  if (!data || data.length === 0) {
    throw new Error(`No location found for address: "${address}"`);
  }

  const location = data[0];
  return {
    lat: parseFloat(location.lat),
    lng: parseFloat(location.lon),
    displayName: location.display_name,
  };
}

/**
 * Parses OSRM route maneuver type into a human-readable spoken instruction.
 * @param {object} step - OSRM route step object
 * @returns {string} Human-readable instruction
 */
function buildInstruction(step) {
  const { maneuver, name, distance } = step;
  const roadName = name ? `onto ${name}` : '';
  const distM = Math.round(distance);
  const distStr = distM >= 1000
    ? `${(distM / 1000).toFixed(1)} kilometers`
    : `${distM} meters`;

  switch (maneuver.type) {
    case 'depart':
      return `Head ${maneuver.modifier || 'forward'} ${roadName}. Travel ${distStr}.`;
    case 'arrive':
      return `You have arrived at your destination.`;
    case 'turn':
      return `Turn ${maneuver.modifier || 'left'} ${roadName}. Travel ${distStr}.`;
    case 'continue':
      return `Continue straight ${roadName} for ${distStr}.`;
    case 'merge':
      return `Merge ${maneuver.modifier || 'right'} ${roadName}.`;
    case 'on ramp':
      return `Take the ramp ${maneuver.modifier || ''} ${roadName}.`;
    case 'off ramp':
      return `Take the exit ${roadName}.`;
    case 'fork':
      return `Keep ${maneuver.modifier || 'right'} at the fork ${roadName}.`;
    case 'end of road':
      return `At the end of the road, turn ${maneuver.modifier || 'right'} ${roadName}.`;
    case 'roundabout':
    case 'rotary': {
      const exit = maneuver.exit ? `Take exit ${maneuver.exit}` : 'Exit';
      return `Enter the roundabout and ${exit} ${roadName}.`;
    }
    default:
      return `Continue ${roadName} for ${distStr}.`;
  }
}

export async function getDirections(req, res) {
  // Log which API providers are being used for debugging
  console.log('[directions] Using Nominatim (geocoding) + OSRM (routing) — both free, no key required');

  const { origin, destination } = req.query;

  if (!origin || !destination) {
    return res.status(400).json({
      error: 'Both "origin" (lat,lng) and "destination" (address or lat,lng) are required.',
      status: 400,
    });
  }

  try {
    // ─── Parse Origin ──────────────────────────────────────────────────────────
    // Origin should be "lat,lng" from the browser Geolocation API
    const originParts = origin.split(',');
    if (originParts.length < 2) {
      return res.status(400).json({ error: 'Origin must be in "lat,lng" format.', status: 400 });
    }
    const originLat = parseFloat(originParts[0]);
    const originLng = parseFloat(originParts[1]);
    if (isNaN(originLat) || isNaN(originLng)) {
      return res.status(400).json({ error: 'Origin coordinates are not valid numbers.', status: 400 });
    }

    // ─── Parse Destination ────────────────────────────────────────────────────
    // Destination can be an address string or "lat,lng" coordinates
    let destLat, destLng, destDisplayName;
    const destParts = destination.split(',');
    const isCoordinates = destParts.length >= 2 && !isNaN(parseFloat(destParts[0])) && !isNaN(parseFloat(destParts[1]));

    if (isCoordinates) {
      // Already coordinates — use directly
      destLat = parseFloat(destParts[0]);
      destLng = parseFloat(destParts[1]);
      destDisplayName = destination;
    } else {
      // Address string — geocode via Nominatim first
      const geocoded = await geocodeAddress(destination);
      destLat = geocoded.lat;
      destLng = geocoded.lng;
      destDisplayName = geocoded.displayName;
    }

    // ─── Call OSRM for Routing (Request Alternatives & Geometries) ───────────
    // OSRM expects coordinates as "lng,lat" (longitude first!)
    const osrmUrl = `${OSRM_BASE}/${originLng},${originLat};${destLng},${destLat}?steps=true&annotations=false&geometries=geojson&overview=full&alternatives=true`;

    console.log(`[directions] Requesting OSRM shortest route & alternatives: (${originLat},${originLng}) → (${destLat},${destLng})`);

    const osrmResponse = await fetch(osrmUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!osrmResponse.ok) {
      throw new Error(`OSRM API returned status ${osrmResponse.status}`);
    }

    const osrmData = await osrmResponse.json();

    if (osrmData.code !== 'Ok' || !osrmData.routes || osrmData.routes.length === 0) {
      return res.status(404).json({
        error: `No route found between the specified locations. OSRM code: ${osrmData.code}`,
        status: 404,
      });
    }

    // Sort routes by total distance to guarantee selection of the SHORTEST route
    const sortedRoutes = [...osrmData.routes].sort((a, b) => a.distance - b.distance);
    const shortestRoute = sortedRoutes[0];
    const leg = shortestRoute.legs[0];

    // Format primary shortest route polyline: [lat, lng] pairs for Leaflet map
    const primaryPolyline = shortestRoute.geometry?.coordinates?.map(coord => [coord[1], coord[0]]) || [];

    // Format alternative route polylines
    const alternativeRoutes = sortedRoutes.slice(1).map((altRoute, altIdx) => ({
      id: altIdx + 1,
      distance: Math.round(altRoute.distance),
      duration: Math.round(altRoute.duration),
      polyline: altRoute.geometry?.coordinates?.map(coord => [coord[1], coord[0]]) || [],
    }));

    // ─── Transform OSRM Steps to Spoken Instructions ──────────────────────────
    const steps = leg.steps.map((step, index) => {
      const instruction = buildInstruction(step);
      const location = step.maneuver.location; // [lng, lat]
      return {
        instruction,
        distance: Math.round(step.distance), // meters
        duration: Math.round(step.duration), // seconds
        location: {
          lat: location[1], // OSRM returns [lng, lat]
          lng: location[0],
        },
        stepIndex: index,
      };
    });

    console.log(`[directions] Shortest route selected (${Math.round(shortestRoute.distance)}m total across ${sortedRoutes.length} candidate paths)`);

    return res.json({
      steps,
      totalDistance: Math.round(shortestRoute.distance), // meters
      totalDuration: Math.round(shortestRoute.duration), // seconds
      origin: {
        lat: originLat,
        lng: originLng,
      },
      destination: {
        displayName: destDisplayName,
        lat: destLat,
        lng: destLng,
      },
      polyline: primaryPolyline,
      alternativeRoutes,
      totalCandidatePaths: sortedRoutes.length,
      provider: 'Nominatim (geocoding) + OSRM (Shortest Path Engine)',
    });

  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({
        error: 'Directions API timed out. Please try again.',
        status: 504,
      });
    }

    console.error('[directions] Error:', err.message);

    // Specific error for no location found
    if (err.message.includes('No location found')) {
      return res.status(404).json({ error: err.message, status: 404 });
    }

    return res.status(500).json({ error: 'Failed to retrieve directions.', status: 500 });
  }
}
