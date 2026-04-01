import { useMemo } from 'react';

// ── Cron expression parser (next N executions) ────────────────────────────
function parseCronField(field, min, max) {
  if (field === '*') {
    const arr = [];
    for (let i = min; i <= max; i++) arr.push(i);
    return arr;
  }
  const values = new Set();
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      for (let i = parseInt(rangeMatch[1], 10); i <= parseInt(rangeMatch[2], 10); i++) values.add(i);
      continue;
    }
    const num = parseInt(part, 10);
    if (!isNaN(num)) values.add(num);
  }
  return [...values].sort((a, b) => a - b);
}

function getNextCronExecutions(cronExpr, count = 6, fromMs = Date.now()) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return [];

  const [minF, hourF, domF, monF, dowF] = parts;
  const minutes = parseCronField(minF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monF, 1, 12);
  const dows = parseCronField(dowF, 0, 6);

  const results = [];
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // start from next minute

  const maxIterations = 60 * 24 * 7; // 1 week of minutes
  for (let i = 0; i < maxIterations && results.length < count; i++) {
    const m = d.getMinutes();
    const h = d.getHours();
    const dom = d.getDate();
    const mon = d.getMonth() + 1;
    const dow = d.getDay();

    if (minutes.includes(m) && hours.includes(h) && doms.includes(dom) && months.includes(mon) && dows.includes(dow)) {
      results.push(d.getTime());
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return results;
}

function getNextEveryExecutions(everyMs, lastRunMs, count = 6, fromMs = Date.now()) {
  const results = [];
  let next = lastRunMs ? lastRunMs + everyMs : fromMs + everyMs;
  // If next is in the past, fast-forward
  while (next <= fromMs) next += everyMs;
  for (let i = 0; i < count; i++) {
    results.push(next);
    next += everyMs;
  }
  return results;
}

// ── Main hook ──────────────────────────────────────────────────────────────
export default function useCronSchedule(jobs, historyData = []) {
  const now = Date.now();

  const executions = useMemo(() => {
    const all = [];

    for (const job of jobs) {
      if (!job.enabled) continue;

      let times = [];

      if (job.source === 'native') {
        const raw = job._raw;
        const sched = raw?.schedule;
        if (sched?.kind === 'cron') {
          times = getNextCronExecutions(sched.expr, 6, now);
        } else if (sched?.kind === 'every') {
          const lastRun = raw?.state?.lastRunAtMs || null;
          times = getNextEveryExecutions(sched.everyMs, lastRun, 6, now);
        } else if (sched?.kind === 'at') {
          const atMs = new Date(sched.at).getTime();
          if (atMs > now) times = [atMs];
        }
      } else {
        // Legacy: parse cron expression
        if (job.schedule) {
          times = getNextCronExecutions(job.schedule, 6, now);
        }
      }

      for (const t of times) {
        all.push({
          id: job.id,
          name: job.name,
          type: job.type,
          time: t,
          source: job.source,
        });
      }
    }

    // Sort by time
    all.sort((a, b) => a.time - b.time);
    return all;
  }, [jobs, now]);

  // History from DB
  const history = useMemo(() => {
    return historyData.map(h => ({
      id: h.job_id,
      name: h.job_name,
      type: h.job_type,
      time: new Date(h.executed_at + 'Z'),
      status: h.status,
      source: h.source,
      durationMs: h.duration_ms,
      resultText: h.result_text,
    }));
  }, [historyData]);

  return { executions, history };
}
