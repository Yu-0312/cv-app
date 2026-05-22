#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";

const DEFAULT_INPUT = "data/app/career-ops-jobs.json";
const DEFAULT_OUT_DIR = "data/app/career-ops-snapshot";
const DEFAULT_JOBS_PER_SHARD = 1000;
const DEFAULT_BUCKET = "career-ops-snapshots";
const DEFAULT_PREFIX = "career-ops/latest";
const DEFAULT_CONFIG = "config.js";
const UPLOAD_RETRY_DELAYS_MS = [1000, 3000, 7000];
const UPLOAD_THROTTLE_MS = 250;
const gzip = promisify(gzipCallback);

function printHelp() {
  console.log(`Career Ops snapshot sharder / Supabase Storage publisher

Creates a manifest + gzip-compressed JSON shard files from the Career Ops jobs
snapshot. When --upload is provided, the shard files are uploaded first and the
manifest is uploaded last so the frontend never sees a pointer before the shard
objects exist.

Usage:
  node scripts/career-ops-snapshot-shards.mjs
  node scripts/career-ops-snapshot-shards.mjs --upload --allow-missing-credentials

Options:
  --input <file>                  Input snapshot JSON. Default: ${DEFAULT_INPUT}
  --out-dir <dir>                 Local shard output directory. Default: ${DEFAULT_OUT_DIR}
  --jobs-per-shard <n>            Jobs per shard. Default: ${DEFAULT_JOBS_PER_SHARD}
  --plain-json-shards             Write .json shards instead of .json.gz
  --upload                        Upload manifest and shards to Supabase Storage
  --allow-missing-credentials     Skip upload instead of failing when Supabase env is absent
  --bucket <name>                 Supabase Storage bucket. Default: env CAREER_OPS_STORAGE_BUCKET or ${DEFAULT_BUCKET}
  --prefix <path>                 Object prefix. Default: env CAREER_OPS_STORAGE_PREFIX or ${DEFAULT_PREFIX}
  --config <file>                 Config file for Supabase URL/bucket/prefix fallback. Default: ${DEFAULT_CONFIG}
  --private-bucket                Create bucket as private when it does not exist. Default: public
  --cache-control <seconds>       Upload cache-control seconds. Default: 60
  --help                          Show this help

Environment for upload:
  SUPABASE_URL                    Optional when config.js has supabaseUrl
  SUPABASE_SERVICE_ROLE_KEY       Required for bucket creation and uploads
  CAREER_OPS_STORAGE_BUCKET       Optional bucket override
  CAREER_OPS_STORAGE_PREFIX       Optional object prefix override
`);
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    outDir: DEFAULT_OUT_DIR,
    jobsPerShard: DEFAULT_JOBS_PER_SHARD,
    upload: false,
    allowMissingCredentials: false,
    bucket: process.env.CAREER_OPS_STORAGE_BUCKET || "",
    prefix: process.env.CAREER_OPS_STORAGE_PREFIX || "",
    config: DEFAULT_CONFIG,
    publicBucket: true,
    cacheControl: "60",
    gzipShards: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--input") args.input = argv[++i] || DEFAULT_INPUT;
    else if (token === "--out-dir") args.outDir = argv[++i] || DEFAULT_OUT_DIR;
    else if (token === "--jobs-per-shard") args.jobsPerShard = Number(argv[++i] || DEFAULT_JOBS_PER_SHARD);
    else if (token === "--plain-json-shards") args.gzipShards = false;
    else if (token === "--gzip-shards") args.gzipShards = true;
    else if (token === "--upload") args.upload = true;
    else if (token === "--allow-missing-credentials") args.allowMissingCredentials = true;
    else if (token === "--bucket") args.bucket = argv[++i] || args.bucket;
    else if (token === "--prefix") args.prefix = argv[++i] || args.prefix;
    else if (token === "--config") args.config = argv[++i] || DEFAULT_CONFIG;
    else if (token === "--private-bucket") args.publicBucket = false;
    else if (token === "--cache-control") args.cacheControl = String(argv[++i] || args.cacheControl);
    else throw new Error(`Unknown argument: ${token}`);
  }
  args.jobsPerShard = Math.max(1, Math.floor(Number(args.jobsPerShard) || DEFAULT_JOBS_PER_SHARD));
  args.prefix = String(args.prefix || "").replace(/^\/+|\/+$/g, "");
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

