export interface Coord {
  lat: number;
  lng: number;
}

export const CITIES: Record<string, Coord & { displayName: string }> = {
  kigali: { lat: -1.9441, lng: 30.0619, displayName: 'Kigali (Capital)' },
  huye: { lat: -2.5967, lng: 29.7394, displayName: 'Huye (Southern Province)' },
  musanze: { lat: -1.5034, lng: 29.6350, displayName: 'Musanze (Northern Province)' },
  rubavu: { lat: -1.7011, lng: 29.2612, displayName: 'Rubavu / Gisenyi (Western Province)' },
  gisenyi: { lat: -1.7011, lng: 29.2612, displayName: 'Rubavu / Gisenyi (Western Province)' },
  nyagatare: { lat: -1.2990, lng: 30.3421, displayName: 'Nyagatare (Eastern Province)' },
  rwamagana: { lat: -1.9487, lng: 30.4347, displayName: 'Rwamagana (Eastern Province)' },
  rusizi: { lat: -2.4833, lng: 28.9000, displayName: 'Rusizi (Southwest Border)' },
  karongi: { lat: -2.0620, lng: 29.3522, displayName: 'Karongi / Kibuye' },
  kibuye: { lat: -2.0620, lng: 29.3522, displayName: 'Karongi / Kibuye' },
  muhanga: { lat: -2.0747, lng: 29.7561, displayName: 'Muhanga District' },
  gitarama: { lat: -2.0747, lng: 29.7561, displayName: 'Muhanga District' },
  kayonza: { lat: -1.9272, lng: 30.5284, displayName: 'Kayonza Hub' },
  nyanza: { lat: -2.3516, lng: 29.7509, displayName: 'Nyanza Royal Seat' },
};

// Precise waypoints representing actual road/highways in Rwanda (RN1, RN2, RN3, RN4, etc.)
export const ROUTE_WAYPOINTS: Record<string, Coord[]> = {
  'kigali-huye': [
    { lat: -1.9441, lng: 30.0619 }, // Kigali
    { lat: -1.9660, lng: 30.0150 },
    { lat: -1.9961, lng: 29.9142 },
    { lat: -2.0250, lng: 29.8700 }, // Kamonyi entry
    { lat: -2.0463, lng: 29.8344 }, // Kamonyi Center
    { lat: -2.0590, lng: 29.8000 },
    { lat: -2.0747, lng: 29.7561 }, // Muhanga
    { lat: -2.1480, lng: 29.7610 },
    { lat: -2.2223, lng: 29.7758 }, // Ruhango
    { lat: -2.2910, lng: 29.7600 },
    { lat: -2.3516, lng: 29.7509 }, // Nyanza
    { lat: -2.4780, lng: 29.7210 },
    { lat: -2.5310, lng: 29.7150 },
    { lat: -2.5967, lng: 29.7394 }, // Huye (Butare)
  ],
  'kigali-musanze': [
    { lat: -1.9441, lng: 30.0619 }, // Kigali
    { lat: -1.9050, lng: 30.0380 },
    { lat: -1.8742, lng: 30.0150 }, // Shyorongi / Mount Kigali pass
    { lat: -1.8210, lng: 30.0310 },
    { lat: -1.7820, lng: 30.0410 }, // Rulindo foothills
    { lat: -1.7341, lng: 30.0520 }, // Rulindo Town
    { lat: -1.6890, lng: 30.0120 },
    { lat: -1.6520, lng: 29.9320 },
    { lat: -1.6321, lng: 29.8450 }, // Gakenke District Office
    { lat: -1.5980, lng: 29.7890 },
    { lat: -1.5510, lng: 29.7120 },
    { lat: -1.5034, lng: 29.6350 }, // Musanze (Ruhengeri)
  ],
  'kigali-rubavu': [
    { lat: -1.9441, lng: 30.0619 }, // Kigali
    { lat: -1.8742, lng: 30.0150 },
    { lat: -1.7341, lng: 30.0520 }, // Rulindo
    { lat: -1.6321, lng: 29.8450 }, // Gakenke
    { lat: -1.5034, lng: 29.6350 }, // Musanze
    { lat: -1.5280, lng: 29.5810 },
    { lat: -1.5580, lng: 29.5410 }, // Nyabihu mountains road
    { lat: -1.5810, lng: 29.4790 },
    { lat: -1.5971, lng: 29.4121 }, // Mukamira junction / Nyabihu base
    { lat: -1.6150, lng: 29.3780 },
    { lat: -1.6420, lng: 29.3410 }, // Pfunda Tea factory
    { lat: -1.6810, lng: 29.2990 },
    { lat: -1.7011, lng: 29.2612 }, // Rubavu / Gisenyi border
  ],
  'kigali-rwamagana': [
    { lat: -1.9441, lng: 30.0619 }, // Kigali center
    { lat: -1.9510, lng: 30.1050 }, // Remera / Kanombe bypass
    { lat: -1.9620, lng: 30.1340 }, // Masaka Hospital area
    { lat: -1.9560, lng: 30.2210 }, // Kabuga town
    { lat: -1.9460, lng: 30.2780 },
    { lat: -1.9390, lng: 30.3120 }, // Nzige hill section
    { lat: -1.9420, lng: 30.3710 },
    { lat: -1.9487, lng: 30.4347 }, // Rwamagana Town
  ],
  'kigali-nyagatare': [
    { lat: -1.9441, lng: 30.0619 }, // Kigali
    { lat: -1.9620, lng: 30.1340 },
    { lat: -1.9560, lng: 30.2210 }, // Kabuga
    { lat: -1.9487, lng: 30.4347 }, // Rwamagana
    { lat: -1.9330, lng: 30.4910 },
    { lat: -1.9272, lng: 30.5284 }, // Kayonza Junction
    { lat: -1.8510, lng: 30.5510 },
    { lat: -1.7920, lng: 30.5840 }, // Kabarore / Gatsibo
    { lat: -1.7210, lng: 30.5610 },
    { lat: -1.6110, lng: 30.4560 }, // Gatsibo center
    { lat: -1.5120, lng: 30.4120 },
    { lat: -1.4320, lng: 30.3890 }, // Ryabega hub
    { lat: -1.2990, lng: 30.3421 }, // Nyagatare
  ],
  'kigali-karongi': [
    { lat: -1.9441, lng: 30.0619 }, // Kigali
    { lat: -2.0463, lng: 29.8344 }, // Kamonyi
    { lat: -2.0747, lng: 29.7561 }, // Muhanga
    { lat: -2.0510, lng: 29.6820 },
    { lat: -2.0310, lng: 29.5420 }, // Ngororero mountains path
    { lat: -2.0640, lng: 29.4710 },
    { lat: -2.1020, lng: 29.4230 }, // Rubengera turnoff
    { lat: -2.0780, lng: 29.3880 },
    { lat: -2.0620, lng: 29.3522 }, // Karongi lake view
  ],
  'kigali-rusizi': [
    { lat: -1.9441, lng: 30.0619 }, // Kigali
    { lat: -2.0747, lng: 29.7561 }, // Muhanga
    { lat: -2.2223, lng: 29.7758 }, // Ruhango
    { lat: -2.3516, lng: 29.7509 }, // Nyanza
    { lat: -2.5967, lng: 29.7394 }, // Huye
    { lat: -2.5510, lng: 29.5610 },
    { lat: -2.5210, lng: 29.4120 }, // Nyamagabe crossing
    { lat: -2.4830, lng: 29.3210 }, // Kitabi Tea entrance to Nyungwe
    { lat: -2.4930, lng: 29.2150 }, // Nyungwe forest canopy trail
    { lat: -2.4850, lng: 29.0810 }, // Uwinka overlook
    { lat: -2.4710, lng: 28.9810 }, // Bugarama junction
    { lat: -2.4833, lng: 28.9000 }, // Rusizi / Cyangugu port
  ]
};

