#!/usr/bin/env node
// ---------------------------------------------------------------------------
// career-ops-staging.mjs — 104 兩階段 staging 串聯（two-stage linking）
//
// 這支腳本把 worker 產出的 104 職缺快照，灌進 Supabase 的兩張 staging 表：
//   Stage 1  career_ops_job_candidates  ← 便宜的清單資料（去重 + 新鮮度）
//   Stage 2  career_ops_job_details     ← 節流後的詳細內容（liveness）
//
// 借鏡 career_agent 的做法：清單先進池、挑選後再限量抓詳情，避免對 104
// 一次打太多請求。所有寫入預設 dry-run，只有加上 --push / --enrich 才會
// 真的碰網路。設計上零外部依賴（原生 fetch + node:crypto）。
//
// 用法：
//   node tooling/scripts/career-ops-staging.mjs \
//     --jobs tooling/data/app/career-ops-jobs.json \
//     --out  tooling/data/app/career-ops-staging.json \
//     --report-out tooling/data/app/career-ops-staging.md
//   # 預設 dry-run：只計算 stage-1 候選與去重/新鮮度，不碰網路。
//
//   # 真的推 Supabase（需要 env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）：
//   ... --push
//   # 加做 stage-2 詳情抓取（節流）：
//   ... --push --enrich --detail-limit 40
//   # 不推 DB、只想 probe 幾筆詳情端點是否活著：
//   ... --enrich --probe 3
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { createArgParser, stableJobKey, randomDelay, ensureDir } from "./lib/utils.mjs";
import {
  job104NoFromUrl,
  fetch104JobDetail,
  normalize104Detail
} from "./career-ops-source-adapters.mjs";

const { getFlag, hasFlag, getNumberFlag } = createArgParser(process.argv.slice(2));

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`career-ops-staging.mjs — 104 兩階段 staging 串聯

用法：
  node tooling/scripts/career-ops-staging.mjs [flags]

Flags：
  --jobs <path>          worker 職缺快照（預設 tooling/data/app/career-ops-jobs.json）
  --source <id>          來源代號（預設 104）
  --out <path>           staging 快照輸出（預設 tooling/data/app/career-ops-staging.json）
  --report-out <path>    Markdown 報告輸出（預設 tooling/data/app/career-ops-staging.md）
  --detail-limit <n>     stage-2 詳情抓取上限（預設 40）
  --min-delay <ms>       詳情抓取間最小延遲（預設 2500）
  --max-delay <ms>       詳情抓取間最大延遲（預設 5000）
  --schema-version <n>   寫入的 schema_version（預設 1）
  --probe <n>            只 probe n 筆詳情端點（dry-run 也可用；隱含 stage-2）
  --push                 真的寫入 Supabase（需 env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）
  --enrich               啟用 stage-2 詳情抓取（節流）
  --supabase-url <url>   覆寫 env SUPABASE_URL
  --supabase-key <key>   覆寫 env SUPABASE_SERVICE_ROLE_KEY
  -h, --help             顯示此說明

預設 dry-run：只算 stage-1 候選 + 去重/新鮮度，不碰網路、不寫 DB。`);
  process.exit(0);
}

const JOBS_PATH = getFlag("--jobs", "tooling/data/app/career-ops-jobs.json");
const SOURCE = String(getFlag("--source", "104")).toLowerCase();
const OUT_PATH = getFlag("--out", "tooling/data/app/career-ops-staging.json");
const REPORT_PATH = getFlag("--report-out", "tooling/data/app/career-ops-staging.md");
const DETAIL_LIMIT = getNumberFlag("--detail-limit", 40);
const MIN_DELAY = getNumberFlag("--min-delay", 2500);
const MAX_DELAY = getNumberFlag("--max-delay", 5000);
const SCHEMA_VERSION = getNumberFlag("--schema-version", 1);
const PROBE = getNumberFlag("--probe", 0);
const DO_PUSH = hasFlag("--push");
const DO_ENRICH = hasFlag("--enrich");
const SUPABASE_URL = getFlag("--supabase-url", process.env.SUPABASE_URL || "");
const SUPABASE_KEY = getFlag("--supabase-key", process.env.SUPABASE_SERVICE_ROLE_KEY || "");

const NOW_ISO = new Date().toISOString();

