import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeDigest,
  renderDigestMarkdown,
} from "../lib/career-ops-digest.mjs";

const NOW = Date.parse("2026-07-13T00:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

test("computeDigest: empty when nothing changed in window", () => {
  const jobs = [
    { job_key: "a", status: "面試中", first_seen_at: hoursAgo(200), updated_at: hoursAgo(100) },
  ];
  const events = [
    { job_key: "a", from_status: "已投遞", to_status: "面試中", changed_at: hoursAgo(100) },
  ];
  const d = computeDigest(jobs, events, { now: NOW, sinceHours: 24 });
  assert.equal(d.empty, true);
  assert.equal(d.totals.changes, 0);
});

test("computeDigest: status change in window is surfaced + highlighted", () => {
  const jobs = [
    { job_key: "a", company: "Acme", title: "後端工程師", status: "面試中", first_seen_at: hoursAgo(200) },
  ];
  const events = [
    { job_key: "a", from_status: "已投遞", to_status: "面試中", changed_at: hoursAgo(3) },
  ];
  const d = computeDigest(jobs, events, { now: NOW, sinceHours: 24 });
  assert.equal(d.empty, false);
  assert.equal(d.sections.status_changes.length, 1);
  assert.equal(d.sections.status_changes[0].from, "已投遞");
  assert.equal(d.sections.status_changes[0].to, "面試中");
  assert.equal(d.sections.interviews.length, 1); // highlighted
  assert.equal(d.sections.interviews[0].company, "Acme");
});

test("computeDigest: offer + rejection highlights", () => {
  const jobs = [
    { job_key: "o", company: "OfferCo", status: "Offer", first_seen_at: hoursAgo(300) },
    { job_key: "r", company: "RejCo", status: "拒絕", first_seen_at: hoursAgo(300) },
  ];
  const events = [
    { job_key: "o", from_status: "面試中", to_status: "Offer", changed_at: hoursAgo(2) },
    { job_key: "r", from_status: "面試中", to_status: "拒絕", changed_at: hoursAgo(5) },
  ];
  const d = computeDigest(jobs, events, { now: NOW, sinceHours: 24 });
  assert.equal(d.sections.offers.length, 1);
  assert.equal(d.sections.offers[0].company, "OfferCo");
  assert.equal(d.sections.rejections.length, 1);
  assert.equal(d.sections.rejections[0].kind, "rejected");
});

test("computeDigest: new jobs detected by first_seen_at in window", () => {
  const jobs = [
    { job_key: "new", company: "Fresh", status: "待評估", first_seen_at: hoursAgo(2) },
    { job_key: "old", company: "Stale", status: "待評估", first_seen_at: hoursAgo(100) },
  ];
  const d = computeDigest(jobs, [], { now: NOW, sinceHours: 24 });
  assert.equal(d.sections.new_jobs.length, 1);
  assert.equal(d.sections.new_jobs[0].job_key, "new");
});

test("computeDigest: follow-ups due (overdue sorted first), terminal excluded", () => {
  const jobs = [
    { job_key: "due", company: "DueCo", status: "待追蹤", next_follow_up_at: hoursAgo(48) }, // 2d overdue
    { job_key: "today", company: "TodayCo", status: "待追蹤", next_follow_up_at: hoursAgo(1) },
    { job_key: "future", company: "Later", status: "待追蹤", next_follow_up_at: hoursAgo(-48) }, // not due
    { job_key: "done", company: "Rejected", status: "拒絕", next_follow_up_at: hoursAgo(48) }, // terminal
  ];
  const d = computeDigest(jobs, [], { now: NOW, sinceHours: 24 });
  assert.equal(d.sections.follow_ups_due.length, 2);
  assert.equal(d.sections.follow_ups_due[0].job_key, "due"); // most overdue first
  assert.ok(d.sections.follow_ups_due[0].overdue_days >= 1.9);
});

test("computeDigest: newly-stale = stale now but not stale a window ago", () => {
  const jobs = [
    // last touch 15d ago: stale now (>14d), but 24h earlier was 14d → also stale.
    { job_key: "already", status: "已投遞", updated_at: hoursAgo(24 * 15) },
    // last touch exactly 14d+1h ago: stale now; 24h earlier was 13d → NOT stale → newly stale.
    { job_key: "fresh", status: "已投遞", updated_at: hoursAgo(24 * 14 + 1) },
  ];
  const d = computeDigest(jobs, [], { now: NOW, sinceHours: 24, staleDays: 14 });
  const keys = d.sections.newly_stale.map((x) => x.job_key);
  assert.ok(keys.includes("fresh"), `expected 'fresh' newly stale, got ${keys}`);
  assert.ok(!keys.includes("already"), `'already' was stale before window`);
});

test("renderDigestMarkdown: empty digest shows no-change line", () => {
  const jobs = [{ job_key: "a", status: "待評估", first_seen_at: hoursAgo(100) }];
  const d = computeDigest(jobs, [], { now: NOW, sinceHours: 24 });
  const md = renderDigestMarkdown(d);
  assert.match(md, /今日沒有新變化/);
});

test("renderDigestMarkdown: populated digest renders highlight sections", () => {
  const jobs = [
    { job_key: "o", company: "OfferCo", title: "PM", status: "Offer", first_seen_at: hoursAgo(300) },
  ];
  const events = [
    { job_key: "o", from_status: "面試中", to_status: "Offer", changed_at: hoursAgo(2) },
  ];
  const d = computeDigest(jobs, events, { now: NOW, sinceHours: 24 });
  const md = renderDigestMarkdown(d);
  assert.match(md, /拿到 Offer/);
  assert.match(md, /OfferCo — PM/);
});
