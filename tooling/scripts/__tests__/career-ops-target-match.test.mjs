import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SIMILARITY_WEIGHTS,
  inferRoleFamilyLite,
  targetSimilarity,
  rankBySimilarity,
} from "../lib/career-ops-target-match.mjs";

// ── inferRoleFamilyLite ──────────────────────────────────────────────────────
test("inferRoleFamilyLite: recognises common families (EN + CJK)", () => {
  assert.equal(inferRoleFamilyLite("Senior Frontend Engineer (React)"), "Frontend");
  assert.equal(inferRoleFamilyLite("後端工程師 Golang"), "Backend");
  assert.equal(inferRoleFamilyLite("機器學習工程師 / ML Engineer"), "AI/Data");
  assert.equal(inferRoleFamilyLite("產品經理"), "Product");
  assert.equal(inferRoleFamilyLite("硬體 IC design 韌體"), "Hardware");
  assert.equal(inferRoleFamilyLite("完全不相關的東西"), "General");
});

// ── targetSimilarity: composite behaviour ────────────────────────────────────
test("targetSimilarity: exact company + same role family scores high", () => {
  const seed = { company: "Acme Technologies Inc.", title: "Frontend Engineer" };
  const job = { company: "Acme Tech", title: "Senior Frontend Engineer", description: "React, Vue" };
  const sim = targetSimilarity(seed, job);
  assert.ok(sim.score >= 0.7, `expected >=0.7, got ${sim.score}`);
  assert.ok(sim.parts.company >= 0.8);
  assert.ok(sim.parts.title >= 0.6);
});

test("targetSimilarity: unrelated company + different family scores low", () => {
  const seed = { company: "Acme Technologies Inc.", title: "Frontend Engineer" };
  const job = { company: "Globex 全球物流", title: "業務銷售 Account Executive", description: "sales" };
  const sim = targetSimilarity(seed, job);
  assert.ok(sim.score < 0.3, `expected <0.3, got ${sim.score}`);
});

test("targetSimilarity: same-company job ranks above same-family-different-company", () => {
  const seed = { company: "Acme Technologies Inc.", title: "Frontend Engineer" };
  const sameCompany = { company: "Acme Technologies", title: "Frontend Engineer", description: "React" };
  const diffCompany = { company: "OtherCorp", title: "Frontend Engineer", description: "React" };
  const a = targetSimilarity(seed, sameCompany).score;
  const b = targetSimilarity(seed, diffCompany).score;
  assert.ok(a > b, `same-company ${a} should beat diff-company ${b}`);
});

test("targetSimilarity: unspecified sub-signals are dropped and weight redistributed", () => {
  // seed has ONLY a title → company/location signals dropped
  const seed = { title: "Backend Engineer" };
  const job = { company: "Anything", title: "Backend Engineer", description: "Golang API" };
  const sim = targetSimilarity(seed, job);
  assert.equal(sim.parts.company, undefined, "company should be dropped when seed has none");
  assert.equal(sim.parts.location, undefined, "location should be dropped when seed has none");
  assert.ok(sim.parts.title !== undefined);
  // title is a perfect family+token match → composite should be high despite dropped dims
  assert.ok(sim.score >= 0.7, `expected >=0.7, got ${sim.score}`);
});

test("targetSimilarity: location remote preference matches remote job", () => {
  const seed = { title: "Data Engineer", remote: true };
  const remoteJob = { title: "Data Engineer", description: "fully remote 遠端" };
  const onsiteJob = { title: "Data Engineer", description: "onsite office" };
  const r = targetSimilarity(seed, remoteJob);
  const o = targetSimilarity(seed, onsiteJob);
  assert.equal(r.parts.location, 1);
  assert.equal(o.parts.location, 0);
  assert.ok(r.score > o.score);
});

// ── rankBySimilarity ─────────────────────────────────────────────────────────
test("rankBySimilarity: sorts desc, applies threshold and limit", () => {
  const seed = { company: "Acme", title: "Frontend Engineer" };
  const jobs = [
    { id: "a", company: "Acme", title: "Frontend Engineer", description: "React" },
    { id: "b", company: "OtherCorp", title: "Frontend Developer", description: "Vue" },
    { id: "c", company: "Globex", title: "Warehouse Operator", description: "logistics" },
  ];
  const ranked = rankBySimilarity(seed, jobs, { limit: 2, threshold: 0.12 });
  assert.ok(ranked.length <= 2);
  assert.equal(ranked[0].id, "a", "best match should be first");
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].similarity >= ranked[i].similarity, "must be sorted desc");
  }
  // every result annotated
  for (const r of ranked) {
    assert.equal(typeof r.similarity, "number");
    assert.ok(r.similarityParts && typeof r.similarityParts === "object");
  }
});

test("rankBySimilarity: threshold filters out irrelevant jobs", () => {
  const seed = { company: "Acme", title: "Frontend Engineer" };
  const jobs = [{ id: "c", company: "Globex", title: "Warehouse Operator", description: "logistics" }];
  const ranked = rankBySimilarity(seed, jobs, { threshold: 0.3 });
  assert.equal(ranked.length, 0);
});

test("DEFAULT_SIMILARITY_WEIGHTS sum to 1.0", () => {
  const sum = Object.values(DEFAULT_SIMILARITY_WEIGHTS).reduce((s, w) => s + w, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum ${sum}`);
});
