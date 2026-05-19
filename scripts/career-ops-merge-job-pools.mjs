#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAIN = "data/app/career-ops-jobs.json";
const DEFAULT_UPSTREAM = "data/app/career-ops-upstream-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-combined-jobs.json";
const DEFAULT_JS_OUT = "data/app/career-ops-combined-jobs.js";
const DEFAULT_REPORT_OUT = "data/app/career-ops-combined-jobs-report.md";
const DEFAULT_TOP_LIMIT = 1000;

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gh_src",
  "ref",
  "source"
];

function printHelp() {
  console.log(`Career Ops merge job pools

Merges the main CV Studio Career Ops job pool with the imported upstream pool,
dedupes by stable jobKey, normalized URL, and company/title/location text, and
writes a combined pool suitable for the 100k comparison runner.

Usage:
  node scripts/career-ops-merge-job-pools.mjs

Options:
  --main <file>       Main app job pool. Default: ${DEFAULT_MAIN}
  --upstream <file>   Imported upstream job pool. Default: ${DEFAULT_UPSTREAM}
  --out <file>        Combined JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown merge report. Default: ${DEFAULT_REPORT_OUT}
  --top-limit <n>     Report/app-tracker sample size. Default: ${DEFAULT_TOP_LIMIT}
  --no-js             Skip browser JS output
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    main: DEFAULT_MAIN,
    upstream: DEFAULT_UPSTREAM,
    out: DEFAULT_OUT,
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT_OUT,
    topLimit: DEFAULT_TOP_LIMIT,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--main") args.main = argv[++i] || DEFAULT_MAIN;
    else if (token === "--upstream") args.upstream = argv[++i] || DEFAULT_UPSTREAM;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT_OUT;
    else if (token === "--top-limit") args.topLimit = Math.max(1, Number.parseInt(argv[++i] || `${DEFAULT_TOP_LIMIT}`, 10) || DEFAULT_TOP_LIMIT);
    else if (token === "--no-js") args.writeJs = false;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function compact(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

function compactLower(value) {
  return compact(value).toLowerCase();
}

function normalizeUrl(value) {
  const raw = compact(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.hash = "";
    for (const key of TRACKING_PARAMS) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.searchParams.sort();
    return parsed.href.toLowerCase();
  } catch {
    return "";
  }
}

function textKey(job) {
  const parts = [job.company, job.title, job.location].map(compactLower);
  if (!parts[0] || !parts[1]) return "";
  return `text:${parts.join("|")}`;
}

function urlKey(job) {
  const normalized = normalizeUrl(job.url);
  return normalized ? `url:${normalized}` : "";
}

function stableJobKey(job) {
  const raw = compactLower(job.jobKey || job.job_key);
  if (!raw || /^job-\d+$/.test(raw) || raw.startsWith("generated:")) return "";
  if (raw.startsWith("url:") || raw.startsWith("text:")) return raw;
  return `jobkey:${raw}`;
}

function jobKeys(job) {
  return [
    stableJobKey(job),
    urlKey(job),
    textKey(job)
  ].filter(Boolean);
}

function arrays(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flat(Infinity);
  return [value];
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const item of arrays(values)) {
    const value = compact(item);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function latestDate(...values) {
  const sorted = values
    .map((value) => compact(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return sorted[0] || "";
}

function earliestDate(...values) {
  const sorted = values
    .map((value) => compact(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return sorted[0] || "";
}

function longerText(current, incoming, minimumGain = 1.25) {
  const currentText = compact(current);
  const incomingText = compact(incoming);
  if (!incomingText) return currentText;
  if (!currentText) return incomingText;
  if (currentText.length < 220 && incomingText.length > currentText.length) return incomingText;
  if (incomingText.length >= Math.round(currentText.length * minimumGain)) return incomingText;
  return currentText;
}

function preferField(current, incoming) {
  return compact(current) || compact(incoming);
}

function mergeQuality(a, b) {
  const scoreA = Number(a?.score ?? -1);
  const scoreB = Number(b?.score ?? -1);
  if (scoreB > scoreA) return b;
  return a || b || undefined;
}

function mergeJob(existing, incoming, pool, now) {
  const mergedPools = uniqueStrings([existing.mergedPools, pool]);
  const duplicateSources = uniqueStrings([existing.duplicateSources, incoming.source, incoming.sourceType, incoming.url]);
  const currentDescription = String(existing.description || "");
  const nextDescription = longerText(currentDescription, incoming.description);
  const sourceQuality = mergeQuality(existing.sourceQuality, incoming.sourceQuality);
  const next = {
    ...existing,
    title: preferField(existing.title, incoming.title),
    company: preferField(existing.company, incoming.company),
    url: preferField(existing.url, incoming.url),
    location: preferField(existing.location, incoming.location),
    description: nextDescription,
    source: preferField(existing.source, incoming.source),
    sourceType: preferField(existing.sourceType, incoming.sourceType),
    sourceMarket: preferField(existing.sourceMarket, incoming.sourceMarket),
    employmentType: preferField(existing.employmentType, incoming.employmentType),
    salary: preferField(existing.salary, incoming.salary),
    compensation: preferField(existing.compensation, incoming.compensation),
    datePosted: latestDate(existing.datePosted, incoming.datePosted),
    firstSeenAt: earliestDate(existing.firstSeenAt, incoming.firstSeenAt) || existing.firstSeenAt || incoming.firstSeenAt || now,
    lastSeenAt: latestDate(existing.lastSeenAt, incoming.lastSeenAt) || now,
    expiredAt: existing.isExpired && incoming.isExpired ? latestDate(existing.expiredAt, incoming.expiredAt) : "",
    isExpired: Boolean(existing.isExpired && incoming.isExpired),
    isNew: Boolean(existing.isNew || incoming.isNew),
    mergedPools,
    sourcePool: mergedPools.join("+"),
    duplicateSources,
    mergedDuplicateCount: Number(existing.mergedDuplicateCount || 1) + 1
  };
  if (sourceQuality) next.sourceQuality = sourceQuality;
  return next;
}

function qualityScore(job) {
  const score = Number(job.sourceQuality?.score);
  if (Number.isFinite(score)) return score;
  const descriptionLength = String(job.description || "").length;
  if (/^adapter:/i.test(String(job.sourceType || ""))) return 90;
  if (descriptionLength > 900) return 78;
  if (descriptionLength > 450) return 68;
  return 52;
}

function postedRank(job) {
  const dates = [job.datePosted, job.lastSeenAt, job.firstSeenAt]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return dates.length ? Math.max(...dates) : 0;
}

function sortJobs(jobs) {
  return jobs.sort((a, b) =>
    Number(a.isExpired) - Number(b.isExpired) ||
    qualityScore(b) - qualityScore(a) ||
    Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)) ||
    postedRank(b) - postedRank(a) ||
    String(b.description || "").length - String(a.description || "").length ||
    compactLower(a.company).localeCompare(compactLower(b.company)) ||
    compactLower(a.title).localeCompare(compactLower(b.title))
  );
}

function hasPool(job, pool) {
  return arrays(job.mergedPools).includes(pool);
}

function weightedInterleave(groups, pattern) {
  const output = [];
  const indexes = Object.fromEntries(Object.keys(groups).map((key) => [key, 0]));
  let guard = 0;
  const total = Object.values(groups).reduce((sum, group) => sum + group.length, 0);
  while (output.length < total && guard < total * pattern.length * 2) {
    for (const key of pattern) {
      const group = groups[key] || [];
      if (indexes[key] < group.length) output.push(group[indexes[key]++]);
    }
    guard += 1;
    if (pattern.every((key) => indexes[key] >= (groups[key] || []).length)) break;
  }
  for (const [key, group] of Object.entries(groups)) {
    while (indexes[key] < group.length) output.push(group[indexes[key]++]);
  }
  return output;
}

function orderMergedJobs(jobs) {
  const active = jobs.filter((job) => !job.isExpired);
  const expired = sortJobs(jobs.filter((job) => job.isExpired));
  const groups = {
    overlap: sortJobs(active.filter((job) => hasPool(job, "main") && hasPool(job, "upstream"))),
    main: sortJobs(active.filter((job) => hasPool(job, "main") && !hasPool(job, "upstream"))),
    upstream: sortJobs(active.filter((job) => hasPool(job, "upstream") && !hasPool(job, "main")))
  };
  return [
    ...weightedInterleave(groups, ["overlap", "main", "upstream", "main", "main"]),
    ...expired
  ];
}

function poolCounts(jobs) {
  const counts = {
    total: jobs.length,
    active: jobs.filter((job) => !job.isExpired).length,
    mainOnly: 0,
    upstreamOnly: 0,
    overlap: 0,
    expired: jobs.filter((job) => job.isExpired).length
  };
  for (const job of jobs) {
    const main = hasPool(job, "main");
    const upstream = hasPool(job, "upstream");
    if (main && upstream) counts.overlap += 1;
    else if (main) counts.mainOnly += 1;
    else if (upstream) counts.upstreamOnly += 1;
  }
  return counts;
}

function eligibleForApp(job) {
  return !job.isExpired && String(job.description || "").replace(String(job.url || ""), "").trim().length >= 80;
}

function topSample(jobs, limit) {
  const sample = jobs.slice(0, limit);
  return {
    limit,
    importedJobs: sample.length,
    eligibleJobs: sample.filter(eligibleForApp).length,
    ...poolCounts(sample)
  };
}

function addJob(indexes, merged, job, pool, now, stats) {
  const incoming = {
    ...job,
    mergedPools: uniqueStrings([job.mergedPools, pool]),
    sourcePool: pool,
    duplicateSources: uniqueStrings([job.source, job.sourceType, job.url]),
    mergedDuplicateCount: Number(job.mergedDuplicateCount || 1),
    firstSeenAt: job.firstSeenAt || now,
    lastSeenAt: job.lastSeenAt || now,
    isExpired: Boolean(job.isExpired)
  };
  const keys = jobKeys(incoming);
  let existingIndex = -1;
  for (const key of keys) {
    if (indexes.has(key)) {
      existingIndex = indexes.get(key);
      break;
    }
  }
  if (existingIndex >= 0) {
    merged[existingIndex] = mergeJob(merged[existingIndex], incoming, pool, now);
    for (const key of jobKeys(merged[existingIndex])) indexes.set(key, existingIndex);
    stats.duplicates += 1;
    return;
  }
  const stableKey = stableJobKey(incoming) || urlKey(incoming) || textKey(incoming) || `generated:${pool}:${merged.length}`;
  const next = {
    ...incoming,
    jobKey: stableKey
  };
  merged.push(next);
  const nextIndex = merged.length - 1;
  for (const key of jobKeys(next)) indexes.set(key, nextIndex);
}

function mergePools(mainPayload, upstreamPayload, args) {
  const now = new Date().toISOString();
  const mainJobs = Array.isArray(mainPayload.jobs) ? mainPayload.jobs : [];
  const upstreamJobs = Array.isArray(upstreamPayload.jobs) ? upstreamPayload.jobs : [];
  const errors = [
    ...arrays(mainPayload.errors),
    ...arrays(upstreamPayload.errors)
  ];
  const merged = [];
  const indexes = new Map();
  const stats = { duplicates: 0 };

  for (const job of mainJobs) addJob(indexes, merged, job, "main", now, stats);
  for (const job of upstreamJobs) addJob(indexes, merged, job, "upstream", now, stats);

  const orderedJobs = orderMergedJobs(merged);
  const counts = poolCounts(orderedJobs);
  const report = {
    generatedAt: now,
    mainInputJobs: mainJobs.length,
    upstreamInputJobs: upstreamJobs.length,
    inputJobs: mainJobs.length + upstreamJobs.length,
    duplicateJobsRemoved: stats.duplicates,
    outputJobs: orderedJobs.length,
    activeOutputJobs: counts.active,
    expiredOutputJobs: counts.expired,
    poolCounts: counts,
    topSample: topSample(orderedJobs, args.topLimit)
  };

  return {
    source: "career-ops-combined-pool",
    generatedAt: now,
    inputs: {
      main: args.main,
      upstream: args.upstream
    },
    mergePolicy: {
      duplicateKeys: ["jobKey", "normalized-url", "company-title-location"],
      duplicatePreference: "main pool first; fill missing fields from upstream; keep longer thin descriptions",
      ordering: "active high-quality jobs first with weighted main/upstream interleave for app tracker comparison"
    },
    sourceCount: Number(mainPayload.sourceCount || 0) + Number(upstreamPayload.sourceCount || 0),
    jobCount: counts.active,
    newJobCount: orderedJobs.filter((job) => job.isNew && !job.isExpired).length,
    expiredJobCount: counts.expired,
    duplicateJobCount: stats.duplicates,
    mergeReport: report,
    jobs: orderedJobs,
    errors
  };
}

function renderReport(payload) {
  const report = payload.mergeReport || {};
  const counts = report.poolCounts || {};
  const sample = report.topSample || {};
  return `# Career Ops Combined Job Pool

- Generated: ${payload.generatedAt}
- Main input jobs: ${report.mainInputJobs || 0}
- Upstream input jobs: ${report.upstreamInputJobs || 0}
- Duplicate jobs removed: ${report.duplicateJobsRemoved || 0}
- Output jobs: ${report.outputJobs || 0}
- Active output jobs: ${report.activeOutputJobs || 0}
- Expired output jobs: ${report.expiredOutputJobs || 0}

## Pool Mix

- Main only: ${counts.mainOnly || 0}
- Upstream only: ${counts.upstreamOnly || 0}
- Main + upstream overlap: ${counts.overlap || 0}

## App Tracker Sample

- Sample limit: ${sample.limit || 0}
- Imported jobs in first slice: ${sample.importedJobs || 0}
- App-eligible jobs in first slice: ${sample.eligibleJobs || 0}
- Main only in first slice: ${sample.mainOnly || 0}
- Upstream only in first slice: ${sample.upstreamOnly || 0}
- Main + upstream overlap in first slice: ${sample.overlap || 0}

## Merge Policy

- Duplicate keys: ${(payload.mergePolicy?.duplicateKeys || []).join(", ")}
- Duplicate preference: ${payload.mergePolicy?.duplicatePreference || ""}
- Ordering: ${payload.mergePolicy?.ordering || ""}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const [mainPayload, upstreamPayload] = await Promise.all([
    readJson(args.main),
    readJson(args.upstream)
  ]);
  const combined = mergePools(mainPayload, upstreamPayload, args);
  await Promise.all([
    writeText(args.out, `${JSON.stringify(combined)}\n`),
    writeText(args.reportOut, renderReport(combined)),
    args.writeJs ? writeText(args.jsOut, `window.CV_CAREER_OPS_COMBINED_JOBS = ${JSON.stringify(combined)};\n`) : Promise.resolve()
  ]);
  console.log(`[career-ops] combined pool ${combined.mergeReport.outputJobs}/${combined.mergeReport.inputJobs} job(s); removed ${combined.mergeReport.duplicateJobsRemoved} duplicate(s)`);
  console.log(`[career-ops] active jobs ${combined.mergeReport.activeOutputJobs}; first ${combined.mergeReport.topSample.limit} slice eligible ${combined.mergeReport.topSample.eligibleJobs}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
