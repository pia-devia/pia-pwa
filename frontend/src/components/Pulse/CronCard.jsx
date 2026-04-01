import { Play, Pause, Check, Clock, Terminal, Globe, Mail, Bot, Cpu } from 'lucide-react';
import styles from './Pulse.module.css';

const TYPE_ICONS = {
  script: Terminal,
  http: Globe,
  email: Mail,
  kai: Bot,
  'kai-agent': Cpu,
};

const TYPE_LABELS = {
  script: 'script',
  http: 'http',
  email: 'email',
  kai: 'kai',
  'kai-agent': 'agent',
};

function timeAgo(date) {
  if (!date) return null;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function CronCard({ job, onEdit, onToggle, onRun, running, disabled: isDisabledStyle, style }) {
  const isRunning = job.status === 'running' || running;
  const isError = job.status === 'error';
  const TypeIcon = TYPE_ICONS[job.type] || Terminal;
  const ago = timeAgo(job.lastRun);

  return (
    <li className={`${styles.card} ${isDisabledStyle ? styles.cardDisabled : ''}`} style={style}>
      <div className={styles.cardBody} onClick={onEdit}>
        <div className={styles.cardIcon}>
          <TypeIcon size={16} />
        </div>
        <div className={styles.cardInfo}>
          <div className={styles.cardHeader}>
            <span
              className={`${styles.statusDot} ${
                isRunning ? styles.dotRunning
                : isError ? styles.dotError
                : job.enabled ? styles.dotIdle
                : styles.dotDisabled
              }`}
            />
            <span className={styles.cardName}>{job.name}</span>
          </div>
          {job.description && <p className={styles.cardDesc}>{job.description}</p>}
          <div className={styles.cardMeta}>
            <span className={styles.metaChip}>
              <Clock size={11} /> {job.scheduleDisplay}
            </span>
            <span className={styles.metaType}>{TYPE_LABELS[job.type] || job.type}</span>
            {job.source === 'native' && <span className={styles.metaSource}>openclaw</span>}
            {job.oneShot && <span className={styles.metaOneShot}>única</span>}
            {ago && <span className={styles.metaTime}>Última: {ago}</span>}
            {job.runCount > 0 && <span className={styles.metaRuns}>{job.runCount}x</span>}
            {isError && <span className={styles.errorBadge}>Error</span>}
          </div>
        </div>
        <div className={styles.cardActions} onClick={e => e.stopPropagation()}>
          <button
            className={`${styles.iconBtn} ${isRunning ? styles.spinning : ''}`}
            onClick={onRun}
            disabled={isRunning}
            title="Ejecutar ahora"
          >
            <Play size={14} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={onToggle}
            title={job.enabled ? 'Pausar' : 'Activar'}
          >
            {job.enabled ? <Pause size={14} /> : <Check size={14} />}
          </button>
        </div>
      </div>
    </li>
  );
}
