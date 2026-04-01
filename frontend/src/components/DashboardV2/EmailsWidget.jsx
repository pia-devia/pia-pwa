import { useState, useEffect, useCallback } from 'react';
import { Mail } from 'lucide-react';
import { getToken } from '../../api/client';
import EmailModal from './EmailModal';
import styles from './EmailsWidget.module.css';

const API = '/api/system/inbox';
const OWN_ADDRESS = 'kai.live.dev@gmail.com';

function auth() {
  return { Authorization: `Bearer ${getToken()}` };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffH = diffMs / 3_600_000;
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`;
  if (diffH < 24) return `${Math.floor(diffH)}h`;
  if (diffH < 48) return 'ayer';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function parseAddress(raw) {
  if (!raw) return { name: '', email: '' };
  const match = raw.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: raw, email: raw };
}

export default function EmailsWidget() {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch(`${API}?limit=15`, { headers: auth() });
      if (!res.ok) return;
      const data = await res.json();
      setEmails(data.emails || []);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), 60000);
    return () => clearInterval(id);
  }, [load]);

  const unreadCount = emails.filter(e => !e.isRead && parseAddress(e.from).email.toLowerCase() !== OWN_ADDRESS).length;

  return (
    <div
      className={styles.widget}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={styles.header}>
        <h3 className={styles.title}>Correo</h3>
        {refreshing && <span className={styles.updating}>Actualizando mail</span>}
      </div>

      {/* Privacy overlay */}
      {!loading && emails.length > 0 && (
        <div className={`${styles.privacy} ${hovered ? styles.privacyHidden : ''}`}>
          <Mail size={48} strokeWidth={1} className={`${styles.privacyIcon} ${unreadCount > 0 ? styles.privacyIconPulse : ''}`} />
          {unreadCount > 0 && (
            <span className={styles.badge}>{unreadCount}</span>
          )}
          <span className={styles.privacyText}>
            {unreadCount > 0 ? `${unreadCount} sin leer` : 'Sin correos nuevos'}
          </span>
        </div>
      )}

      {loading ? (
        <div className={styles.empty}><div className={styles.spinner} /></div>
      ) : emails.length === 0 ? (
        <div className={styles.empty}>
          <Mail size={28} strokeWidth={1} />
          <span>Bandeja vacía</span>
        </div>
      ) : (
        <ul className={styles.list}>
          {emails.map((email, i) => {
            const from = parseAddress(email.from);
            const isSelf = from.email.toLowerCase() === OWN_ADDRESS;
            const displayName = isSelf ? 'Yo' : (from.name || from.email);
            const isUnread = !email.isRead && !isSelf;

            return (
              <li key={email.uid || i} className={`${styles.item} ${isUnread ? styles.unread : ''}`} onClick={() => setSelectedEmail(email)}>
                <div className={styles.link}>
                  <div className={`${styles.avatar} ${isUnread ? styles.avatarUnread : ''} ${isSelf ? styles.avatarSelf : ''}`}>
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className={styles.content}>
                    <div className={styles.topRow}>
                      <span className={styles.from}>{displayName}</span>
                      <span className={styles.date}>{formatDate(email.date)}</span>
                    </div>
                    <div className={styles.subject}>{email.subject}</div>
                    {email.snippet && <div className={styles.snippet}>{email.snippet}</div>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selectedEmail && <EmailModal email={selectedEmail} onClose={() => setSelectedEmail(null)} onUpdate={() => load(true)} />}
    </div>
  );
}