function bufferLength(value) {
  return Buffer.isBuffer(value) ? value.byteLength : byteLength(String(value || ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function descriptionLength(job = {}) {
  return String(job.description || "").replace(String(job.url || ""), "").trim().length;
}

function countryKey(job = {}) {
  const code = String(job.countryCode || job.sourceCountryCode || "").trim().toUpperCase();
  if (code) return code;
  const market = String(job.sourceMarket || job.market || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(market)) return market;
  const country = String(job.country || job.sourceCountry || "").trim();
  return country || "Unknown";
}

function countByCountry(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    const key = countryKey(job);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function uploadPath(prefix, fileName) {
  return [prefix, fileName].filter(Boolean).join("/");
}

function encodeObjectPath(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function configString(configText, key, fallback = "") {
  const pattern = new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]*)["'\`]`);
  return configText.match(pattern)?.[1] || fallback;
}

async function readConfigHints(configPath) {
  try {
    const configText = await fs.readFile(configPath, "utf8");
    return {
      supabaseUrl: configString(configText, "supabaseUrl"),
      bucket: configString(configText, "careerOpsSnapshotBucket"),
      prefix: configString(configText, "careerOpsSnapshotPrefix")
    };
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeShardFiles(snapshot, args) {
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
  const generatedAt = new Date().toISOString();
  const shards = [];
  await fs.rm(args.outDir, { recursive: true, force: true });
  await ensureDir(args.outDir);

  const shardCount = Math.max(1, Math.ceil(jobs.length / args.jobsPerShard));
  for (let index = 0; index < shardCount; index += 1) {
    const start = index * args.jobsPerShard;
    const shardJobs = jobs.slice(start, start + args.jobsPerShard);
    const file = `jobs-${String(index + 1).padStart(4, "0")}.json${args.gzipShards ? ".gz" : ""}`;
    const shardPayload = {
      schemaVersion: 1,
      source: "career-ops-snapshot-shard",
      generatedAt,
      extractedAt: snapshot.extractedAt || "",
      shardIndex: index + 1,
      shardCount,
      jobs: shardJobs
    };
    const rawContent = `${JSON.stringify(shardPayload)}\n`;
    const content = args.gzipShards ? await gzip(rawContent) : Buffer.from(rawContent, "utf8");
    await fs.writeFile(path.join(args.outDir, file), content, "utf8");
    shards.push({
      index: index + 1,
      file,
      path: file,
      format: args.gzipShards ? "json.gz" : "json",
      contentEncoding: args.gzipShards ? "gzip" : "",
      jobCount: shardJobs.length,
      activeJobCount: shardJobs.filter((job) => !job.isExpired).length,
      eligibleJobCount: shardJobs.filter((job) => !job.isExpired && descriptionLength(job) >= 80).length,
      bytes: bufferLength(content),
      uncompressedBytes: byteLength(rawContent),
      countries: countByCountry(shardJobs)
    });
  }

  const activeJobs = jobs.filter((job) => !job.isExpired);
  const manifest = {
    schemaVersion: 1,
    source: "career-ops-snapshot-manifest",
    generatedAt,
    extractedAt: snapshot.extractedAt || "",
    sourceSnapshot: {
      source: snapshot.source || "",
      sourceCount: snapshot.sourceCount || 0,
      newJobCount: snapshot.newJobCount || 0,
      expiredJobCount: snapshot.expiredJobCount || 0
    },
    jobCount: jobs.length,
    activeJobCount: activeJobs.length,
    eligibleJobCount: activeJobs.filter((job) => descriptionLength(job) >= 80).length,
    jobsPerShard: args.jobsPerShard,
    shardCount: shards.length,
    shardFormat: args.gzipShards ? "json.gz" : "json",
    shardContentEncoding: args.gzipShards ? "gzip" : "",
    shards,
    countries: countByCountry(jobs)
  };
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(path.join(args.outDir, "manifest.json"), manifestContent, "utf8");
  return {
    manifest,
    files: [
      ...await readShardContents(args.outDir, shards),
      {
        file: "manifest.json",
        content: Buffer.from(manifestContent, "utf8"),
        contentType: "application/json",
        contentEncoding: ""
      }
    ]
  };
}

async function readShardContents(outDir, shards) {
  const files = [];
  for (const shard of shards) {
    files.push({
      file: shard.file,
      content: await fs.readFile(path.join(outDir, shard.file)),
      contentType: "application/json",
      contentEncoding: shard.contentEncoding || ""
    });
  }
  return files;
}

async function supabaseConfig(args) {
  const hints = await readConfigHints(args.config);
  const supabaseUrl = String(process.env.SUPABASE_URL || hints.supabaseUrl || "").replace(/\/+$/g, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) return null;
  return {
    supabaseUrl,
    serviceRoleKey,
    bucket: args.bucket || hints.bucket || DEFAULT_BUCKET,
    prefix: String(args.prefix || hints.prefix || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, ""),
    publicBucket: args.publicBucket,
    cacheControl: args.cacheControl
  };
}

async function supabaseRequest(config, endpoint, options = {}) {
  const response = await fetch(`${config.supabaseUrl}${endpoint}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Supabase Storage request failed ${response.status} ${endpoint}: ${body.slice(0, 500)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return response;
}

function isRetryableStorageError(error) {
  if ([408, 429, 500, 502, 503, 504].includes(error?.status)) return true;
  return error?.status === 400 && /<html|bad request/i.test(String(error.body || ""));
}

async function ensureBucket(config) {
  const endpoint = "/storage/v1/bucket";
  const response = await fetch(`${config.supabaseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: config.bucket,
      name: config.bucket,
      public: config.publicBucket,
      file_size_limit: 52428800,
      allowed_mime_types: ["application/json"]
    })
  });
  if (response.ok || response.status === 409) return;
  const body = await response.text().catch(() => "");
  // Supabase returns HTTP 400 with JSON body {statusCode:"409", error:"Duplicate"}
  // when the bucket already exists — treat this as a non-error (bucket is ready).
  try {
    const json = JSON.parse(body);
    if (String(json.statusCode) === "409" || json.error === "Duplicate") return;
  } catch {}
  throw new Error(`Supabase bucket create failed ${response.status}: ${body.slice(0, 500)}`);
}

async function uploadFile(config, item) {
  const objectPath = uploadPath(config.prefix, item.file);
  const endpoint = `/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodeObjectPath(objectPath)}`;
  for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await supabaseRequest(config, endpoint, {
        method: "POST",
        headers: {
          "cache-control": config.cacheControl,
          "content-type": item.contentType || "application/json",
          ...(item.contentEncoding ? { "content-encoding": item.contentEncoding } : {}),
          "x-upsert": "true"
        },
        body: item.content
      });
      return;
    } catch (error) {
      const delay = UPLOAD_RETRY_DELAYS_MS[attempt];
      if (!delay || !isRetryableStorageError(error)) throw error;
      console.warn(`[career-ops] upload retry ${attempt + 1}/${UPLOAD_RETRY_DELAYS_MS.length} for ${objectPath}: ${error.message}`);
      await sleep(delay);
    }
  }
}

async function uploadFiles(args, files) {
  const config = await supabaseConfig(args);
  if (!config) {
    if (args.allowMissingCredentials) {
      console.warn("[career-ops] Supabase credentials missing; shard files generated locally and upload skipped.");
      return null;
    }
    throw new Error("Missing Supabase upload credentials. Provide SUPABASE_SERVICE_ROLE_KEY and either SUPABASE_URL or config.js supabaseUrl.");
  }
  await ensureBucket(config);
  for (const item of files) {
    await uploadFile(config, item);
    console.log(`[career-ops] uploaded ${uploadPath(config.prefix, item.file)} (${bufferLength(item.content)} bytes)`);
    await sleep(UPLOAD_THROTTLE_MS);
  }
  return `${config.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${encodeObjectPath(uploadPath(config.prefix, "manifest.json"))}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const snapshot = await readJson(args.input);
  const { manifest, files } = await writeShardFiles(snapshot, args);
  console.log(`[career-ops] wrote ${manifest.shardCount} shard(s) for ${manifest.jobCount} job(s) -> ${args.outDir}`);
  if (args.upload) {
    const manifestUrl = await uploadFiles(args, files);
    if (manifestUrl) console.log(`[career-ops] manifest: ${manifestUrl}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
