import { useState, useEffect, useCallback } from 'react';
import { X, ExternalLink, User, MailCheck, Trash2 } from 'lucide-react';
import { getToken } from '../../api/client';
import styles from './EmailModal.module.css';

function parseAddress(raw) {
  if (!raw) return { name: '', email: '' };
  const match = raw.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: raw, email: raw };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

export default function EmailModal({ email, onClose, onUpdate }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [markedRead, setMarkedRead] = useState(false);

  const auth = { Authorization: `Bearer ${getToken()}` };

  const handleMarkRead = async () => {
    setMarking(true);
    try {
      await fetch(`/api/system/inbox/${email.uid}/read`, { method: 'POST', headers: auth });
      setMarkedRead(true);
      if (onUpdate) onUpdate();
    } catch {} finally { setMarking(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetch(`/api/system/inbox/${email.uid}`, { method: 'DELETE', headers: auth });
      if (onUpdate) onUpdate();
      handleClose();
    } catch {} finally { setDeleting(false); }
  };

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleClose]);

  useEffect(() => {
    if (!email?.uid) return;
    (async () => {
      try {
        const res = await fetch(`/api/system/inbox/${email.uid}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) setDetail(await res.json());
      } catch {} finally {
        setLoading(false);
      }
    })();
  }, [email?.uid]);

  if (!email) return null;
  const from = parseAddress(email.from);

  return (
    <div className={`${styles.backdrop} ${closing ? styles.backdropOut : ''}`} onClick={handleClose}>
      <div className={`${styles.modal} ${closing ? styles.modalOut : ''}`} onClick={e => e.stopPropagation()}>
        {/* Fixed header */}
        <div className={styles.header}>
          <div className={styles.avatar}>
            <User size={20} strokeWidth={1.5} />
          </div>
          <div className={styles.headerInfo}>
            <div className={styles.fromRow}>
              <span className={styles.fromName}>{from.name || from.email}</span>
              <span className={styles.date}>{formatDate(email.date)}</span>
            </div>
            <span className={styles.fromEmail}>{from.email}</span>
            <h2 className={styles.subject}>{email.subject}</h2>
          </div>

        </div>

        {/* Scrollable body */}
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}><div className={styles.spinner} /></div>
          ) : detail?.htmlBody ? (
            <div
              className={styles.htmlContent}
              dangerouslySetInnerHTML={{ __html: detail.htmlBody }}
            />
          ) : (
            <pre className={styles.textContent}>
              {detail?.textBody || email.snippet || 'Sin contenido'}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerActions}>
            {!email.isRead && !markedRead && (
              <button className={styles.actionBtn} onClick={handleMarkRead} disabled={marking}>
                <MailCheck size={14} />
                {marking ? 'Marcando...' : 'Marcar leído'}
              </button>
            )}
            <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={handleDelete} disabled={deleting}>
              <Trash2 size={14} />
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
          <a href={email.gmailLink} target="_blank" rel="noopener noreferrer" className={styles.gmailBtn}>
            Abrir en Gmail <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}
