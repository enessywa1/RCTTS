import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { CITIES, getRoutePath, getInterpolatedPoint } from '../utils/routing';

interface Ticket {
  id: string;
  senderName: string;
  receiverName: string;
  packageType: string;
  status: string;
  route: string;
  agency?: string;
  agencyId?: string;
  weight?: number;
  currentLat?: number;
  currentLng?: number;
}

interface GeneralFleetMapProps {
  tickets: Ticket[];
  onSelectTicket?: (ticketId: string) => void;
}

function parseLocations(routeStr: string) {
  const parts = routeStr.split(/→|->|-/).map((p) => p.trim().toLowerCase());
  const originName = parts[0] || 'kigali';
  const destName = parts[1] || 'huye';

  const origin = CITIES[originName] || CITIES.kigali;
  const destination = CITIES[destName] || CITIES.huye;

  return { origin, destination, originName, destName };
}

// Generate a deterministic offset so vehicles don't stack up if multiple are on the same route
function getDeterministicProgress(ticketId: string, status: string): number {
  if (status === 'Delivered') return 1.0;
  if (status === 'Created') return 0.0;
  if (status === 'Picked Up') return 0.12;
  if (status === 'At Customs') return 0.50;
  if (status === 'Cleared') return 0.65;
  if (status === 'Out') return 0.88;

  // For 'In Transit'
  let hash = 0;
  for (let i = 0; i < ticketId.length; i++) {
    hash += ticketId.charCodeAt(i);
  }
  // Yields a float between 0.18 and 0.82
  return 0.18 + (hash % 64) * 0.01;
}

