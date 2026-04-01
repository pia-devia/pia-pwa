import { useState, useEffect, useMemo } from 'react';
import { Bot, Cpu, Terminal, Globe, Mail } from 'lucide-react';
import useCrons from '../Pulse/hooks/useCrons';
import useCronSchedule from '../Pulse/hooks/useCronSchedule';
import styles from './CronsWidget.module.css';

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

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export default function CronsWidget() {
  const { jobs, history: historyData } = useCrons();
  const { executions } = useCronSchedule(jobs, historyData);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => {
    return executions.filter(e => e.time > now).slice(0, 5);
  }, [executions, now]);

  return (
    <div className={styles.widget}>
      <h3 className={styles.label}>Próximos crons</h3>
      {items.length === 0 ? (
        <div className={styles.empty}>Sin ejecuciones programadas</div>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => {
            const color = TYPE_COLORS[item.type] || 'var(--text-secondary)';
            const Icon = TYPE_ICONS[item.type] || Terminal;
            return (
              <li key={`${item.id}-${item.time}`} className={styles.item}>
                <div className={styles.dot} style={{ background: color, boxShadow: `0 0 6px ${color}` }}>
                  <Icon size={10} strokeWidth={2} />
                </div>
                <span className={styles.name}>{item.name}</span>
                <span className={styles.time}>{formatTime(item.time)}</span>
                <span className={styles.countdown} style={{ color }}>{formatCountdown(item.time - now)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
