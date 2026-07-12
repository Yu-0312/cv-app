/**
 * Career Ops application-funnel analytics — pure, dependency-free.
 *
 * Turns a user's tracked jobs (`cv_career_ops_jobs`) plus their status-change
 * timeline (`cv_career_ops_job_events`) into a recruiting-style funnel:
 * how many jobs reached each stage, stage-to-stage conversion rates, median
 * dwell time per stage, and which jobs have gone stale.
 *
 * Inspired by career_agent's `sentinel/src/career_sentinel/stats.py`, but
 * re-keyed to CV Studio's Chinese status vocabulary and made fully
 * deterministic (no LLM). Kept self-contained (no imports) so the identical
 * logic can be mirrored inline in the single-file browser app without a
 * bundler. Keep the two copies in sync; this Node copy is the source of truth
 * and is unit-tested.
 *
 * ── stage model ──────────────────────────────────────────────────────────────
 * The app exposes many statuses; for funnel purposes they collapse onto an
 * ordered pipeline. Rank 0 = "not yet in pipeline". Higher rank = further along.
 * Rejected / dropped are TERMINAL and sit outside the linear pipeline (a job can
 * be rejected from any stage), so they do not get a pipeline rank but are
 * counted separately.
 *
 *   considering   1  待評估 / 觀望
 *   shortlisted   2  值得投遞 / 強烈投遞
 *   applied       3  已投遞 / 待追蹤
 *   interviewing  4  面試中
 *   offer         5  Offer
 *
 *   rejected      —  拒絕                 (terminal, negative)
 *   dropped       —  略過 / 已下架         (terminal, abandoned)
 *
 * "reached stage N" is cumulative: a job currently interviewing has necessarily
 * passed through considering/shortlisted/applied, so it counts toward every
 * stage up to and including its furthest-reached rank. Furthest-reached is
 * computed from the event timeline (max rank ever held), not just the current
 * status — a rejected-after-interview job still counts as having reached
 * interviewing.
 */

// ── stage vocabulary ─────────────────────────────────────────────────────────

/** Ordered pipeline stages (rank = index + 1). */
export const FUNNEL_STAGES = [
  "considering",
  "shortlisted",
  "applied",
  "interviewing",
  "offer",
];

/** Chinese status → pipeline stage. Statuses absent here are non-pipeline. */
export const STATUS_TO_STAGE = {
  "待評估": "considering",
  "觀望": "considering",
  "值得投遞": "shortlisted",
  "強烈投遞": "shortlisted",
  "已投遞": "applied",
  "待追蹤": "applied",
  "面試中": "interviewing",
  "Offer": "offer",
};

/** Terminal statuses, kept out of the linear funnel and tallied separately. */
export const TERMINAL_STATUS = {
  "拒絕": "rejected",
  "略過": "dropped",
  "已下架": "dropped",
};

/** stage name → 1-based rank; 0 for anything not in the pipeline. */
export const STAGE_RANK = FUNNEL_STAGES.reduce((acc, s, i) => {
  acc[s] = i + 1;
  return acc;
}, {});

/** Map a raw status string to its pipeline stage, or "" if none. */
export function stageOfStatus(status) {
  if (status == null) return "";
  return STATUS_TO_STAGE[String(status).trim()] || "";
}

/** Map a raw status string to its terminal kind ("rejected"/"dropped"/""). */
export function terminalOfStatus(status) {
  if (status == null) return "";
  return TERMINAL_STATUS[String(status).trim()] || "";
}

/** 1-based rank of a status within the pipeline, or 0 if non-pipeline. */
export function rankOfStatus(status) {
  const stage = stageOfStatus(status);
  return stage ? STAGE_RANK[stage] : 0;
}

// ── small helpers ────────────────────────────────────────────────────────────

