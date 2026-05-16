#!/usr/bin/env node

/**
 * Career Ops Job Health Monitor
 *
 * Checks the job database for stale/expired listings.
 * If more than --threshold (default 30%) of jobs are expired,
 * automatically triggers a re-scrape via the pipeline.
 *
 * Usage:
 *   node scripts/career-ops-health-monitor.mjs
 *   node scripts/career-ops-health-monitor.mjs --threshold 0.25 --auto-scrape
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-job-health.json";
const DEFAULT_REPORT = "data/app/career-ops-job-health-report.md";
const DEFAULT_THRESHOLD = 0.30;

function printHelp() {
  console.log(`Career Ops job health monitor

Scans the job database for expired/stale listings and reports health status.
Auto-triggers a re-scrape when the expiry rate exceeds --threshold.

Usage:
  node scripts/career-ops-health-monitor.mjs
  node scripts/career-ops-health-monitor.mjs --threshold 0.25 --auto-scrape

Options:
  --jobs <file>        Jobs snapshot. Default: ${DEFAULT_JOBS}
  --out <file>         Health JSON output. Default: ${DEFAULT_OUT}
  --report-out <file>  Markdown report. Default: ${DEFAULT_REPORT}
  --threshold <ratio>  Expiry ratio that triggers re-scrape (0-1). Default: ${DEFAULT_THRESHOLD}
  --auto-scrape        Automatically trigger pipeline re-scrape when threshold exceeded
  --profile <file>     Profile for re-scrape. Default: auto-detect
  --dry-run            Report only, never trigger re-scrape
  --help               Show this help
`);
}

function parseArgs(argv) {
  const defaultProfile = fsSync.existsSync("data/career-ops-profile.json")
    ? "data/career-ops-profile.json"
    : "data/career-ops-profile.example.json";

  const args = {
    jobs: DEFAULT_JOBS,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT,
    threshold: DEFAULT_THRESHOLD,
    autoScrape: false,
    dryRun: false,
    profile: defaultProfile
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--threshold") args.threshold = Math.min(1, Math.max(0, Number.parseFloat(argv[++i] || "0.30") || DEFAULT_THRESHOLD));
    else if (token === "--auto-scrape") args.autoScrape = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--profile") args.profile = argv[++i] || defaultProfile;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function analyzeHealth(jobsPayload) {
  const jobs = array(jobsPayload?.jobs);
  if (!jobs.length) {
    return { total: 0, active: 0, expired: 0, expiredRate: 0, status: "empty" };
  }

  const expired = jobs.filter((j) => j.isExpired === true);
  const active = jobs.filter((j) => j.isExpired !== true);
  const expiredRate = expired.length / jobs.length;

  // Detect stale jobs: last seen more than 14 days ago
  const now = Date.now();
  const STALE_MS = 14 * 24 * 60 * 60 * 1000;
  const stale = active.filter((j) => {
    const lastSeen = j.lastSeenAt || j.last_seen_at;
    if (!lastSeen) return false;
    return now - new Date(lastSeen).getTime() > STALE_MS;
  });

  // Distribution by source
  const bySource = {};
  for (const job of jobs) {
    const src = job.source || "unknown";
    if (!bySource[src]) bySource[src] = { total: 0, expired: 0 };
    bySource[src].total += 1;
    if (job.isExpired) bySource[src].expired += 1;
  }

  // Score distribution snapshot
  const scores = active.map((j) => Number(j.score || 0)).filter(Boolean).sort((a, b) => a - b);
  const avgScore = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;

  let status = "healthy";
  if (expiredRate >= 0.50) status = "critical";
  else if (expiredRate >= 0.30) status = "degraded";
  else if (expiredRate >= 0.15) status = "warning";

  return {
    total: jobs.length,
    active: active.length,
    expired: expired.length,
    stale: stale.length,
    expiredRate: Math.round(expiredRate * 1000) / 1000,
    expiredRatePct: `${Math.round(expiredRate * 100)}%`,
    avgActiveScore: avgScore,
    bySource,
    status
  };
}

function renderReport(health, args, triggered) {
  const statusEmoji = { healthy: "✅", warning: "⚠️", degraded: "🔴", critical: "🚨", empty: "⬜" };
  const lines = [
    "# Career Ops Job Health Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Status: ${statusEmoji[health.status] || ""} **${health.status.toUpperCase()}**`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total jobs | ${health.total} |`,
    `| Active | ${health.active} |`,
    `| Expired | ${health.expired} (${health.expiredRatePct}) |`,
    `| Stale (>14d) | ${health.stale} |`,
    `| Avg active score | ${health.avgActiveScore} |`,
    `| Threshold | ${Math.round(args.threshold * 100)}% |`,
    `| Action triggered | ${triggered ? "YES — re-scrape launched" : "No"} |`,
    ""
  ];

  if (Object.keys(health.bySource).length) {
    lines.push("## By Source", "");
    lines.push("| Source | Total | Expired | Expiry % |");
    lines.push("|--------|-------|---------|---------|");
    for (const [src, stat] of Object.entries(health.bySource).sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
      const pct = stat.total ? Math.round((stat.expired / stat.total) * 100) : 0;
      lines.push(`| ${src} | ${stat.total} | ${stat.expired} | ${pct}% |`);
    }
    lines.push("");
  }

  if (triggered) {
    lines.push(
      "## Auto-scrape Triggered",
      "",
      `Expiry rate ${health.expiredRatePct} exceeded threshold of ${Math.round(args.threshold * 100)}%.`,
      "Pipeline re-scrape has been launched. Re-run health monitor after completion.",
      ""
    );
  } else if (health.expiredRate >= args.threshold) {
    lines.push(
      "## Action Recommended",
      "",
      `Expiry rate ${health.expiredRatePct} exceeds threshold of ${Math.round(args.threshold * 100)}%.`,
      "Run with `--auto-scrape` to trigger re-scrape, or manually run:",
      "```",
      "npm run career-ops:pipeline -- --skip-evaluate --skip-intelligence --skip-application-kit --skip-deep-research --skip-compensation --skip-story-bank --skip-parallel --skip-modes",
      "```",
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function triggerReScrape(args) {
  console.log("[career-ops:health] Expiry threshold exceeded — launching re-scrape pipeline...");
  const pipelineArgs = [
    "scripts/career-ops-pipeline.mjs",
    "--profile", args.profile,
    "--skip-evaluate",
    "--skip-intelligence",
    "--skip-application-kit",
    "--skip-deep-research",
    "--skip-compensation",
    "--skip-story-bank",
    "--skip-parallel",
    "--skip-modes"
  ];
  if (fsSync.existsSync("data/career-ops-source-strategy.json")) {
    pipelineArgs.push("--strategy", "data/career-ops-source-strategy.json");
  }
  const result = spawnSync("node", pipelineArgs, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    console.error(`[career-ops:health] Re-scrape pipeline exited with code ${result.status}`);
    return false;
  }
  console.log("[career-ops:health] Re-scrape complete.");
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const jobsPayload = await readJsonIfExists(args.jobs);
  if (!jobsPayload) {
    console.error(`[career-ops:health] Jobs file not found: ${args.jobs}`);
    process.exitCode = 1;
    return;
  }

  const health = analyzeHealth(jobsPayload);
  const needsScrape = health.expiredRate >= args.threshold || health.status === "empty";
  let triggered = false;

  console.log(`[career-ops:health] Status: ${health.status} | Total: ${health.total} | Active: ${health.active} | Expired: ${health.expired} (${health.expiredRatePct}) | Stale: ${health.stale}`);

  if (needsScrape) {
    console.log(`[career-ops:health] Expiry rate ${health.expiredRatePct} >= threshold ${Math.round(args.threshold * 100)}%`);
    if (args.autoScrape && !args.dryRun) {
      triggered = triggerReScrape(args);
    } else if (args.dryRun) {
      console.log("[career-ops:health] Dry run — skipping re-scrape.");
    } else {
      console.log("[career-ops:health] Pass --auto-scrape to trigger re-scrape automatically.");
    }
  }

  const result = {
    source: "career-ops-health-monitor",
    checkedAt: new Date().toISOString(),
    threshold: args.threshold,
    health,
    needsScrape,
    scrapeTriggered: triggered
  };

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(args.reportOut, renderReport(health, args, triggered), "utf8");
  console.log(`[career-ops:health] Report written to ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
