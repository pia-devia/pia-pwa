import { useState, useEffect, useCallback } from 'react';
import { Zap } from 'lucide-react';
import { getToken } from '../../api/client';
import styles from './SubscriptionWidget.module.css';

export default function SubscriptionWidget({ compact }) {
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      if (manual) {
        // Trigger real sync from claude.ai
        await fetch('/api/system/claude-web-sync', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
        });
      }
      const res = await fetch('/api/system/claude-web-limits', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) setData(await res.json());
    } catch {} finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  if (!data) return null;
  const profile = data.profiles?.personal;
  if (!profile?.updated_at) return null;

  const sessionColor = (profile.session_pct ?? 0) >= 80 ? 'var(--danger, #ff6b6b)' : undefined;

  return (
    <div className={styles.row}>
      <div className={styles.sep} />
      <Zap size={13} strokeWidth={1.5} className={`${styles.icon} ${refreshing ? styles.spinning : ''}`}
        onClick={() => load(true)} style={{ cursor: 'pointer' }} title="Actualizar" />
      {!compact && <span className={styles.label}>Anthropic</span>}
      {refreshing ? (
        <span className={styles.sub}>actualizando...</span>
      ) : (
        <>
          <span className={styles.tipWrap}>
            <span className={styles.value} style={{ color: sessionColor }}>
              {profile.session_pct ?? 0}%
            </span>
            {!compact && <span className={styles.sub}>sesión</span>}
            {profile.session_resets_in && <span className={styles.tip}>Renueva en {profile.session_resets_in}</span>}
          </span>
          <span className={styles.tipWrap}>
            <span className={styles.value}>{profile.weekly_all_pct ?? 0}%</span>
            {!compact && <span className={styles.sub}>semana</span>}
            {profile.weekly_resets_at && <span className={styles.tip}>Renueva {profile.weekly_resets_at}</span>}
          </span>
        </>
      )}
    </div>
  );
}
