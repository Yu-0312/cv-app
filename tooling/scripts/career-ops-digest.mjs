#!/usr/bin/env node
// ---------------------------------------------------------------------------
// career-ops-digest.mjs — 每日變更摘要（就地計算、零 LLM）
//
// 借鏡 career_agent 的 sentinel/diff.py + digest.py，但不存快照、不呼叫 LLM：
// CV Studio 已有 append-only 的 cv_career_ops_job_events，「有什麼變化」就是對
// 事件與職缺做一個時間窗查詢。輸出當期（近 N 小時）的：狀態變動、新職缺、
// 進面試/拿 Offer 亮點、被拒/放棄、待追蹤到期、新轉為過期。
//
// 資料來源二選一：
//   A) 本機 JSON：--jobs <path> --events <path>
//   B) Supabase：--supabase-url --supabase-key（service_role）--user-id <uuid>
//
// 用法：
//   node tooling/scripts/career-ops-digest.mjs \
//     --jobs tooling/data/app/career-ops-tracked.json \
//     --events tooling/data/app/career-ops-events.json \
//     --since-hours 24 \
//     --out tooling/data/app/career-ops-digest.json \
//     --report-out tooling/data/app/career-ops-digest.md
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import { createArgParser, ensureDir } from "./lib/utils.mjs";
import { computeDigest, renderDigestMarkdown } from "./lib/career-ops-digest.mjs";

const { getFlag, hasFlag, getNumberFlag } = createArgParser(process.argv.slice(2));

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`career-ops-digest.mjs — 每日變更摘要（就地計算、零 LLM）

用法：
  node tooling/scripts/career-ops-digest.mjs [flags]

資料來源（二選一）：
  本機 JSON：
    --jobs <path>          cv_career_ops_jobs 匯出（陣列）
    --events <path>        cv_career_ops_job_events 匯出（陣列，可省略）
  Supabase（service_role）：
    --supabase-url <url>   （或環境變數 SUPABASE_URL）
    --supabase-key <key>   （或環境變數 SUPABASE_SERVICE_ROLE_KEY）
    --user-id <uuid>       只算此使用者（強烈建議指定）

輸出：
  --out <path>             JSON 輸出（預設 tooling/data/app/career-ops-digest.json）
  --js-out <path>          JS global 輸出（給前端 <script> 直接用；可省略）
  --js-global <name>       JS global 變數名（預設 CV_CAREER_OPS_DIGEST）
  --report-out <path>      Markdown 報告輸出（可省略）

參數：
  --since-hours <n>        觀察區間（預設 24）
  --stale-days <n>         幾天沒動算過期（預設 14）
  --now <iso>             以此時間為「現在」（預設當下）
  -h, --help               顯示此說明`);
  process.exit(0);
}

const JOBS_PATH = getFlag("--jobs", "");
const EVENTS_PATH = getFlag("--events", "");
const SUPABASE_URL = getFlag("--supabase-url", process.env.SUPABASE_URL || "");
const SUPABASE_KEY = getFlag("--supabase-key", process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const USER_ID = getFlag("--user-id", "");
const OUT_PATH = getFlag("--out", "tooling/data/app/career-ops-digest.json");
const JS_OUT = getFlag("--js-out", "");
const JS_GLOBAL = getFlag("--js-global", "CV_CAREER_OPS_DIGEST");
const REPORT_OUT = getFlag("--report-out", "");
const SINCE_HOURS = getNumberFlag("--since-hours", 24);
const STALE_DAYS = getNumberFlag("--stale-days", 14);
const NOW_FLAG = getFlag("--now", "");
const NOW = NOW_FLAG ? Date.parse(NOW_FLAG) : Date.now();

if (NOW_FLAG && Number.isNaN(NOW)) {
  console.error(`--now 不是合法時間：${NOW_FLAG}`);
  process.exit(1);
}

async function supabaseSelect(base, key, table, columns, filter) {
  const rows = [];
  const pageSize = 1000;
  const cleanBase = base.replace(/\/$/, "");
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const qs = `select=${encodeURIComponent(columns)}${filter ? `&${filter}` : ""}`;
    const res = await fetch(`${cleanBase}/rest/v1/${table}?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${to}` },
    });
    if (!res.ok) throw new Error(`select ${table} 失敗：${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function readJsonArray(path) {
  const raw = JSON.parse(await fs.readFile(path, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.data)) return raw.data;
  throw new Error(`${path} 不是陣列（也沒有 rows/data 欄位）`);
}

async function loadData() {
  if (JOBS_PATH) {
    const jobs = await readJsonArray(JOBS_PATH);
    const events = EVENTS_PATH ? await readJsonArray(EVENTS_PATH) : [];
    return { jobs, events, source: `本機 JSON（${JOBS_PATH}）` };
  }
  if (SUPABASE_URL && SUPABASE_KEY) {
    const userFilter = USER_ID ? `user_id=eq.${USER_ID}` : "";
    const jobs = await supabaseSelect(
      SUPABASE_URL, SUPABASE_KEY, "cv_career_ops_jobs",
      "job_key,company,title,status,first_seen_at,last_seen_at,updated_at,is_expired,next_follow_up_at", userFilter,
    );
    const events = await supabaseSelect(
      SUPABASE_URL, SUPABASE_KEY, "cv_career_ops_job_events",
      "job_key,from_status,to_status,changed_at", userFilter,
    );
    return { jobs, events, source: `Supabase（${USER_ID ? "user=" + USER_ID : "全部使用者"}）` };
  }
  throw new Error("請提供 --jobs（本機）或 --supabase-url/--supabase-key（線上）");
}

async function main() {
  const { jobs, events, source } = await loadData();
  const digest = computeDigest(jobs, events, { now: NOW, sinceHours: SINCE_HOURS, staleDays: STALE_DAYS });
  digest.source = source;

  await ensureDir(OUT_PATH);
  await fs.writeFile(OUT_PATH, JSON.stringify(digest, null, 2));
  console.log(`✓ 寫入 ${OUT_PATH}`);

  if (JS_OUT) {
    await ensureDir(JS_OUT);
    await fs.writeFile(JS_OUT, `window.${JS_GLOBAL} = ${JSON.stringify(digest)};\n`);
    console.log(`✓ 寫入 ${JS_OUT}`);
  }
  if (REPORT_OUT) {
    await ensureDir(REPORT_OUT);
    await fs.writeFile(REPORT_OUT, renderDigestMarkdown(digest));
    console.log(`✓ 寫入 ${REPORT_OUT}`);
  }

  console.log(`— 來源：${source}｜區間 近 ${SINCE_HOURS}h`);
  console.log(`— 追蹤 ${digest.totals.tracked}｜變化 ${digest.totals.changes}｜仍過期 ${digest.totals.still_stale}`);
  if (digest.empty) console.log("   （本期沒有新變化）");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
