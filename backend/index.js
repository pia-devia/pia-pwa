const express = require('express');
const cors = require('cors');
const path = require('path');
const { WebSocketServer } = require('ws');
const { URL } = require('url');

const { port } = require('./config/env');
const { verifyToken } = require('./middlewares/auth');
const { initWatcher, addClient, removeClient } = require('./services/watcherService');

const authRoutes = require('./routes/auth');
const agentsRoutes = require('./routes/agents');
const filesRoutes = require('./routes/files');
const tasksRoutes = require('./routes/tasks');
const eventsRoutes = require('./routes/events');
const systemRoutes = require('./routes/system');
const chatRoutes   = require('./routes/chat-v2');
const vaultRoutes  = require('./routes/vault');
const cronRoutes       = require('./routes/cron');
const cronNativeRoutes = require('./routes/cronNative');
const spotifyRoutes    = require('./routes/spotify');
const briefingRoutes   = require('./routes/briefing');
const projectsRoutes   = require('./routes/projects');
const cronService      = require('./services/cronService');

// Initialize SQLite database (creates tables + seed data on first run)
require('./db');

// Initialize Express
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/chat',   chatRoutes);
app.use('/api/vault',  vaultRoutes);
app.use('/api/cron',        cronRoutes);
app.use('/api/cron-native', cronNativeRoutes);
app.use('/api/spotify',     spotifyRoutes);
app.use('/api/briefing',   briefingRoutes);
app.use('/api/projects',   projectsRoutes);

// ── PMP App Reverse Proxy ────────────────────────────────────
// Proxy /pmp/* → PMP container on port 3002
const http = require('http');
app.use('/pmp', (req, res) => {
  const targetPath = req.url === '' ? '/' : req.url;
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 3002,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:3002' }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => res.status(502).send('PMP app unavailable'));
  req.pipe(proxyReq);
});
// ─────────────────────────────────────────────────────────────

// ── Devia Model SPA ─────────────────────────────────────────
// MUST be registered BEFORE express.static(frontendDist) to avoid
// collision with /app/public/deviamodel/ if that path ever exists.
// Legacy: devia now has its own container at devia.kaidevia.com:3003
// This route kept for backwards compatibility with kaidevia.com/deviamodel
const deviaModelPath = '/app/devia-model-web/dist';
app.use('/deviamodel', express.static(deviaModelPath));
app.get(['/deviamodel', '/deviamodel/', '/deviamodel/*'], (req, res) => {
  res.sendFile(path.join(deviaModelPath, 'index.html'));
});
// ────────────────────────────────────────────────────────────

// Serve static frontend (./public in Docker, ../frontend/dist in dev)
const frontendDist = process.env.NODE_ENV === 'production' 
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..', 'frontend', 'dist');

app.use(express.static(frontendDist));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Start Gateway WebSocket connection
const gatewayWs = require('./services/gatewayWs');
gatewayWs.start();

// Start HTTP server
const server = app.listen(port, () => {
  console.log(`🚀 KAI DOC PWA server running on http://localhost:${port}`);
});

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  // Verify token from query string
  const url = new URL(req.url, `http://localhost:${port}`);
  const token = url.searchParams.get('token');

  if (!token || !verifyToken(token)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  addClient(ws);

  ws.on('close', () => {
    removeClient(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    removeClient(ws);
  });

  // Send welcome message
  ws.send(JSON.stringify({ type: 'connected' }));
});

// Initialize file watcher
initWatcher();

// Start cron scheduler
cronService.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close();
  process.exit(0);
});
