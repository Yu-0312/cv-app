#!/usr/bin/env node

import fs from "node:fs";

const REQUIRED_FILES = [
  "data/career-ops-source-strategy.json",
  "data/career-ops-modes.json",
  "data/career-ops-rubric.json",
  "data/career-ops-sources.json",
  "data/app/career-ops-jobs.json",
  "data/app/career-ops-jobs.js"
];

const OPTIONAL_FILES = [
  "data/career-ops-profile.json",
  "data/app/career-ops-deep-research.json",
  "data/app/career-ops-source-quality-report.md",
  "data/app/career-ops-compensation.json",
  "data/app/career-ops-story-bank.json",
  "data/app/career-ops-decision-report.json",
  "data/app/career-ops-parallel-report.json",
  "data/app/career-ops-learning.json",
  "data/app/career-ops-modes.json"
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const checks = [];
  for (const filePath of REQUIRED_FILES) {
    checks.push({ type: "required-file", name: filePath, ok: fs.existsSync(filePath) });
  }
  for (const filePath of OPTIONAL_FILES) {
    checks.push({ type: "optional-file", name: filePath, ok: fs.existsSync(filePath) });
  }
  const sources = readJson("data/career-ops-sources.json");
  const jobs = readJson("data/app/career-ops-jobs.json");
  const modes = readJson("data/career-ops-modes.json");
  checks.push({ type: "schema", name: "sources array", ok: Array.isArray(sources?.sources), detail: `${sources?.sources?.length || 0} source(s)` });
  checks.push({ type: "schema", name: "jobs array", ok: Array.isArray(jobs?.jobs), detail: `${jobs?.jobs?.length || 0} job(s)` });
  checks.push({ type: "schema", name: "modes commands", ok: Array.isArray(modes?.commands), detail: `${modes?.commands?.length || 0} command(s)` });
  checks.push({ type: "secret", name: "BRAVE_SEARCH_API_KEY", ok: Boolean(process.env.BRAVE_SEARCH_API_KEY), optional: true });
  checks.push({ type: "secret", name: "BING_SEARCH_API_KEY", ok: Boolean(process.env.BING_SEARCH_API_KEY), optional: true });
  checks.push({ type: "secret", name: "SERPAPI_API_KEY", ok: Boolean(process.env.SERPAPI_API_KEY), optional: true });
  checks.push({ type: "browser", name: "CHROME_PATH / PUPPETEER_EXECUTABLE_PATH", ok: Boolean(process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH), optional: true });

  const failed = checks.filter((check) => !check.ok && !check.optional && check.type !== "optional-file");
  console.log("# Career Ops Doctor\n");
  for (const check of checks) {
    const status = check.ok ? "PASS" : check.optional || check.type === "optional-file" ? "INFO" : "FAIL";
    console.log(`[${status}] ${check.type}: ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} required check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll required Career Ops checks passed.");
  }
}

main();
