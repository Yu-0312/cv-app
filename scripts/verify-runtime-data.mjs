#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const DEFAULT_DIST = "dist";
const DEFAULT_MIN_SNAPSHOT_JOBS = 10000;
const DEFAULT_BUCKET = "career-ops-snapshots";
const DEFAULT_PREFIX = "career-ops/latest";

function parseArgs(argv) {
  const args = {
    dist: DEFAULT_DIST,
    config: "",
    skipRemote: false,
    minSnapshotJobs: DEFAULT_MIN_SNAPSHOT_JOBS
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dist") args.dist = argv[++i] || DEFAULT_DIST;
    else if (token === "--config") args.config = argv[++i] || "";
    else if (token === "--skip-remote") args.skipRemote = true;
    else if (token === "--min-snapshot-jobs") args.minSnapshotJobs = Number(argv[++i] || DEFAULT_MIN_SNAPSHOT_JOBS);
    else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  args.minSnapshotJobs = Math.max(1, Math.floor(Number(args.minSnapshotJobs) || DEFAULT_MIN_SNAPSHOT_JOBS));
  return args;
}

function printHelp() {
  console.log(`Verify CV Studio runtime data

Usage:
  node scripts/verify-runtime-data.mjs
  node scripts/verify-runtime-data.mjs --skip-remote

Options:
  --dist <dir>              Dist directory. Default: ${DEFAULT_DIST}
  --config <file>           Config file. Default: <dist>/config.js
  --skip-remote             Do not verify Supabase Career Ops snapshot
  --min-snapshot-jobs <n>   Minimum remote snapshot jobs. Default: ${DEFAULT_MIN_SNAPSHOT_JOBS}
`);
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function configString(configText, key, fallback = "") {
  const pattern = new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]*)["'\`]`);
  return configText.match(pattern)?.[1] || fallback;
}

function encodeObjectPath(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function snapshotManifestUrls(configText) {
  const urls = [];
  const directUrl = configString(configText, "careerOpsSnapshotManifestUrl");
  if (directUrl) urls.push(directUrl);
  const supabaseUrl = configString(configText, "supabaseUrl").replace(/\/+$/g, "");
  const bucket = configString(configText, "careerOpsSnapshotBucket", DEFAULT_BUCKET);
  const prefix = configString(configText, "careerOpsSnapshotPrefix", DEFAULT_PREFIX).replace(/^\/+|\/+$/g, "");
  if (supabaseUrl && !supabaseUrl.includes("your-project") && bucket) {
    const objectPath = encodeObjectPath([prefix, "manifest.json"].filter(Boolean).join("/"));
    urls.push(`${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`);
  }
  return [...new Set(urls)];
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.toString("utf8").slice(0, 200)}`);
  }
  const text = body.toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    try {
      return JSON.parse(gunzipSync(body).toString("utf8"));
    } catch {
      throw error;
    }
  }
}

function resolveShardUrl(manifestUrl, shardPath) {
  return new URL(shardPath, new URL(".", manifestUrl)).href;
}

async function verifyRemoteSnapshot(configText, minSnapshotJobs) {
  const urls = snapshotManifestUrls(configText);
  if (!urls.length) {
    throw new Error("No Supabase snapshot manifest URL could be derived from config.js");
  }
  const errors = [];
  for (const url of urls) {
    try {
      const manifest = await fetchJson(url);
      const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
      const jobCount = Number(manifest.jobCount || 0);
      if (jobCount < minSnapshotJobs) {
        throw new Error(`manifest jobCount ${jobCount} is below ${minSnapshotJobs}`);
      }
      if (!shards.length) throw new Error("manifest has no shards");
      const firstShard = shards[0];
      const lastShard = shards[shards.length - 1];
      for (const shard of [firstShard, lastShard]) {
        const shardUrl = resolveShardUrl(url, shard.path || shard.file);
        const payload = await fetchJson(shardUrl);
        const actual = countArray(payload.jobs);
        if (actual !== Number(shard.jobCount || actual)) {
          throw new Error(`${shard.file || shard.path} expected ${shard.jobCount}, got ${actual}`);
        }
        if (!actual) throw new Error(`${shard.file || shard.path} has no jobs`);
      }
      return {
        url,
        jobCount,
        activeJobCount: Number(manifest.activeJobCount || 0),
        eligibleJobCount: Number(manifest.eligibleJobCount || 0),
        shardCount: shards.length,
        generatedAt: manifest.generatedAt || ""
      };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function fileSize(filePath) {
  return (await fs.stat(filePath)).size;
}

async function verifyJsonData(distDir) {
  const checks = [
    {
      file: "data/app/gsat-external-data.json",
      label: "GSAT external data",
      count: (data) => countArray(data.records)
    },
    {
      file: "data/app/university-tw-app-data.json",
      label: "University TW data",
      count: (data) => countObject(data.universities)
    },
    {
      file: "data/app/career-ops-singapore-jobs.json",
      label: "Career Ops Singapore jobs",
      count: (data) => countArray(data.jobs)
    },
    {
      file: "data/app/career-ops-application-kit.json",
      label: "Career Ops application kit",
      count: (data) => countArray(data.playbooks)
    },
    {
      file: "data/app/career-ops-deep-research.json",
      label: "Career Ops deep research",
      count: (data) => countArray(data.dossiers)
    },
    {
      file: "data/app/career-ops-deep-fit.json",
      label: "Career Ops bundled deep fit",
      count: (data) => countArray(data.dossiers)
    },
    {
      file: "data/app/career-ops-compensation.json",
      label: "Career Ops compensation",
      count: (data) => countArray(data.plans)
    },
    {
      file: "data/app/career-ops-story-bank.json",
      label: "Career Ops story bank",
      count: (data) => countArray(data.storyBank?.stories)
    },
    {
      file: "data/app/career-ops-parallel-report.json",
      label: "Career Ops parallel report",
      count: (data) => countArray(data.results)
    },
    {
      file: "data/app/career-ops-learning.json",
      label: "Career Ops learning",
      count: (data) => Number(data.learning?.activeJobCount || 0)
    },
    {
      file: "data/app/career-ops-modes.json",
      label: "Career Ops modes",
      count: (data) => countArray(data.commands)
    },
    {
      file: "data/app/career-ops-job-health.json",
      label: "Career Ops job health",
      count: (data) => Number(data.health?.total || data.totalJobs || data.total_jobs || 0)
    }
  ];

  const results = [];
  for (const check of checks) {
    const filePath = path.join(distDir, check.file);
    const data = await readJson(filePath);
    const count = check.count(data);
    results.push({
      ...check,
      count,
      size: await fileSize(filePath)
    });
    if (!count) {
      throw new Error(`${check.label} is empty (${check.file})`);
    }
  }
  return results;
}

async function verifyNoLargeUnexpectedFiles(distDir) {
  const appDir = path.join(distDir, "data", "app");
  const entries = await fs.readdir(appDir, { withFileTypes: true });
  const blocked = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(appDir, entry.name);
    const size = await fileSize(filePath);
    if (
      /^career-ops-(combined|upstream)-jobs\.(json|js)$/i.test(entry.name)
      || /^career-ops-jobs-thomas\.(json|js)$/i.test(entry.name)
      || entry.name === ".DS_Store"
    ) {
      blocked.push(`${entry.name} (${size} bytes)`);
    }
  }
  if (blocked.length) {
    throw new Error(`Unexpected non-runtime files in dist/data/app: ${blocked.join(", ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  await verifyNoLargeUnexpectedFiles(args.dist);
  const dataResults = await verifyJsonData(args.dist);
  for (const item of dataResults) {
    console.log(`[runtime-data] OK ${item.label}: ${item.count.toLocaleString()} (${item.size.toLocaleString()} bytes)`);
  }

  if (!args.skipRemote) {
    const configPath = args.config || path.join(args.dist, "config.js");
    const configText = await readText(configPath);
    const remote = await verifyRemoteSnapshot(configText, args.minSnapshotJobs);
    console.log(`[runtime-data] OK Career Ops Supabase snapshot: ${remote.jobCount.toLocaleString()} jobs, ${remote.shardCount.toLocaleString()} shards`);
    console.log(`[runtime-data] manifest: ${remote.url}`);
  }
}

main().catch((error) => {
  console.error(`[runtime-data] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
