const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// ── Config ──────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'https://kai.devia.team/api/spotify/callback';
const TOKEN_FILE = path.join(__dirname, '..', 'data', 'spotify_tokens.json');
const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-read',
  'user-library-modify',
].join(' ');

// ── Token persistence ───────────────────────────────────────────────────────
let tokens = null;

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch {}
}

function saveTokens(t) {
  tokens = t;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
}

loadTokens();

// ── Token refresh ───────────────────────────────────────────────────────────
async function refreshAccessToken() {
  if (!tokens?.refresh_token) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body,
  });
  if (!res.ok) return null;
  const data = await res.json();
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  });
  return tokens.access_token;
}

async function getAccessToken() {
  if (!tokens) return null;
  if (Date.now() > (tokens.expires_at || 0)) {
    return refreshAccessToken();
  }
  return tokens.access_token;
}

// ── Spotify API helper ──────────────────────────────────────────────────────
async function spotifyFetch(endpoint, options = {}) {
  const token = await getAccessToken();
  if (!token) return { error: 'not_authenticated', status: 401 };
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (res.status === 204) return { ok: true, status: 204 };
  if (res.status === 401) {
    // Try refresh once
    const newToken = await refreshAccessToken();
    if (!newToken) return { error: 'token_expired', status: 401 };
    const retry = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...options,
      headers: { Authorization: `Bearer ${newToken}`, ...options.headers },
    });
    if (retry.status === 204) return { ok: true, status: 204 };
    if (!retry.ok) return { error: 'spotify_error', status: retry.status };
    const retryText = await retry.text();
    let retryData = null;
    try { retryData = retryText ? JSON.parse(retryText) : null; } catch {}
    return { data: retryData, status: retry.status };
  }
  if (!res.ok) {
    const errText = await res.text();
    return { error: 'spotify_error', status: res.status, detail: errText };
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { data, status: res.status };
}

// ── Routes ──────────────────────────────────────────────────────────────────

// GET /api/spotify/status — check if authenticated
router.get('/status', (req, res) => {
  res.json({ authenticated: !!tokens?.access_token });
});

// GET /api/spotify/authorize — redirect to Spotify OAuth
router.get('/authorize', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    show_dialog: 'true',
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// GET /api/spotify/callback — OAuth callback
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Spotify denied: ${error}`);
  if (!code) return res.status(400).send('Missing code');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    });
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
      body,
    });
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(500).send(`Token exchange failed: ${err}`);
    }
    const data = await tokenRes.json();
    saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
    });
    res.send('<html><body style="background:#0a0a0f;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>Spotify conectado — puedes cerrar esta pestaña</h2></body></html>');
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// GET /api/spotify/now-playing — currently playing track
router.get('/now-playing', async (req, res) => {
  const result = await spotifyFetch('/me/player/currently-playing');
  if (result.error) return res.status(result.status).json(result);
  if (result.status === 204 || !result.data) return res.json({ playing: false });

  const d = result.data;
  const track = d.item;
  if (!track) return res.json({ playing: false });

  // Check if track is liked
  const likeResult = await spotifyFetch(`/me/tracks/contains?ids=${track.id}`);
  const isLiked = likeResult.data?.[0] || false;

  res.json({
    playing: d.is_playing,
    track: {
      id: track.id,
      name: track.name,
      artist: track.artists?.map(a => a.name).join(', ') || '',
      album: track.album?.name || '',
      image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null,
      duration: track.duration_ms,
      progress: d.progress_ms,
      liked: isLiked,
    },
  });
});

// POST /api/spotify/play — resume playback
router.post('/play', async (req, res) => {
  const result = await spotifyFetch('/me/player/play', { method: 'PUT' });
  res.status(result.status || 200).json(result);
});

// POST /api/spotify/pause — pause playback
router.post('/pause', async (req, res) => {
  const result = await spotifyFetch('/me/player/pause', { method: 'PUT' });
  res.status(result.status || 200).json(result);
});

// POST /api/spotify/next — skip to next
router.post('/next', async (req, res) => {
  const result = await spotifyFetch('/me/player/next', { method: 'POST' });
  res.status(result.status || 200).json(result);
});

// POST /api/spotify/prev — skip to previous
router.post('/prev', async (req, res) => {
  const result = await spotifyFetch('/me/player/previous', { method: 'POST' });
  res.status(result.status || 200).json(result);
});

// POST /api/spotify/like — save track to library
router.post('/like', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'missing track id' });
  const result = await spotifyFetch('/me/tracks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  });
  res.status(result.status || 200).json(result);
});

// POST /api/spotify/unlike — remove track from library
router.post('/unlike', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'missing track id' });
  const result = await spotifyFetch('/me/tracks', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  });
  res.status(result.status || 200).json(result);
});

module.exports = router;
