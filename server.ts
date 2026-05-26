import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { pool, ensureSchema } from './server/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory fundraising state (synced for the live session)
  let raisedAmount = 420000;
  let donorCount = 14;
  const GOAL_AMOUNT = 1000000;

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "RCTTS Server is running" });
  });

  // Generic collection endpoints backed by Postgres `documents` table
  // List
  app.get('/api/:collection', async (req, res) => {
    const { collection } = req.params;
    try {
      const result = await pool.query('SELECT doc_id, data, created_at, updated_at FROM documents WHERE collection=$1 ORDER BY created_at DESC', [collection]);
      const docs = result.rows.map(r => ({ id: r.doc_id, ...r.data, createdAt: r.created_at, updatedAt: r.updated_at }));
      res.json(docs);
    } catch (e) {
      console.error('List error', e);
      res.status(500).json({ error: 'Failed to fetch collection' });
    }
  });

  // Create
  app.post('/api/:collection', async (req, res) => {
    const { collection } = req.params;
    const payload = req.body || {};
    const docId = req.body.id || require('crypto').randomUUID();
    try {
      await pool.query(`INSERT INTO documents(collection, doc_id, data) VALUES($1, $2, $3) ON CONFLICT (collection, doc_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [collection, docId, payload]);
      // broadcast
      broadcast(collection, 'create', { id: docId, ...payload });
      res.json({ id: docId, ...payload });
    } catch (e) {
      console.error('Create error', e);
      res.status(500).json({ error: 'Failed to create document' });
    }
  });

  // Update
  app.put('/api/:collection/:id', async (req, res) => {
    const { collection, id } = req.params;
    const payload = req.body || {};
    try {
      await pool.query('UPDATE documents SET data = $1, updated_at = now() WHERE collection=$2 AND doc_id=$3', [payload, collection, id]);
      broadcast(collection, 'update', { id, ...payload });
      res.json({ id, ...payload });
    } catch (e) {
      console.error('Update error', e);
      res.status(500).json({ error: 'Failed to update document' });
    }
  });

  // Delete
  app.delete('/api/:collection/:id', async (req, res) => {
    const { collection, id } = req.params;
    try {
      await pool.query('DELETE FROM documents WHERE collection=$1 AND doc_id=$2', [collection, id]);
      broadcast(collection, 'delete', { id });
      res.json({ success: true });
    } catch (e) {
      console.error('Delete error', e);
      res.status(500).json({ error: 'Failed to delete' });
    }
  });

  // Server-Sent Events stream for live updates
  const streams: Record<string, Set<express.Response>> = {};

  function broadcast(collection: string, eventType: string, payload: any) {
    const clients = streams[collection];
    if (!clients) return;
    const data = JSON.stringify({ event: eventType, payload });
    for (const res of clients) {
      try {
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${data}\n\n`);
      } catch (e) {
        console.warn('Failed to write to SSE client', e);
      }
    }
  }

  app.get('/api/stream', (req, res) => {
    const topic = String(req.query.topic || '');
    if (!topic) return res.status(400).json({ error: 'topic query required' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    streams[topic] = streams[topic] || new Set();
    streams[topic].add(res);

    // keep connection alive
    const keepAlive = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      streams[topic].delete(res);
    });
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
