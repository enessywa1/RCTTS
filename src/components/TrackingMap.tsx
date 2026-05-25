import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { CITIES, getRoutePath, getInterpolatedPoint } from '../utils/routing';

interface TrackingMapProps {
  ticketId: string;
  status: string;
  route: string;
  agency?: string;
  currentLat?: number;
  currentLng?: number;
}

function parseLocations(routeStr: string) {
  const parts = routeStr.split(/→|->|-/).map((p) => p.trim().toLowerCase());
  const originName = parts[0] || 'kigali';
  const destName = parts[1] || 'huye';

  const origin = CITIES[originName] || CITIES.kigali;
  const destination = CITIES[destName] || CITIES.huye;

  return { origin, destination, originName, destName };
}

export default function TrackingMap({ ticketId, status, route, agency, currentLat, currentLng }: TrackingMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const pathLineRef = useRef<L.Polyline | null>(null);
  
  // Marker references to update dynamically
  const originMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);

  // Live in-transit animated progress state
  const [progress, setProgress] = useState(0.35);

  const { origin, destination, originName, destName } = parseLocations(route);
  const routeWaypoints = getRoutePath(originName, destName);

  // Status-based default progress
  useEffect(() => {
    if (status === 'Delivered') {
      setProgress(1.0);
    } else if (status === 'Created') {
      setProgress(0.0);
    } else if (status === 'Picked Up') {
      setProgress(0.1);
    } else if (status === 'At Customs') {
      setProgress(0.5); // customs checkpoint is midway
    } else if (status === 'Cleared') {
      setProgress(0.65);
    } else if (status === 'Out') {
      setProgress(0.85);
    } else {
      // In Transit - we trigger progress animation
      setProgress(0.35);
    }
  }, [status, route]);

  // Animate transit vehicle smoothly over time if not on live GPS
  const isRealGPS = typeof currentLat === 'number' && typeof currentLng === 'number';

  useEffect(() => {
    if (status === 'In Transit' && !isRealGPS) {
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 1.0) return 0.05; // cycle back for realism
          return prev + 0.004; // slow move
        });
      }, 350);
      return () => clearInterval(interval);
    }
  }, [status, isRealGPS]);

  // Interpolate coordinates or use real driver phone GPS coordinates
  const currentVehicleCoords = isRealGPS ? {
    lat: currentLat!,
    lng: currentLng!,
  } : getInterpolatedPoint(routeWaypoints, progress);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Check if map doesn't exist yet, then initialize it
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [-1.9403, 30.0], // Centered roughly in Rwanda
        zoom: 9,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      // Use an elegant muted outdoor map style
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Force invalidate size on mount to prevent partial loading in CSS transitions/iframes
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    // Custom Icon Definitions using inline HTML & Tailwind
    const originIcon = L.divIcon({
      html: `
        <div class="custom-pin flex items-center justify-center">
          <div class="relative flex items-center justify-center">
            <span class="absolute inline-flex h-6 w-6 rounded-full bg-emerald-400 opacity-60 animate-ping"></span>
            <div class="custom-pin-inner bg-emerald-600 text-white w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold border-2 border-white shadow-md">
              A
            </div>
          </div>
        </div>
      `,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const destIcon = L.divIcon({
      html: `
        <div class="custom-pin flex items-center justify-center">
          <div class="custom-pin-inner bg-rose-600 text-white w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold border-2 border-white shadow-md">
            B
          </div>
        </div>
      `,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const vehicleIcon = L.divIcon({
      html: `
        <div class="custom-pin flex items-center justify-center">
          <div class="relative flex items-center justify-center">
            <span class="absolute inline-flex h-8 w-8 rounded-full bg-amber-400 opacity-80 animate-ping"></span>
            <div class="w-9 h-9 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center shadow-lg transform scale-110">
              <svg class="w-5 h-5 text-neutral-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125a1.125 1.125 0 0 0 1.125-1.125V9.75M3.82 14.5a3 3 0 0 1-1.125-1.125V3a1 1 0 0 1 1-1h13.125a1 1 0 0 1 1 1v10.375c0 .414-.336.75-.75.75H3.82ZM11.25 6H13.5v3H11.25V6ZM6 6h2.25v3H6V6Z" />
              </svg>
            </div>
          </div>
        </div>
      `,
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    // 1. Update/Add Origin Marker
    if (originMarkerRef.current) {
      originMarkerRef.current.setLatLng([origin.lat, origin.lng]);
    } else {
      originMarkerRef.current = L.marker([origin.lat, origin.lng], { icon: originIcon })
        .addTo(map)
        .bindPopup(`<b>Origin: ${origin.displayName}</b>`);
    }

    // 2. Update/Add Destination Marker
    if (destMarkerRef.current) {
      destMarkerRef.current.setLatLng([destination.lat, destination.lng]);
    } else {
      destMarkerRef.current = L.marker([destination.lat, destination.lng], { icon: destIcon })
        .addTo(map)
        .bindPopup(`<b>Destination: ${destination.displayName}</b>`);
    }

    // 3. Update/Add Route Polyline
    const routeCoords: L.LatLngExpression[] = routeWaypoints.map(p => [p.lat, p.lng]);
    if (pathLineRef.current) {
      pathLineRef.current.setLatLngs(routeCoords);
    } else {
      pathLineRef.current = L.polyline(routeCoords, {
        color: '#1B5E34',
        weight: 4,
        opacity: 0.8,
        dashArray: '8, 8',
      }).addTo(map);
    }

    // 4. Update/Add Live Moving Vehicle Marker
    if (vehicleMarkerRef.current) {
      vehicleMarkerRef.current.setLatLng([currentVehicleCoords.lat, currentVehicleCoords.lng]);
    } else {
      vehicleMarkerRef.current = L.marker([currentVehicleCoords.lat, currentVehicleCoords.lng], { icon: vehicleIcon })
        .addTo(map)
        .bindPopup(`<b>${agency || 'Courier Truck'}</b><br/>Transit Ticket: <b>#RW-${ticketId.slice(0, 4).toUpperCase()}</b>`);
    }

    // Zoom and pan the map to fit both active marker bounds
    const bounds = L.latLngBounds([
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
      [currentVehicleCoords.lat, currentVehicleCoords.lng],
    ]);
    map.fitBounds(bounds, { padding: [50, 50] });

  }, [origin, destination, currentLat, currentLng, progress]);

  // Let's also update the vehicle marker continuously on progress updates
  useEffect(() => {
    if (vehicleMarkerRef.current && mapInstanceRef.current) {
      vehicleMarkerRef.current.setLatLng([currentVehicleCoords.lat, currentVehicleCoords.lng]);
    }
  }, [progress, currentLat, currentLng]);

  // Destructor callback
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        originMarkerRef.current = null;
        destMarkerRef.current = null;
        vehicleMarkerRef.current = null;
        pathLineRef.current = null;
      }
    };
  }, []);

  return (
    <div className="w-full relative rounded-lg overflow-hidden border border-neutral-200 shadow-sm" style={{ height: '380px' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '380px' }} />
      
      {/* Dynamic Status Dashboard Overlay inside the Map */}
      <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-md p-3.5 rounded-lg shadow-lg border border-neutral-100 z-[9999] max-w-[210px] text-neutral-800">
        <div className="text-[10px] uppercase tracking-wider font-extrabold text-neutral-400">Rwandan Live GPS Tracker</div>
        <div className="text-xs font-bold text-emerald-950 mt-1 truncate">Route: {route}</div>
        <div className="text-[11px] font-medium text-neutral-500 mt-0.5">{agency}</div>
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-neutral-100">
          <span className="flex h-2.5 w-2.5 relative">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isRealGPS ? 'bg-red-400' : 'bg-emerald-400'} opacity-75`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isRealGPS ? 'bg-rose-600' : 'bg-emerald-500'}`}></span>
          </span>
          <span className="text-[11px] font-bold text-neutral-900 capitalize">
            {isRealGPS ? 'LIVE PHONE GPS' : (status || 'In Transit')}
          </span>
        </div>
        
        {isRealGPS ? (
          <div className="mt-2.5">
            <div className="text-[9px] font-mono font-bold text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded text-center">
              Lat: {currentVehicleCoords.lat.toFixed(5)}<br/>Lng: {currentVehicleCoords.lng.toFixed(5)}
            </div>
            <div className="text-[9px] text-neutral-400 mt-1 text-center font-medium">Broadcasting live from driver's device</div>
          </div>
        ) : (
          <>
            <div className="w-full bg-neutral-100 h-1.5 rounded-full mt-2.5 overflow-hidden">
              <div 
                className="bg-emerald-600 h-full transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-neutral-500 text-right mt-1">{Math.round(progress * 100)}% route complete</div>
          </>
        )}
      </div>
    </div>
  );
}
