import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCORING_CONFIG } from "../lib/career-ops-scoring-config.mjs";
import { normalizeProfile } from "../career-ops-evaluate.mjs";
import { buildSeed, targetFit } from "../career-ops-target-fit.mjs";

const CONFIG = DEFAULT_SCORING_CONFIG;
const PROFILE = normalizeProfile(
  {
    role: "Frontend Engineer",
    skills: ["React", "TypeScript", "JavaScript"],
    summary: "前端工程師",
    education: [{ major: "資訊工程" }],
    workHistory: [{ title: "Frontend Engineer", company: "StartupX", start: "2021", end: "present" }],
    preferences: { expectedSalary: "月薪 80000", location: "Taipei", remote: true },
  },
  CONFIG
);

const JOBS = [
  { id: "a", company: "Acme Technologies", title: "Senior Frontend Engineer", description: "React remote 遠端", location: "Taipei" },
  { id: "b", company: "OtherCorp", title: "Frontend Developer", description: "Vue onsite", location: "Taipei" },
  { id: "c", company: "Globex Logistics", title: "Warehouse Operator", description: "logistics", location: "Taoyuan" },
  { id: "d", company: "Acme Tech", title: "Backend Engineer", description: "Golang API", location: "Taipei", isExpired: true },
];

test("buildSeed: inline flags override file seed", () => {
  const seed = buildSeed({ company: "Acme", title: "", location: "", remote: true }, { company: "OldCo", title: "PM" });
  assert.equal(seed.company, "Acme", "inline company overrides file");
  assert.equal(seed.title, "PM", "file title kept when no inline");
  assert.equal(seed.remote, true);
});

test("targetFit: excludes expired jobs, filters irrelevant, annotates similarity", () => {
  const seed = { company: "Acme", title: "Frontend Engineer", location: "Taipei", remote: true };
  const { matched, scored } = targetFit(seed, JOBS, PROFILE, CONFIG, { threshold: 0.12 });
  const ids = scored.map((j) => j.id);
  assert.ok(!ids.includes("d"), "expired job must be excluded");
  assert.ok(!ids.includes("c"), "warehouse job must be below threshold");
  assert.ok(ids.includes("a") && ids.includes("b"));
  assert.equal(matched, scored.length);
  for (const j of scored) {
    assert.equal(typeof j.similarity, "number");
    assert.equal(typeof j.score, "number", "each scored job has a fit score");
    assert.ok(j.similarityParts && typeof j.similarityParts === "object");
  }
});

test("targetFit: best same-company match ranks at/near top", () => {
  const seed = { company: "Acme", title: "Frontend Engineer" };
  const { scored } = targetFit(seed, JOBS, PROFILE, CONFIG, { threshold: 0.12 });
  // Acme frontend job (id a) should have the highest similarity of the pool
  const a = scored.find((j) => j.id === "a");
  const b = scored.find((j) => j.id === "b");
  assert.ok(a && b);
  assert.ok(a.similarity >= b.similarity, "same-company job at least as similar");
});

test("targetFit: limit caps the scored subset", () => {
  const seed = { title: "Frontend Engineer" };
  const { scored } = targetFit(seed, JOBS, PROFILE, CONFIG, { threshold: 0.05, limit: 1 });
  assert.ok(scored.length <= 1);
});
