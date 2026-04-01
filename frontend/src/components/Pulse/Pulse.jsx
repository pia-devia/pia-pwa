import { useState } from 'react';
import { Plus, Clock, ChevronRight } from 'lucide-react';

import useCrons from './hooks/useCrons';
import useCronSchedule from './hooks/useCronSchedule';
import CronTimeline from './CronTimeline';
import CronCard from './CronCard';
import CronForm from './CronForm';
import GlobalHistory from './GlobalHistory';
import styles from './Pulse.module.css';

const FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'kai', label: 'Pia' },
  { value: 'kai-agent', label: 'Agente' },
  { value: 'script', label: 'Script' },
  { value: 'http', label: 'HTTP' },
  { value: 'email', label: 'Email' },
];

export default function Pulse() {
  const { jobs, history: historyData, loading, error, refresh, create, update, toggle, run, remove } = useCrons();
  const { executions } = useCronSchedule(jobs, historyData);
  const [modal, setModal] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showDisabled, setShowDisabled] = useState(false);
  const [showGlobalHistory, setShowGlobalHistory] = useState(false);
  const handleRun = async (job) => {
    setRunningId(job.id);
    try { await run(job); } finally { setTimeout(() => setRunningId(null), 2000); }
  };

  const handleSave = async (formData) => {
    if (formData._isUpdate) {
      const { _isUpdate, _job, _legacyPayload, ...changes } = formData;
      if (_legacyPayload) {
        await update(_job, _legacyPayload);
      } else {
        await update(_job, changes);
      }
    } else if (formData._legacyPayload) {
      await create({ type: 'script', _legacyPayload: formData._legacyPayload });
    } else {
      await create(formData);
    }
    setModal(null);
  };

  const handleDelete = async (job) => {
    await remove(job);
    setModal(null);
  };

  if (loading) return <div className={styles.centered}><div className={styles.spinner} /></div>;
  if (error) return (
    <div className={styles.centered}>
      <p className={styles.errorText}>{error}</p>
      <button className={styles.retryBtn} onClick={refresh}>Reintentar</button>
    </div>
  );

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.type === filter);
  const active = filtered.filter(j => j.enabled);
  const disabled = filtered.filter(j => !j.enabled);

  // Build per-job history lookup
  const jobHistory = {};
  for (const h of historyData) {
    const key = h.job_name || h.job_id;
    if (!jobHistory[key]) jobHistory[key] = [];
    jobHistory[key].push({
      time: new Date(h.executed_at + (h.executed_at.endsWith('Z') ? '' : 'Z')),
      status: h.status,
      durationMs: h.duration_ms,
      resultText: h.result_text || '',
    });
  }

  return (
    <div className={styles.pulse}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Pulse</h1>
        <button className={styles.newBtn} onClick={() => setModal({ job: null })}>
          <Plus size={14} /> Nuevo
        </button>
      </div>

      {/* Filters */}
      <div className={styles.filterRow}>
        {FILTER_OPTIONS.map(f => (
          <button
            key={f.value}
            className={`${styles.filterBtn} ${filter === f.value ? styles.filterActive : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <CronTimeline
        executions={filter === 'all' ? executions : executions.filter(e => e.type === filter)}
        onShowHistory={() => setShowGlobalHistory(true)}
        onEdit={(id) => {
          const job = jobs.find(j => j.id === id);
          if (job) setModal({ job });
        }}
      />

      {/* Active crons */}
      {active.length === 0 && disabled.length === 0 ? (
        <div className={styles.empty}>
          <Clock size={32} strokeWidth={1} />
          <p>{filter === 'all' ? 'No hay cron jobs' : `No hay crons de tipo ${filter}`}</p>
        </div>
      ) : (
        <>
          <ul className={styles.cardsList} key={`active-${filter}`}>
            {active.map((job, i) => (
              <CronCard
                key={`${job.source}-${job.id}`}
                job={job}
                onEdit={() => setModal({ job })}
                onToggle={() => toggle(job)}
                onRun={() => handleRun(job)}
                running={runningId === job.id}
                style={{ animationDelay: `${i * 50}ms` }}
              />
            ))}
          </ul>

          {/* Disabled section */}
          {disabled.length > 0 && (
            <div className={styles.disabledSection}>
              <button
                className={styles.disabledToggle}
                onClick={() => setShowDisabled(!showDisabled)}
              >
                <ChevronRight
                  size={14}
                  className={`${styles.disabledChevron} ${showDisabled ? styles.disabledChevronOpen : ''}`}
                />
                Desactivados ({disabled.length})
                <span className={styles.disabledLine} />
              </button>

              {showDisabled && (
                <ul className={styles.cardsList}>
                  {disabled.map((job, i) => (
                    <CronCard
                      key={`${job.source}-${job.id}`}
                      job={job}
                      onEdit={() => setModal({ job })}
                      onToggle={() => toggle(job)}
                      onRun={() => handleRun(job)}
                      running={runningId === job.id}
                      disabled
                      style={{ animationDelay: `${i * 50}ms` }}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {modal !== null && (
        <CronForm
          job={modal.job}
          onSave={handleSave}
          onClose={() => setModal(null)}
          onDelete={handleDelete}
          history={modal.job ? (jobHistory[modal.job.name] || []) : []}
        />
      )}

      {/* Global History */}
      {showGlobalHistory && (
        <GlobalHistory onClose={() => setShowGlobalHistory(false)} />
      )}
    </div>
  );
}
