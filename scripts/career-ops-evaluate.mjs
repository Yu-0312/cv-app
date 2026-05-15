#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function printHelp() {
  console.log(`Career Ops batch evaluator

Scores a Career Ops job snapshot against a CV/profile JSON file without touching the frontend.

Usage:
  node scripts/career-ops-evaluate.mjs --jobs data/app/career-ops-jobs.json --profile data/career-ops-profile.example.json --out data/app/career-ops-jobs.json

Options:
  --jobs <file>     Input Career Ops snapshot JSON
  --profile <file>  CV/profile JSON. Supports {role, skills, summary, experience, projects, preferences}
  --out <file>      Output JSON. Default: overwrite --jobs
  --help            Show this help
`);
}

function parseArgs(argv) {
  const args = { jobs: "", profile: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || "";
    else if (token === "--profile") args.profile = argv[++i] || "";
    else if (token === "--out") args.out = argv[++i] || "";
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function tokenize(value) {
  return Array.from(new Set(String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/^(and|the|with|for|you|our|我們|以及|或|與)$/.test(item))));
}

function normalizeProfile(profile) {
  const preferences = profile.preferences && typeof profile.preferences === "object" ? profile.preferences : {};
  const keywords = tokenize([
    profile.role,
    profile.summary,
    profile.skills,
    profile.experience,
    profile.projects,
    preferences.keywords,
    preferences.targetRoles
  ].flat().join(" "));
  const avoid = tokenize([preferences.avoidKeywords, preferences.exclude].flat().join(" "));
  return {
    keywords,
    avoid,
    preferredLocations: tokenize([preferences.locations, preferences.remote ? "remote" : ""].flat().join(" ")),
    preferredCompanies: tokenize(preferences.companies || "")
  };
}

function evaluateJob(job, profile) {
  const haystack = tokenize([job.title, job.company, job.location, job.description, job.employmentType].join(" "));
  const haystackSet = new Set(haystack);
  const found = profile.keywords.filter((keyword) => haystackSet.has(keyword));
  const missing = profile.keywords.filter((keyword) => !haystackSet.has(keyword)).slice(0, 12);
  const avoidHits = profile.avoid.filter((keyword) => haystackSet.has(keyword));
  const locationHits = profile.preferredLocations.filter((keyword) => haystackSet.has(keyword));
  const companyHits = profile.preferredCompanies.filter((keyword) => haystackSet.has(keyword));
  const base = 45;
  const keywordScore = Math.min(35, found.length * 4);
  const preferenceScore = Math.min(12, locationHits.length * 4 + companyHits.length * 4);
  const freshnessScore = job.isNew ? 5 : 0;
  const penalty = Math.min(25, avoidHits.length * 8 + (job.isExpired ? 30 : 0));
  const score = Math.max(0, Math.min(100, base + keywordScore + preferenceScore + freshnessScore - penalty));
  const grade = score >= 85 ? "A" : score >= 72 ? "B" : score >= 58 ? "C" : score >= 42 ? "D" : "F";
  const recommendation = score >= 78 ? "值得投遞" : score >= 58 ? "觀望" : "略過";
  return {
    ...job,
    score,
    grade,
    recommendation,
    status: job.status && job.status !== "待評估" ? job.status : recommendation,
    evaluatedAt: new Date().toISOString(),
    evaluation: {
      source: "career-ops-evaluate-heuristic",
      overall: {
        grade,
        score,
        recommendation,
        summary: `命中 ${found.length} 個履歷/偏好關鍵字，缺少 ${missing.length} 個高價值關鍵字${avoidHits.length ? `，並命中 ${avoidHits.length} 個排除訊號` : ""}。`
      },
      decision_factors: [
        found.length ? `履歷關鍵字命中：${found.slice(0, 8).join("、")}` : "履歷關鍵字命中偏低",
        locationHits.length ? `地點/遠端偏好命中：${locationHits.join("、")}` : "未命中明確地點偏好",
        job.isNew ? "新職缺，建議優先檢查" : "非新職缺"
      ],
      ats_keywords: { found: found.slice(0, 16), missing },
      risks: avoidHits.length ? [`命中排除或低偏好關鍵字：${avoidHits.join("、")}`] : [],
      next_actions: score >= 78
        ? ["確認職缺仍開放", "產生客製 ATS PDF", "安排 48 小時內投遞"]
        : ["補充 JD 細節或手動標記偏好", "與更高分職缺比較後再決定"]
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (!args.jobs || !args.profile) throw new Error("Use --jobs <file> and --profile <file>.");
  const jobsPayload = JSON.parse(await fs.readFile(args.jobs, "utf8"));
  const profile = normalizeProfile(JSON.parse(await fs.readFile(args.profile, "utf8")));
  const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
  const evaluated = jobs.map((job) => job.isExpired ? job : evaluateJob(job, profile));
  const payload = {
    ...jobsPayload,
    evaluatedAt: new Date().toISOString(),
    evaluatedBy: "career-ops-evaluate-heuristic",
    jobs: evaluated
  };
  const out = args.out || args.jobs;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[career-ops] evaluated ${evaluated.length} job(s) -> ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
