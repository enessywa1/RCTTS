import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { pool, ensureSchema } from './server/db';
import admin from 'firebase-admin';
import fs from 'fs';
import fetch from 'node-fetch';
import http from 'http';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  app.use(express.json());

  // In-memory fundraising state (synced for the live session)
  let raisedAmount = 420000;
  let donorCount = 14;
  const GOAL_AMOUNT = 1000000;

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "RCTTS Server is running" });
  });

  // Firebase Admin (for token verification) - requires SERVICE_ACCOUNT_PATH or SERVICE_ACCOUNT_JSON
  try {
    const svcPath = process.env.SERVICE_ACCOUNT_PATH;
    const svcJson = process.env.SERVICE_ACCOUNT_JSON;
    if (svcJson) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svcJson)) });
    else if (svcPath) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(svcPath, 'utf8'))) });
  } catch (e) {
    console.warn('Firebase admin init skipped or failed (required for auth verification):', e?.message || e);
  }

  // Structured CRUD endpoints (agencies, users, drivers, tickets)
  function requireAuth(req: any, res: any, next: any) {
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth token' });
    const token = authHeader.split(' ')[1];
    if (!admin.apps.length) return res.status(500).json({ error: 'Auth not configured on server' });
    admin.auth().verifyIdToken(token).then((dec: any) => {
      req.user = dec;
      next();
    }).catch((err: any) => {
      console.warn('Token verify failed:', err?.message || err);
      res.status(401).json({ error: 'Invalid token' });
    });
  }

  // Agencies
  app.get('/api/agencies', async (req, res) => {
    try {
      const r = await pool.query('SELECT id, name, active, tier, contact, metadata, created_at, updated_at FROM agencies ORDER BY created_at DESC');
      res.json(r.rows.map((row: any) => ({ id: row.id, name: row.name, active: row.active, tier: row.tier, contact: row.contact, metadata: row.metadata, createdAt: row.created_at, updatedAt: row.updated_at })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
  });
  app.post('/api/agencies', requireAuth, express.json(), async (req, res) => {
    const { name, active = true, tier = null, contact = null, metadata = {} } = req.body || {};
    try {
      const r = await pool.query('INSERT INTO agencies(name, active, tier, contact, metadata) VALUES($1,$2,$3,$4,$5) RETURNING id, name', [name, active, tier, contact, metadata]);
      wsBroadcast('agencies', { event: 'create', payload: r.rows[0] });
      res.json(r.rows[0]);
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed create' }); }
  });

  // Users
  app.get('/api/custom_users', async (req, res) => {
    try {
      const r = await pool.query('SELECT id, firebase_uid, name, email, role, agency_id, status, meta, created_at, updated_at FROM users ORDER BY created_at DESC');
      res.json(r.rows.map((row: any) => ({ id: row.id, firebaseUid: row.firebase_uid, name: row.name, email: row.email, role: row.role, agencyId: row.agency_id, status: row.status, meta: row.meta, createdAt: row.created_at })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
  });
  app.post('/api/custom_users', requireAuth, express.json(), async (req, res) => {
    const { id, firebaseUid, name, email, role, agencyId, status, meta } = req.body || {};
    try {
      const r = await pool.query('INSERT INTO users(id, firebase_uid, name, email, role, agency_id, status, meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, agency_id=EXCLUDED.agency_id, status=EXCLUDED.status RETURNING id, name, email, role', [id || null, firebaseUid || null, name || null, email || null, role || null, agencyId || null, status || null, meta || {}]);
      wsBroadcast('custom_users', { event: 'create', payload: r.rows[0] });
      res.json(r.rows[0]);
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
  });

  // Drivers
  app.get('/api/drivers', async (req, res) => {
    try {
      const r = await pool.query('SELECT id, name, license, agency_id, vehicle, status, meta, created_at FROM drivers ORDER BY created_at DESC');
      res.json(r.rows.map((row: any) => ({ id: row.id, name: row.name, license: row.license, agencyId: row.agency_id, vehicle: row.vehicle, status: row.status, meta: row.meta })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
  });
  app.post('/api/drivers', requireAuth, express.json(), async (req, res) => {
    const { name, license, agencyId, vehicle, status, meta } = req.body || {};
    try {
      const r = await pool.query('INSERT INTO drivers(name, license, agency_id, vehicle, status, meta) VALUES($1,$2,$3,$4,$5,$6) RETURNING id, name', [name, license, agencyId, vehicle, status, meta || {}]);
      wsBroadcast('drivers', { event: 'create', payload: r.rows[0] });
      res.json(r.rows[0]);
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
  });

  // Tickets
  app.get('/api/tickets', async (req, res) => {
    try {
      const r = await pool.query('SELECT id, sender, receiver, package_type, weight, declared_value, agency_id, driver_id, status, route, current_lat, current_lng, last_gps_update, created_at FROM tickets ORDER BY created_at DESC LIMIT 200');
      res.json(r.rows.map((row: any) => ({ id: row.id, ...row })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
  });
  app.post('/api/tickets', requireAuth, express.json(), async (req, res) => {
    const payload = req.body || {};
    try {
      const r = await pool.query('INSERT INTO tickets(sender, receiver, package_type, weight, declared_value, agency_id, driver_id, status, route, meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', [payload.sender || null, payload.receiver || null, payload.ptype || payload.package_type || null, payload.weight || null, payload.declaredValue || payload.declared_value || null, payload.agencyId || payload.agency_id || null, payload.driverId || payload.driver_id || null, payload.status || 'Created', payload.route || null, payload.meta || {}]);
      wsBroadcast('tickets', { event: 'create', payload: { id: r.rows[0].id, ...payload } });
      res.json({ id: r.rows[0].id, ...payload });
    } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
  });

  // Geocoding via Nominatim (open-source)
  app.get('/api/geocode', async (req, res) => {
    const q = String(req.query.q || '');
    if (!q) return res.status(400).json({ error: 'q required' });
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`;
      const r = await fetch(url, { headers: { 'User-Agent': 'RCTTS/1.0 (dev)' } });
      const data = await r.json();
      res.json(data);
    } catch (e) { console.error(e); res.status(500).json({ error: 'geocode failed' }); }
  });

  // Routing via OSRM public demo (note: for production host your own OSRM)
  app.get('/api/route', async (req, res) => {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });
    try {
      // expects "lat,lng"
      const coords = `${start};${end}`;
      const url = `http://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      const data = await r.json();
      res.json(data);
    } catch (e) { console.error(e); res.status(500).json({ error: 'route failed' }); }
  });

  // WebSocket state
  const wssClients: Set<any> = new Set();
  function wsBroadcast(topic: string, msg: any) {
    const payload = JSON.stringify({ topic, msg });
    for (const c of wssClients) {
      try { c.send(payload); } catch (e) { /* ignore */ }
    }
  }

  app.get("/api/fundraising", (req, res) => {
    res.json({
      success: true,
      goal: GOAL_AMOUNT,
      raised: raisedAmount,
      contributors: donorCount
    });
  });

  app.post("/api/fundraising/donate", (req, res) => {
    const { amount, phone } = req.body;
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid donation amount" });
    }
    raisedAmount += parsedAmount;
    donorCount += 1;
    res.json({
      success: true,
      goal: GOAL_AMOUNT,
      raised: raisedAmount,
      contributors: donorCount,
      message: `Successfully processed donation of RWF ${parsedAmount.toLocaleString()}`
    });
  });

  // Vite middleware for development
  // Ensure Postgres schema
  try {
    await ensureSchema();
    console.log('Postgres schema ensured.');
  } catch (e) {
    console.warn('Failed to ensure Postgres schema:', e);
  }
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Create HTTP server and attach WS server so both share same port
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (socket, req) => {
    console.log('WS client connected');
    wssClients.add(socket);
    socket.on('message', async (msg) => {
      // Expect driver GPS updates via WS: { type: 'gps', ticketId, driverId, lat, lng, speed }
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'gps' && parsed.ticketId) {
          await pool.query('INSERT INTO gps_updates(ticket_id, driver_id, lat, lng, speed) VALUES($1,$2,$3,$4,$5)', [parsed.ticketId, parsed.driverId || null, parsed.lat, parsed.lng, parsed.speed || null]);
          await pool.query('UPDATE tickets SET current_lat=$1, current_lng=$2, last_gps_update=now() WHERE id=$3', [parsed.lat, parsed.lng, parsed.ticketId]);
          wsBroadcast('tickets', { event: 'update', payload: { id: parsed.ticketId, currentLat: parsed.lat, currentLng: parsed.lng } });
        }
      } catch (e) { console.error('WS parse error', e); }
    });
    socket.on('close', () => { wssClients.delete(socket); console.log('WS client disconnected'); });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
