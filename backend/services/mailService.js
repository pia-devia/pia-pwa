const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

const IMAP_CONFIG = {
  imap: {
    user: 'kai.live.dev@gmail.com',
    password: 'ihvhfodgkrncnkay',
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
  }
};

// Cache to avoid hammering IMAP
let _cache = { emails: [], unread: 0, lastFetch: 0 };
const CACHE_TTL = 60_000; // 1 minute

/**
 * Fetch recent emails from INBOX
 * @param {number} limit - max emails to return
 * @returns {{ emails: Array, unread: number }}
 */
async function fetchInbox(limit = 20) {
  const now = Date.now();
  if (now - _cache.lastFetch < CACHE_TTL && _cache.emails.length >= 0) {
    return { emails: _cache.emails, unread: _cache.unread };
  }

  let conn;
  try {
    conn = await imaps.connect(IMAP_CONFIG);
    const box = await conn.openBox('INBOX');
    const unread = box.messages.unseen || 0;

    // Fetch recent emails (last N by sequence number)
    const totalMessages = box.messages.total;
    if (totalMessages === 0) {
      _cache = { emails: [], unread: 0, lastFetch: now };
      conn.end();
      return { emails: [], unread: 0 };
    }

    // Search for recent messages
    const searchCriteria = ['ALL'];
    const fetchOptions = {
      bodies: ['HEADER', ''],
      struct: true,
      markSeen: false,
    };

    const msgs = await conn.search(searchCriteria, fetchOptions);

    // Sort by UID descending (newest first) and take limit
    msgs.sort((a, b) => (b.attributes.uid || 0) - (a.attributes.uid || 0));
    const recent = msgs.slice(0, limit);

    const emails = [];
    for (const msg of recent) {
      const header = msg.parts.find(p => p.which === 'HEADER');
      const fullBody = msg.parts.find(p => p.which === '');
      
      let snippet = '';
      if (fullBody?.body) {
        try {
          const parsed = await simpleParser(fullBody.body);
          snippet = (parsed.text || parsed.html?.replace(/<[^>]+>/g, '') || '').slice(0, 200).trim();
        } catch {}
      }

      const flags = msg.attributes.flags || [];
      const isRead = flags.includes('\\Seen');
      const uid = msg.attributes.uid;
      const messageId = header?.body?.['message-id']?.[0] || '';

      // Gmail web link: https://mail.google.com/mail/u/0/#inbox/<hex-message-id>
      // We'll use a search-based link which is more reliable
      const gmailLink = `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}`;

      emails.push({
        uid,
        from: header?.body?.from?.[0] || '',
        to: header?.body?.to?.[0] || '',
        subject: header?.body?.subject?.[0] || '(sin asunto)',
        date: header?.body?.date?.[0] || '',
        snippet,
        isRead,
        messageId,
        gmailLink,
      });
    }

    conn.end();
    _cache = { emails, unread, lastFetch: now };
    return { emails, unread };
  } catch (err) {
    if (conn) try { conn.end(); } catch {}
    console.error('[mail] fetchInbox error:', err.message);
    // Return cache on error
    if (_cache.emails.length > 0) return { emails: _cache.emails, unread: _cache.unread };
    throw err;
  }
}

/**
 * Invalidate cache (after sending, etc.)
 */
function invalidateCache() {
  _cache.lastFetch = 0;
}

/**
 * Fetch a single email by UID with full body
 */
async function fetchEmail(uid) {
  let conn;
  try {
    conn = await imaps.connect(IMAP_CONFIG);
    await conn.openBox('INBOX');

    const msgs = await conn.search([['UID', String(uid)]], {
      bodies: ['HEADER', ''],
      struct: true,
      markSeen: false,
    });

    if (msgs.length === 0) { conn.end(); return null; }

    const msg = msgs[0];
    const header = msg.parts.find(p => p.which === 'HEADER');
    const fullBody = msg.parts.find(p => p.which === '');

    let textBody = '';
    let htmlBody = '';
    if (fullBody?.body) {
      try {
        const parsed = await simpleParser(fullBody.body);
        textBody = parsed.text || '';
        htmlBody = parsed.html || '';
      } catch {}
    }

    const flags = msg.attributes.flags || [];
    const messageId = header?.body?.['message-id']?.[0] || '';
    const gmailLink = `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}`;

    conn.end();
    return {
      uid,
      from: header?.body?.from?.[0] || '',
      to: header?.body?.to?.[0] || '',
      subject: header?.body?.subject?.[0] || '(sin asunto)',
      date: header?.body?.date?.[0] || '',
      isRead: flags.includes('\\Seen'),
      messageId,
      gmailLink,
      textBody,
      htmlBody,
    };
  } catch (err) {
    if (conn) try { conn.end(); } catch {}
    throw err;
  }
}

/**
 * Mark email as read by UID
 */
async function markAsRead(uid) {
  let conn;
  try {
    conn = await imaps.connect(IMAP_CONFIG);
    await conn.openBox('INBOX');
    await conn.addFlags(uid, ['\\Seen']);
    conn.end();
    invalidateCache();
  } catch (err) {
    if (conn) try { conn.end(); } catch {}
    throw err;
  }
}

/**
 * Delete email by UID (move to Trash)
 */
async function deleteEmail(uid) {
  let conn;
  try {
    conn = await imaps.connect(IMAP_CONFIG);
    await conn.openBox('INBOX');
    await conn.moveMessage(uid, '[Gmail]/Trash');
    conn.end();
    invalidateCache();
  } catch (err) {
    if (conn) try { conn.end(); } catch {}
    throw err;
  }
}

module.exports = { fetchInbox, fetchEmail, markAsRead, deleteEmail, invalidateCache };
