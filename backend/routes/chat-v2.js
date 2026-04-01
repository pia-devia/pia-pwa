/**
 * chat-v2.js — Chat routes using native Gateway WebSocket protocol
 * 
 * Replaces the old chat.js that used /v1/chat/completions with manual
 * system prompt + history management. Now everything goes through the
 * gateway's native chat.send / chat.history / chat.abort.
 * 
 * Endpoints:
 *   GET  /api/chat/history   → fetch history from gateway
 *   POST /api/chat/send      → send message, stream response via SSE
 *   POST /api/chat/abort     → abort current run
 *   GET  /api/chat/status    → connection status
 */

const express = require('express');
const gateway = require('../services/gatewayWs');
const router = express.Router();

// ── GET /api/chat/status ─────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    connected: gateway.isConnected(),
    sessionKey: 'webchat:chat:guille',
  });
});

// ── GET /api/chat/history ────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const sessionKey = req.query.sessionKey || 'webchat:chat:guille';
    const result = await gateway.chatHistory(sessionKey, limit);
    
    // Transform gateway format to simpler format for frontend
    const messages = (result.messages || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        let content = '';
        if (typeof m.content === 'string') {
          content = m.content;
        } else if (Array.isArray(m.content)) {
          content = m.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        }
        return {
          role: m.role,
          content,
          timestamp: m.timestamp || null,
        };
      })
      .filter(m => m.content.trim().length > 0);
    
    res.json({
      sessionKey: result.sessionKey,
      messages,
    });
  } catch (err) {
    console.error('[chat-v2] history error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/chat/send ──────────────────────────────────────────────────
// SSE stream: emits delta events as the agent responds
router.post('/send', async (req, res) => {
  const { message, sessionKey: reqSessionKey, attachments } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  const sessionKey = reqSessionKey || 'webchat:chat:guille';

  // Validate and transform attachments for the gateway
  let gatewayAttachments = undefined;
  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    if (attachments.length > 4) {
      return res.status(400).json({ error: 'Maximum 4 images per message' });
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    gatewayAttachments = attachments
      .filter(a => a.type === 'image' && allowedTypes.includes(a.mimeType))
      .map((a, i) => ({
        name: `image-${i + 1}.${a.mimeType.split('/')[1]}`,
        mimeType: a.mimeType,
        content: a.data, // base64
      }));
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  
  let runId = null;
  let accumulated = '';
  let finished = false;
  let bufferedEvents = []; // Buffer events until runId is set

  const cleanup = () => {
      gateway.removeListener('chat', onChat);
    gateway.removeListener('agent', onAgent);
  };

  let disconnectInterval = null;

  const finish = (state, extra = {}) => {
    if (finished) return;
    finished = true;
    if (disconnectInterval) clearInterval(disconnectInterval);
    cleanup();
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: state, content: accumulated, ...extra })}\n\n`);
      res.end();
    }
  };

  const processEvent = async (payload) => {

    if (payload.state === 'delta') {
      // Delta may or may not have message content
      let text = '';
      const msg = payload.message;
      if (msg) {
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('');
        }
      }
      if (text) {
        accumulated = text;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'delta', content: accumulated })}\n\n`);
        }
      }
    } else if (payload.state === 'final') {
      // Final: extract text from payload.message or fetch from history
      let text = '';
      const msg = payload.message;
      if (msg) {
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('');
        }
      }

      // If no text in final event, fetch last message from history
      if (!text && !accumulated) {
        try {
          const hist = await gateway.chatHistory(sessionKey, 3);
          const msgs = (hist.messages || []).filter(m => m.role === 'assistant');
          const last = msgs[msgs.length - 1];
          if (last) {
            if (typeof last.content === 'string') {
              text = last.content;
            } else if (Array.isArray(last.content)) {
              text = last.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('');
            }
          }
        } catch (e) {
          console.error('[chat-v2] history fetch after final:', e.message);
        }
      }

      finish('done', { content: text || accumulated });
    } else if (payload.state === 'aborted') {
      finish('aborted', { content: accumulated });
    } else if (payload.state === 'error') {
      finish('error', { error: payload.errorMessage || 'Unknown error' });
    }
  };

  // Listen for chat events from gateway
  const onChat = async (payload) => {
    // Gateway may prefix sessionKey with 'agent:main:'
    if (!payload.sessionKey) return;
    if (payload.sessionKey !== sessionKey && !payload.sessionKey.endsWith(sessionKey)) return;
    
    // If runId not set yet, buffer the event
    if (!runId) {
      bufferedEvents.push(payload);
      return;
    }
    if (payload.runId !== runId) return;
    await processEvent(payload);
  };

  const onAgent = (payload) => {
    // Agent events (tool calls, etc.) — forward status to client
    if (!runId || payload.runId !== runId) return;
    if (!res.writableEnded) {
      // Send lightweight status updates
      const status = payload.status || payload.state;
      if (status) {
        res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
      }
    }
  };

  gateway.on('chat', onChat);
  gateway.on('agent', onAgent);

  // Keep SSE connection alive
  const keepAlive = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      clearInterval(keepAlive);
      if (!finished) cleanup();
      return;
    }
    // Send SSE comment to keep connection alive
    try { res.write(': keepalive\n\n'); } catch {}
  }, 5000);
  disconnectInterval = keepAlive;

  // Send the message
  try {
    const sendOptions = {};
    if (gatewayAttachments && gatewayAttachments.length > 0) {
      sendOptions.attachments = gatewayAttachments;
    }
    const result = await gateway.chatSend(sessionKey, message.trim(), sendOptions);
    runId = result.runId;
    
    // Send ack with runId
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'ack', runId })}\n\n`);
    }

    // Drain buffered events that arrived before runId was set
    for (const evt of bufferedEvents) {
      if (evt.runId === runId) {
        await processEvent(evt);
      }
    }
    bufferedEvents = [];

    // If already done (very fast response or in_flight)
    if (result.status === 'ok') {
      // Response was immediate — fetch from history
      try {
        const hist = await gateway.chatHistory(sessionKey, 3);
        const msgs = (hist.messages || []).filter(m => m.role === 'assistant');
        const last = msgs[msgs.length - 1];
        let text = '';
        if (last) {
          if (typeof last.content === 'string') text = last.content;
          else if (Array.isArray(last.content)) {
            text = last.content.filter(c => c.type === 'text').map(c => c.text).join('');
          }
        }
        finish('done', { content: text });
      } catch (e) {
        finish('done', { content: accumulated });
      }
    }
  } catch (err) {
    console.error('[chat-v2] send error:', err.message);
    finish('error', { error: err.message });
  }

  // No safety timeout — user controls via abort button
});

// ── POST /api/chat/abort ─────────────────────────────────────────────────
router.post('/abort', async (req, res) => {
  try {
    const sessionKey = req.body.sessionKey || 'webchat:chat:guille';
    await gateway.chatAbort(sessionKey);
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat-v2] abort error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/chat/usage ───────────────────────────────────────────────────
// Get context usage for the webchat session
router.get('/usage', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const raw = execSync('openclaw sessions 2>&1', { encoding: 'utf8', timeout: 5000 });
    
    // Parse the line for our webchat session
    const line = raw.split('\n').find(l => l.includes('webch') && l.includes('guille'));
    if (!line) {
      return res.json({ contextPercent: null, contextUsed: null, contextMax: null, compactions: 0 });
    }

    // Extract tokens: "41k/200k (21%)"
    const tokenMatch = line.match(/(\d+)k\/(\d+)k\s+\((\d+)%\)/);
    if (!tokenMatch) {
      return res.json({ contextPercent: null, contextUsed: null, contextMax: null, compactions: 0 });
    }

    res.json({
      contextPercent: parseInt(tokenMatch[3]),
      contextUsed: parseInt(tokenMatch[1]) * 1000,
      contextMax: parseInt(tokenMatch[2]) * 1000,
      compactions: 0,
    });
  } catch (err) {
    console.error('[chat-v2] usage error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/chat/model ───────────────────────────────────────────────────
// Get current model for the webchat session
router.get('/model', async (req, res) => {
  try {
    const sessionKey = req.query.sessionKey || 'webchat:chat:guille';
    // Use sessions.patch with no changes to get current state — not ideal
    // Instead, we'll store the model locally and return it
    res.json({ model: currentModel || 'anthropic/claude-opus-4-6' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/chat/model ──────────────────────────────────────────────────
// Set model for the webchat session
let currentModel = 'anthropic/claude-opus-4-6';

router.post('/model', async (req, res) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model required' });

    const allowed = [
      'anthropic/claude-sonnet-4-20250514',
      'anthropic/claude-opus-4-6',
    ];
    if (!allowed.includes(model)) {
      return res.status(400).json({ error: `Model not allowed. Use: ${allowed.join(', ')}` });
    }

    const sessionKey = req.body.sessionKey || 'webchat:chat:guille';
    await gateway.sessionPatch(sessionKey, { model });
    currentModel = model;
    res.json({ ok: true, model });
  } catch (err) {
    console.error('[chat-v2] model error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/chat/flush ──────────────────────────────────────────────────
// Full flush cycle: raw context backup → summary → compact
router.post('/flush', async (req, res) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');

  const sessionKey = 'agent:main:webchat:chat:guille';
  const workspace = '/home/kai/.openclaw/workspace';
  const steps = [];

  try {
    // 1. Determine date and paths (Europe/Madrid)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const dateStr = now.toISOString().slice(0, 10);
    const hhmm = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        const [year, month, day] = dateStr.split('-');
    const dailyDir = path.join(workspace, 'DAILY_MEMORIES', year, month, day);
    const compDir = path.join(dailyDir, 'compressions');
    
    fs.mkdirSync(compDir, { recursive: true });
    steps.push('dirs_created');

    // 2. Find session .jsonl file
    const sessionsRaw = execSync('openclaw sessions 2>&1', { encoding: 'utf8', timeout: 5000 });
    const sessLine = sessionsRaw.split('\n').find(l => l.includes('webch') && l.includes('guille'));
    
    // Get session ID from sessions list
    const idMatch = sessLine?.match(/id:([a-f0-9-]+)/);
    const sessionId = idMatch?.[1];
    const jsonlPath = sessionId 
      ? `/home/kai/.openclaw/agents/main/sessions/${sessionId}.jsonl`
      : null;

    // 3. Raw context copy → HH-MM_raw-context.md
    if (jsonlPath && fs.existsSync(jsonlPath)) {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.trim().split('\n');
      
      let md = `# Raw Context Backup — ${dateStr} ${hhmm.replace('-', ':')}\n\n`;
      md += `**Session:** ${sessionKey}\n`;
      md += `**Messages:** ${lines.length}\n\n---\n\n`;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'session') {
            md += `## Session Start — ${entry.timestamp}\n\n`;
            continue;
          }
          if (entry.type !== 'message') continue;
          
          const msg = entry.message;
          if (!msg) continue;
          
          const ts = entry.timestamp || '';
          const role = msg.role?.toUpperCase() || '?';
          
          md += `### ${role} — ${ts}\n\n`;
          
          // Extract text content
          if (typeof msg.content === 'string') {
            md += msg.content + '\n\n';
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'text') {
                md += part.text + '\n\n';
              } else if (part.type === 'tool_use') {
                md += `**Tool call:** \`${part.name}\`\n\`\`\`json\n${JSON.stringify(part.input, null, 2).slice(0, 500)}\n\`\`\`\n\n`;
              } else if (part.type === 'tool_result') {
                const txt = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
                md += `**Tool result:** \`\`\`\n${txt.slice(0, 300)}\n\`\`\`\n\n`;
              } else if (part.type === 'thinking') {
                // Skip thinking blocks
              }
            }
          }
        } catch {}
      }

      const rawPath = path.join(compDir, `${hhmm}_raw-context.md`);
      fs.writeFileSync(rawPath, md);
      steps.push('raw_context_saved');
    } else {
      steps.push('raw_context_skipped_no_file');
    }

    // 4. Summary → HH-MM_summary.md (extract key topics from user messages)
    if (jsonlPath && fs.existsSync(jsonlPath)) {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.trim().split('\n');
      
      let summary = `# Session Summary — ${dateStr} ${hhmm.replace('-', ':')}\n\n`;
      summary += `**Session:** webchat:chat:guille\n\n`;
      summary += `## Temas tratados\n\n`;

      let userMsgs = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'message') continue;
          const msg = entry.message;
          if (msg?.role !== 'user') continue;
          
          let text = '';
          if (typeof msg.content === 'string') text = msg.content;
          else if (Array.isArray(msg.content)) {
            text = msg.content.filter(p => p.type === 'text').map(p => p.text).join(' ');
          }
          // Skip metadata-only messages
          text = text.replace(/Sender \(untrusted.*?\n```json\n[\s\S]*?```\n*/g, '').trim();
          if (text && text.length > 10) {
            userMsgs.push(text.slice(0, 200));
          }
        } catch {}
      }

      for (const msg of userMsgs) {
        summary += `- ${msg.replace(/\n/g, ' ')}\n`;
      }

      summary += `\n## Estadísticas\n\n`;
      summary += `- Total mensajes en transcript: ${lines.length}\n`;
      summary += `- Mensajes del usuario: ${userMsgs.length}\n`;
      
      const tokenMatch = sessLine?.match(/(\d+)k\/(\d+)k\s+\((\d+)%\)/);
      if (tokenMatch) {
        summary += `- Contexto pre-compact: ${tokenMatch[1]}k/${tokenMatch[2]}k (${tokenMatch[3]}%)\n`;
      }

      const summaryPath = path.join(compDir, `${hhmm}_summary.md`);
      fs.writeFileSync(summaryPath, summary);
      steps.push('summary_saved');
    }

    // 5. Compact the session via gateway WS
    try {
      console.log('[chat-v2] compacting session:', sessionKey);
      const compactResult = await gateway.sessionCompact(sessionKey);
      console.log('[chat-v2] compact result:', JSON.stringify(compactResult));
      steps.push('compact_done');
    } catch (compactErr) {
      console.error('[chat-v2] compact failed:', compactErr.message);
      steps.push(`compact_error: ${compactErr.message?.slice(0, 100)}`);
    }

    res.json({ ok: true, steps });
  } catch (err) {
    console.error('[chat-v2] flush error:', err.message);
    res.status(500).json({ error: err.message, steps });
  }
});

module.exports = router;
