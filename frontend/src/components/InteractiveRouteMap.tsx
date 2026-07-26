import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface LocationPoint {
  lat: number;
  lng: number;
}

interface AlternativeRoute {
  id: number;
  distance: number;
  duration: number;
  polyline: [number, number][];
}

interface InteractiveRouteMapProps {
  origin: LocationPoint | null;
  destination: LocationPoint | null;
  destinationName?: string;
  primaryPolyline: [number, number][];
  alternativeRoutes?: AlternativeRoute[];
  currentPosition?: LocationPoint | null;
  selectedRouteIndex?: number;
  onSelectRoute?: (index: number) => void;
}

export default function InteractiveRouteMap({
  origin,
  destination,
  destinationName = 'Goal Destination',
  primaryPolyline,
  alternativeRoutes = [],
  currentPosition,
  selectedRouteIndex = 0,
  onSelectRoute,
}: InteractiveRouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialLat = origin?.lat || 37.7749;
      const initialLng = origin?.lng || -122.4194;

      const map = L.map(mapContainerRef.current, {
        center: [initialLat, initialLng],
        zoom: 15,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      layersGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const layers = layersGroupRef.current;
    if (!map || !layers) return;

    layers.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];

    // Custom Icon Creators
    const createCustomIcon = (bgColor: string, text: string) => {
      return L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="
            background-color: ${bgColor};
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            border: 2px solid white;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
          ">
            ${text}
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
    };

    // 1. Draw Alternative Paths (Dashed lines)
    alternativeRoutes.forEach((alt, idx) => {
      if (alt.polyline && alt.polyline.length > 0) {
        const altPolyline = L.polyline(alt.polyline, {
          color: selectedRouteIndex === idx + 1 ? '#0284c7' : '#94a3b8',
          weight: 4,
          dashArray: '6, 8',
          opacity: 0.7,
        });

        altPolyline.bindTooltip(`Alt Route ${idx + 1}: ${(alt.distance / 1000).toFixed(1)}km`);
        altPolyline.on('click', () => onSelectRoute?.(idx + 1));
        altPolyline.addTo(layers);

        alt.polyline.forEach(pt => boundsPoints.push(pt));
      }
    });

    // 2. Draw Shortest / Primary Path (Glowing Polyline)
    if (primaryPolyline && primaryPolyline.length > 0) {
      const primaryLine = L.polyline(primaryPolyline, {
        color: selectedRouteIndex === 0 ? '#2563eb' : '#64748b',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
      });

      primaryLine.bindTooltip('✨ Shortest Path (Recommended)', { permanent: false });
      primaryLine.on('click', () => onSelectRoute?.(0));
      primaryLine.addTo(layers);

      primaryPolyline.forEach(pt => boundsPoints.push(pt));
    }

    // 3. Draw Starting Point Marker
    if (origin) {
      const startMarker = L.marker([origin.lat, origin.lng], {
        icon: createCustomIcon('#10b981', '🚩'),
      });
      startMarker.bindPopup('<b>Starting Location</b><br/>Origin point of navigation');
      startMarker.addTo(layers);
      boundsPoints.push([origin.lat, origin.lng]);
    }

    // 4. Draw Goal / Destination Marker
    if (destination) {
      const goalMarker = L.marker([destination.lat, destination.lng], {
        icon: createCustomIcon('#ef4444', '🏁'),
      });
      goalMarker.bindPopup(`<b>Goal Destination</b><br/>${destinationName}`);
      goalMarker.addTo(layers);
      boundsPoints.push([destination.lat, destination.lng]);
    }

    // 5. Draw Live User Location Marker (Pulsing Dot)
    if (currentPosition) {
      const userDot = L.circleMarker([currentPosition.lat, currentPosition.lng], {
        radius: 9,
        fillColor: '#3b82f6',
        fillOpacity: 1,
        color: '#ffffff',
        weight: 3,
      });
      userDot.bindPopup('<b>You Are Here</b><br/>Live GPS Position');
      userDot.addTo(layers);
      boundsPoints.push([currentPosition.lat, currentPosition.lng]);
    }

    // Auto-fit map viewport to show entire route from start to goal
    if (boundsPoints.length > 0) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [origin, destination, destinationName, primaryPolyline, alternativeRoutes, currentPosition, selectedRouteIndex, onSelectRoute]);

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          🗺 Interactive Route Map &amp; Pathways
        </span>
        {alternativeRoutes.length > 0 && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-700">
            ⚡ Shortest Route Selected ({1 + alternativeRoutes.length} candidate paths)
          </span>
        )}
      </div>

      <div className="relative w-full h-[320px] rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10 shadow-md">
        <div ref={mapContainerRef} className="w-full h-full z-0" aria-label="Interactive leaflet route map" />

        {/* Map Legend Floating Badge */}
        <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 dark:bg-dark-800/90 backdrop-blur-md px-3 py-2 rounded-xl text-[11px] font-medium border border-gray-200 dark:border-white/10 shadow-lg flex flex-wrap gap-3 text-gray-700 dark:text-gray-300">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Start
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Goal
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-1.5 bg-blue-600 rounded-full inline-block" /> Shortest Path
          </div>
          {alternativeRoutes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-1 bg-slate-400 rounded-full border-b border-dashed inline-block" /> Alt Path
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
