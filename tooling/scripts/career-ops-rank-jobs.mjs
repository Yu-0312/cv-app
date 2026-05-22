#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { evaluateJob, normalizeProfile } from "./career-ops-evaluate.mjs";

const DEFAULT_JOBS = "tooling/data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "tooling/data/career-ops-profile.example.json";
const DEFAULT_OUT = "tooling/data/app/career-ops-full-pool-ranking.json";
const DEFAULT_REPORT_OUT = "tooling/data/app/career-ops-full-pool-ranking.md";
const DEFAULT_TOP = 250;

function printHelp() {
  console.log(`Career Ops full-pool job ranker

Scores one CV/profile against every eligible job in the snapshot and writes the
best matches only, so product flows can search a 100k-class job pool without
persisting every row into the browser tracker.

Usage:
  node scripts/career-ops-rank-jobs.mjs --profile data/career-ops-profile.example.json

Options:
  --jobs <file>        Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>     CV/profile JSON. Default: ${DEFAULT_PROFILE}
  --top <n>            Number of top matches to keep. Default: ${DEFAULT_TOP}
  --include-expired    Include expired jobs. Default: active jobs only
  --min-description <n> Minimum JD text length after URL stripping. Default: 80
  --out <file>         Summary JSON output. Default: ${DEFAULT_OUT}
  --report-out <file>  Markdown report output. Default: ${DEFAULT_REPORT_OUT}
  --help               Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: DEFAULT_PROFILE,
    top: DEFAULT_TOP,
    includeExpired: false,
    minDescription: 80,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT_OUT
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--top") args.top = Number(argv[++i] || DEFAULT_TOP);
    else if (token === "--include-expired") args.includeExpired = true;
    else if (token === "--min-description") args.minDescription = Number(argv[++i] || 80);
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT_OUT;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function jobDescriptionLength(job = {}) {
  return String(job.description || "").replace(String(job.url || ""), "").trim().length;
}

function jobKey(job = {}, index = 0) {
  const url = String(job.url || "").trim();
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => parsed.searchParams.delete(key));
      return `url:${parsed.href.toLowerCase()}`;
    } catch {}
  }
  const fallback = [job.company, job.title, job.location].map((item) => String(item || "").trim().toLowerCase()).join("|");
  return fallback ? `text:${fallback}` : `job-${index + 1}`;
}

function recommendationCounts(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.recommendation || "unknown", (counts.get(item.recommendation || "unknown") || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function gradeCounts(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.grade || "unknown", (counts.get(item.grade || "unknown") || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function average(items, getter) {
  if (!items.length) return 0;
  return Math.round((items.reduce((sum, item) => sum + Number(getter(item) || 0), 0) / items.length) * 100) / 100;
}

function descriptionQualityScore(job = {}) {
  const length = jobDescriptionLength(job);
  if (!length) return 0;
  if (length < 120) return 25;
  if (length < 300) return 55;
  if (length < 800) return 75;
  return 95;
}

function rankScore(evaluated, sourceJob) {
  const dimensions = evaluated.dimensions || {};
  const foundKeywords = evaluated.evaluation?.ats_keywords?.found || [];
  const missingKeywords = evaluated.evaluation?.ats_keywords?.missing || [];
  const blockG = evaluated.blockG?.tier || "";
  const blockBonus = blockG === "High Confidence" ? 200 : blockG === "Proceed with Caution" ? 0 : -1000;
  const salaryBonus = Number(dimensions.compensation?.score || 0) >= 72 ? 30 : 0;
  return Number(evaluated.score || 0) * 10000 +
    Number(dimensions.cvMatch?.score || 0) * 45 +
    Number(dimensions.northStar?.score || 0) * 35 +
    Number(dimensions.culture?.score || 0) * 12 +
    Number(dimensions.redFlags?.score || 0) * 10 +
    Number(dimensions.effort?.score || 0) * 8 +
    foundKeywords.length * 120 -
    missingKeywords.length * 12 +
    blockBonus +
    descriptionQualityScore(sourceJob) +
    salaryBonus +
    (sourceJob.isNew ? 25 : 0) +
    (sourceJob.url ? 10 : 0);
}

function compactJob(evaluated, sourceJob, index) {
  const dimensions = evaluated.dimensions || {};
  return {
    rank: index + 1,
    rankScore: rankScore(evaluated, sourceJob),
    jobKey: jobKey(sourceJob, index),
    company: evaluated.company || "",
    title: evaluated.title || "",
    location: evaluated.location || "",
    url: evaluated.url || "",
    source: evaluated.source || "",
    sourceType: evaluated.sourceType || evaluated.source_type || "",
    score: evaluated.score,
    rating: evaluated.rating,
    grade: evaluated.grade,
    recommendation: evaluated.recommendation,
    blockG: evaluated.blockG?.tier || "",
    summary: evaluated.evaluation?.overall?.summary || "",
    dimensions: {
      cvMatch: dimensions.cvMatch?.score ?? null,
      northStar: dimensions.northStar?.score ?? null,
      compensation: dimensions.compensation?.score ?? null,
      culture: dimensions.culture?.score ?? null,
      redFlags: dimensions.redFlags?.score ?? null,
      effort: dimensions.effort?.score ?? null
    },
    foundKeywords: evaluated.evaluation?.ats_keywords?.found || [],
    missingKeywords: evaluated.evaluation?.ats_keywords?.missing || []
  };
}

function renderReport(summary) {
  const topRows = summary.topMatches.slice(0, 20).map((item) =>
    `- ${item.rank}. ${item.score}/100 (${item.rating}/5, ${item.grade}) - ${item.company} / ${item.title} - ${item.recommendation}`
  );
  return [
    "# 全職缺池履歷匹配排名",
    "",
    `產生時間：${summary.generatedAt}`,
    "",
    "## 執行範圍",
    `- 履歷：${summary.profile.name || summary.profile.role || summary.inputs.profile}`,
    `- 職缺快照：${summary.coverage.snapshotJobs} 筆`,
    `- 可評分職缺：${summary.coverage.eligibleJobs} 筆`,
    `- 實際評分：${summary.coverage.scoredJobs} 筆`,
    `- 保留 top：${summary.coverage.topKept} 筆`,
    `- 耗時：${summary.durationMs} ms`,
    "",
    "## 結果摘要",
    `- 平均分數：${summary.scoreSummary.averageScore}/100`,
    `- 最高分：${summary.scoreSummary.maxScore}/100`,
    `- Top 建議分布：${Object.entries(summary.topRecommendationDistribution).map(([key, value]) => `${key} ${value}`).join("、")}`,
    `- 全池等級分布：${Object.entries(summary.gradeDistribution).map(([key, value]) => `${key} ${value}`).join("、")}`,
    "",
    "## Top Matches",
    ...topRows
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const startedAt = Date.now();
  const [jobsPayload, rawProfile] = await Promise.all([readJson(args.jobs), readJson(args.profile)]);
  const profile = normalizeProfile(rawProfile);
  const snapshotJobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
  const eligible = snapshotJobs
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => args.includeExpired || !job.isExpired)
    .filter(({ job }) => jobDescriptionLength(job) >= args.minDescription);

  const scored = eligible.map(({ job, index }) => {
    const evaluated = evaluateJob(job, profile);
    return { sourceJob: job, index, evaluated, rankScore: rankScore(evaluated, job) };
  });
  scored.sort((a, b) =>
    Number(b.evaluated.score || 0) - Number(a.evaluated.score || 0) ||
    Number(b.rankScore || 0) - Number(a.rankScore || 0) ||
    String(a.evaluated.company || "").localeCompare(String(b.evaluated.company || "")) ||
    String(a.evaluated.title || "").localeCompare(String(b.evaluated.title || ""))
  );
  const top = scored.slice(0, Math.max(1, Math.floor(args.top))).map((item, index) => compactJob(item.evaluated, item.sourceJob, index));
  const allEvaluated = scored.map((item) => item.evaluated);
  const summary = {
    generatedAt: new Date().toISOString(),
    executionMode: "single-profile-full-job-pool-ranking",
    inputs: {
      jobs: args.jobs,
      profile: args.profile,
      top: args.top,
      includeExpired: args.includeExpired,
      minDescription: args.minDescription
    },
    profile: {
      name: rawProfile.name || rawProfile.fullName || rawProfile.displayName || rawProfile.basics?.name || "",
      role: rawProfile.role || rawProfile.targetRole || rawProfile.basics?.label || "",
      normalizedRole: profile.role,
      skillCount: profile.rawSkills.length,
      targetRoles: profile.targetRoles
    },
    coverage: {
      snapshotJobs: snapshotJobs.length,
      activeJobs: snapshotJobs.filter((job) => !job.isExpired).length,
      eligibleJobs: eligible.length,
      scoredJobs: scored.length,
      topKept: top.length
    },
    scoreSummary: {
      averageScore: average(allEvaluated, (item) => item.score),
      averageRating: average(allEvaluated, (item) => item.rating),
      maxScore: top[0]?.score || 0,
      maxRating: top[0]?.rating || 0
    },
    gradeDistribution: gradeCounts(allEvaluated),
    recommendationDistribution: recommendationCounts(allEvaluated),
    topRecommendationDistribution: recommendationCounts(top),
    topMatches: top,
    durationMs: Date.now() - startedAt
  };

  await Promise.all([ensureDir(args.out), ensureDir(args.reportOut)]);
  await fs.writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fs.writeFile(args.reportOut, `${renderReport(summary)}\n`, "utf8");
  console.log(`[career-ops] scored ${summary.coverage.scoredJobs} job(s) for one profile`);
  console.log(`[career-ops] top ${summary.coverage.topKept} -> ${args.out}`);
  console.log(`[career-ops] report -> ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
