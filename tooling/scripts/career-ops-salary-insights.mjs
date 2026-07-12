#!/usr/bin/env node
// ---------------------------------------------------------------------------
// career-ops-salary-insights.mjs — 從自己的職缺池就地算薪資分位數
//
// 借鏡 career_agent 的 salary_insights.py：把職缺薪資正規化成「每月」、排除
// 面議與時薪、算出 median / p25 / p75。差別在我們的 pool 是多來源、多幣別，
// 所以：
//   1) 幣別絕不混算 —— 先分幣別（TWD / JPY / USD / …），各自算分位數。
//   2) 幣別 → 市場（TWD→tw、JPY→jp、USD→global），對齊 compensation.mjs。
//   3) 依可設定的職類關鍵字把職缺分桶（backend / data / pm…），外加 all 桶。
//   4) 期別（月/年/時）能明確判斷才計入；判不出來的算 ambiguous、誠實排除並回報。
//
// 純資料、確定性、零 LLM 成本。輸出 JSON + JS global + Markdown 報告。
//
// 用法：
//   node tooling/scripts/career-ops-salary-insights.mjs \
//     --jobs tooling/data/app/career-ops-jobs.json \
//     --out  tooling/data/app/career-ops-salary-insights.json \
//     --js-out tooling/data/app/career-ops-salary-insights.js \
//     --report-out tooling/data/app/career-ops-salary-insights.md
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import { createArgParser, ensureDir } from "./lib/utils.mjs";

const { getFlag, hasFlag, getNumberFlag } = createArgParser(process.argv.slice(2));

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`career-ops-salary-insights.mjs — 從職缺池就地算薪資分位數

用法：
  node tooling/scripts/career-ops-salary-insights.mjs [flags]

Flags：
  --jobs <path>        職缺快照（預設 tooling/data/app/career-ops-jobs.json）
  --out <path>         JSON 輸出（預設 tooling/data/app/career-ops-salary-insights.json）
  --js-out <path>      JS global 輸出（給前端 <script> 直接用；可省略）
  --report-out <path>  Markdown 報告輸出（可省略）
  --min-sample <n>     報告裡略過樣本數 < n 的桶（預設 5）
  --js-global <name>   JS global 變數名（預設 CV_CAREER_OPS_SALARY_INSIGHTS）
  -h, --help           顯示此說明

期別正規化：全部換算「每月」同幣別後算分位數；面議/時薪/判不出期別者排除並回報。`);
  process.exit(0);
}

const JOBS_PATH = getFlag("--jobs", "tooling/data/app/career-ops-jobs.json");
const OUT_PATH = getFlag("--out", "tooling/data/app/career-ops-salary-insights.json");
const JS_OUT = getFlag("--js-out", "");
const REPORT_OUT = getFlag("--report-out", "");
const MIN_SAMPLE = getNumberFlag("--min-sample", 5);
const JS_GLOBAL = getFlag("--js-global", "CV_CAREER_OPS_SALARY_INSIGHTS");

// 職類分桶：關鍵字比對 title（小寫）。一筆職缺可落多桶，且一律計入 all。
const ROLE_BUCKETS = [
  { id: "backend", label: "後端", keywords: ["backend", "back-end", "後端", "server", "golang", "java engineer", "node"] },
  { id: "frontend", label: "前端", keywords: ["frontend", "front-end", "前端", "react", "vue", "ui engineer"] },
  { id: "fullstack", label: "全端", keywords: ["fullstack", "full-stack", "full stack", "全端", "全棧"] },
  { id: "mobile", label: "行動", keywords: ["ios", "android", "flutter", "react native", "mobile", "行動"] },
  { id: "data", label: "資料", keywords: ["data engineer", "data analyst", "數據", "資料工程", "資料分析", "etl", "analytics"] },
  { id: "ml-ai", label: "ML/AI", keywords: ["machine learning", "deep learning", "ml engineer", "ai engineer", "人工智慧", "演算法", "llm", "nlp", "computer vision"] },
  { id: "devops", label: "DevOps/SRE", keywords: ["devops", "sre", "site reliability", "platform engineer", "infrastructure", "維運"] },
  { id: "security", label: "資安", keywords: ["security", "資安", "infosec", "penetration", "appsec"] },
  { id: "qa", label: "測試", keywords: ["qa", "quality assurance", "test engineer", "sdet", "測試"] },
  { id: "pm", label: "產品", keywords: ["product manager", "產品經理", "product owner", "專案經理", "project manager"] },
  { id: "designer", label: "設計", keywords: ["designer", "ux", "ui/ux", "設計師", "設計"] },
];

