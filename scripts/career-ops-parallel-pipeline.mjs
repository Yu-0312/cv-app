#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PROFILE = fsSync.existsSync("data/career-ops-profile.json")
  ? "data/career-ops-profile.json"
  : "data/career-ops-profile.example.json";
const DEFAULT_RUBRIC = fsSync.existsSync("data/career-ops-rubric.json")
  ? "data/career-ops-rubric.json"
  : "data/career-ops-rubric.example.json";

function printHelp() {
  console.log(`Career Ops parallel pipeline

Runs the Career Ops backend with bounded parallel fan-out. The scan stage splits
sources across worker processes, then merges normalized job snapshots before
running scoring, intelligence, deep research, compensation, story bank, apply
agent, and application-kit stages.

Usage:
  node scripts/career-ops-parallel-pipeline.mjs --concurrency 4

Options:
  --profile <file>      Profile JSON. Default: ${DEFAULT_PROFILE}
  --strategy <file>     Source strategy JSON. Default: data/career-ops-source-strategy.json
  --rubric <file>       Rubric JSON. Default: ${DEFAULT_RUBRIC}
  --sources <file>      Sources JSON. Default: data/career-ops-sources.json
  --concurrency <n>     Parallel source-scan workers. Default: min(4, CPU count)
  --skip-source-build   Do not build sources from strategy first
  --skip-source-flex    Do not expand sources with flex rules
  --skip-scrape         Skip parallel network scrape
  --skip-quality        Do not run source quality gate
  --skip-modes          Do not generate command registry artifacts
  --include-expired     Preserve expired jobs from previous snapshot
  --help                Show this help
`);
}

function parseArgs(argv) {
  const args = {
    profile: DEFAULT_PROFILE,
    strategy: "data/career-ops-source-strategy.json",
    rubric: DEFAULT_RUBRIC,
    sources: "data/career-ops-sources.json",
    concurrency: Math.max(1, Math.min(4, os.cpus().length || 2)),
    skipSourceBuild: false,
    skipSourceFlex: false,
    skipScrape: false,
    skipQuality: false,
    skipModes: false,
    includeExpired: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--profile") args.profile = argv[++i] || args.profile;
    else if (token === "--strategy") args.strategy = argv[++i] || args.strategy;
    else if (token === "--rubric") args.rubric = argv[++i] || args.rubric;
    else if (token === "--sources") args.sources = argv[++i] || args.sources;
    else if (token === "--concurrency") args.concurrency = Math.max(1, Number.parseInt(argv[++i] || "4", 10) || 4);
    else if (token === "--skip-source-build") args.skipSourceBuild = true;
    else if (token === "--skip-source-flex") args.skipSourceFlex = true;
    else if (token === "--skip-scrape") args.skipScrape = true;
    else if (token === "--skip-quality") args.skipQuality = true;
    else if (token === "--skip-modes") args.skipModes = true;
    else if (token === "--include-expired") args.includeExpired = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function runProcess(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`[career-ops:parallel] start ${label}`);
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`[career-ops:parallel] done ${label}`);
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code}`));
      }
    });
  });
}

async function runSequential(label, command, args) {
  await runProcess(label, command, args);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function chunkArray(items, count) {
  const chunks = Array.from({ length: Math.max(1, count) }, () => []);
  items.forEach((item, index) => chunks[index % chunks.length].push(item));
  return chunks.filter((chunk) => chunk.length);
}

function stableJobKey(job) {
  const url = String(job?.url || "").trim();
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
        parsed.searchParams.delete(key);
      }
      return `url:${parsed.href.toLowerCase()}`;
    } catch {}
  }
  return `text:${[job?.company, job?.title, job?.location].map((item) => String(item || "").trim().toLowerCase()).join("|")}`;
}

async function mergeWorkerOutputs(files, previousPath, includeExpired) {
  const jobs = [];
  const errors = [];
  let sourceCount = 0;
  for (const filePath of files) {
    const payload = await readJson(filePath);
    sourceCount += Number(payload.sourceCount || 0);
    jobs.push(...(Array.isArray(payload.jobs) ? payload.jobs.filter((job) => !job.isExpired) : []));
    errors.push(...(Array.isArray(payload.errors) ? payload.errors : []));
  }
  const previous = fsSync.existsSync(previousPath) ? await readJson(previousPath) : {};
  const previousJobs = Array.isArray(previous.jobs) ? previous.jobs : [];
  const previousByKey = new Map(previousJobs.map((job) => [job.jobKey || stableJobKey(job), job]));
  const now = new Date().toISOString();
  const seen = new Set();
  const active = [];
  for (const job of jobs) {
    const key = job.jobKey || stableJobKey(job);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = previousByKey.get(key);
    active.push({
      ...job,
      jobKey: key,
      firstSeenAt: prev?.firstSeenAt || job.firstSeenAt || now,
      lastSeenAt: now,
      isNew: !prev,
      isExpired: false,
      expiredAt: ""
    });
  }
  const expired = includeExpired
    ? previousJobs
      .filter((job) => !seen.has(job.jobKey || stableJobKey(job)))
      .map((job) => ({ ...job, isNew: false, isExpired: true, expiredAt: job.expiredAt || now }))
    : [];
  return {
    source: "career-ops-parallel-pipeline",
    extractedAt: now,
    sourceCount,
    jobCount: active.length,
    newJobCount: active.filter((job) => job.isNew).length,
    expiredJobCount: expired.length,
    jobs: [...active, ...expired],
    errors
  };
}

async function writeBrowserJs(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `window.CV_CAREER_OPS_JOBS = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
}

