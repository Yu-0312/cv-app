#!/usr/bin/env node

import fs from "node:fs/promises";
import { createArgParser, ensureDir, fetchWithRetry } from "./lib/utils.mjs";

const UAC_ORIGIN = "https://www.uac.edu.tw";

const { args, getFlag, hasFlag, getNumberFlag } = createArgParser(process.argv.slice(2));

function printHelp() {
  console.log(`
大學分發入學委員會最低登記標準抓取工具

用法：
  node scripts/import-uac-scores.mjs --year 115 --out data/normalized/uac-standards-115.json

說明：
  從大學分發入學委員會官網抓取學科能力測驗採計組合的最低登記標準，
  輸出可供 build-gsat-external-data.mjs 使用的正規化 JSON。

  注意：分發委員會的個別校系錄取分數僅提供 PDF 格式，此工具抓取
  的是採計科目組合的最低登記標準（非個別校系），可作為分發入學
  門檻的參考資料。

選項：
  --year       學年度（民國，如 115）
  --out        輸出 JSON 路徑
  --help       顯示此說明
`);
}


const SUBJECT_PATTERNS = [
  { key: "chinese", name: "國文", patterns: ["國文", "國(文)?"] },
  { key: "english", name: "英文", patterns: ["英文", "英(文)?"] },
  { key: "mathA", name: "數學A", patterns: ["數學A", "數A", "數甲"] },
  { key: "mathB", name: "數學B", patterns: ["數學B", "數B", "數乙"] },
  { key: "natural", name: "自然", patterns: ["自然"] },
  { key: "society", name: "社會", patterns: ["社會"] }
];

function parseSubjectsFromText(text = "") {
  const found = [];
  for (const { name, patterns } of SUBJECT_PATTERNS) {
    if (patterns.some((p) => new RegExp(p).test(text))) {
      found.push(name);
    }
  }
  return found;
}

function parseMinScore(text = "") {
  const match = String(text).match(/\d+(\.\d+)?/);
  if (!match) return null;
  const score = Number(match[0]);
  return Number.isFinite(score) ? score : null;
}

function parseHtmlTable(html = "") {
  const rows = [];
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const tagPattern = /<[^>]+>/g;

  let trMatch;
  while ((trMatch = trPattern.exec(html)) !== null) {
    const cells = [];
    let tdMatch;
    const rowHtml = trMatch[1];
    tdPattern.lastIndex = 0;
    while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
      const text = tdMatch[1].replace(tagPattern, "").replace(/&nbsp;/g, " ").trim();
      cells.push(text);
    }
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

async function fetchUacStandardsPage(year) {
  const rocYear = year;
  const candidates = [
    `${UAC_ORIGIN}/${rocYear}uac_note/uac4129.html`,
    `${UAC_ORIGIN}/${rocYear}uac_note/uac5129.html`,
    `${UAC_ORIGIN}/${rocYear}data/${rocYear}_result_school_standard.html`
  ];

  const headers = {
    "accept": "text/html,application/xhtml+xml,*/*",
    "accept-language": "zh-TW,zh;q=0.9",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  for (const url of candidates) {
    try {
      console.log(`嘗試：${url}`);
      const response = await fetchWithRetry(url, { headers }, { maxRetries: 1 });
      const html = await response.text();
      if (html.includes("最低") || html.includes("標準") || html.includes("登記")) {
        console.log(`找到頁面：${url}`);
        return { url, html };
      }
    } catch {
      // 繼續嘗試下一個 URL
    }
  }
  return null;
}

async function importUacScores() {
  const year = getNumberFlag("--year");
  const out = getFlag("--out");

  if (!year) throw new Error("缺少 --year，例如 --year 115");
  if (!out) throw new Error("缺少 --out，請指定輸出 JSON 檔案");

  const result = await fetchUacStandardsPage(year);

  if (!result) {
    console.warn("無法取得分發委員會最低登記標準頁面，輸出空資料。");
    const payload = {
      source: "uac",
      fetchedAt: new Date().toISOString(),
      year,
      status: "unavailable",
      note: "分發委員會最低登記標準頁面 URL 未找到。個別校系分發錄取分數僅提供 PDF 格式，需人工解析。",
      combinations: []
    };
    await ensureDir(out);
    await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`已輸出空資料：${out}`);
    return;
  }

  const rows = parseHtmlTable(result.html);
  const combinations = [];

  for (const cells of rows) {
    if (cells.length < 3) continue;
    const subjectText = cells.slice(0, -1).join(" ");
    const scoreText = cells[cells.length - 1];

    const subjects = parseSubjectsFromText(subjectText);
    const minScore = parseMinScore(scoreText);

    if (subjects.length >= 2 && minScore !== null) {
      combinations.push({
        subjects: subjects.sort(),
        subjectText: subjectText.replace(/\s+/g, " ").trim(),
        minScore,
        year
      });
    }
  }

  const deduped = [...new Map(
    combinations.map((c) => [c.subjects.join("+"), c])
  ).values()];

  const payload = {
    source: "uac",
    fetchedAt: new Date().toISOString(),
    year,
    sourceUrl: result.url,
    status: deduped.length > 0 ? "ok" : "parsed-empty",
    combinationCount: deduped.length,
    note: "採計科目組合的最低登記標準，非個別校系分發錄取分數。",
    combinations: deduped
  };

  await ensureDir(out);
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`已輸出分發委員會標準資料：${out}`);
  console.log(`科目組合數：${deduped.length}`);
}

async function main() {
  if (!args[0] || hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }
  await importUacScores();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