// 幣別 → 市場（對齊 compensation.mjs 的 tw / jp / global）。
const CURRENCY_MARKET = { TWD: "tw", JPY: "jp", USD: "global", SGD: "sg", EUR: "eu", GBP: "uk", RMB: "cn", CNY: "cn", HKD: "hk" };

// 期別倍率：換算成「每月」的乘數。
const PERIOD_TO_MONTHLY = { monthly: 1, yearly: 1 / 12, hourly: null, daily: null };

function cleanText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

// 從 job 取出薪資原文：優先 salaryDesc 欄位，否則抓 description 的 "Salary:" 行。
function salaryStringFromJob(job) {
  if (job?.salaryDesc) return cleanText(job.salaryDesc);
  const m = String(job?.description || "").match(/Salary:\s*([^\n]+)/i);
  return m ? cleanText(m[1]) : "";
}

function detectCurrency(text) {
  const t = text.toUpperCase();
  // 先判專屬符號的幣別，讓「人民幣」在裸『元』之前勝出。
  if (/RMB|CNY|人民幣|￥/.test(t)) return "CNY";
  if (/NT\$|TWD|NTD|新台幣|台幣/.test(t)) return "TWD";
  if (/JPY|¥|円|日圓/.test(t)) return "JPY";
  if (/SGD|新?加坡幣/.test(t)) return "SGD";
  if (/EUR|€/.test(t)) return "EUR";
  if (/GBP|£/.test(t)) return "GBP";
  if (/HKD|港幣/.test(t)) return "HKD";
  if (/US\$|USD/.test(t)) return "USD";
  if (/\$/.test(t)) return "USD"; // 裸 $ 保守當 USD
  if (/元/.test(t)) return "TWD"; // 裸『元』在台灣情境視為 TWD（已先排除人民幣）
  return "";
}

function detectPeriod(text) {
  const t = text.toLowerCase();
  if (/面議|negotiable|\bdoe\b|competitive/.test(t)) return "negotiable";
  if (/時薪|\/\s*h(ou)?r|per hour|hourly|\bhr\b/.test(t)) return "hourly";
  if (/日薪|\/\s*day|per day|daily/.test(t)) return "daily";
  if (/年薪|\/\s*(yr|year)|per year|per annum|\bp\.?a\.?\b|annual/.test(t)) return "yearly";
  if (/月薪|\/\s*mo(nth)?|per month|monthly/.test(t)) return "monthly";
  return ""; // 未標明 → 交給幅度啟發式
}

// 解析數字：處理 k/K 後綴（×1000）、千分位逗號、小數。
function parseNumberToken(tok) {
  const raw = String(tok).replace(/[,，]/g, "").trim();
  const m = raw.match(/([\d.]+)\s*([kK])?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2]) n *= 1000;
  return Math.round(n);
}

// 抽出 1~2 個金額（區間取 low/high）。"Up to X" → 只有 high。
function parseAmounts(text) {
  // 去掉明顯不是薪資的括號附註
  const cleaned = text.replace(/\(.*?\)/g, " ");
  const tokens = cleaned.match(/[\d][\d,.\s]*\d\s*[kK]?|\d\s*[kK]?/g) || [];
  const nums = tokens.map(parseNumberToken).filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  if (/up to|最高|至多/i.test(text) && nums.length === 1) return { low: 0, high: nums[0] };
  const low = nums[0];
  const high = nums.length > 1 ? nums[1] : 0;
  return { low, high };
}

