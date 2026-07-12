import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FUNNEL_STAGES,
  STAGE_RANK,
  stageOfStatus,
  terminalOfStatus,
  rankOfStatus,
  median,
  groupEvents,
  furthestRank,
  computeFunnel,
  computeConversions,
  computeDwell,
  computeStale,
  computeStats,
} from "../lib/career-ops-stats.mjs";

// ── status mapping ───────────────────────────────────────────────────────────
test("stageOfStatus: maps Chinese statuses onto pipeline stages", () => {
  assert.equal(stageOfStatus("待評估"), "considering");
  assert.equal(stageOfStatus("觀望"), "considering");
  assert.equal(stageOfStatus("值得投遞"), "shortlisted");
  assert.equal(stageOfStatus("強烈投遞"), "shortlisted");
  assert.equal(stageOfStatus("已投遞"), "applied");
  assert.equal(stageOfStatus("待追蹤"), "applied");
  assert.equal(stageOfStatus("面試中"), "interviewing");
  assert.equal(stageOfStatus("Offer"), "offer");
  assert.equal(stageOfStatus("  面試中  "), "interviewing"); // trims
});

test("terminalOfStatus / stageOfStatus: terminal statuses are non-pipeline", () => {
  assert.equal(terminalOfStatus("拒絕"), "rejected");
  assert.equal(terminalOfStatus("略過"), "dropped");
  assert.equal(terminalOfStatus("已下架"), "dropped");
  assert.equal(stageOfStatus("拒絕"), "");
  assert.equal(stageOfStatus("略過"), "");
  assert.equal(stageOfStatus(null), "");
  assert.equal(rankOfStatus("拒絕"), 0);
});

test("rankOfStatus: monotonic along the pipeline", () => {
  assert.equal(rankOfStatus("待評估"), 1);
  assert.equal(rankOfStatus("值得投遞"), 2);
  assert.equal(rankOfStatus("已投遞"), 3);
  assert.equal(rankOfStatus("面試中"), 4);
  assert.equal(rankOfStatus("Offer"), 5);
  assert.equal(STAGE_RANK[FUNNEL_STAGES[FUNNEL_STAGES.length - 1]], 5);
});

// ── median ───────────────────────────────────────────────────────────────────
test("median: odd, even, empty, and non-finite filtering", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 5, undefined]), 5);
});

// ── groupEvents ──────────────────────────────────────────────────────────────
test("groupEvents: groups by job_key and sorts ascending by changed_at", () => {
  const evs = [
    { job_key: "a", to_status: "面試中", changed_at: "2026-01-03" },
    { job_key: "a", to_status: "待評估", changed_at: "2026-01-01" },
    { job_key: "b", to_status: "已投遞", changed_at: "2026-01-02" },
  ];
  const g = groupEvents(evs);
  assert.equal(g.get("a").length, 2);
  assert.equal(g.get("a")[0].to_status, "待評估"); // earliest first
  assert.equal(g.get("b").length, 1);
});

// ── furthestRank ─────────────────────────────────────────────────────────────
test("furthestRank: uses timeline max even when current status is terminal", () => {
  // Rejected after interviewing → still counts as having reached interviewing (4).
  const evs = [
    { to_status: "待評估", from_status: "", changed_at: "2026-01-01" },
    { to_status: "面試中", from_status: "已投遞", changed_at: "2026-01-05" },
    { to_status: "拒絕", from_status: "面試中", changed_at: "2026-01-08" },
  ];
  assert.equal(furthestRank("拒絕", evs), 4);
});

test("furthestRank: falls back to current status when no events", () => {
  assert.equal(furthestRank("已投遞", []), 3);
  assert.equal(furthestRank("略過", []), 0);
});

// ── computeFunnel ────────────────────────────────────────────────────────────
test("computeFunnel: cumulative reach + terminal tallies", () => {
  const jobs = [
    { job_key: "j1", status: "待評估" },   // considering only
    { job_key: "j2", status: "面試中" },   // reached interviewing (1..4)
    { job_key: "j3", status: "拒絕" },     // rejected; reached interviewing via events
    { job_key: "j4", status: "略過" },     // dropped, never entered pipeline
    { job_key: "j5", status: "Offer" },    // full pipeline (1..5)
  ];
  const events = [
    { job_key: "j3", to_status: "面試中", changed_at: "2026-01-05" },
    { job_key: "j3", to_status: "拒絕", changed_at: "2026-01-06" },
  ];
  const f = computeFunnel(jobs, groupEvents(events));
  const byStage = Object.fromEntries(f.stages.map((s) => [s.stage, s.reached]));
  assert.equal(byStage.considering, 4);   // j1,j2,j3,j5
  assert.equal(byStage.shortlisted, 3);   // j2,j3,j5
  assert.equal(byStage.applied, 3);       // j2,j3,j5
  assert.equal(byStage.interviewing, 3);  // j2,j3,j5
  assert.equal(byStage.offer, 1);         // j5
  assert.equal(f.totals.tracked, 5);
  assert.equal(f.totals.rejected, 1);
  assert.equal(f.totals.dropped, 1);
});

