import { useState, useEffect } from 'react';
import { X, Trash2, Terminal, Globe, Mail, Bot, Cpu, CheckCircle, XCircle, Clock } from 'lucide-react';
import DateTimePicker from './DateTimePicker';
import styles from './Pulse.module.css';

const TASK_TYPES = [
  { value: 'kai', label: 'Pia', icon: Bot, desc: 'Pia interpreta y ejecuta la tarea' },
  { value: 'kai-agent', label: 'Agente', icon: Cpu, desc: 'Sesión aislada de agente autónomo' },
  { value: 'script', label: 'Script', icon: Terminal, desc: 'Ejecuta un comando en el servidor' },
  { value: 'http', label: 'HTTP', icon: Globe, desc: 'Petición HTTP a una URL' },
  { value: 'email', label: 'Email', icon: Mail, desc: 'Envía un email automático' },
];

const QUICK_INTERVALS = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
];

// Detect if a cron expression is a daily "0 H * * *" pattern
function isDailyCron(expr) {
  if (!expr) return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  return min === '0' && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*';
}

function cronToTime(expr) {
  if (!expr) return '08:00';
  const parts = expr.trim().split(/\s+/);
  const hour = parseInt(parts[1], 10);
  const min = parseInt(parts[0], 10);
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function minutesToCron(m) {
  if (m <= 0) return '*/30 * * * *';
  if (m < 60) return `*/${m} * * * *`;
  if (m === 60) return '0 * * * *';
  if (m < 1440) return `0 */${Math.round(m / 60)} * * *`;
  return '0 9 * * *';
}

function cronToMinutes(cron) {
  if (!cron) return 30;
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 30;
  const [min, hour] = parts;
  if (min.startsWith('*/')) return parseInt(min.slice(2), 10);
  if (hour.startsWith('*/') && min === '0') return parseInt(hour.slice(2), 10) * 60;
  if (hour === '*' && min === '0') return 60;
  return 30;
}

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

export default function CronForm({ job, onSave, onClose, onDelete, history = [] }) {
  const isEdit = !!job;

  const [historyFilter, setHistoryFilter] = useState('all'); // all | ok | error
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function parseCustomDate(str) {
    if (!str) return null;
    const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
    const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
    return isNaN(date.getTime()) ? null : date;
  }

  const filteredHistory = history.filter(entry => {
    if (historyFilter === 'ok' && entry.status !== 'ok') return false;
    if (historyFilter === 'error' && entry.status === 'ok') return false;
    const fromDate = parseCustomDate(dateFrom);
    const toDate = parseCustomDate(dateTo);
    if (fromDate && entry.time < fromDate) return false;
    if (toDate && entry.time > toDate) return false;
    return true;
  });

  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'kai',
    interval: 30,
    scheduleMode: 'interval',
    dailyTime: '08:00',
    enabled: true,
    oneShot: false,
    scheduleStart: false,
    startAt: '',
    instruction: '',
    agentMessage: '',
    model: '',
    command: '',
    url: '',
    method: 'GET',
    emailTo: '',
    emailSubject: '',
    emailBody: '',
  });

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => onClose(), 200);
  };

  useEffect(() => {
    if (!job) return;
    const base = {
      name: job.name || '',
      description: job.description || '',
      type: job.type || 'kai',
      enabled: job.enabled,
      interval: job.source === 'legacy' ? cronToMinutes(job.schedule) : everyMsToMinutes(job._raw?.schedule),
      scheduleMode: (job.source === 'native' && job._raw?.schedule?.kind === 'cron' && isDailyCron(job._raw.schedule.expr))
        ? 'daily'
        : (job.source === 'legacy' && isDailyCron(job.schedule))
          ? 'daily'
          : 'interval',
      dailyTime: (job.source === 'native' && job._raw?.schedule?.kind === 'cron' && isDailyCron(job._raw.schedule.expr))
        ? cronToTime(job._raw.schedule.expr)
        : (job.source === 'legacy' && isDailyCron(job.schedule))
          ? cronToTime(job.schedule)
          : '08:00',
    };

    const cfg = job.config || {};
    if (job.type === 'kai') base.instruction = cfg.instruction || '';
    if (job.type === 'kai-agent') { base.agentMessage = cfg.message || ''; base.model = cfg.model || ''; }
    if (job.type === 'script') base.command = cfg.command || '';
    if (job.type === 'http') { base.url = cfg.url || ''; base.method = cfg.method || 'GET'; }
    if (job.type === 'email') { base.emailTo = cfg.to || ''; base.emailSubject = cfg.subject || ''; base.emailBody = cfg.body || ''; }

    setForm(f => ({ ...f, ...base }));
  }, [job]);

  function everyMsToMinutes(sched) {
    if (!sched) return 30;
    if (sched.kind === 'every') return Math.round((sched.everyMs || 1800000) / 60000);
    if (sched.kind === 'cron') return cronToMinutes(sched.expr);
    return 30;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const isNative = form.type === 'kai' || form.type === 'kai-agent';

      if (isNative) {
        if (isEdit && job.source === 'native') {
          const schedule = form.scheduleMode === 'daily'
            ? { kind: 'cron', expr: `${parseInt(form.dailyTime.split(':')[1], 10)} ${parseInt(form.dailyTime.split(':')[0], 10)} * * *`, tz: 'Europe/Madrid' }
            : { kind: 'every', everyMs: form.interval * 60000 };
          const changes = {
            name: form.name,
            enabled: form.enabled,
            schedule,
          };
          if (form.type === 'kai') changes.payload = { kind: 'systemEvent', text: form.instruction };
          if (form.type === 'kai-agent') {
            changes.payload = { kind: 'agentTurn', message: form.agentMessage };
            if (form.model) changes.payload.model = form.model;
          }
          await onSave({ ...changes, _isUpdate: true, _job: job });
        } else {
          const newSchedule = form.scheduleMode === 'daily'
            ? { scheduleType: 'cron', schedule: `${parseInt(form.dailyTime.split(':')[1], 10)} ${parseInt(form.dailyTime.split(':')[0], 10)} * * *`, tz: 'Europe/Madrid' }
            : { scheduleType: form.oneShot ? 'at' : 'every', every: `${form.interval}m`, at: form.oneShot ? `${form.interval}m` : undefined };
          await onSave({
            type: form.type,
            name: form.name,
            description: form.description,
            ...newSchedule,
            startAt: form.scheduleStart && form.startAt ? (() => {
              const m = form.startAt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
              return m ? new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]).toISOString() : new Date(form.startAt).toISOString();
            })() : undefined,
            enabled: form.scheduleStart ? false : form.enabled,
            config: form.type === 'kai'
              ? { instruction: form.instruction || form.description }
              : { message: form.agentMessage || form.description, model: form.model },
          });
        }
      } else {
        let taskConfig;
        switch (form.type) {
          case 'script': taskConfig = { command: form.command }; break;
          case 'http': taskConfig = { url: form.url, method: form.method }; break;
          case 'email': taskConfig = { to: form.emailTo, subject: form.emailSubject, body: form.emailBody }; break;
          default: taskConfig = {};
        }

        const cronSchedule = form.scheduleMode === 'daily'
          ? `${parseInt(form.dailyTime.split(':')[1], 10)} ${parseInt(form.dailyTime.split(':')[0], 10)} * * *`
          : minutesToCron(form.interval);

        const payload = {
          name: form.name,
          description: form.description,
          schedule: cronSchedule,
          task_type: form.type,
          task_config: JSON.stringify(taskConfig),
          enabled: form.scheduleStart ? 0 : (form.enabled ? 1 : 0),
          one_shot: form.oneShot ? 1 : 0,
        };
        if (form.scheduleStart && form.startAt) {
          // Parse dd/mm/yyyy HH:mm format
          const m = form.startAt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
          if (m) {
            payload.starts_at = new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]).toISOString();
          } else {
            payload.starts_at = new Date(form.startAt).toISOString();
          }
        }

        if (isEdit && job.source === 'legacy') {
          await onSave({ _legacyPayload: payload, _isUpdate: true, _job: job });
        } else {
          await onSave({ _legacyPayload: payload });
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const canSave = () => {
    if (!form.name) return false;
    switch (form.type) {
      case 'kai': return !!(form.instruction || form.description);
      case 'kai-agent': return !!(form.agentMessage || form.description);
      case 'script': return !!form.command;
      case 'http': return !!form.url;
      case 'email': return !!form.emailTo && !!form.emailSubject;
      default: return true;
    }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const taskMeta = TASK_TYPES.find(t => t.value === form.type);

  return (
    <div className={`${styles.overlay} ${closing ? styles.overlayOut : ''}`} onClick={handleClose}>
      <div className={`${styles.modal} ${isEdit ? styles.modalWide : ''} ${closing ? styles.modalOut : ''}`} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? 'Editar Cron' : 'Nuevo Cron'}</h2>
          <button className={styles.closeBtn} onClick={handleClose}><X size={18} /></button>
        </div>

        <div className={isEdit ? styles.modalSplit : ''}>
          {/* Left: Form */}
          <div className={styles.modalBody}>
            <label className={styles.fieldLabel}>Nombre</label>
            <input className={styles.input} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Nombre del cron job" />

            <label className={styles.fieldLabel}>Descripción</label>
            <input className={styles.input} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Qué hace este cron" />

            <label className={styles.fieldLabel}>Frecuencia</label>
            <div className={styles.intervalRow}>
              <div className={styles.quickBtns}>
                {QUICK_INTERVALS.map(({ label, minutes }) => (
                  <button key={minutes} className={`${styles.quickBtn} ${form.scheduleMode === 'interval' && form.interval === minutes ? styles.quickActive : ''}`} onClick={() => { set('scheduleMode', 'interval'); set('interval', minutes); }}>
                    {label}
                  </button>
                ))}
                <button className={`${styles.quickBtn} ${form.scheduleMode === 'daily' ? styles.quickActive : ''}`} onClick={() => set('scheduleMode', 'daily')}>
                  Diario
                </button>
              </div>
              {form.scheduleMode === 'interval' && (
                <div className={styles.customInterval}>
                  <span className={styles.intervalPrefix}>Cada</span>
                  <input type="number" className={styles.intervalInput} value={form.interval} min={1} onChange={e => set('interval', Math.max(1, parseInt(e.target.value, 10) || 1))} />
                  <span className={styles.intervalSuffix}>minutos</span>
                </div>
              )}
              {form.scheduleMode === 'daily' && (
                <div className={styles.dailyTimeRow}>
                  <span className={styles.intervalPrefix}>Todos los días a las</span>
                  <select
                    className={styles.timeSelect}
                    value={form.dailyTime.split(':')[0]}
                    onChange={e => set('dailyTime', `${e.target.value}:${form.dailyTime.split(':')[1]}`)}
                  >
                    {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <span className={styles.timeSep}>:</span>
                  <select
                    className={styles.timeSelect}
                    value={form.dailyTime.split(':')[1]}
                    onChange={e => set('dailyTime', `${form.dailyTime.split(':')[0]}:${e.target.value}`)}
                  >
                    {['00', '15', '30', '45'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <label className={styles.fieldLabel}>Tipo de tarea</label>
            <div className={styles.typeGrid}>
              {TASK_TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.value} className={`${styles.typeCard} ${form.type === t.value ? styles.typeActive : ''}`} onClick={() => set('type', t.value)}>
                    <Icon size={18} />
                    <span className={styles.typeLabel}>{t.label}</span>
                  </button>
                );
              })}
            </div>
            <p className={styles.typeHint}>{taskMeta?.desc}</p>

            {form.type === 'kai' && (
              <>
                <label className={styles.fieldLabel}>Instrucción para Pia</label>
                <textarea className={styles.textarea} value={form.instruction} onChange={e => set('instruction', e.target.value)} placeholder="Describe qué quieres que Pia haga..." rows={4} />
              </>
            )}

            {form.type === 'kai-agent' && (
              <>
                <label className={styles.fieldLabel}>Mensaje para el agente</label>
                <textarea className={styles.textarea} value={form.agentMessage} onChange={e => set('agentMessage', e.target.value)} placeholder="Tarea para el agente aislado..." rows={4} />
                <label className={styles.fieldLabel}>Modelo (opcional)</label>
                <input className={styles.input} value={form.model} onChange={e => set('model', e.target.value)} placeholder="anthropic/claude-sonnet-4-20250514" />
              </>
            )}

            {form.type === 'script' && (
              <>
                <label className={styles.fieldLabel}>Comando</label>
                <input className={styles.inputMono} value={form.command} onChange={e => set('command', e.target.value)} placeholder="node /home/pia/scripts/my-script.js" spellCheck={false} />
              </>
            )}

            {form.type === 'http' && (
              <>
                <label className={styles.fieldLabel}>URL</label>
                <input className={styles.inputMono} value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://api.example.com/webhook" spellCheck={false} />
                <label className={styles.fieldLabel}>Método</label>
                <div className={styles.methodRow}>
                  {['GET', 'POST', 'PUT'].map(m => (
                    <button key={m} className={`${styles.quickBtn} ${form.method === m ? styles.quickActive : ''}`} onClick={() => set('method', m)}>{m}</button>
                  ))}
                </div>
              </>
            )}

            {form.type === 'email' && (
              <>
                <label className={styles.fieldLabel}>Destinatario</label>
                <input className={styles.input} value={form.emailTo} onChange={e => set('emailTo', e.target.value)} placeholder="guille@email.com" />
                <label className={styles.fieldLabel}>Asunto</label>
                <input className={styles.input} value={form.emailSubject} onChange={e => set('emailSubject', e.target.value)} placeholder="Informe..." />
                <label className={styles.fieldLabel}>Cuerpo</label>
                <textarea className={styles.textarea} value={form.emailBody} onChange={e => set('emailBody', e.target.value)} placeholder="Contenido del email..." rows={4} />
              </>
            )}

            <div className={styles.toggleRow}>
              <label className={styles.fieldLabel} style={{ margin: 0 }}>Ejecución única</label>
              <button className={`${styles.toggle} ${form.oneShot ? styles.toggleOn : ''}`} onClick={() => set('oneShot', !form.oneShot)}>
                <div className={styles.toggleKnob} />
              </button>
            </div>
            {form.oneShot && <p className={styles.typeHint}>Se ejecutará una vez y se desactivará automáticamente.</p>}

            <div className={styles.toggleRow}>
              <label className={styles.fieldLabel} style={{ margin: 0 }}>Programar inicio</label>
              <button className={`${styles.toggle} ${form.scheduleStart ? styles.toggleOn : ''}`} onClick={() => set('scheduleStart', !form.scheduleStart)}>
                <div className={styles.toggleKnob} />
              </button>
            </div>
            {form.scheduleStart && (
              <>
                <label className={styles.fieldLabel}>Arranca a partir de</label>
                <DateTimePicker value={form.startAt} onChange={v => set('startAt', v)} placeholder="dd/mm/aaaa, --:--" />
                <p className={styles.typeHint}>El cron se creará desactivado y se activará automáticamente en esta fecha.</p>
              </>
            )}

            {!form.scheduleStart && (
              <div className={styles.toggleRow}>
                <label className={styles.fieldLabel} style={{ margin: 0 }}>Activado</label>
                <button className={`${styles.toggle} ${form.enabled ? styles.toggleOn : ''}`} onClick={() => set('enabled', !form.enabled)}>
                  <div className={styles.toggleKnob} />
                </button>
              </div>
            )}

            {isEdit && job.lastResult && (
              <>
                <label className={styles.fieldLabel}>Última ejecución</label>
                <pre className={styles.resultBox}>{job.lastResult}</pre>
              </>
            )}
          </div>

          {/* Right: History (only in edit mode with history) */}
          {isEdit && (
            <div className={styles.modalHistory}>
              <h3 className={styles.modalHistoryTitle}>
                <Clock size={14} />
                Historial
                <span className={styles.modalHistoryCount}>{filteredHistory.length}/{history.length}</span>
              </h3>

              {history.length === 0 ? (
                <div className={styles.modalHistoryEmptyState}>
                  <Clock size={28} strokeWidth={1} />
                  <p>Sin ejecuciones</p>
                </div>
              ) : (
              <>
              {/* Filters */}
              <div className={styles.modalHistoryFilters}>
                {[
                  { value: 'all', label: 'Todos' },
                  { value: 'ok', label: 'OK' },
                  { value: 'error', label: 'Error' },
                ].map(f => (
                  <button
                    key={f.value}
                    className={`${styles.historyFilterBtn} ${historyFilter === f.value ? styles.historyFilterActive : ''}`}
                    onClick={() => setHistoryFilter(f.value)}
                  >
                    {f.label}
                  </button>
                ))}
                <span style={{ flex: 1 }} />
                <DateTimePicker value={dateFrom} onChange={setDateFrom} placeholder="Desde" />
                <span className={styles.historyDateSep}>—</span>
                <DateTimePicker value={dateTo} onChange={setDateTo} placeholder="Hasta" />
              </div>

              <div className={styles.modalHistoryScroll}>
                {filteredHistory.length === 0 ? (
                  <div className={styles.modalHistoryEmpty}>Sin resultados para este filtro</div>
                ) : filteredHistory.map((entry, i) => (
                  <div key={i} className={styles.modalHistoryEntry}>
                    <div className={styles.modalHistoryRow}>
                      {entry.status === 'error' ? (
                        <XCircle size={13} className={styles.modalHistoryErr} />
                      ) : (
                        <CheckCircle size={13} className={styles.modalHistoryOk} />
                      )}
                      <span className={styles.modalHistoryTime}>
                        {formatDateTime(entry.time)}
                      </span>
                      {entry.durationMs > 0 && (
                        <span className={styles.modalHistoryDuration}>
                          {formatDuration(entry.durationMs)}
                        </span>
                      )}
                    </div>
                    {entry.resultText && (
                      <pre className={styles.modalHistoryResult}>{entry.resultText}</pre>
                    )}
                  </div>
                ))}
              </div>
              </>
              )}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          {isEdit && (
            <button className={`${styles.actionBtn} ${styles.dangerBtn}`} onClick={() => {
              if (confirmDelete) onDelete(job);
              else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
            }}>
              <Trash2 size={14} />
              {confirmDelete ? 'Confirmar' : 'Eliminar'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className={styles.cancelBtn} onClick={handleClose}>Cancelar</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave() || saving}>
            {saving ? 'Guardando...' : (isEdit ? 'Guardar' : 'Crear')}
          </button>
        </div>
      </div>
    </div>
  );
}