// 幅度啟發式：期別未標明時，用幣別 + 單一數字大小推期別。判不出回 "" → ambiguous。
function inferPeriodByMagnitude(currency, value) {
  if (!value || value <= 0) return "";
  switch (currency) {
    case "TWD":
      if (value >= 300_000) return "yearly";
      if (value >= 20_000) return "monthly";
      if (value <= 1_000) return "hourly";
      return "";
    case "JPY":
      if (value >= 2_000_000) return "yearly";
      if (value >= 150_000) return "monthly";
      return "";
    case "USD":
    case "SGD":
    case "EUR":
    case "GBP":
    case "HKD":
      if (value >= 15_000) return "yearly";
      if (value >= 1_500) return "monthly";
      if (value <= 200) return "hourly";
      return "";
    case "CNY":
      if (value >= 200_000) return "yearly";
      if (value >= 3_000) return "monthly";
      return "";
    default:
      return "";
  }
}

// 把一筆職缺解析成 {currency, monthly}（已換算每月、同幣別），或標記排除原因。
function parseSalary(job) {
  const text = salaryStringFromJob(job);
  if (!text) return { status: "none" };
  let period = detectPeriod(text);
  // 期別中的「排除類」先判掉，不受幣別能否辨識影響。
  if (period === "negotiable") return { status: "negotiable" };
  if (period === "hourly" || period === "daily") return { status: "hourly_daily" };
  const currency = detectCurrency(text);
  const amounts = parseAmounts(text);
  if (!amounts || (!amounts.low && !amounts.high)) {
    return { status: period === "" ? "none" : "negotiable" };
  }
  // 代表值：有 high 取中點，否則取 low（或 up-to 的 high）。
  const rep = amounts.high > 0 && amounts.low > 0
    ? Math.round((amounts.low + amounts.high) / 2)
    : (amounts.low || amounts.high);
  if (!currency) return { status: "unknown_currency" };
  if (period === "") period = inferPeriodByMagnitude(currency, rep);
  if (period === "") return { status: "ambiguous" };
  if (period === "hourly" || period === "daily") return { status: "hourly_daily" };
  const mult = PERIOD_TO_MONTHLY[period];
  if (mult == null) return { status: "hourly_daily" };
  const monthly = Math.round(rep * mult);
  if (!(monthly > 0)) return { status: "ambiguous" };
  return { status: "ok", currency, monthly, period };
}

// 線性內插百分位（同 salary_insights.py）。sorted 已排序，q ∈ [0,1]。
function percentile(sorted, q) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  if (lo + 1 < sorted.length) return Math.round(sorted[lo] + (sorted[lo + 1] - sorted[lo]) * frac);
  return sorted[lo];
}

function bucketsForTitle(title) {
  const t = String(title || "").toLowerCase();
  const ids = ROLE_BUCKETS.filter((b) => b.keywords.some((k) => t.includes(k))).map((b) => b.id);
  return ids;
}

