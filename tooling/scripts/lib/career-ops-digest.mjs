/**
 * Career Ops daily digest — pure, dependency-free.
 *
 * Deterministic "what changed since last time" report. career_agent's
 * sentinel/diff.py compares two stored snapshots and sentinel/digest.py sends
 * the diff to an LLM to phrase it. We do neither: CV Studio already has an
 * append-only event log (cv_career_ops_job_events), so "what changed" is just a
 * time-window query over events + jobs — no snapshot storage, no LLM.
 *
 * A digest covers the window (now - sinceHours, now] and surfaces:
 *   - status_changes  誰的狀態變了（含跨階段箭頭）
 *   - new_jobs        窗內新出現的追蹤職缺（first_seen_at）
 *   - interviews      窗內進到「面試中」的職缺（亮點）
 *   - offers          窗內拿到 Offer 的職缺（亮點）
 *   - rejections      窗內被拒/放棄的職缺
 *   - follow_ups_due  next_follow_up_at 已到期、仍在進行中
 *   - newly_stale     現在算過期、但上次摘要時還沒（sinceHours 前還活著）
 *
 * Kept self-contained except for the shared stage vocabulary imported from
 * career-ops-stats.mjs, so the two stay in sync. Node copy is source of truth
 * and unit-tested.
 */

import {
  stageOfStatus,
  terminalOfStatus,
  computeStale,
  groupEvents,
} from "./career-ops-stats.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function toTime(value) {
  if (value == null) return NaN;
  if (value instanceof Date) return value.getTime();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? NaN : t;
}

/** True when `value` falls in (fromT, toT]. */
function inWindow(value, fromT, toT) {
  const t = toTime(value);
  if (Number.isNaN(t)) return false;
  return t > fromT && t <= toT;
}

/**
 * @param jobs    cv_career_ops_jobs rows
 *                { job_key, company?, title?, status, first_seen_at?, last_seen_at?,
 *                  updated_at?, is_expired?, next_follow_up_at? }
 * @param events  cv_career_ops_job_events rows
 *                { job_key, from_status, to_status, changed_at }
 * @param opts    { now, sinceHours = 24, staleDays = 14 }
 */
export function computeDigest(jobs, events, { now = Date.now(), sinceHours = 24, staleDays = 14 } = {}) {
  const nowT = toTime(now);
  const sinceT = nowT - sinceHours * 60 * 60 * 1000;
  const jobList = jobs || [];
  const eventsByJob = groupEvents(events);

  // Quick lookup of job meta for labelling event rows.
  const jobByKey = new Map();
  for (const j of jobList) jobByKey.set(j.job_key, j);

  const label = (job_key) => {
    const j = jobByKey.get(job_key);
    if (!j) return { job_key, company: "", title: "" };
    return { job_key, company: j.company || "", title: j.title || "" };
  };

  // ── status changes in window ────────────────────────────────────────────
  const status_changes = [];
  const interviews = [];
  const offers = [];
  const rejections = [];
  for (const ev of events || []) {
    if (!inWindow(ev.changed_at, sinceT, nowT)) continue;
    // Skip the synthetic "created" event (from_status === "" at first insert)
    // for the status-change list, but still let it feed highlights below.
    const from = ev.from_status || "";
    const to = ev.to_status || "";
    if (from !== to) {
      status_changes.push({ ...label(ev.job_key), from, to, changed_at: ev.changed_at });
    }
    if (stageOfStatus(to) === "interviewing") {
      interviews.push({ ...label(ev.job_key), changed_at: ev.changed_at });
    }
    if (stageOfStatus(to) === "offer") {
      offers.push({ ...label(ev.job_key), changed_at: ev.changed_at });
    }
    const term = terminalOfStatus(to);
    if (term) {
      rejections.push({ ...label(ev.job_key), kind: term, changed_at: ev.changed_at });
    }
  }

  // ── new jobs in window ──────────────────────────────────────────────────
  const new_jobs = jobList
    .filter((j) => inWindow(j.first_seen_at, sinceT, nowT))
    .map((j) => ({ job_key: j.job_key, company: j.company || "", title: j.title || "", first_seen_at: j.first_seen_at }));

  // ── follow-ups due ──────────────────────────────────────────────────────
  const follow_ups_due = jobList
    .filter((j) => {
      if (terminalOfStatus(j.status)) return false;
      const t = toTime(j.next_follow_up_at);
      return Number.isFinite(t) && t <= nowT;
    })
    .map((j) => ({
      job_key: j.job_key,
      company: j.company || "",
      title: j.title || "",
      status: j.status,
      due_at: j.next_follow_up_at,
      overdue_days: Math.round(((nowT - toTime(j.next_follow_up_at)) / DAY_MS) * 10) / 10,
    }))
    .sort((a, b) => b.overdue_days - a.overdue_days);

  // ── newly stale: stale now, but was NOT stale sinceHours ago ────────────
  const staleNow = computeStale(jobList, eventsByJob, nowT, staleDays);
  const stalePrev = computeStale(jobList, eventsByJob, sinceT, staleDays);
  const prevStaleKeys = new Set(stalePrev.items.map((i) => i.job_key));
  const newly_stale = staleNow.items
    .filter((i) => !prevStaleKeys.has(i.job_key))
    .map((i) => ({ ...label(i.job_key), status: i.status, stage: i.stage, idleDays: i.idleDays }));

  const sections = {
    status_changes,
    new_jobs,
    interviews,
    offers,
    rejections,
    follow_ups_due,
    newly_stale,
  };

  const totalChanges =
    status_changes.length + new_jobs.length + interviews.length + offers.length +
    rejections.length + follow_ups_due.length + newly_stale.length;

  return {
    generated_at: new Date(nowT).toISOString(),
    window: { since: new Date(sinceT).toISOString(), until: new Date(nowT).toISOString(), sinceHours },
    empty: totalChanges === 0,
    totals: {
      tracked: jobList.length,
      changes: totalChanges,
      still_stale: staleNow.count,
    },
    sections,
  };
}

