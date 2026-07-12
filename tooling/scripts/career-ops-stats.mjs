#!/usr/bin/env node
// ---------------------------------------------------------------------------
// career-ops-stats.mjs — 求職漏斗 / 轉換率 / 停留時間 / 過期追蹤（就地計算）
//
// 借鏡 career_agent 的 sentinel/stats.py，但改用 CV Studio 的中文狀態詞彙，
// 且完全確定性、零 LLM。輸入是使用者的 cv_career_ops_jobs（現況）＋
// cv_career_ops_job_events（狀態變更時間軸），輸出：
//   1) 漏斗：每個階段「曾到達」的職缺數（累積）。
//   2) 轉換率：階段對階段的通過率。
//   3) 停留時間：每個階段的中位數天數（由事件時間軸推算，現況階段算到 now）。
//   4) 過期：仍在進行中但超過 N 天沒動的職缺。
//
// 資料來源二選一：
//   A) 本機 JSON：--jobs <path> --events <path>
//   B) Supabase：--supabase-url --supabase-key（service_role）--user-id <uuid>
//
// 計算邏輯全部在 lib/career-ops-stats.mjs（純函式、有單元測試）；本檔只做
// I/O 與報告輸出。
//
// 用法：
//   node tooling/scripts/career-ops-stats.mjs \
//     --jobs tooling/data/app/career-ops-tracked.json \
//     --events tooling/data/app/career-ops-events.json \
//     --out tooling/data/app/career-ops-stats.json \
//     --report-out tooling/data/app/career-ops-stats.md
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import { createArgParser, ensureDir } from "./lib/utils.mjs";
import {
  FUNNEL_STAGES,
  computeStats,
} from "./lib/career-ops-stats.mjs";

const { getFlag, hasFlag, getNumberFlag } = createArgParser(process.argv.slice(2));

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`career-ops-stats.mjs — 求職漏斗 / 轉換率 / 停留時間 / 過期追蹤

用法：
  node tooling/scripts/career-ops-stats.mjs [flags]

資料來源（二選一）：
  本機 JSON：
    --jobs <path>          cv_career_ops_jobs 匯出（陣列）
    --events <path>        cv_career_ops_job_events 匯出（陣列，可省略）
  Supabase（service_role）：
    --supabase-url <url>   （或環境變數 SUPABASE_URL）
    --supabase-key <key>   （或環境變數 SUPABASE_SERVICE_ROLE_KEY）
    --user-id <uuid>       只算此使用者（強烈建議指定）

輸出：
  --out <path>             JSON 輸出（預設 tooling/data/app/career-ops-stats.json）
  --js-out <path>          JS global 輸出（給前端 <script> 直接用；可省略）
  --js-global <name>       JS global 變數名（預設 CV_CAREER_OPS_STATS）
  --report-out <path>      Markdown 報告輸出（可省略）

參數：
  --stale-days <n>         幾天沒動算過期（預設 14）
  --now <iso>             以此時間為「現在」（預設當下；方便回溯／測試）
  -h, --help               顯示此說明

階段：${FUNNEL_STAGES.join(" → ")}（拒絕 / 略過 / 已下架 為終結，另計）。`);
  process.exit(0);
}

const JOBS_PATH = getFlag("--jobs", "");
const EVENTS_PATH = getFlag("--events", "");
const SUPABASE_URL = getFlag("--supabase-url", process.env.SUPABASE_URL || "");
const SUPABASE_KEY = getFlag("--supabase-key", process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const USER_ID = getFlag("--user-id", "");
const OUT_PATH = getFlag("--out", "tooling/data/app/career-ops-stats.json");
const JS_OUT = getFlag("--js-out", "");
const JS_GLOBAL = getFlag("--js-global", "CV_CAREER_OPS_STATS");
const REPORT_OUT = getFlag("--report-out", "");
const STALE_DAYS = getNumberFlag("--stale-days", 14);
const NOW_FLAG = getFlag("--now", "");
const NOW = NOW_FLAG ? Date.parse(NOW_FLAG) : Date.now();

if (NOW_FLAG && Number.isNaN(NOW)) {
  console.error(`--now 不是合法時間：${NOW_FLAG}`);
  process.exit(1);
}

// ── Supabase REST（分頁 select，可選 user_id 過濾）────────────────────────────
async function supabaseSelect(base, key, table, columns, filter) {
  const rows = [];
  const pageSize = 1000;
  const cleanBase = base.replace(/\/$/, "");
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const qs = `select=${encodeURIComponent(columns)}${filter ? `&${filter}` : ""}`;
    const res = await fetch(`${cleanBase}/rest/v1/${table}?${qs}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${to}`,
      },
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
      "job_key,status,updated_at,last_seen_at", userFilter,
    );
    const events = await supabaseSelect(
      SUPABASE_URL, SUPABASE_KEY, "cv_career_ops_job_events",
      "job_key,from_status,to_status,changed_at", userFilter,
    );
    return { jobs, events, source: `Supabase（${USER_ID ? "user=" + USER_ID : "全部使用者"}）` };
  }
  throw new Error("請提供 --jobs（本機）或 --supabase-url/--supabase-key（線上）");
}

