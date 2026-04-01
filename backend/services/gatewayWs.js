/**
 * gatewayWs.js — Persistent WebSocket connection to OpenClaw Gateway
 * 
 * Maintains a single WS connection, handles reconnect, and provides
 * methods for chat.history, chat.send, chat.abort.
 * 
 * Events from the gateway (chat deltas, agent events) are emitted
 * via an EventEmitter so routes can subscribe.
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1';
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18789;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const GATEWAY_URL = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}`;

class GatewayWs extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.pendingRequests = new Map(); // id → { resolve, reject, timer }
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.sessionDefaults = null;
    this._reqCounter = 0;
  }

  /** Start the connection (call once at boot) */
  start() {
    this._connect();
  }

  _connect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    console.log(`[gatewayWs] connecting to ${GATEWAY_URL}...`);
    this.ws = new WebSocket(GATEWAY_URL, {
      headers: { 'Origin': 'http://127.0.0.1' },
      handshakeTimeout: 10000,
    });

    this.ws.on('open', () => {
      console.log('[gatewayWs] WS open, waiting for challenge...');
    });

    this.ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this._handleMessage(msg);
    });

    this.ws.on('error', (err) => {
      console.error(`[gatewayWs] WS error: ${err.message}`);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[gatewayWs] WS closed: ${code} ${reason?.toString() || ''}`);
      this.connected = false;
      // Reject all pending requests
      for (const [id, req] of this.pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error('WS connection closed'));
      }
      this.pendingRequests.clear();
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[gatewayWs] reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  _handleMessage(msg) {
    // Challenge → send connect
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this._sendConnect();
      return;
    }

    // Response to a request
    if (msg.type === 'res' && msg.id) {
      // Special: connect response
      if (msg.id === '__connect__') {
        if (msg.ok) {
          console.log('[gatewayWs] connected to gateway!');
          this.connected = true;
          this.reconnectDelay = 1000;
          this.sessionDefaults = msg.payload?.snapshot?.sessionDefaults || null;
          this.emit('connected', this.sessionDefaults);
        } else {
          console.error('[gatewayWs] connect failed:', msg.error?.message);
          this.ws.close();
        }
        return;
      }

      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(msg.error?.message || 'Unknown error'));
        }
      }
      return;
    }

    // Events (chat, agent, tick, etc.)
    if (msg.type === 'event') {
      this.emit('gateway-event', msg);
      // Specific event routing
      if (msg.event === 'chat') {
        // console.log('[gatewayWs] chat event:', msg.payload?.state, 'runId:', msg.payload?.runId);
        this.emit('chat', msg.payload);
      } else if (msg.event === 'agent') {
        console.log('[gatewayWs] agent event:', msg.payload?.runId);
        this.emit('agent', msg.payload);
      }
    }
  }

  _sendConnect() {
    const frame = {
      type: 'req',
      id: '__connect__',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          version: '1.0.0',
          platform: 'linux',
          mode: 'backend',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: GATEWAY_TOKEN },
        locale: 'es-ES',
        userAgent: 'kai-pwa/1.0.0',
      },
    };
    this.ws.send(JSON.stringify(frame));
  }

  /** Send a request and return a promise for the response */
  _request(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        return reject(new Error('Not connected to gateway'));
      }
      const id = `r${++this._reqCounter}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  /** Get chat history for a session */
  async chatHistory(sessionKey, limit = 50) {
    return this._request('chat.history', { sessionKey, limit });
  }

  /** Send a chat message (non-blocking, returns runId) */
  async chatSend(sessionKey, message, options = {}) {
    const idempotencyKey = crypto.randomUUID();
    const params = {
      sessionKey,
      message,
      idempotencyKey,
      ...options,
    };
    // Pass attachments if provided (format: [{ name, mimeType, content }])
    if (options.attachments && options.attachments.length > 0) {
      params.attachments = options.attachments;
    }
    return this._request('chat.send', params);
  }

  /** Compact a session (maxLines forces compaction threshold) */
  async sessionCompact(sessionKey, maxLines) {
    const params = { key: sessionKey };
    if (maxLines != null) params.maxLines = maxLines;
    return this._request('sessions.compact', params);
  }

  /** Resolve session info (context, model, etc.) */
  async sessionResolve(sessionKey) {
    return this._request('sessions.resolve', { key: sessionKey });
  }

  /** Patch session settings (model, thinking, etc.) */
  async sessionPatch(sessionKey, patch = {}) {
    return this._request('sessions.patch', {
      key: sessionKey,
      ...patch,
    });
  }

  /** Get session context usage */
  async sessionUsage(sessionKey) {
    return this._request('sessions.usage', { key: sessionKey });
  }

  /** Abort an active run */
  async chatAbort(sessionKey) {
    return this._request('chat.abort', { sessionKey });
  }

  /** Check if connected */
  isConnected() {
    return this.connected;
  }

  /** Get the default session key */
  getMainSessionKey() {
    return this.sessionDefaults?.mainSessionKey || 'agent:main:main';
  }
}

// Singleton
const gateway = new GatewayWs();
module.exports = gateway;
