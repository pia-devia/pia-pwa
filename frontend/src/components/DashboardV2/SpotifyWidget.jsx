import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Music } from 'lucide-react';
import { getToken } from '../../api/client';
import styles from './SpotifyWidget.module.css';

function auth() {
  return { Authorization: `Bearer ${getToken()}` };
}

export default function SpotifyWidget() {
  const [status, setStatus] = useState(null);
  const [acting, setActing] = useState(false);
  const pendingRef = useRef(null);

  const fetchNow = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/now-playing', { headers: auth() });
      if (res.status === 401) { setStatus(false); return; }
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const statusRes = await fetch('/api/spotify/status', { headers: auth() });
        const statusData = await statusRes.json();
        if (!statusData.authenticated) { setStatus(false); return; }
        fetchNow();
      } catch { setStatus(false); }
    })();
  }, [fetchNow]);

  const action = async (endpoint) => {
    if (acting) return;
    setActing(true);

    if (pendingRef.current) { clearTimeout(pendingRef.current); pendingRef.current = null; }

    // Optimistic update
    if (status?.track) {
      if (endpoint === 'pause') setStatus(s => ({ ...s, playing: false }));
      if (endpoint === 'play') setStatus(s => ({ ...s, playing: true }));
    }

    try {
      await fetch(`/api/spotify/${endpoint}`, {
        method: 'POST',
        headers: auth(),
      });
      pendingRef.current = setTimeout(fetchNow, 1500);
    } catch {} finally {
      setActing(false);
    }
  };

  if (status === null) {
    return <div className={styles.widget}><div className={styles.empty}><div className={styles.spinner} /></div></div>;
  }

  if (status === false) {
    return (
      <div className={styles.widget}>
        <div className={styles.empty}>
          <Music size={24} strokeWidth={1.5} />
          <a href="/api/spotify/authorize" className={styles.connectBtn}>Conectar Spotify</a>
        </div>
      </div>
    );
  }

  if (!status.playing && !status.track) {
    return (
      <div className={styles.widget} onClick={fetchNow} style={{ cursor: 'pointer' }}>
        <div className={styles.empty}>
          <Music size={18} strokeWidth={1.5} />
          <span>Sin reproducción</span>
        </div>
      </div>
    );
  }

  const t = status.track;

  return (
    <div className={styles.widget} onClick={fetchNow} style={{ cursor: 'pointer' }}>
      {t.image && <img src={t.image} alt="" className={styles.cover} />}
      {t.image && <img src={t.image} alt="" className={styles.coverThumb} />}
      <div className={styles.info}>
        <div className={styles.track}>{t.name}</div>
        <div className={styles.artist}>{t.artist}</div>
      </div>
      <div className={styles.controls} onClick={e => e.stopPropagation()}>
        <button className={styles.ctrlBtn} onClick={() => action('prev')} disabled={acting}>
          <SkipBack size={18} />
        </button>
        <button className={styles.ctrlBtnMain} onClick={() => action(status.playing ? 'pause' : 'play')} disabled={acting}>
          {status.playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className={styles.ctrlBtn} onClick={() => action('next')} disabled={acting}>
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  );
}