// ── plain-text / Markdown rendering (mirrors digest.render_human) ────────────

function jobLabel(x) {
  const c = x.company || "";
  const t = x.title || "";
  if (c && t) return `${c} — ${t}`;
  return c || t || x.job_key;
}

/** Markdown digest. Returns a "今日沒有新變化" line when empty. */
export function renderDigestMarkdown(digest) {
  const L = [];
  L.push("# Career Ops — 每日變更摘要", "");
  L.push(`- 產出時間：${digest.generated_at}`);
  L.push(`- 觀察區間：近 ${digest.window.sinceHours} 小時`);
  L.push(`- 追蹤中 ${digest.totals.tracked} 筆｜本期變化 ${digest.totals.changes} 項｜仍過期 ${digest.totals.still_stale} 筆`);
  L.push("");

  if (digest.empty) {
    L.push("今日沒有新變化。");
    return L.join("\n");
  }

  const s = digest.sections;
  if (s.offers.length) {
    L.push("## 🎉 拿到 Offer", "");
    for (const x of s.offers) L.push(`- ${jobLabel(x)}`);
    L.push("");
  }
  if (s.interviews.length) {
    L.push("## 📞 進到面試", "");
    for (const x of s.interviews) L.push(`- ${jobLabel(x)}`);
    L.push("");
  }
  if (s.status_changes.length) {
    L.push("## 投遞狀態變動", "");
    for (const x of s.status_changes) L.push(`- ${jobLabel(x)}：${x.from || "（新增）"} → ${x.to}`);
    L.push("");
  }
  if (s.new_jobs.length) {
    L.push("## 新加入追蹤", "");
    for (const x of s.new_jobs) L.push(`- ${jobLabel(x)}`);
    L.push("");
  }
  if (s.follow_ups_due.length) {
    L.push("## ⏰ 待追蹤到期", "");
    for (const x of s.follow_ups_due) {
      const od = x.overdue_days > 0 ? `（逾期 ${x.overdue_days} 天）` : "（今日）";
      L.push(`- ${jobLabel(x)}｜${x.status}${od}`);
    }
    L.push("");
  }
  if (s.newly_stale.length) {
    L.push("## 💤 新轉為過期（久未動）", "");
    for (const x of s.newly_stale) L.push(`- ${jobLabel(x)}｜${x.status}（閒置 ${x.idleDays} 天）`);
    L.push("");
  }
  if (s.rejections.length) {
    L.push("## 已結束（拒絕／放棄／下架）", "");
    for (const x of s.rejections) {
      const kind = x.kind === "rejected" ? "拒絕" : "放棄/下架";
      L.push(`- ${jobLabel(x)}｜${kind}`);
    }
    L.push("");
  }

  L.push("> 註：變化以 append-only 的狀態事件時間軸就地推算，零 LLM。");
  return L.join("\n").replace(/\n+$/, "\n");
}