function sha1(value) {
  return crypto.createHash("sha1").update(String(value ?? ""), "utf8").digest("hex");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// 從描述文字裡撈出 "Salary: ..." 這行（104 list adapter 把薪資塞進 description）。
function salaryDescFromJob(job) {
  if (job?.salaryDesc) return cleanText(job.salaryDesc);
  const m = String(job?.description || "").match(/Salary:\s*([^\n]+)/i);
  return m ? cleanText(m[1]) : "";
}

// 只收 104 職缺：URL 命中 104.com.tw/job/{jobNo}，且能解析出 jobNo。
function is104Job(job) {
  return /104\.com\.tw\/job\//i.test(String(job?.url || ""));
}

// stage-1 候選列：把 worker 的 normalized job 攤平成 candidates 表的形狀。
function toCandidate(job) {
  const externalId = job104NoFromUrl(job.url);
  if (!externalId) return null;
  const jobKey = job.jobKey || stableJobKey(job);
  const salaryDesc = salaryDescFromJob(job);
  // content_hash 只涵蓋「有意義」的欄位，用來偵測改版 / 重新張貼。
  const contentHash = sha1([
    cleanText(job.title),
    cleanText(job.company),
    cleanText(job.url),
    cleanText(job.location),
    salaryDesc,
    cleanText(job.employmentType)
  ].join("|"));
  return {
    source: SOURCE,
    external_id: externalId,
    job_key: jobKey,
    title: cleanText(job.title),
    company: cleanText(job.company),
    url: cleanText(job.url),
    location: cleanText(job.location),
    salary_desc: salaryDesc,
    employment_type: cleanText(job.employmentType),
    appear_date: cleanText(job.datePosted),
    market: "tw",
    list_json: job,
    content_hash: contentHash,
    schema_version: SCHEMA_VERSION
  };
}

// ---------------------------------------------------------------------------
// Supabase REST helper（原生 fetch，無 SDK 依賴）。
// select 走分頁（Range），upsert 走 Prefer: resolution=merge-duplicates，
// patch 走 PATCH + 欄位過濾。所有方法只有在 --push 時才會被呼叫。
// ---------------------------------------------------------------------------
class SupabaseRest {
  constructor(url, key) {
    if (!url || !key) throw new Error("SupabaseRest：缺少 SUPABASE_URL 或 SERVICE_ROLE_KEY");
    this.base = url.replace(/\/$/, "");
    this.key = key;
  }
  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra
    };
  }
  async selectAll(table, columns, filter = "") {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const qs = `select=${encodeURIComponent(columns)}${filter ? `&${filter}` : ""}`;
      const res = await fetch(`${this.base}/rest/v1/${table}?${qs}`, {
        headers: this.headers({ Range: `${from}-${to}`, Prefer: "count=exact" })
      });
      if (!res.ok) throw new Error(`select ${table} 失敗：${res.status} ${await res.text()}`);
      const batch = await res.json();
      rows.push(...batch);
      if (batch.length < pageSize) break;
    }
    return rows;
  }
  async upsert(table, records, onConflict) {
    if (!records.length) return { count: 0 };
    const res = await fetch(`${this.base}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: this.headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(records)
    });
    if (!res.ok) throw new Error(`upsert ${table} 失敗：${res.status} ${await res.text()}`);
    return { count: records.length };
  }
  async patch(table, filter, patch) {
    const res = await fetch(`${this.base}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: this.headers({ Prefer: "return=minimal" }),
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error(`patch ${table} 失敗：${res.status} ${await res.text()}`);
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — 去重 + 新鮮度：把候選 upsert 進 candidates，保留 first_seen_at、
// 遞增 seen_count、內容變動時把 detail_status 重設為 pending，並把這輪快照
// 沒再出現的既有候選標記為 expired。
// ---------------------------------------------------------------------------
function planStage1(candidates, existingBySource) {
  const incomingIds = new Set(candidates.map((c) => c.external_id));
  const existing = new Map(existingBySource.map((r) => [r.external_id, r]));
  const upserts = [];
  const stats = { new: 0, seen: 0, changed: 0, expired: 0 };

  for (const cand of candidates) {
    const prev = existing.get(cand.external_id);
    if (!prev) {
      stats.new += 1;
      upserts.push({
        ...cand,
        detail_status: "pending",
        first_seen_at: NOW_ISO,
        last_seen_at: NOW_ISO,
        seen_count: 1,
        is_active: true,
        is_expired: false,
        expired_at: null
      });
      continue;
    }
    const changed = prev.content_hash !== cand.content_hash;
    if (changed) stats.changed += 1; else stats.seen += 1;
    upserts.push({
      ...cand,
      // 內容變了 → 重新排隊抓 stage-2；沒變 → 沿用既有狀態。
      detail_status: changed ? "pending" : (prev.detail_status || "pending"),
      first_seen_at: prev.first_seen_at || NOW_ISO,
      last_seen_at: NOW_ISO,
      seen_count: Number(prev.seen_count || 0) + 1,
      is_active: true,
      is_expired: false,
      expired_at: null
    });
  }

  // 這輪沒再出現、但 DB 裡還 active 的 → 標記為過期（軟刪除）。
  const expired = [];
  for (const prev of existingBySource) {
    if (!incomingIds.has(prev.external_id) && prev.is_active && !prev.is_expired) {
      stats.expired += 1;
      expired.push({
        source: prev.source,
        external_id: prev.external_id,
        is_active: false,
        is_expired: true,
        expired_at: NOW_ISO
      });
    }
  }
  return { upserts, expired, stats };
}

// ---------------------------------------------------------------------------
// Stage 2 — 節流詳情抓取 + liveness。挑 detail_status=pending 的候選，限量、
// 加 jitter 逐筆抓 104 詳情端點，normalize 後回傳 detail rows 與候選狀態 patch。
// ---------------------------------------------------------------------------
async function enrichDetails(candidates, limit) {
  const queue = candidates
    .filter((c) => (c.detail_status || "pending") === "pending")
    .slice(0, Math.max(0, limit));
  const details = [];
  const patches = [];
  const stats = { attempted: 0, fetched: 0, failed: 0, dead: 0 };

  for (let i = 0; i < queue.length; i++) {
    const cand = queue[i];
    stats.attempted += 1;
    if (i > 0) await randomDelay(MIN_DELAY, MAX_DELAY); // 對 104 保持禮貌
    try {
      const payload = await fetch104JobDetail(cand.external_id);
      const norm = normalize104Detail(cand.external_id, payload);
      const isLive = Boolean(norm.title || norm.description);
      const detailHash = sha1(JSON.stringify([
        norm.description, norm.requirements, norm.salaryMin, norm.salaryMax, norm.salaryType
      ]));
      details.push({
        source: SOURCE,
        external_id: cand.external_id,
        job_key: cand.job_key,
        description: norm.description || "",
        requirements: norm.requirements || "",
        salary_min: norm.salaryMin ?? null,
        salary_max: norm.salaryMax ?? null,
        salary_type: norm.salaryType || "",
        salary_desc: norm.salaryDesc || "",
        work_experience: norm.workExperience || "",
        education: norm.education || "",
        industry: norm.industry || "",
        headcount: norm.headcount || "",
        skills: norm.skills || [],
        tags: norm.tags || [],
        contact: norm.contact || {},
        raw_json: payload,
        detail_hash: detailHash,
        is_live: isLive,
        http_status: 200,
        last_checked_at: NOW_ISO,
        schema_version: SCHEMA_VERSION
      });
      patches.push({
        external_id: cand.external_id,
        detail_status: isLive ? "fetched" : "stale",
        detail_fetched_at: NOW_ISO
      });
      if (isLive) stats.fetched += 1; else stats.dead += 1;
    } catch (err) {
      stats.failed += 1;
      patches.push({
        external_id: cand.external_id,
        detail_status: "failed",
        detail_fetched_at: NOW_ISO
      });
      console.error(`  ✗ 詳情抓取失敗 ${cand.external_id}：${err.message}`);
    }
  }
  return { details, patches, stats };
}

function buildReport({ total, candidates, stage1, enrich, mode }) {
  const lines = [];
  lines.push("# Career Ops — 104 Staging 串聯報告", "");
  lines.push(`- 產出時間：${NOW_ISO}`);
  lines.push(`- 模式：${mode}`);
  lines.push(`- 來源快照：\`${JOBS_PATH}\``);
  lines.push(`- 快照職缺總數：${total}`);
  lines.push(`- 命中 ${SOURCE} 且可解析 jobNo 的候選：${candidates}`, "");
  lines.push("## Stage 1 — 去重與新鮮度", "");
  lines.push(`- 全新候選：${stage1.stats.new}`);
  lines.push(`- 再次出現（內容未變）：${stage1.stats.seen}`);
  lines.push(`- 內容變動（重排 stage-2）：${stage1.stats.changed}`);
  lines.push(`- 本輪缺席 → 標記過期：${stage1.stats.expired}`, "");
  if (enrich) {
    lines.push("## Stage 2 — 詳情抓取與 liveness", "");
    lines.push(`- 嘗試：${enrich.stats.attempted}`);
    lines.push(`- 成功且活著：${enrich.stats.fetched}`);
    lines.push(`- 抓到但疑似下架（stale）：${enrich.stats.dead}`);
    lines.push(`- 失敗：${enrich.stats.failed}`, "");
  } else {
    lines.push("## Stage 2 — 詳情抓取", "", "- （未啟用 --enrich；本輪略過）", "");
  }
  return lines.join("\n");
}

async function main() {
  const mode = DO_PUSH ? (DO_ENRICH ? "push + enrich" : "push（僅 stage-1）")
    : (DO_ENRICH || PROBE ? "dry-run + 詳情 probe" : "dry-run（不碰網路）");
  console.log(`▶ career-ops staging：${mode}`);

  const raw = JSON.parse(await fs.readFile(JOBS_PATH, "utf8"));
  const jobs = Array.isArray(raw) ? raw : (raw.jobs || raw.data || []);
  const candidates = [];
  const seenIds = new Set();
  for (const job of jobs) {
    if (!is104Job(job)) continue;
    const cand = toCandidate(job);
    if (!cand) continue;
    if (seenIds.has(cand.external_id)) continue; // 同一輪內去重
    seenIds.add(cand.external_id);
    candidates.push(cand);
  }
  console.log(`  快照 ${jobs.length} 筆 → ${SOURCE} 候選 ${candidates.length} 筆`);

  // 抓既有候選（push 模式才連 DB；dry-run 視為空表）。
  let existing = [];
  let db = null;
  if (DO_PUSH) {
    db = new SupabaseRest(SUPABASE_URL, SUPABASE_KEY);
    existing = await db.selectAll(
      "career_ops_job_candidates",
      "external_id,source,content_hash,detail_status,first_seen_at,seen_count,is_active,is_expired",
      `source=eq.${encodeURIComponent(SOURCE)}`
    );
    console.log(`  DB 既有 ${SOURCE} 候選：${existing.length} 筆`);
  }

  const stage1 = planStage1(candidates, existing);
  console.log(`  Stage 1：new=${stage1.stats.new} seen=${stage1.stats.seen} changed=${stage1.stats.changed} expired=${stage1.stats.expired}`);

  if (DO_PUSH) {
    // 分批 upsert，避免單次 body 過大。
    const batchSize = 500;
    for (let i = 0; i < stage1.upserts.length; i += batchSize) {
      await db.upsert("career_ops_job_candidates", stage1.upserts.slice(i, i + batchSize), "source,external_id");
    }
    for (const exp of stage1.expired) {
      await db.patch(
        "career_ops_job_candidates",
        `source=eq.${encodeURIComponent(exp.source)}&external_id=eq.${encodeURIComponent(exp.external_id)}`,
        { is_active: false, is_expired: true, expired_at: NOW_ISO }
      );
    }
    console.log(`  ✓ Stage 1 已推 Supabase（upsert ${stage1.upserts.length}、expire ${stage1.expired.length}）`);
  }

  // Stage 2：只有 --enrich 或 --probe 才碰網路。
  let enrich = null;
  if (DO_ENRICH || PROBE) {
    const limit = PROBE ? PROBE : DETAIL_LIMIT;
    // dry-run + probe 時，用剛算出來的 upserts 當候選（都算 pending）。
    const pool = DO_PUSH
      ? stage1.upserts
      : stage1.upserts.map((c) => ({ ...c, detail_status: "pending" }));
    console.log(`  Stage 2：節流抓取上限 ${limit} 筆（delay ${MIN_DELAY}-${MAX_DELAY}ms）`);
    enrich = await enrichDetails(pool, limit);
    console.log(`  Stage 2：fetched=${enrich.stats.fetched} stale=${enrich.stats.dead} failed=${enrich.stats.failed}`);
    if (DO_PUSH && enrich.details.length) {
      await db.upsert("career_ops_job_details", enrich.details, "source,external_id");
      for (const p of enrich.patches) {
        await db.patch(
          "career_ops_job_candidates",
          `source=eq.${encodeURIComponent(SOURCE)}&external_id=eq.${encodeURIComponent(p.external_id)}`,
          { detail_status: p.detail_status, detail_fetched_at: p.detail_fetched_at }
        );
      }
      console.log(`  ✓ Stage 2 已推 Supabase（details ${enrich.details.length}）`);
    }
  }

  // 本地產出：staging 快照 + Markdown 報告（供 review / 離線稽核）。
  const out = {
    generatedAt: NOW_ISO,
    mode,
    source: SOURCE,
    snapshotPath: JOBS_PATH,
    snapshotJobCount: jobs.length,
    candidateCount: candidates.length,
    stage1: { stats: stage1.stats, expiredCount: stage1.expired.length },
    stage2: enrich ? { stats: enrich.stats, detailCount: enrich.details.length } : null,
    candidates: DO_PUSH ? undefined : candidates // dry-run 時附上候選供檢視
  };
  await ensureDir(OUT_PATH);
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  await ensureDir(REPORT_PATH);
  await fs.writeFile(REPORT_PATH, buildReport({
    total: jobs.length, candidates: candidates.length, stage1, enrich, mode
  }));
  console.log(`  ✓ 已寫出 ${OUT_PATH} 與 ${REPORT_PATH}`);
  if (!DO_PUSH) console.log("  ℹ 這是 dry-run，未寫入 Supabase。加 --push 才會真的推。");
}

main().catch((err) => {
  console.error("staging 失敗：", err);
  process.exit(1);
});
