/**
 * Unit tests for the career-ops scoring engine (career-ops-evaluate v3).
 * Runs with zero dependencies via Node's built-in test runner:
 *   node --test tooling/scripts/__tests__/
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProfile,
  evaluateJob,
  tokenize,
  scoreFieldMatch,
  scoreExperience,
  inferRoleFamily,
  blockG,
} from "../career-ops-evaluate.mjs";
import { DEFAULT_SCORING_CONFIG, inferSeniority } from "../lib/career-ops-scoring-config.mjs";

const cfg = DEFAULT_SCORING_CONFIG;

// ── tokenize / CJK stopwords (A3) ────────────────────────────────────────────

test("tokenize strips expanded CJK stopwords", () => {
  const toks = tokenize("我們 公司 職務 團隊 需要 React 工程師", cfg);
  assert.ok(!toks.includes("我們"), "我們 should be filtered");
  assert.ok(!toks.includes("公司"), "公司 should be filtered");
  assert.ok(!toks.includes("職務"), "職務 should be filtered");
  assert.ok(toks.includes("react"), "meaningful tokens survive");
});

test("tokenize dedupes and lowercases", () => {
  const toks = tokenize("React react REACT Node", cfg);
  assert.equal(toks.filter((t) => t === "react").length, 1);
  assert.ok(toks.includes("node"));
});

// ── weight redistribution (A1 core invariant) ────────────────────────────────

test("noData dimensions are dropped and weight redistributed (score stays 0–100)", () => {
  const profile = normalizeProfile({ role: "Frontend Engineer", skills: ["React"] }, cfg);
  // job with no salary, no education signal on candidate → compensation + fieldMatch may be noData
  const job = { title: "Frontend Engineer", company: "Acme", description: "Build React UIs. " + "x".repeat(300), url: "https://boards.greenhouse.io/acme/1" };
  const out = evaluateJob(job, profile, cfg);
  assert.ok(out.score >= 0 && out.score <= 100, `score in range, got ${out.score}`);
  assert.equal(out.dimensions.compensation.noData, true, "no salary → compensation noData");
  assert.ok(out.rating >= 1 && out.rating <= 5);
});

test("evaluateJob is deterministic for identical inputs (ignoring timestamp)", () => {
  const profile = normalizeProfile({ role: "Backend Engineer", skills: ["Go", "Postgres"] }, cfg);
  const job = { title: "Senior Backend Engineer", description: "Go microservices " + "y".repeat(400), url: "https://x.com/j/1", salary: "NT$1,200,000" };
  const a = evaluateJob(job, profile, cfg);
  const b = evaluateJob(job, profile, cfg);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.dimensions.cvMatch.found, b.dimensions.cvMatch.found);
});

// ── Block G legitimacy tiers ─────────────────────────────────────────────────

test("blockG flags scam patterns as Suspicious", () => {
  const g = blockG({ title: "Easy job", company: "X", description: "advance fee required, whatsapp only to apply", url: "" }, cfg);
  assert.equal(g.tier, "Suspicious");
});

test("blockG rates a fresh known-ATS posting as High Confidence", () => {
  const g = blockG({
    title: "Software Engineer",
    company: "Acme",
    description: "d".repeat(400),
    url: "https://boards.greenhouse.io/acme/jobs/123",
    datePosted: new Date().toISOString(),
  }, cfg);
  assert.equal(g.tier, "High Confidence");
  assert.equal(g.confidence, "high");
});

// ── seniority inference ──────────────────────────────────────────────────────

test("inferSeniority ranks titles correctly and beats false positives", () => {
  assert.equal(inferSeniority("Senior Software Engineer").level, "Senior");
  assert.equal(inferSeniority("Engineering Manager").level, "Manager");
  assert.equal(inferSeniority("實習生").level, "Intern");
  // "international" must NOT match intern
  assert.equal(inferSeniority("International Sales").level, "Unknown");
});

// ── fieldMatch (科系匹配度) ──────────────────────────────────────────────────

test("scoreFieldMatch: same-field major scores higher than unrelated field", () => {
  const csProfile = normalizeProfile({ role: "Engineer", education: [{ major: "資訊工程" }], skills: ["React"] }, cfg);
  const humProfile = normalizeProfile({ role: "Engineer", education: [{ major: "歷史學系" }], skills: ["React"] }, cfg);
  const job = { title: "Frontend Engineer", description: "React, TypeScript " + "z".repeat(200) };
  const csScore = scoreFieldMatch(job, csProfile, cfg).score;
  const humScore = scoreFieldMatch(job, humProfile, cfg).score;
  assert.ok(csScore > humScore, `CS (${csScore}) should beat humanities (${humScore})`);
});

test("scoreFieldMatch: missing education → noData (redistributed, not penalised)", () => {
  const profile = normalizeProfile({ role: "Engineer", skills: ["React"] }, cfg);
  const res = scoreFieldMatch({ title: "Frontend Engineer", description: "React" }, profile, cfg);
  assert.equal(res.noData, true);
  assert.equal(res.score, null);
});

// ── experience (工作經驗 + 晉升) ─────────────────────────────────────────────

test("scoreExperience: promotion trajectory scores higher than flat/stagnant tenure", () => {
  const promoted = normalizeProfile({
    role: "Engineering Manager",
    workHistory: [
      { title: "Junior Engineer", start: "2016", end: "2018" },
      { title: "Senior Engineer", start: "2018", end: "2021" },
      { title: "Engineering Manager", start: "2021", end: "present" },
    ],
  }, cfg);
  const stagnant = normalizeProfile({
    role: "Engineer",
    workHistory: [
      { title: "Engineer", start: "2013", end: "2017" },
      { title: "Engineer", start: "2017", end: "present" },
    ],
  }, cfg);
  const job = { title: "Engineering Manager", description: "Lead a team of engineers " + "q".repeat(200) };
  const promoScore = scoreExperience(job, promoted, cfg).score;
  const stagScore = scoreExperience(job, stagnant, cfg).score;
  assert.ok(promoScore > stagScore, `promoted (${promoScore}) should beat stagnant (${stagScore})`);
});

test("scoreExperience: long tenure without promotion triggers stagnation penalty", () => {
  const stagnant = normalizeProfile({
    role: "Engineer",
    workHistory: [
      { title: "Engineer", start: "2012", end: "2018" },
      { title: "Engineer", start: "2018", end: "present" },
    ],
  }, cfg);
  const res = scoreExperience({ title: "Engineer", description: "x".repeat(200) }, stagnant, cfg);
  assert.ok(res.reasons.some((r) => r.includes("stagnation")), `expected stagnation reason, got: ${JSON.stringify(res.reasons)}`);
});

test("scoreExperience: seniority matching the posting adds role-fit bonus", () => {
  const senior = normalizeProfile({
    role: "Senior Engineer",
    workHistory: [{ title: "Senior Engineer", start: "2019", end: "present" }],
  }, cfg);
  const res = scoreExperience({ title: "Senior Backend Engineer", description: "y".repeat(200) }, senior, cfg);
  assert.ok(res.reasons.some((r) => r.includes("seniority matches")), `expected role-fit reason, got: ${JSON.stringify(res.reasons)}`);
});

test("scoreExperience: no signal → noData", () => {
  const bare = normalizeProfile({ skills: ["React"] }, cfg);
  const res = scoreExperience({ title: "Engineer", description: "x" }, bare, cfg);
  assert.equal(res.noData, true);
});

// ── role-family inference feeds fieldMatch/experience ────────────────────────

test("inferRoleFamily classifies common roles", () => {
  assert.equal(inferRoleFamily({ title: "Frontend Engineer" }), "Frontend");
  assert.equal(inferRoleFamily({ title: "產品經理" }), "Product");
  assert.equal(inferRoleFamily({ title: "Machine Learning Engineer" }), "AI/Data");
});

// ── end-to-end: new dims actually move the needle ────────────────────────────

test("evaluateJob surfaces all 8 dimensions", () => {
  const profile = normalizeProfile({
    role: "Frontend Engineer",
    skills: ["React", "TypeScript"],
    education: [{ major: "資訊工程" }],
    workHistory: [
      { title: "Junior Engineer", start: "2018", end: "2020" },
      { title: "Senior Frontend Engineer", start: "2020", end: "present" },
    ],
  }, cfg);
  const job = { title: "Senior Frontend Engineer", description: "React TypeScript " + "d".repeat(400), url: "https://boards.greenhouse.io/x/1", salary: "NT$1,500,000", datePosted: new Date().toISOString() };
  const out = evaluateJob(job, profile, cfg);
  for (const key of ["cvMatch", "experience", "northStar", "compensation", "redFlags", "fieldMatch", "culture", "effort"]) {
    assert.ok(out.dimensions[key], `dimension ${key} present`);
  }
  assert.ok(out.score > 60, `well-matched senior FE role should score decently, got ${out.score}`);
});
