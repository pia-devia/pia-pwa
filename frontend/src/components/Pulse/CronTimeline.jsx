import { useState, useEffect, useMemo } from 'react';
import { Bot, Cpu, Terminal, Globe, Mail, History } from 'lucide-react';
import styles from './Pulse.module.css';

const TYPE_COLORS = {
  kai: 'var(--accent)',
  'kai-agent': '#E8B310',
  script: '#8AAD18',
  http: '#4A7A10',
  email: '#A07808',
};

const TYPE_ICONS = {
  kai: Bot,
  'kai-agent': Cpu,
  script: Terminal,
  http: Globe,
  email: Mail,
};

export default function CronTimeline({ executions, onShowHistory, onEdit }) {
  const [now, setNow] = useState(Date.now());
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => {
    return executions
      .filter(e => e.time > now)
      .slice(0, 8);
  }, [executions, now]);

  if (items.length === 0) {
    return (
      <div className={styles.timelineSection}>
        <div className={styles.timelineHeader}>
          <h3 className={styles.sectionLabel}>Próximas ejecuciones</h3>
          <button className={styles.historyBtn} onClick={onShowHistory} title="Historial global">
            <History size={14} />
          </button>
        </div>
        <div className={styles.timelineEmpty}>No hay ejecuciones programadas</div>
      </div>
    );
  }

  const rangeStart = now;
  const rangeEnd = items[items.length - 1].time;
  const rangeDuration = rangeEnd - rangeStart;
  const padding = rangeDuration * 0.1;
  const totalRange = rangeDuration + padding;

  const NOW_POS = 6;
  const MARKER_START = 10;
  const MARKER_END = 96;

  function getPosition(time) {
    const pct = (time - rangeStart) / totalRange;
    return Math.max(MARKER_START, MARKER_START + pct * (MARKER_END - MARKER_START));
  }

  function formatCountdown(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  }

  return (
    <div className={styles.timelineSection}>
      <div className={styles.timelineHeader}>
        <h3 className={styles.sectionLabel}>Próximas ejecuciones</h3>
        <button className={styles.historyBtn} onClick={onShowHistory} title="Historial global">
          <History size={14} />
        </button>
      </div>
      <div className={styles.timeline}>
        <span className={styles.timelineNowLabel}>ahora</span>
        <span className={styles.timelineNowDot} />
        <div className={styles.timelineLine} />

        {items.map((item, i) => {
          const pos = getPosition(item.time);
          const isTop = i % 2 === 0;
          const color = TYPE_COLORS[item.type] || 'var(--text-secondary)';
          const Icon = TYPE_ICONS[item.type] || Terminal;
          const isHovered = hovered === item.id + item.time;

          return (
            <div
              key={`${item.id}-${item.time}`}
              className={`${styles.timelineMarker} ${isTop ? styles.timelineTop : styles.timelineBottom}`}
              onMouseEnter={() => setHovered(item.id + item.time)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onEdit?.(item.id)}
              style={{ left: `${pos}%`, cursor: 'pointer' }}
            >
              <span className={styles.timelineCountdown} style={{ color }}>
                {formatCountdown(item.time - now)}
              </span>
              <div className={styles.timelineNode} style={{ background: color, boxShadow: `0 0 10px ${color}`, pointerEvents: 'none' }}>
                <Icon size={13} strokeWidth={2} />
              </div>
              <div className={styles.timelineConnector} style={{ background: color }} />
              {isHovered && (
                <div className={styles.timelineTooltip}>
                  {item.name}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
