import { useState, useEffect, useCallback } from 'react';
import { Cpu, MemoryStick, HardDrive, Clock } from 'lucide-react';
import { getToken } from '../../api/client';
import styles from './HardwareWidget.module.css';

function mbToGb(mb) { return (mb / 1024).toFixed(1); }
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function MiniBar({ percent }) {
  const color = percent >= 85 ? 'var(--danger, #ff6b6b)' : percent >= 60 ? 'var(--warning, #ffa94d)' : 'var(--accent)';
  return (
    <div className={styles.bar}>
      <div className={styles.barFill} style={{ width: `${Math.min(percent, 100)}%`, background: color }} />
    </div>
  );
}

function Metric({ icon: Icon, label, percent, detail, noBar, compact }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={styles.metric}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon size={14} strokeWidth={1.5} className={styles.icon} />
      {!compact && <span className={styles.label}>{label}</span>}
      <span className={styles.value}>{percent}</span>
      {detail && hovered && (
        <span className={styles.tooltip}>{detail}</span>
      )}
    </div>
  );
}

export default function HardwareWidget({ compact }) {
  const [metrics, setMetrics] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/system/metrics', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) setMetrics(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (!metrics) return null;
  const { cpu, memory, disk, uptime } = metrics;

  return (
    <div className={styles.row}>
      <Metric icon={Cpu} label="CPU" percent={`${cpu.usage}%`} detail={`${cpu.usage}% · ${cpu.cores} cores`} compact={compact} />
      <div className={styles.sep} />
      <Metric icon={MemoryStick} label="RAM" percent={`${memory.percent}%`} detail={`${mbToGb(memory.used)} / ${mbToGb(memory.total)} GB`} compact={compact} />
      <div className={styles.sep} />
      <Metric icon={HardDrive} label="Disco" percent={`${disk.percent}%`} detail={`${disk.used} / ${disk.total} GB · ${disk.free} GB libre`} compact={compact} />
      <div className={styles.sep} />
      <Metric icon={Clock} label="Uptime" percent={formatUptime(uptime)} noBar compact={compact} />
    </div>
  );
}
