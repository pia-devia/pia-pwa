const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { jwtSecret, jwtExpiry, telegramBotToken, telegramChatId } = require('../config/env');
const { authMiddleware } = require('../middlewares/auth');
const db = require('../db');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Send a message via Telegram Bot API
 */
async function sendTelegramMessage(text, code) {
  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramChatId, text, ...(code ? { reply_markup: { inline_keyboard: [[{ text: code, copy_text: { text: code } }]] } } : {}) }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram API error: ${err}`);
  }
  return response.json();
}

// ─── POST /api/auth/request-otp ───────────────────────────────────────────
/**
 * Generate a 6-digit OTP, store it, and send it to Guille via Telegram.
 * Rate limiting: if there's already an active (unused, non-expired) code,
 * we invalidate it and generate a fresh one.
 */
router.post('/request-otp', async (req, res) => {
  try {
    // Invalidate any existing active codes
    db.prepare(`
      UPDATE otp_codes SET used = 1
      WHERE used = 0 AND expires_at > datetime('now')
    `).run();

    // Generate a secure 6-digit OTP (100000–999999)
    const code = String(crypto.randomInt(100000, 999999));

    // Store it with 10-minute expiry
    db.prepare(`
      INSERT INTO otp_codes (code, used, expires_at)
      VALUES (?, 0, datetime('now', '+10 minutes'))
    `).run(code);

    // Send via Telegram
    await sendTelegramMessage(`🔐 CODIGO DE ACCESO`, code);

    res.json({ ok: true });
  } catch (err) {
    console.error('OTP request error:', err.message);
    res.status(500).json({ error: 'No se pudo enviar el código. Inténtalo de nuevo.' });
  }
});

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────
/**
 * Verify OTP code and return a JWT on success.
 * Body: { code: string }
 */
router.post('/verify-otp', (req, res) => {
  const { code } = req.body;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Código requerido' });
  }

  const row = db.prepare(`
    SELECT id FROM otp_codes
    WHERE code = ? AND used = 0 AND expires_at > datetime('now')
    LIMIT 1
  `).get(code.trim());

  if (!row) {
    return res.status(401).json({ error: 'Código incorrecto o expirado' });
  }

  // Mark code as used
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);

  // Issue JWT valid for 365 days
  const token = jwt.sign({ user: 'guille' }, jwtSecret, { expiresIn: jwtExpiry });

  res.json({ token });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────
/**
 * Logout — client drops the token. Server-side is stateless (JWT).
 * Requires valid JWT to prevent abuse.
 */
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