/**
 * Returns a list of coordinates representing the highway route path.
 */
export function getRoutePath(originName: string, destName: string): Coord[] {
  const o = originName.trim().toLowerCase();
  const d = destName.trim().toLowerCase();

  const key = `${o}-${d}`;
  if (ROUTE_WAYPOINTS[key]) {
    return ROUTE_WAYPOINTS[key];
  }

  const reverseKey = `${d}-${o}`;
  if (ROUTE_WAYPOINTS[reverseKey]) {
    // Return inverted copy so route direction is correct
    return [...ROUTE_WAYPOINTS[reverseKey]].reverse();
  }

  // Fallback: If no custom highway curve exists, create a graceful curved midpoint using quadratic bezier
  const origin = CITIES[o] || CITIES.kigali;
  const destination = CITIES[d] || CITIES.huye;

  const points: Coord[] = [];
  const segments = 12; // interpolate 12 steps for smooth curve

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Straight line
    const straightLat = origin.lat + (destination.lat - origin.lat) * t;
    const straightLng = origin.lng + (destination.lng - origin.lng) * t;

    // Curved nudge offset (orthogonal) using a sine bulge
    const bulge = Math.sin(t * Math.PI) * 0.08;
    const dx = destination.lng - origin.lng;
    const dy = destination.lat - origin.lat;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    
    // Orthogonal unit vector
    const nx = -dy / len;
    const ny = dx / len;

    points.push({
      lat: straightLat + nx * bulge,
      lng: straightLng + ny * bulge
    });
  }

  return points;
}

/**
 * Interpolates vehicle position coordinates along a multi-segment route coordinate path.
 */
export function getInterpolatedPoint(coords: Coord[], progress: number): Coord {
  if (!coords || coords.length === 0) return { lat: -1.9441, lng: 30.0619 };
  if (coords.length === 1) return coords[0];
  if (progress <= 0) return coords[0];
  if (progress >= 1) return coords[coords.length - 1];

  const totalSegments = coords.length - 1;
  const absoluteProgress = progress * totalSegments;
  const segmentIndex = Math.floor(absoluteProgress);
  const segmentProgress = absoluteProgress - segmentIndex;

  const p1 = coords[segmentIndex];
  const p2 = coords[segmentIndex + 1] || p1;

  return {
    lat: p1.lat + (p2.lat - p1.lat) * segmentProgress,
    lng: p1.lng + (p2.lng - p1.lng) * segmentProgress,
  };
}