async function writeReport(filePath, report) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, report, "utf8");
}

function renderParallelReport({ startedAt, finishedAt, concurrency, chunkCount, sourceCount, jobCount, errors }) {
  return `# Career Ops Parallel Pipeline Report

- Started: ${startedAt}
- Finished: ${finishedAt}
- Concurrency: ${concurrency}
- Source chunks: ${chunkCount}
- Sources scanned: ${sourceCount}
- Jobs: ${jobCount}
- Errors: ${errors.length}

## Worker Errors

${errors.map((error) => `- ${error.url || "unknown"}: ${error.message}`).join("\n") || "- None"}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const startedAt = new Date().toISOString();

  if (!args.skipSourceBuild && fsSync.existsSync(args.strategy)) {
    await runSequential("source-strategy", "node", [
      "scripts/career-ops-build-sources.mjs",
      "--strategy", args.strategy,
      "--out", args.sources,
      "--report-out", "data/app/career-ops-source-strategy-report.md"
    ]);
  }

  if (!args.skipSourceFlex && fsSync.existsSync("data/career-ops-source-flex.json")) {
    await runSequential("source-flex", "node", [
      "scripts/career-ops-source-flex.mjs",
      "--sources", args.sources,
      "--profile", args.profile,
      "--rules", "data/career-ops-source-flex.json",
      "--out", args.sources,
      "--report-out", "data/app/career-ops-source-flex-report.md"
    ]);
  }

  if (!args.skipScrape) {
    const payload = await readJson(args.sources);
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    if (!sources.length) throw new Error(`No sources in ${args.sources}`);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "career-ops-parallel-"));
    const chunks = chunkArray(sources, Math.min(args.concurrency, sources.length));
    const outputFiles = [];
    await Promise.all(chunks.map(async (chunk, index) => {
      const sourceFile = path.join(tmpDir, `sources-${index}.json`);
      const jsonOut = path.join(tmpDir, `jobs-${index}.json`);
      const jsOut = path.join(tmpDir, `jobs-${index}.js`);
      outputFiles.push(jsonOut);
      await writeJson(sourceFile, {
        source: "career-ops-parallel-chunk",
        titleFilter: payload.titleFilter || {},
        sources: chunk
      });
      await runProcess(`scan worker ${index + 1}/${chunks.length}`, "node", [
        "scripts/career-ops-worker.mjs",
        "--source", sourceFile,
        "--json-out", jsonOut,
        "--js-out", jsOut,
        "--previous", "",
        "--include-expired"
      ]);
    }));
    const merged = await mergeWorkerOutputs(outputFiles, "data/app/career-ops-jobs.json", args.includeExpired);
    await writeJson("data/app/career-ops-jobs.json", merged);
    await writeBrowserJs("data/app/career-ops-jobs.js", merged);
    await writeReport("data/app/career-ops-parallel-report.md", renderParallelReport({
      startedAt,
      finishedAt: new Date().toISOString(),
      concurrency: args.concurrency,
      chunkCount: chunks.length,
      sourceCount: merged.sourceCount,
      jobCount: merged.jobCount,
      errors: merged.errors
    }));
  }

  if (!args.skipQuality) {
    await runSequential("source quality", "node", [
      "scripts/career-ops-source-quality.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--out", "data/app/career-ops-jobs.json",
      "--js-out", "data/app/career-ops-jobs.js",
      "--report-out", "data/app/career-ops-source-quality-report.md"
    ]);
  }

  await runSequential("evaluation", "node", [
    "scripts/career-ops-evaluate.mjs",
    "--jobs", "data/app/career-ops-jobs.json",
    "--profile", args.profile,
    "--out", "data/app/career-ops-jobs.json"
  ]);
  await Promise.all([
    runProcess("intelligence", "node", [
      "scripts/career-ops-intelligence.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--rubric", args.rubric,
      "--out", "data/app/career-ops-jobs.json",
      "--js-out", "data/app/career-ops-jobs.js",
      "--report-out", "data/app/career-ops-intelligence-report.md"
    ]),
    runProcess("deep research", "node", [
      "scripts/career-ops-deep-research.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--sources", args.sources,
      "--out", "data/app/career-ops-deep-research.json",
      "--js-out", "data/app/career-ops-deep-research.js",
      "--report-out", "data/app/career-ops-deep-research.md"
    ])
  ]);
  await Promise.all([
    runProcess("application kit", "node", [
      "scripts/career-ops-application-kit.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--out", "data/app/career-ops-application-kit.json",
      "--js-out", "data/app/career-ops-application-kit.js",
      "--report-out", "data/app/career-ops-application-kit.md"
    ]),
    runProcess("compensation", "node", [
      "scripts/career-ops-compensation.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile
    ]),
    runProcess("story bank", "node", [
      "scripts/career-ops-story-bank.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile
    ]),
    runProcess("apply agent", "node", [
      "scripts/career-ops-apply-agent.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--dry-run",
      "--out", "data/app/career-ops-apply-agent-report.json",
      "--report-out", "data/app/career-ops-apply-agent-report.md"
    ]),
    runProcess("learning", "node", [
      "scripts/career-ops-learning.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--sources", args.sources,
      "--out", "data/app/career-ops-learning.json",
      "--js-out", "data/app/career-ops-learning.js",
      "--report-out", "data/app/career-ops-learning-report.md"
    ])
  ]);
  await Promise.all([
    runProcess("deep fit", "node", [
      "scripts/career-ops-deep-fit.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--research", "data/app/career-ops-deep-research.json",
      "--compensation", "data/app/career-ops-compensation.json",
      "--story-bank", "data/app/career-ops-story-bank.json",
      "--out", "data/app/career-ops-deep-fit.json",
      "--js-out", "data/app/career-ops-deep-fit.js",
      "--report-out", "data/app/career-ops-deep-fit.md"
    ]),
    runProcess("job-level parallel merge", "node", [
      "scripts/career-ops-parallel.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--research", "data/app/career-ops-deep-research.json",
      "--compensation", "data/app/career-ops-compensation.json",
      "--story-bank", "data/app/career-ops-story-bank.json",
      "--out", "data/app/career-ops-parallel-report.json",
      "--js-out", "data/app/career-ops-parallel-report.js",
      "--report-out", "data/app/career-ops-parallel-report.md",
      "--concurrency", String(args.concurrency)
    ])
  ]);

  await runSequential("decision report", "node", [
    "scripts/career-ops-decision-report.mjs",
    "--jobs", "data/app/career-ops-jobs.json",
    "--profile", args.profile,
    "--research", "data/app/career-ops-deep-research.json",
    "--compensation", "data/app/career-ops-compensation.json",
    "--story-bank", "data/app/career-ops-story-bank.json",
    "--application-kit", "data/app/career-ops-application-kit.json",
    "--deep-fit", "data/app/career-ops-deep-fit.json",
    "--out", "data/app/career-ops-decision-report.json",
    "--js-out", "data/app/career-ops-decision-report.js",
    "--report-out", "data/app/career-ops-decision-report.md"
  ]);

  if (!args.skipModes) {
    await runSequential("modes", "node", [
      "scripts/career-ops-modes.mjs",
      "--in", "data/career-ops-modes.json",
      "--out", "data/app/career-ops-modes.json",
      "--js-out", "data/app/career-ops-modes.js",
      "--report-out", "data/app/career-ops-modes-report.md"
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