export default function GeneralFleetMap({ tickets, onSelectTicket }: GeneralFleetMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  
  // Keep track of layers to clean them up on updates
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Active filter
  const [filterAgency, setFilterAgency] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('active'); // 'all' | 'active' | 'delivered'
  const [filterId, setFilterId] = useState<string>(''); // Search by ID

  // Ref to active filter state so leaflet event handlers can access updated fields if needed
  const uniqueAgencies = Array.from(new Set(tickets.map((t) => t.agency || 'Zebre Car Express').filter(Boolean)));

  // Periodic visual animation ticks to simulate live movements
  const [animationTick, setAnimationTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setAnimationTick((prev) => prev + 1);
    }, 1200);
    return () => clearInterval(timer);
  }, []);

  // Filtered tickets
  const filteredTickets = tickets.filter((ticket) => {
    // Agency filter
    if (filterAgency !== 'all' && (ticket.agency || 'Zebre Car Express') !== filterAgency) {
      return false;
    }
    // Status filter
    if (filterStatus === 'active' && ticket.status === 'Delivered') {
      return false;
    }
    if (filterStatus === 'delivered' && ticket.status !== 'Delivered') {
      return false;
    }

    // ID search filter (case-insensitive search by ticket.id or formatted target as #RW-XXXX or RW-XXXX)
    if (filterId.trim()) {
      const searchStr = filterId.trim().toUpperCase();
      const formatted = `RW-${ticket.id.slice(0, 4).toUpperCase()}`;
      const hashFormatted = `#RW-${ticket.id.slice(0, 4).toUpperCase()}`;
      if (
        !ticket.id.toUpperCase().includes(searchStr) &&
        !formatted.includes(searchStr) &&
        !hashFormatted.includes(searchStr)
      ) {
        return false;
      }
    }

    return true;
  });

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // 1. Initialize Map
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [-1.9403, 30.0619], // Centered roughly in Rwanda
        zoom: 9,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      // Muted warm Voyager tile style
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
      }).addTo(map);

      // Initialize layered group
      const layerGroup = L.layerGroup().addTo(map);
      layerGroupRef.current = layerGroup;

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;

    if (!layerGroup) return;

    // Clean up previous renderings before repainting
    layerGroup.clearLayers();

    // Invalidate size immediately to resolve any tab resizing layout bugs
    setTimeout(() => {
      map.invalidateSize();
    }, 100);

    if (filteredTickets.length === 0) {
      return;
    }

    // 2. Render Paths and Markers for each matching ticket
    filteredTickets.forEach((ticket) => {
      const { origin, destination, originName, destName } = parseLocations(ticket.route);
      const routeWaypoints = getRoutePath(originName, destName);
      const baseProgress = getDeterministicProgress(ticket.id, ticket.status);

      // Introduce subtle animated vibration if In Transit
      let progress = baseProgress;
      if (ticket.status === 'In Transit') {
        const offset = Math.sin(animationTick * 0.15 + (ticket.id.charCodeAt(0) || 0)) * 0.015;
        progress = Math.min(Math.max(baseProgress + offset, 0.05), 0.95);
      }

      // Check if ticket is broadcasting real-time phone GPS location
      const isRealGPS = typeof ticket.currentLat === 'number' && typeof ticket.currentLng === 'number';

      // Compute current simulated or live coordinates
      const currentPos = getInterpolatedPoint(routeWaypoints, progress);
      const currentLat = isRealGPS ? ticket.currentLat! : currentPos.lat;
      const currentLng = isRealGPS ? ticket.currentLng! : currentPos.lng;

      // Color scheme based on status or agency
      let routeColor = '#78909c'; // neutral grayish
      if (isRealGPS) routeColor = '#e11d48'; // deep rose for active telemetry
      else if (ticket.status === 'In Transit') routeColor = '#f5b041'; // warm orange
      else if (ticket.status === 'Delivered') routeColor = '#27ae60'; // success green
      else if (ticket.status === 'At Customs') routeColor = '#e74c3c'; // red/customs alert

      // A. Path line using highway vertices
      const routeCoords = routeWaypoints.map(p => [p.lat, p.lng] as L.LatLngTuple);
      const pathLine = L.polyline(routeCoords, {
        color: routeColor,
        weight: 3,
        opacity: isRealGPS ? 0.8 : 0.6,
        dashArray: ticket.status === 'Delivered' ? '6, 6' : '4, 4',
      });
      layerGroup.addLayer(pathLine);

      // B. Custom markers for current courier position
      let iconHtml = '';
      if (ticket.status === 'Delivered') {
        iconHtml = `
          <div class="custom-pin flex items-center justify-center">
            <div class="w-6 h-6 rounded-full bg-emerald-600 border border-white text-white flex items-center justify-center text-[10px] font-bold shadow-md">
              ✓
            </div>
          </div>
        `;
      } else if (isRealGPS) {
        iconHtml = `
          <div class="custom-pin flex items-center justify-center">
            <div class="relative flex items-center justify-center">
              <span class="absolute inline-flex h-6 w-6 rounded-full bg-rose-400 opacity-80 animate-ping"></span>
              <div class="w-7 h-7 rounded-full bg-rose-600 text-white border-2 border-white flex items-center justify-center shadow-lg transform scale-105">
                <svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                </svg>
              </div>
            </div>
          </div>
        `;
      } else {
        const pingClass = ticket.status === 'In Transit' ? 'animate-ping' : '';
        const badgeColor = ticket.status === 'At Customs' ? 'bg-rose-500' : 'bg-amber-500';
        iconHtml = `
          <div class="custom-pin flex items-center justify-center">
            <div class="relative flex items-center justify-center">
              ${ticket.status === 'In Transit' ? `<span class="absolute inline-flex h-6 w-6 rounded-full bg-amber-400 opacity-60 ${pingClass}"></span>` : ''}
              <div class="w-7 h-7 rounded-full ${badgeColor} text-neutral-900 border border-white flex items-center justify-center shadow-lg">
                <svg class="w-4 h-4 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75c-.828 0-1.5.672-1.5 1.5s.672 1.5 1.5 1.5 1.5-.672 1.5-1.5-.672-1.5-1.5-1.5Zm9 0c-.828 0-1.5.672-1.5 1.5s.672 1.5 1.5 1.5 1.5-.672 1.5-1.5-.672-1.5-1.5-1.5M3 3h1.5L7 14.5c.214.945 1.05 1.625 2.022 1.625h8.496c.928 0 1.738-.616 1.986-1.505L21 6H5.5" />
                </svg>
              </div>
            </div>
          </div>
        `;
      }

      const vehicleIcon = L.divIcon({
        html: iconHtml,
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const trackingIdText = `RW-${ticket.id.slice(0, 4).toUpperCase()}`;

      const popupContent = `
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4; color: #333; min-width: 180px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 6px;">
            <b style="color: #111;">#${trackingIdText}</b>
            <span style="background: ${isRealGPS ? '#fff1f2' : '#efe'}; color: ${isRealGPS ? '#e11d48' : '#161'}; font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: bold; text-transform: uppercase;">
              ${isRealGPS ? '🔴 LIVE PHONE GPS' : ticket.status}
            </span>
          </div>
          <div><b>Agency:</b> ${ticket.agency || 'Zebre Car Express'}</div>
          <div><b>Route:</b> ${ticket.route}</div>
          <div><b>Package:</b> ${ticket.packageType} (${ticket.weight || 1} kg)</div>
          ${isRealGPS ? `
            <div style="margin-top: 6px; padding: 4px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 4px; font-size: 10px; font-family: monospace; color: #e11d48; text-align: center;">
              📡 GPS: ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}
            </div>
          ` : ''}
          <div style="margin-top: 8px;">
            <button 
              id="pop-btn-${ticket.id}" 
              style="width: 100%; cursor: pointer; background: #000; color: #fcc000; font-weight: 700; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px;"
            >
              Focus Tracking Details
            </button>
          </div>
        </div>
      `;

      const vehicleMarker = L.marker([currentLat, currentLng], { icon: vehicleIcon })
        .addTo(layerGroup)
        .bindPopup(popupContent, { closeButton: false });

      // Handle custom button interaction in popup
      vehicleMarker.on('popupopen', () => {
        const btn = document.getElementById(`pop-btn-${ticket.id}`);
        if (btn && onSelectTicket) {
          btn.addEventListener('click', () => {
            onSelectTicket(ticket.id);
          });
        }
      });
    });

    // Auto fit bounds to see all active couriers beautifully
    if (filteredTickets.length > 0) {
      const allCoords = filteredTickets.map((tc) => {
        const { origin, destination } = parseLocations(tc.route);
        return [
          [origin.lat, origin.lng],
          [destination.lat, destination.lng],
        ];
      }).flat();

      const bounds = L.latLngBounds(allCoords as L.LatLngExpression[]);
      map.fitBounds(bounds, { padding: [40, 40] });
    }

  }, [filteredTickets, animationTick]);

  // Handle destructor cleanup
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
        <div>
          <div className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Live Network Monitor</span>
            <span style={{ fontSize: '11px', background: 'rgba(0,100,0,0.1)', color: '#1B5E20', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
              {filteredTickets.length} Couriers Live
            </span>
          </div>
          <p className="text-ts" style={{ fontSize: '12px', marginTop: '4px' }}>Displays real-time GPS simulations of parcel couriers on highways throughout Rwanda</p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', zIndex: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Track Bus by ID (e.g. RW-2840)"
            style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '6px', color: '#000', background: '#fff', width: '220px' }}
            value={filterId}
            onChange={(e) => setFilterId(e.target.value)}
          />

          <select
            style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '6px', color: '#000', background: '#fff' }}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">Status: All Parcels</option>
            <option value="active">Status: In-Transit / Active Only</option>
            <option value="delivered">Status: Delivered Only</option>
          </select>

          <select
            style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '6px', color: '#000', background: '#fff' }}
            value={filterAgency}
            onChange={(e) => setFilterAgency(e.target.value)}
          >
            <option value="all">Agencies: All</option>
            {uniqueAgencies.map((agency) => (
              <option key={agency} value={agency}>
                {agency}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="w-full relative rounded-lg overflow-hidden border border-neutral-200 shadow-sm" style={{ height: '480px' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '480px' }} />

        {/* Quick Side Legend */}
        <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-md p-3.5 rounded-lg shadow-lg border border-neutral-100 z-[9999] max-w-[200px] text-neutral-800">
          <div className="text-[10px] uppercase tracking-wider font-extrabold text-neutral-400 mb-2">Map Legend</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f5b041' }}></div>
              <span>Transit Courier Truck</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#e74c3c' }}></div>
              <span>Held at Customs Point</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#27ae60' }}></div>
              <span>Package Delivered Successful</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