function toTime(value) {
  if (value == null) return NaN;
  if (value instanceof Date) return value.getTime();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? NaN : t;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Median of a numeric array (linear interpolation on the midpoint). */
export function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = (xs.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  if (lo === hi) return xs[lo];
  return (xs[lo] + xs[hi]) / 2;
}

/**
 * Group events by job_key, each list sorted ascending by changed_at.
 * Events shaped like { job_key, from_status, to_status, changed_at }.
 */
export function groupEvents(events) {
  const byJob = new Map();
  for (const ev of events || []) {
    const key = ev.job_key;
    if (key == null) continue;
    if (!byJob.has(key)) byJob.set(key, []);
    byJob.get(key).push(ev);
  }
  for (const list of byJob.values()) {
    list.sort((a, b) => toTime(a.changed_at) - toTime(b.changed_at));
  }
  return byJob;
}

// ── furthest-reached rank per job ────────────────────────────────────────────

/**
 * For one job, the highest pipeline rank it has ever held. Prefers the event
 * timeline (so a rejected-after-interview job still counts as interviewing);
 * falls back to the job's current status when no events exist.
 */
export function furthestRank(currentStatus, jobEvents) {
  let best = rankOfStatus(currentStatus);
  for (const ev of jobEvents || []) {
    best = Math.max(best, rankOfStatus(ev.to_status), rankOfStatus(ev.from_status));
  }
  return best;
}

// ── funnel ───────────────────────────────────────────────────────────────────

/**
 * Cumulative count of jobs that reached each stage. A job counts toward every
 * stage up to and including its furthest-reached rank.
 *
 * Returns { stages: [{ stage, rank, reached }], totals: {...} }.
 */
export function computeFunnel(jobs, eventsByJob) {
  const reached = FUNNEL_STAGES.map(() => 0);
  let rejected = 0;
  let dropped = 0;

  for (const job of jobs || []) {
    const term = terminalOfStatus(job.status);
    if (term === "rejected") rejected += 1;
    else if (term === "dropped") dropped += 1;

    const evs = eventsByJob.get(job.job_key) || [];
    const rank = furthestRank(job.status, evs);
    for (let i = 0; i < rank && i < reached.length; i += 1) reached[i] += 1;
  }

  return {
    stages: FUNNEL_STAGES.map((stage, i) => ({
      stage,
      rank: i + 1,
      reached: reached[i],
    })),
    totals: {
      tracked: (jobs || []).length,
      rejected,
      dropped,
    },
  };
}

// ── conversions ──────────────────────────────────────────────────────────────

/** ratio a→b, guarding divide-by-zero (0 denominator → null). */
function ratio(numer, denom) {
  if (!denom) return null;
  return numer / denom;
}

/**
 * Stage-to-stage conversion rates from the cumulative funnel.
 * Each entry: { from, to, fromCount, toCount, rate }.
 */
export function computeConversions(funnel) {
  const s = funnel.stages;
  const out = [];
  for (let i = 0; i < s.length - 1; i += 1) {
    out.push({
      from: s[i].stage,
      to: s[i + 1].stage,
      fromCount: s[i].reached,
      toCount: s[i + 1].reached,
      rate: ratio(s[i + 1].reached, s[i].reached),
    });
  }
  return out;
}

// ── dwell time ───────────────────────────────────────────────────────────────

/**
 * Median days a job spends in each stage, derived from the event timeline.
 *
 * For each job we walk its ordered events. Entering a pipeline stage starts a
 * clock; the next status change (to any status) closes it, contributing a
 * duration to that stage. The job's current stage is left open and measured
 * against `now` (so a job sitting in "interviewing" for 20 days counts).
 *
 * Returns { perStage: { stage: { medianDays, samples } }, samplesByStage }.
 */
export function computeDwell(jobs, eventsByJob, now = Date.now()) {
  const nowT = toTime(now);
  const durations = {};
  for (const stage of FUNNEL_STAGES) durations[stage] = [];

  for (const job of jobs || []) {
    const evs = eventsByJob.get(job.job_key) || [];
    if (evs.length === 0) continue;

    // Build a sequence of (stage, enteredAt) transitions from to_status.
    const points = [];
    for (const ev of evs) {
      const stage = stageOfStatus(ev.to_status);
      const t = toTime(ev.changed_at);
      if (Number.isNaN(t)) continue;
      points.push({ stage, t });
    }
    if (points.length === 0) continue;

    for (let i = 0; i < points.length; i += 1) {
      const { stage, t } = points[i];
      if (!stage) continue; // terminal / non-pipeline stage: no dwell tracked
      const end = i + 1 < points.length ? points[i + 1].t : nowT;
      if (Number.isNaN(end)) continue;
      const days = (end - t) / DAY_MS;
      if (days >= 0) durations[stage].push(days);
    }
  }

  const perStage = {};
  for (const stage of FUNNEL_STAGES) {
    const xs = durations[stage];
    perStage[stage] = {
      medianDays: median(xs),
      samples: xs.length,
    };
  }
  return { perStage };
}

// ── stale ────────────────────────────────────────────────────────────────────

/**
 * Jobs that are still active (in-pipeline, not terminal) but have not been
 * touched in `staleDays` days. "Touched" = the most recent of the job's
 * last_seen_at / updated_at / last event time.
 *
 * Returns { staleDays, count, items: [{ job_key, status, stage, idleDays }] }.
 */
export function computeStale(jobs, eventsByJob, now = Date.now(), staleDays = 14) {
  const nowT = toTime(now);
  const items = [];

  for (const job of jobs || []) {
    if (terminalOfStatus(job.status)) continue; // terminal: not "stale"
    const stage = stageOfStatus(job.status);
    if (!stage) continue; // not in the active pipeline

    const evs = eventsByJob.get(job.job_key) || [];
    const lastEvent = evs.length ? toTime(evs[evs.length - 1].changed_at) : NaN;
    const candidates = [
      toTime(job.updated_at),
      toTime(job.last_seen_at),
      lastEvent,
    ].filter((t) => Number.isFinite(t));
    if (candidates.length === 0) continue;

    const lastTouch = Math.max(...candidates);
    const idleDays = (nowT - lastTouch) / DAY_MS;
    if (idleDays >= staleDays) {
      items.push({
        job_key: job.job_key,
        status: job.status,
        stage,
        idleDays: Math.round(idleDays * 10) / 10,
      });
    }
  }

  items.sort((a, b) => b.idleDays - a.idleDays);
  return { staleDays, count: items.length, items };
}

// ── top-level ────────────────────────────────────────────────────────────────

/**
 * One-shot analytics bundle. `jobs` are cv_career_ops_jobs rows,
 * `events` are cv_career_ops_job_events rows.
 */
export function computeStats(jobs, events, { now = Date.now(), staleDays = 14 } = {}) {
  const eventsByJob = groupEvents(events);
  const funnel = computeFunnel(jobs, eventsByJob);
  const conversions = computeConversions(funnel);
  const dwell = computeDwell(jobs, eventsByJob, now);
  const stale = computeStale(jobs, eventsByJob, now, staleDays);
  return {
    generated_at: new Date(toTime(now)).toISOString(),
    funnel,
    conversions,
    dwell,
    stale,
  };
}
