import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Brain } from 'lucide-react';
import { getToken } from '../../api/client';
import styles from './ModelSelector.module.css';

const MODELS = [
  { id: 'anthropic/claude-sonnet-4-20250514', short: 'Sonnet', color: '#F5C518' },
  { id: 'anthropic/claude-opus-4-6', short: 'Opus', color: '#845EF7' },
];

function auth() { return { Authorization: `Bearer ${getToken()}` }; }

function resolve(modelId) {
  return MODELS.find(m => modelId?.includes(m.short.toLowerCase())) || MODELS[1];
}

export default function ModelSelector({ compact }) {
  const [current, setCurrent] = useState(null);
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/system/model', { headers: auth() });
        if (res.ok) {
          const { model } = await res.json();
          setCurrent(resolve(model));
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const change = async (m) => {
    if (changing || m.id === current?.id) { setOpen(false); return; }
    setChanging(true);
    setOpen(false);
    try {
      // Change default model
      const res = await fetch('/api/system/model', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m.id }),
      });
      // Also change webchat session model (hot swap)
      await fetch('/api/chat/model', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m.id }),
      }).catch(() => {});
      if (res.ok) setCurrent(m);
    } catch {}
    setChanging(false);
  };

  if (!current) return null;

  return (
    <div className={styles.wrapper} ref={ref}>
      <div className={styles.sep} />
      <button className={styles.trigger} onClick={() => setOpen(!open)} disabled={changing}>
        <Brain size={13} strokeWidth={1.5} className={styles.icon} />
        {!compact && <span className={styles.label}>Modelo</span>}
        <span className={styles.current} style={{ color: changing ? 'rgba(255,255,255,0.4)' : current.color }}>
          {changing ? '...' : current.short}
        </span>
        <ChevronDown size={11} className={`${styles.arrow} ${open ? styles.arrowUp : ''}`} />
      </button>
      {open && (
        <div className={styles.dropdown}>
          {MODELS.map(m => (
            <button key={m.id}
              className={`${styles.option} ${m.id === current.id ? styles.optionActive : ''}`}
              onClick={() => change(m)}>
              <span className={styles.optionDot} style={{ background: m.color }} />
              <span style={{ color: m.color }}>{m.short}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
