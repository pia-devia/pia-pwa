import { useState, useEffect, useCallback } from 'react';
import { X, Clock, CheckCircle, XCircle, Terminal, Globe, Mail, Bot, Cpu } from 'lucide-react';
import { getToken } from '../../api/client';
import DateTimePicker from './DateTimePicker';
import styles from './Pulse.module.css';

const TYPE_ICONS = {
  kai: Bot,
  'kai-agent': Cpu,
  script: Terminal,
  http: Globe,
  email: Mail,
};

const LIMIT_OPTIONS = [20, 50, 100];

function formatDateTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function parseCustomDate(str) {
  if (!str) return null;
  // Accept dd/mm/yyyy, dd/mm/yyyy hh:mm, dd/mm/yyyy hh:mm:ss
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return isNaN(date.getTime()) ? null : date;
}

async function fetchHistory({ limit, status, from, to }) {
  const headers = { Authorization: `Bearer ${getToken()}` };
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (status && status !== 'all') params.set('status', status);
  const fromDate = parseCustomDate(from);
  const toDate = parseCustomDate(to);
  if (fromDate) params.set('from', fromDate.toISOString().replace('T', ' ').slice(0, 19));
  if (toDate) params.set('to', toDate.toISOString().replace('T', ' ').slice(0, 19));

  // Fetch legacy + native in parallel
  const [legacyRes, nativeRes] = await Promise.all([
    fetch(`/api/cron/history?${params}`, { headers }).then(r => r.json()).catch(() => []),
    fetch('/api/cron-native/runs', { headers }).then(r => r.json()).catch(() => []),
  ]);

  const legacy = (Array.isArray(legacyRes) ? legacyRes : []).map(h => ({
    name: h.job_name || h.job_id,
    type: h.job_type || 'script',
    source: h.source || 'legacy',
    time: new Date(h.executed_at + (h.executed_at.endsWith('Z') ? '' : 'Z')),
    status: h.status,
    durationMs: h.duration_ms,
    resultText: h.result_text || '',
  }));

  let native = (Array.isArray(nativeRes) ? nativeRes : []).map(h => ({
    name: h.job_name || h.job_id,
    type: h.job_type || 'kai',
    source: h.source || 'native',
    time: new Date(h.executed_at + (h.executed_at.endsWith('Z') ? '' : 'Z')),
    status: h.status,
    durationMs: h.duration_ms,
    resultText: h.result_text || '',
  }));

  // Apply filters to native (backend doesn't filter these)
  if (status && status !== 'all') {
    native = native.filter(e => status === 'error' ? e.status !== 'ok' : e.status === 'ok');
  }
  if (fromDate) {
    native = native.filter(e => e.time >= fromDate);
  }
  if (toDate) {
    native = native.filter(e => e.time <= toDate);
  }

  const all = [...legacy, ...native].sort((a, b) => b.time - a.time);
  return all.slice(0, limit);
}

export default function GlobalHistory({ onClose }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(20);
  const [closing, setClosing] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => onClose(), 200);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchHistory({ limit, status: statusFilter, from: dateFrom, to: dateTo });
      setEntries(data);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  }, [limit, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    // Debounce date inputs, instant for status/limit
    const delay = (dateFrom || dateTo) ? 600 : 0;
    const timer = setTimeout(load, delay);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className={`${styles.overlay} ${closing ? styles.overlayOut : ''}`} onClick={handleClose}>
      <div className={`${styles.modal} ${styles.modalHistory100} ${closing ? styles.modalOut : ''}`} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Historial de ejecuciones</h2>
          <button className={styles.closeBtn} onClick={handleClose}><X size={18} /></button>
        </div>

        {/* Filters */}
        <div className={styles.globalHistoryFilters}>
          <div className={styles.globalHistoryStatusBtns}>
            {[
              { value: 'all', label: 'Todos' },
              { value: 'ok', label: 'OK' },
              { value: 'error', label: 'Error' },
            ].map(f => (
              <button
                key={f.value}
                className={`${styles.historyFilterBtn} ${statusFilter === f.value ? styles.historyFilterActive : ''}`}
                onClick={() => setStatusFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className={styles.globalHistoryDateCenter}>
            <DateTimePicker value={dateFrom} onChange={setDateFrom} placeholder="Desde" />
            <span className={styles.historyDateSep}>—</span>
            <DateTimePicker value={dateTo} onChange={setDateTo} placeholder="Hasta" />
          </div>
          <div className={styles.globalHistoryLimitBtns}>
            {LIMIT_OPTIONS.map(n => (
              <button
                key={n}
                className={`${styles.historyFilterBtn} ${limit === n ? styles.historyFilterActive : ''}`}
                onClick={() => setLimit(n)}
              >
                {n}
              </button>
            ))}
          </div>

        </div>

        {/* List */}
        <div className={styles.globalHistoryScroll}>
          {loading ? (
            <div className={styles.modalHistoryEmptyState}>
              <div className={styles.spinner} />
            </div>
          ) : entries.length === 0 ? (
            <div className={styles.modalHistoryEmptyState}>
              <Clock size={28} strokeWidth={1} />
              <p>Sin resultados</p>
            </div>
          ) : (
            entries.map((entry, i) => {
              const Icon = TYPE_ICONS[entry.type] || Terminal;
              return (
                <div key={i} className={styles.globalHistoryEntry}>
                  <div className={styles.globalHistoryIcon}>
                    {entry.status === 'error' ? (
                      <XCircle size={14} className={styles.modalHistoryErr} />
                    ) : (
                      <CheckCircle size={14} className={styles.modalHistoryOk} />
                    )}
                  </div>
                  <div className={styles.globalHistoryInfo}>
                    <span className={styles.globalHistoryName}>{entry.name}</span>
                    <span className={styles.globalHistoryMeta}>
                      <Icon size={11} />
                      {entry.source === 'native' && <span className={styles.metaSource}>openclaw</span>}
                      {entry.durationMs > 0 && <span>{formatDuration(entry.durationMs)}</span>}
                    </span>
                  </div>
                  <span className={styles.globalHistoryTime}>{formatDateTime(entry.time)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
