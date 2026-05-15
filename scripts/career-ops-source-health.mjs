#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCES = "data/career-ops-sources.json";
const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-source-health.json";
const DEFAULT_REPORT = "data/app/career-ops-source-health-report.md";

function printHelp() {
  console.log(`Career Ops source health

Builds an action backlog from the latest source inventory and scrape errors:
rendered discovery candidates, adapter candidates, and search-only sources.

Usage:
  node scripts/career-ops-source-health.mjs

Options:
  --sources <file>    Source inventory. Default: ${DEFAULT_SOURCES}
  --jobs <file>       Latest jobs snapshot. Default: ${DEFAULT_JOBS}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    sources: DEFAULT_SOURCES,
    jobs: DEFAULT_JOBS,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--sources") args.sources = argv[++i] || DEFAULT_SOURCES;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function actionFor(source, errorMessage) {
  const host = hostOf(source.url);
  const text = `${source.name || ""} ${source.url || ""} ${errorMessage || ""}`.toLowerCase();
  if (/google|apple|microsoft|nvidia|asml|micron|appliedmaterials|garmin|careers\.umc|aseglobal/.test(text)) {
    return "search-api-first";
  }
  if (/400|403|timeout|abort|navigation/i.test(errorMessage || "")) {
    return "rendered-discovery";
  }
  if (/smartrecruiters|greenhouse|lever|ashby|workable|bamboohr/.test(text)) {
    return "adapter";
  }
  if (/talent|zhaopin|career|careers|recruit/.test(host)) {
    return "platform-adapter";
  }
  return "watch";
}

function buildHealth(sourcesPayload, jobsPayload) {
  const sources = array(sourcesPayload.sources);
  const jobs = array(jobsPayload.jobs).filter((job) => !job.isExpired);
  const errors = array(jobsPayload.errors);
  const errorsByUrl = new Map(errors.map((error) => [String(error.url || "").trim(), error]));
  const jobsBySourceHost = new Map();
  for (const job of jobs) {
    const host = hostOf(job.url);
    if (!host) continue;
    jobsBySourceHost.set(host, (jobsBySourceHost.get(host) || 0) + 1);
  }
  const rows = sources.map((source) => {
    const error = errorsByUrl.get(source.url);
    const host = hostOf(source.url);
    const producedJobs = jobsBySourceHost.get(host) || 0;
    const action = error ? actionFor(source, error.message) : producedJobs ? "healthy" : "search-api-first";
    return {
      name: source.name || source.company || "",
      market: source.market || "",
      url: source.url,
      host,
      producedJobs,
      error: error?.message || "",
      action,
      priority: action === "healthy" ? 0 : /tw|cn/.test(source.market || "") ? 3 : action === "search-api-first" ? 2 : 1
    };
  }).sort((a, b) => b.priority - a.priority || a.market.localeCompare(b.market) || a.name.localeCompare(b.name));
  return {
    source: "career-ops-source-health",
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    activeJobCount: jobs.length,
    errorCount: errors.length,
    actionCounts: rows.reduce((acc, row) => {
      acc[row.action] = (acc[row.action] || 0) + 1;
      return acc;
    }, {}),
    backlog: rows.filter((row) => row.action !== "healthy")
  };
}

function renderReport(payload) {
  const backlog = array(payload.backlog);
  return `# Career Ops Source Health

- Generated: ${payload.generatedAt}
- Sources: ${payload.sourceCount}
- Active jobs: ${payload.activeJobCount}
- Scrape errors: ${payload.errorCount}
- Actions: ${Object.entries(payload.actionCounts || {}).map(([key, value]) => `${key} ${value}`).join(" / ") || "-"}

## High Priority Backlog

| Market | Company | Action | Error | URL |
|---|---|---|---|---|
${backlog.slice(0, 40).map((row) => `| ${row.market || "-"} | ${row.name || "-"} | ${row.action} | ${row.error || "-"} | ${row.url} |`).join("\n") || "| - | - | - | - | - |"}
`;
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const payload = buildHealth(await readJsonIfExists(args.sources), await readJsonIfExists(args.jobs));
  await writeText(args.out, `${JSON.stringify(payload, null, 2)}\n`);
  await writeText(args.reportOut, renderReport(payload));
  console.log(`[career-ops] source health backlog=${payload.backlog.length}, errors=${payload.errorCount}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