// ── computeConversions ───────────────────────────────────────────────────────
test("computeConversions: rates from cumulative funnel, guards zero denom", () => {
  const funnel = {
    stages: [
      { stage: "considering", reached: 10 },
      { stage: "shortlisted", reached: 5 },
      { stage: "applied", reached: 4 },
      { stage: "interviewing", reached: 2 },
      { stage: "offer", reached: 0 },
    ],
  };
  const c = computeConversions(funnel);
  assert.equal(c.length, 4);
  assert.equal(c[0].rate, 0.5);   // 5/10
  assert.equal(c[1].rate, 0.8);   // 4/5
  assert.equal(c[2].rate, 0.5);   // 2/4
  assert.equal(c[3].rate, 0);     // 0/2

  const zero = computeConversions({
    stages: [
      { stage: "considering", reached: 0 },
      { stage: "shortlisted", reached: 0 },
    ],
  });
  assert.equal(zero[0].rate, null); // 0/0 → null, not NaN
});

// ── computeDwell ─────────────────────────────────────────────────────────────
test("computeDwell: median days per stage, open stage measured to now", () => {
  const now = Date.parse("2026-01-20T00:00:00Z");
  const jobs = [{ job_key: "j1", status: "面試中" }];
  const events = [
    { job_key: "j1", to_status: "待評估", changed_at: "2026-01-01T00:00:00Z" },
    { job_key: "j1", to_status: "已投遞", changed_at: "2026-01-05T00:00:00Z" }, // considering 4d
    { job_key: "j1", to_status: "面試中", changed_at: "2026-01-10T00:00:00Z" }, // applied 5d
  ];
  const d = computeDwell(jobs, groupEvents(events), now);
  assert.equal(d.perStage.considering.medianDays, 4);
  assert.equal(d.perStage.applied.medianDays, 5);
  assert.equal(d.perStage.interviewing.medianDays, 10); // 01-10 → 01-20 (open)
  assert.equal(d.perStage.shortlisted.samples, 0);
  assert.equal(d.perStage.shortlisted.medianDays, null);
});

test("computeDwell: no events → all stages empty", () => {
  const d = computeDwell([{ job_key: "x", status: "面試中" }], groupEvents([]), Date.now());
  for (const stage of FUNNEL_STAGES) {
    assert.equal(d.perStage[stage].samples, 0);
  }
});

// ── computeStale ─────────────────────────────────────────────────────────────
test("computeStale: flags idle in-pipeline jobs, ignores terminal", () => {
  const now = Date.parse("2026-02-01T00:00:00Z");
  const jobs = [
    { job_key: "fresh", status: "面試中", updated_at: "2026-01-30T00:00:00Z" }, // 2d
    { job_key: "stale", status: "已投遞", updated_at: "2026-01-01T00:00:00Z" }, // 31d
    { job_key: "gone", status: "拒絕", updated_at: "2026-01-01T00:00:00Z" },   // terminal → skip
  ];
  const s = computeStale(jobs, groupEvents([]), now, 14);
  assert.equal(s.staleDays, 14);
  assert.equal(s.count, 1);
  assert.equal(s.items[0].job_key, "stale");
  assert.ok(s.items[0].idleDays >= 30);
});

test("computeStale: last event time counts as a touch", () => {
  const now = Date.parse("2026-02-01T00:00:00Z");
  const jobs = [{ job_key: "j", status: "面試中", updated_at: "2026-01-01T00:00:00Z" }];
  const events = [{ job_key: "j", to_status: "面試中", changed_at: "2026-01-28T00:00:00Z" }];
  const s = computeStale(jobs, groupEvents(events), now, 14);
  assert.equal(s.count, 0); // last touch is the event (4d ago), not updated_at (31d)
});

// ── computeStats bundle ──────────────────────────────────────────────────────
test("computeStats: assembles funnel, conversions, dwell, stale", () => {
  const now = Date.parse("2026-02-01T00:00:00Z");
  const jobs = [
    { job_key: "a", status: "Offer", updated_at: "2026-01-31T00:00:00Z" },
    { job_key: "b", status: "待評估", updated_at: "2026-01-01T00:00:00Z" },
  ];
  const events = [
    { job_key: "a", to_status: "待評估", changed_at: "2026-01-10T00:00:00Z" },
    { job_key: "a", to_status: "Offer", changed_at: "2026-01-20T00:00:00Z" },
  ];
  const out = computeStats(jobs, events, { now, staleDays: 14 });
  assert.ok(out.generated_at.startsWith("2026-02-01"));
  assert.equal(out.funnel.totals.tracked, 2);
  assert.equal(out.conversions.length, FUNNEL_STAGES.length - 1);
  assert.equal(out.stale.count, 1); // job b idle 31d
  assert.equal(out.stale.items[0].job_key, "b");
});