function summarize(monthlyValues) {
  const sorted = [...monthlyValues].sort((a, b) => a - b);
  return {
    sample: sorted.length,
    median_monthly: percentile(sorted, 0.5),
    p25_monthly: percentile(sorted, 0.25),
    p75_monthly: percentile(sorted, 0.75),
    min_monthly: sorted.length ? sorted[0] : null,
    max_monthly: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

async function main() {
  const raw = JSON.parse(await fs.readFile(JOBS_PATH, "utf8"));
  const jobs = Array.isArray(raw) ? raw : (raw.jobs || raw.data || []);

  // currency → bucketId → [monthly...]
  const buckets = new Map();
  function push(currency, bucketId, monthly) {
    if (!buckets.has(currency)) buckets.set(currency, new Map());
    const byBucket = buckets.get(currency);
    if (!byBucket.has(bucketId)) byBucket.set(bucketId, []);
    byBucket.get(bucketId).push(monthly);
  }

  const exclusions = { none: 0, negotiable: 0, hourly_daily: 0, unknown_currency: 0, ambiguous: 0 };
  let parsedOk = 0;
  for (const job of jobs) {
    const r = parseSalary(job);
    if (r.status !== "ok") {
      if (r.status in exclusions) exclusions[r.status] += 1;
      continue;
    }
    parsedOk += 1;
    const roleIds = bucketsForTitle(job.title);
    push(r.currency, "all", r.monthly);
    for (const id of roleIds) push(r.currency, id, r.monthly);
  }

  // 組輸出：每幣別 → 市場 + 各桶 summary。
  const labelById = Object.fromEntries(ROLE_BUCKETS.map((b) => [b.id, b.label]));
  labelById.all = "全部";
  const currencies = [];
  for (const [currency, byBucket] of [...buckets.entries()].sort()) {
    const rows = [];
    for (const [bucketId, vals] of byBucket.entries()) {
      rows.push({ bucket: bucketId, label: labelById[bucketId] || bucketId, ...summarize(vals) });
    }
    rows.sort((a, b) => (b.sample - a.sample));
    currencies.push({
      currency,
      market: CURRENCY_MARKET[currency] || "other",
      buckets: rows,
    });
  }

  const out = {
    schemaVersion: "career-ops-salary-insights/1.0",
    generatedAt: new Date().toISOString(),
    snapshotPath: JOBS_PATH,
    snapshotJobCount: jobs.length,
    parsedCount: parsedOk,
    exclusions,
    note: "薪資已正規化為『同幣別每月』後計算分位數；面議/時薪/日薪/期別不明者已排除。幣別絕不混算。",
    currencies,
  };

  await ensureDir(OUT_PATH);
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));

  if (JS_OUT) {
    await ensureDir(JS_OUT);
    await fs.writeFile(JS_OUT, `window.${JS_GLOBAL} = ${JSON.stringify(out)};\n`);
  }

  if (REPORT_OUT) {
    const lines = ["# Career Ops — 薪資行情（就地計算）", ""];
    lines.push(`- 產出時間：${out.generatedAt}`);
    lines.push(`- 來源快照：\`${JOBS_PATH}\`（${jobs.length} 筆）`);
    lines.push(`- 成功解析：${parsedOk} 筆`);
    lines.push(`- 排除：面議 ${exclusions.negotiable}、時/日薪 ${exclusions.hourly_daily}、無薪資 ${exclusions.none}、幣別不明 ${exclusions.unknown_currency}、期別不明 ${exclusions.ambiguous}`, "");
    for (const c of currencies) {
      const shown = c.buckets.filter((b) => b.sample >= MIN_SAMPLE);
      if (!shown.length) continue;
      lines.push(`## ${c.currency}（市場：${c.market}）· 每月`, "");
      lines.push("| 職類 | 樣本 | P25 | 中位數 | P75 | 最低 | 最高 |");
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
      for (const b of shown) {
        const f = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
        lines.push(`| ${b.label} | ${b.sample} | ${f(b.p25_monthly)} | ${f(b.median_monthly)} | ${f(b.p75_monthly)} | ${f(b.min_monthly)} | ${f(b.max_monthly)} |`);
      }
      lines.push("");
    }
    lines.push(`> 註：${out.note}`);
    await ensureDir(REPORT_OUT);
    await fs.writeFile(REPORT_OUT, lines.join("\n"));
  }

  console.log(`▶ 薪資行情：快照 ${jobs.length} 筆 → 解析 ${parsedOk} 筆，幣別 ${currencies.length} 種`);
  console.log(`  排除：${JSON.stringify(exclusions)}`);
  for (const c of currencies) {
    const all = c.buckets.find((b) => b.bucket === "all");
    if (all) console.log(`  ${c.currency}(${c.market}) all：樣本 ${all.sample}，中位 ${all.median_monthly?.toLocaleString("en-US")}／月`);
  }
  console.log(`  ✓ 已寫出 ${OUT_PATH}${JS_OUT ? " + " + JS_OUT : ""}${REPORT_OUT ? " + " + REPORT_OUT : ""}`);
}

main().catch((err) => {
  console.error("salary-insights 失敗：", err);
  process.exit(1);
});