// ── Markdown 報告 ────────────────────────────────────────────────────────────
const STAGE_LABEL = {
  considering: "評估中",
  shortlisted: "入選短名單",
  applied: "已投遞",
  interviewing: "面試中",
  offer: "Offer",
};

function pct(rate) {
  return rate == null ? "—" : `${(rate * 100).toFixed(0)}%`;
}
function days(v) {
  return v == null ? "—" : `${(Math.round(v * 10) / 10)}`;
}

function buildReport(stats, source) {
  const L = [];
  L.push("# Career Ops — 求職漏斗與追蹤（就地計算）", "");
  L.push(`- 產出時間：${stats.generated_at}`);
  L.push(`- 來源：${source}`);
  L.push(`- 追蹤中職缺：${stats.funnel.totals.tracked}（拒絕 ${stats.funnel.totals.rejected}、放棄/下架 ${stats.funnel.totals.dropped}）`);
  L.push("");

  L.push("## 漏斗（曾到達各階段的職缺數，累積）", "");
  L.push("| 階段 | 曾到達 | 停留中位數（天） | 樣本 |");
  L.push("| --- | ---: | ---: | ---: |");
  for (const s of stats.funnel.stages) {
    const d = stats.dwell.perStage[s.stage];
    L.push(`| ${STAGE_LABEL[s.stage] || s.stage} | ${s.reached} | ${days(d.medianDays)} | ${d.samples} |`);
  }
  L.push("");

  L.push("## 轉換率（階段 → 階段）", "");
  L.push("| 轉換 | 前段 | 後段 | 通過率 |");
  L.push("| --- | ---: | ---: | ---: |");
  for (const c of stats.conversions) {
    L.push(`| ${STAGE_LABEL[c.from]} → ${STAGE_LABEL[c.to]} | ${c.fromCount} | ${c.toCount} | ${pct(c.rate)} |`);
  }
  L.push("");

  L.push(`## 過期追蹤（超過 ${stats.stale.staleDays} 天沒動、仍在進行中）`, "");
  if (stats.stale.count === 0) {
    L.push("目前沒有過期的進行中職缺。", "");
  } else {
    L.push("| job_key | 現況 | 階段 | 閒置天數 |");
    L.push("| --- | --- | --- | ---: |");
    for (const it of stats.stale.items.slice(0, 30)) {
      L.push(`| ${it.job_key} | ${it.status} | ${STAGE_LABEL[it.stage] || it.stage} | ${it.idleDays} |`);
    }
    if (stats.stale.count > 30) L.push(`| …其餘 ${stats.stale.count - 30} 筆 | | | |`);
    L.push("");
  }

  L.push("> 註：漏斗為累積「曾到達」（面試中的職缺也計入其之前的階段）；停留時間由事件時間軸推算，現況階段算到產出時間為止。");
  return L.join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { jobs, events, source } = await loadData();
  const stats = computeStats(jobs, events, { now: NOW, staleDays: STALE_DAYS });

  await ensureDir(OUT_PATH);
  await fs.writeFile(OUT_PATH, JSON.stringify(stats, null, 2));
  console.log(`✓ 寫入 ${OUT_PATH}`);

  if (JS_OUT) {
    await ensureDir(JS_OUT);
    await fs.writeFile(JS_OUT, `window.${JS_GLOBAL} = ${JSON.stringify(stats)};\n`);
    console.log(`✓ 寫入 ${JS_OUT}`);
  }
  if (REPORT_OUT) {
    await ensureDir(REPORT_OUT);
    await fs.writeFile(REPORT_OUT, buildReport(stats, source));
    console.log(`✓ 寫入 ${REPORT_OUT}`);
  }

  const t = stats.funnel.totals;
  console.log(`— 來源：${source}`);
  console.log(`— 追蹤 ${t.tracked}｜拒絕 ${t.rejected}｜放棄/下架 ${t.dropped}｜過期 ${stats.stale.count}`);
  for (const s of stats.funnel.stages) {
    const d = stats.dwell.perStage[s.stage];
    console.log(`   ${s.stage.padEnd(13)} 到達 ${String(s.reached).padStart(4)}｜停留中位 ${d.medianDays == null ? "—" : d.medianDays.toFixed(1)}d（${d.samples}）`);
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
