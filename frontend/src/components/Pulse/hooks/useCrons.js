import { useState, useEffect, useCallback } from 'react';
import { getToken } from '../../../api/client';

const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...headers(), ...opts.headers } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ── Normalize legacy (PWA backend) job → unified format ────────────────────
function normalizeLegacy(job) {
  let config = {};
  try { config = JSON.parse(job.task_config || '{}'); } catch {}

  return {
    id: String(job.id),
    name: job.name || '(sin nombre)',
    description: job.description || '',
    type: job.task_type || 'script',
    schedule: job.schedule || '',
    scheduleDisplay: describeSchedule(job.schedule),
    enabled: !!job.enabled,
    status: job.status || 'idle',
    lastRun: job.last_run ? new Date(job.last_run + 'Z') : null,
    lastResult: job.last_result || null,
    lastDurationMs: job.last_duration_ms || null,
    runCount: job.run_count || 0,
    errorCount: job.error_count || 0,
    oneShot: !!job.one_shot,
    config,
    source: 'legacy',
    _raw: job,
  };
}

// ── Normalize native (OpenClaw) job → unified format ───────────────────────
function normalizeNative(job) {
  const sched = job.schedule || {};
  let scheduleDisplay = '';
  if (sched.kind === 'cron') scheduleDisplay = describeCronExpr(sched.expr);
  else if (sched.kind === 'every') scheduleDisplay = describeEvery(sched.everyMs);
  else if (sched.kind === 'at') scheduleDisplay = `Una vez: ${new Date(sched.at).toLocaleString('es-ES')}`;

  const payload = job.payload || {};
  let type, config;
  if (payload.kind === 'systemEvent') {
    type = 'kai';
    config = { instruction: payload.text };
  } else if (payload.kind === 'agentTurn') {
    type = 'kai-agent';
    config = { message: payload.message, model: payload.model };
  } else {
    type = 'kai';
    config = {};
  }

  const state = job.state || {};

  return {
    id: job.id,
    name: job.name || '(sin nombre)',
    description: job.description || '',
    type,
    schedule: sched.expr || `${sched.everyMs}ms` || '',
    scheduleDisplay,
    enabled: job.enabled,
    status: state.lastRunStatus === 'error' ? 'error' : (state.consecutiveErrors > 0 ? 'error' : 'idle'),
    lastRun: state.lastRunAtMs ? new Date(state.lastRunAtMs) : null,
    lastResult: state.lastStatus || null,
    lastDurationMs: state.lastDurationMs || null,
    runCount: null,
    errorCount: state.consecutiveErrors || 0,
    oneShot: job.deleteAfterRun || job.schedule?.kind === 'at',
    config,
    source: 'native',
    _raw: job,
  };
}

// ── Schedule display helpers ───────────────────────────────────────────────
function describeCronExpr(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour] = parts;
  if (min.startsWith('*/')) return `Cada ${min.slice(2)} min`;
  if (hour.startsWith('*/') && min === '0') return `Cada ${hour.slice(2)}h`;
  if (hour === '*' && min === '0') return 'Cada hora';
  if (hour !== '*' && min !== '*') return `${hour}:${min.padStart(2, '0')}`;
  return expr;
}

function describeEvery(ms) {
  if (!ms) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `Cada ${mins} min`;
  if (mins === 60) return 'Cada hora';
  if (mins < 1440) return `Cada ${Math.round(mins / 60)}h`;
  return `Cada ${Math.round(mins / 1440)}d`;
}

function describeSchedule(cronExpr) {
  return describeCronExpr(cronExpr);
}

// ── Hook ───────────────────────────────────────────────────────────────────
export default function useCrons() {
  const [jobs, setJobs] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [legacyData, nativeData, legacyHistory, nativeHistory] = await Promise.all([
        apiFetch('/api/cron'),
        apiFetch('/api/cron-native').catch(() => ({ jobs: [] })),
        apiFetch('/api/cron/history?limit=100').catch(() => []),
        apiFetch('/api/cron-native/runs').catch(() => []),
      ]);
      const legacy = (Array.isArray(legacyData) ? legacyData : []).map(normalizeLegacy);
      const native = (nativeData.jobs || []).map(normalizeNative);
      setJobs([...native, ...legacy]);
      // Merge and sort histories
      const allHistory = [
        ...(Array.isArray(legacyHistory) ? legacyHistory : []),
        ...(Array.isArray(nativeHistory) ? nativeHistory : []),
      ].sort((a, b) => b.executed_at.localeCompare(a.executed_at));
      setHistory(allHistory);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  // ── Create ─────────────────────────────────────────────────────────────
  const create = async (form) => {
    if (form.type === 'kai' || form.type === 'kai-agent') {
      // Native OpenClaw cron
      const body = {
        name: form.name,
        type: form.type === 'kai-agent' ? 'agent' : 'system-event',
        session: form.type === 'kai-agent' ? 'isolated' : 'main',
        tz: 'Europe/Madrid',
        disabled: !form.enabled,
      };
      if (form.type === 'kai') body.text = form.config?.instruction || form.description;
      if (form.type === 'kai-agent') body.message = form.config?.message || form.description;
      if (form.config?.model) body.model = form.config.model;
      if (form.startAt) body.startAt = form.startAt;

      // Schedule
      if (form.scheduleType === 'every') body.every = form.every;
      else if (form.scheduleType === 'at') body.at = form.at;
      else body.schedule = form.schedule;

      await apiFetch('/api/cron-native', { method: 'POST', body: JSON.stringify(body) });
    } else {
      // Legacy PWA cron
      await apiFetch('/api/cron', { method: 'POST', body: JSON.stringify(form._legacyPayload) });
    }
    await load();
  };

  // ── Update ─────────────────────────────────────────────────────────────
  const update = async (job, changes) => {
    if (job.source === 'native') {
      await apiFetch(`/api/cron-native/${job.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    } else {
      await apiFetch(`/api/cron/${job.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    }
    await load();
  };

  // ── Toggle ─────────────────────────────────────────────────────────────
  const toggle = async (job) => {
    if (job.source === 'native') {
      const endpoint = job.enabled ? 'disable' : 'enable';
      await apiFetch(`/api/cron-native/${job.id}/${endpoint}`, { method: 'POST' });
    } else {
      await apiFetch(`/api/cron/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !job.enabled }),
      });
    }
    await load();
  };

  // ── Run ────────────────────────────────────────────────────────────────
  const run = async (job) => {
    if (job.source === 'native') {
      // Fire and don't wait — native run can take long (agent processing)
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      apiFetch(`/api/cron-native/${job.id}/run`, { method: 'POST', signal: controller.signal }).catch(() => {});
    } else {
      await apiFetch(`/api/cron/${job.id}/run`, { method: 'POST' });
    }
    setTimeout(load, 3000);
  };

  // ── Remove ─────────────────────────────────────────────────────────────
  const remove = async (job) => {
    if (job.source === 'native') {
      await apiFetch(`/api/cron-native/${job.id}`, { method: 'DELETE' });
    } else {
      await apiFetch(`/api/cron/${job.id}`, { method: 'DELETE' });
    }
    await load();
  };

  return { jobs, history, loading, error, refresh: load, create, update, toggle, run, remove };
}
