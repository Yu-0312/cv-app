#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const DEFAULT_PROFILE = fs.existsSync("data/career-ops-profile.json")
  ? "data/career-ops-profile.json"
  : "data/career-ops-profile.example.json";
const DEFAULT_RUBRIC = fs.existsSync("data/career-ops-rubric.json")
  ? "data/career-ops-rubric.json"
  : "data/career-ops-rubric.example.json";

function printHelp() {
  console.log(`Career Ops pipeline runner

Runs the backend Career Ops stages as explicit agent-style steps: source strategy,
optional search ingestion, scrape, evaluate, intelligence, and application kit.

Usage:
  node scripts/career-ops-pipeline.mjs
  node scripts/career-ops-pipeline.mjs --search-results data/raw/search-results.html

Options:
  --profile <file>          Profile JSON. Default: ${DEFAULT_PROFILE}
  --strategy <file>         Source strategy JSON. Default: data/career-ops-source-strategy.json if present
  --rubric <file>           Rubric JSON. Default: ${DEFAULT_RUBRIC}
  --search-results <file>   Curated search results file. Can be repeated
  --health-threshold <n>    Expiry ratio that triggers auto re-scrape (0-1). Default: 0.30
  --skip-health             Skip job health monitor check
  --skip-source-flex        Skip flexible source expansion
  --skip-scrape             Skip network scrape
  --skip-quality            Skip source quality gate
  --skip-evaluate           Skip heuristic evaluation
  --skip-intelligence       Skip intelligence scoring
  --skip-application-kit    Skip application playbook generation
  --skip-deep-research      Skip company/job deep research
  --skip-compensation       Skip compensation and negotiation planning
  --skip-story-bank         Skip STAR story bank generation
  --skip-parallel           Skip job-level parallel worker merge
  --skip-modes              Skip command registry artifact generation
  --deep-fit-top-a <n>      Layer A dossier count. Default: 25
  --deep-fit-top-b <n>      Layer B standard match count. Default: 40
  --deep-fit-top-c <n>      Layer C exploratory count. Default: 30
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const args = {
    profile: DEFAULT_PROFILE,
    strategy: fs.existsSync("data/career-ops-source-strategy.json") ? "data/career-ops-source-strategy.json" : "",
    rubric: DEFAULT_RUBRIC,
    searchResults: [],
    healthThreshold: 0.30,
    skipHealth: false,
    skipSourceFlex: false,
    skipScrape: false,
    skipQuality: false,
    skipEvaluate: false,
    skipIntelligence: false,
    skipApplicationKit: false,
    skipDeepResearch: false,
    skipCompensation: false,
    skipStoryBank: false,
    skipParallel: false,
    skipModes: false,
    deepFitTopA: 25,
    deepFitTopB: 40,
    deepFitTopC: 30
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--profile") args.profile = argv[++i] || args.profile;
    else if (token === "--strategy") args.strategy = argv[++i] || "";
    else if (token === "--rubric") args.rubric = argv[++i] || args.rubric;
    else if (token === "--search-results") args.searchResults.push(argv[++i] || "");
    else if (token === "--health-threshold") args.healthThreshold = Math.min(1, Math.max(0, Number.parseFloat(argv[++i] || "0.30") || 0.30));
    else if (token === "--skip-health") args.skipHealth = true;
    else if (token === "--skip-source-flex") args.skipSourceFlex = true;
    else if (token === "--skip-scrape") args.skipScrape = true;
    else if (token === "--skip-quality") args.skipQuality = true;
    else if (token === "--skip-evaluate") args.skipEvaluate = true;
    else if (token === "--skip-intelligence") args.skipIntelligence = true;
    else if (token === "--skip-application-kit") args.skipApplicationKit = true;
    else if (token === "--skip-deep-research") args.skipDeepResearch = true;
    else if (token === "--skip-compensation") args.skipCompensation = true;
    else if (token === "--skip-story-bank") args.skipStoryBank = true;
    else if (token === "--skip-parallel") args.skipParallel = true;
    else if (token === "--skip-modes") args.skipModes = true;
    else if (token === "--deep-fit-top-a") args.deepFitTopA = Math.max(1, Number.parseInt(argv[++i] || "25", 10) || 25);
    else if (token === "--deep-fit-top-b") args.deepFitTopB = Math.max(0, Number.parseInt(argv[++i] || "40", 10) || 40);
    else if (token === "--deep-fit-top-c") args.deepFitTopC = Math.max(0, Number.parseInt(argv[++i] || "30", 10) || 30);
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function run(label, command, args) {
  console.log(`\n[career-ops:pipeline] ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  // Health check: report job DB status; skip scrape if still healthy
  if (!args.skipHealth && fs.existsSync("data/app/career-ops-jobs.json")) {
    run("job health monitor", "node", [
      "scripts/career-ops-health-monitor.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--out", "data/app/career-ops-job-health.json",
      "--report-out", "data/app/career-ops-job-health-report.md",
      "--threshold", String(args.healthThreshold)
      // no --auto-scrape: pipeline will scrape in its own scrape step
    ]);
  }

  if (args.strategy && fs.existsSync(args.strategy)) {
    run("source-strategy agent", "node", [
      "scripts/career-ops-build-sources.mjs",
      "--strategy", args.strategy,
      "--out", "data/career-ops-sources.json",
      "--report-out", "data/app/career-ops-source-strategy-report.md"
    ]);
  }

  if (!args.skipSourceFlex && fs.existsSync("data/career-ops-source-flex.json")) {
    run("source-flex agent", "node", [
      "scripts/career-ops-source-flex.mjs",
      "--sources", "data/career-ops-sources.json",
      "--profile", args.profile,
      "--rules", "data/career-ops-source-flex.json",
      "--out", "data/career-ops-sources.json",
      "--report-out", "data/app/career-ops-source-flex-report.md"
    ]);
  }

  for (const filePath of args.searchResults) {
    run("search adapter agent", "node", [
      "scripts/career-ops-search-adapter.mjs",
      "--strategy", args.strategy || "data/career-ops-source-strategy.json",
      "--results", filePath,
      "--append", "data/career-ops-sources.json",
      "--out", "data/career-ops-sources.json",
      "--report-out", "data/app/career-ops-search-report.md"
    ]);
  }

  if (!args.skipScrape) {
    run("source scanner agent", "node", [
      "scripts/career-ops-worker.mjs",
      "--source", "data/career-ops-sources.json",
      "--json-out", "data/app/career-ops-jobs.json",
      "--js-out", "data/app/career-ops-jobs.js",
      "--include-expired"
    ]);
  }

  if (!args.skipQuality) {
    run("source quality agent", "node", [
      "scripts/career-ops-source-quality.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--out", "data/app/career-ops-jobs.json",
      "--js-out", "data/app/career-ops-jobs.js",
      "--report-out", "data/app/career-ops-source-quality-report.md"
    ]);
  }

  if (!args.skipEvaluate && fs.existsSync(args.profile)) {
    run("evaluation agent", "node", [
      "scripts/career-ops-evaluate.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--out", "data/app/career-ops-jobs.json"
    ]);
  }

  if (!args.skipIntelligence) {
    run("intelligence agent", "node", [
      "scripts/career-ops-intelligence.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--rubric", args.rubric,
      "--out", "data/app/career-ops-jobs.json",
      "--js-out", "data/app/career-ops-jobs.js",
      "--report-out", "data/app/career-ops-intelligence-report.md"
    ]);
  }

  if (!args.skipApplicationKit) {
    run("application agent", "node", [
      "scripts/career-ops-application-kit.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--out", "data/app/career-ops-application-kit.json",
      "--js-out", "data/app/career-ops-application-kit.js",
      "--report-out", "data/app/career-ops-application-kit.md"
    ]);
  }

  if (!args.skipDeepResearch) {
    run("deep research agent", "node", [
      "scripts/career-ops-deep-research.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--sources", "data/career-ops-sources.json",
      "--out", "data/app/career-ops-deep-research.json",
      "--js-out", "data/app/career-ops-deep-research.js",
      "--report-out", "data/app/career-ops-deep-research.md"
    ]);
  }

  if (!args.skipCompensation) {
    run("compensation agent", "node", [
      "scripts/career-ops-compensation.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--research", "data/app/career-ops-deep-research.json",
      "--out", "data/app/career-ops-compensation.json",
      "--js-out", "data/app/career-ops-compensation.js",
      "--report-out", "data/app/career-ops-compensation.md"
    ]);
  }

  if (!args.skipStoryBank) {
    run("story bank agent", "node", [
      "scripts/career-ops-story-bank.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--out", "data/app/career-ops-story-bank.json",
      "--js-out", "data/app/career-ops-story-bank.js",
      "--report-out", "data/app/career-ops-story-bank.md"
    ]);
  }

  if (!args.skipParallel) {
    run("parallel worker merge", "node", [
      "scripts/career-ops-parallel.mjs",
      "--jobs", "data/app/career-ops-jobs.json",
      "--profile", args.profile,
      "--research", "data/app/career-ops-deep-research.json",
      "--compensation", "data/app/career-ops-compensation.json",
      "--story-bank", "data/app/career-ops-story-bank.json",
      "--out", "data/app/career-ops-parallel-report.json",
      "--js-out", "data/app/career-ops-parallel-report.js",
      "--report-out", "data/app/career-ops-parallel-report.md"
    ]);
  }

  run("deep fit agent", "node", [
    "scripts/career-ops-deep-fit.mjs",
    "--jobs", "data/app/career-ops-jobs.json",
    "--profile", args.profile,
    "--research", "data/app/career-ops-deep-research.json",
    "--compensation", "data/app/career-ops-compensation.json",
    "--story-bank", "data/app/career-ops-story-bank.json",
    "--out", "data/app/career-ops-deep-fit.json",
    "--js-out", "data/app/career-ops-deep-fit.js",
    "--report-out", "data/app/career-ops-deep-fit.md",
    "--top-a", String(args.deepFitTopA),
    "--top-b", String(args.deepFitTopB),
    "--top-c", String(args.deepFitTopC)
  ]);

  run("learning agent", "node", [
    "scripts/career-ops-learning.mjs",
    "--jobs", "data/app/career-ops-jobs.json",
    "--profile", args.profile,
    "--sources", "data/career-ops-sources.json",
    "--out", "data/app/career-ops-learning.json",
    "--js-out", "data/app/career-ops-learning.js",
    "--report-out", "data/app/career-ops-learning-report.md"
  ]);

  run("decision report agent", "node", [
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
    run("modes agent", "node", [
      "scripts/career-ops-modes.mjs",
      "--in", "data/career-ops-modes.json",
      "--out", "data/app/career-ops-modes.json",
      "--js-out", "data/app/career-ops-modes.js",
      "--report-out", "data/app/career-ops-modes-report.md"
    ]);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
