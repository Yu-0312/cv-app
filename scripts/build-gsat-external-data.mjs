#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const SUBJECT_ALIASES = new Map([
  ["國文", "國文"],
  ["英文", "英文"],
  ["數學a", "數學A"],
  ["數a", "數學A"],
  ["數甲", "數學A"],
  ["數學b", "數學B"],
  ["數b", "數學B"],
  ["數乙", "數學B"],
  ["社會", "社會"],
  ["自然", "自然"]
]);

const LEVEL_MAP = new Map([
  ["頂", "頂標"],
  ["頂標", "頂標"],
  ["前", "前標"],
  ["前標", "前標"],
  ["均", "均標"],
  ["均標", "均標"],
  ["後", "後標"],
  ["後標", "後標"],
  ["底", "底標"],
  ["底標", "底標"]
]);

const SCIENCE_KEYWORDS = [
  "醫", "牙", "藥", "護理", "公衛", "生醫", "生命", "化學", "物理", "數學",
  "電機", "電子", "資訊", "資工", "資科", "機械", "材料", "土木", "工程",
  "航太", "光電", "海洋", "農藝", "獸醫", "森林", "環工", "醫學檢驗", "物治"
];

const SOCIAL_KEYWORDS = [
  "法律", "政治", "經濟", "企管", "管理", "財金", "金融", "會計", "傳播",
  "新聞", "外語", "英文", "日文", "社會", "歷史", "地理", "哲學", "教育",
  "心理", "公行", "行政", "國貿", "行銷", "文學", "公共", "外交"
];

const args = process.argv.slice(2);

function getFlag(name, fallback = null) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx === args.length - 1) return fallback;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

function printHelp() {
  console.log(`
GSAT 外部資料建置工具

用法：
  node scripts/build-gsat-external-data.mjs data/normalized --js-out data/app/gsat-external-data.js --json-out data/app/gsat-external-data.json --report-out data/app/gsat-external-report.md

說明：
  讀取 normalized JSON，轉成目前前端學測分析可直接使用的補充資料。

輸出：
  --js-out      給 index.html 載入的 JS 檔
  --json-out    轉換後的純 JSON
  --report-out  成功 / 跳過筆數摘要
`);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function collectInputFiles(inputPath) {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) return [inputPath];
  const entries = await fs.readdir(inputPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(inputPath, entry.name))
    .sort();
}

function normalizeSubjectName(name = "") {
  const key = String(name).trim().toLowerCase();
  return SUBJECT_ALIASES.get(key) || "";
}

function normalizeLevel(level = "") {
  return LEVEL_MAP.get(String(level).trim()) || "";
}

function inferTrack(record) {
  const standards = Array.isArray(record?.firstStage?.standard) ? record.firstStage.standard : [];
  const subjectSet = new Set(
    standards
      .map((item) => normalizeSubjectName(item?.name))
      .filter(Boolean)
  );

  const departmentName = `${record.departmentName || ""}${record.categoryName || ""}`;
  const hasScienceKeyword = SCIENCE_KEYWORDS.some((keyword) => departmentName.includes(keyword));
  const hasSocialKeyword = SOCIAL_KEYWORDS.some((keyword) => departmentName.includes(keyword));

  if (hasScienceKeyword && !hasSocialKeyword) return "science";
  if (hasSocialKeyword && !hasScienceKeyword) return "social";

  if (subjectSet.has("自然")) return "science";
  if (subjectSet.has("社會")) return "social";
  if (subjectSet.has("數學A") && !subjectSet.has("數學B")) return "science";
  if (subjectSet.has("數學B") && !subjectSet.has("數學A")) return "social";

  if (hasScienceKeyword) return "science";
  if (hasSocialKeyword) return "social";
  return null;
}

function inferWeights(record, track) {
  const name = record.departmentName || "";

  if (track === "science") {
    if (/[醫牙藥護]/.test(name)) {
      return { 國文: 1.5, 英文: 1.5, 數學A: 1, 自然: 2 };
    }
    if (/(電機|電子|資訊|資工|資科|工程)/.test(name)) {
      return { 國文: 1, 英文: 1.5, 數學A: 2, 自然: 1.5 };
    }
    if (/(數學|物理|化學)/.test(name)) {
      return { 國文: 1, 英文: 1, 數學A: 1.5, 自然: 2 };
    }
    return { 國文: 1, 英文: 1.25, 數學A: 1.5, 自然: 1.5 };
  }

  if (/(法律|政治)/.test(name)) {
    return { 國文: 2, 英文: 1.5, 數學B: 0.5, 社會: 2 };
  }
  if (/(經濟|財金|金融|企管|管理|商)/.test(name)) {
    return { 國文: 1, 英文: 1.5, 數學B: 1.5, 社會: 1 };
  }
  if (/(外語|英文|語文|傳播)/.test(name)) {
    return { 國文: 1.25, 英文: 2, 社會: 1 };
  }
  return { 國文: 1.25, 英文: 1.5, 數學B: 1, 社會: 1.5 };
}

function buildThresholds(record) {
  const thresholds = {};
  const standards = Array.isArray(record?.firstStage?.standard) ? record.firstStage.standard : [];
  for (const item of standards) {
    const subject = normalizeSubjectName(item?.name);
    const level = normalizeLevel(item?.level);
    if (!subject || !level) continue;
    thresholds[subject] = level;
  }
  return thresholds;
}

function pickScoreValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const matches = value.match(/\d+(?:\.\d+)?/g);
  if (!matches) return null;
  const numbers = matches
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  if (!numbers.length) return null;
  const plausible = numbers.filter((item) => item >= 20 && item <= 75);
  if (plausible.length) return Math.max(...plausible);
  return Math.max(...numbers);
}

function extractHistory(record) {
  const rows = [
    ...(Array.isArray(record.lowScorePreYear) ? record.lowScorePreYear : []),
    ...(Array.isArray(record.lowScoreThisYear) ? record.lowScoreThisYear : [])
  ];

  const values = rows
    .map((row) => {
      const scoreArray = Array.isArray(row?.score) ? row.score : [];
      const parsed = scoreArray.map(pickScoreValue).filter((value) => value !== null);
      if (!parsed.length) return null;
      return Math.max(...parsed);
    })
    .filter((value) => value !== null);

  return [...new Set(values)].slice(0, 3);
}

function buildNote(record) {
  const base = ["來源：104 落點分析"];
  if (record.schoolTypeName) base.push(record.schoolTypeName);
  if (record.reportRisk !== null && record.reportRisk !== undefined) {
    base.push(`104風險值 ${record.reportRisk}`);
  }
  return base.join("・");
}

function toAppRecord(record) {
  const track = inferTrack(record);
  if (!track) {
    return { skipped: true, reason: "無法判斷自然組或社會組" };
  }

  const history = extractHistory(record);
  if (history.length < 2) {
    return { skipped: true, reason: "缺少足夠歷年分數資料" };
  }

  const schoolName = record.schoolName?.trim();
  const departmentName = record.departmentName?.trim();
  if (!schoolName || !departmentName) {
    return { skipped: true, reason: "缺少校名或系名" };
  }

  return {
    skipped: false,
    value: {
      u: schoolName,
      d: departmentName,
      t: track,
      w: inferWeights(record, track),
      th: buildThresholds(record),
      h: history,
      note: buildNote(record),
      source: "104"
    }
  };
}

function mergeByKey(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.u}::${item.d}::${item.t}`;
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => {
    if (a.t !== b.t) return a.t.localeCompare(b.t);
    if (a.u !== b.u) return a.u.localeCompare(b.u, "zh-Hant");
    return a.d.localeCompare(b.d, "zh-Hant");
  });
}

async function build() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const inputPath = args[0];
  const jsOut = getFlag("--js-out");
  const jsonOut = getFlag("--json-out");
  const reportOut = getFlag("--report-out");

  if (!inputPath) throw new Error("缺少 normalized JSON 路徑");
  if (!jsOut || !jsonOut || !reportOut) {
    throw new Error("請提供 --js-out、--json-out、--report-out");
  }

  const inputFiles = await collectInputFiles(inputPath);
  const accepted = [];
  const skipped = [];

  for (const file of inputFiles) {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    const majors = Array.isArray(payload?.majors) ? payload.majors : [];
    for (const major of majors) {
      const converted = toAppRecord(major);
      if (converted.skipped) {
        skipped.push({
          sourceFile: path.basename(file),
          schoolName: major.schoolName || "",
          departmentName: major.departmentName || "",
          reason: converted.reason
        });
      } else {
        accepted.push(converted.value);
      }
    }
  }

  const merged = mergeByKey(accepted);
  const report = [
    "# GSAT 外部資料建置報告",
    "",
    `建置時間：${new Date().toISOString()}`,
    `輸入檔數：${inputFiles.length}`,
    `成功筆數：${merged.length}`,
    `跳過筆數：${skipped.length}`,
    "",
    "## 輸入來源",
    ...inputFiles.map((file) => `- ${file}`),
    "",
    "## 跳過原因統計"
  ];

  const reasonCount = skipped.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
  for (const [reason, count] of Object.entries(reasonCount)) {
    report.push(`- ${reason}：${count}`);
  }

  if (skipped.length) {
    report.push("", "## 跳過樣本");
    for (const item of skipped.slice(0, 20)) {
      report.push(`- ${item.schoolName} ${item.departmentName}｜${item.reason}｜${item.sourceFile}`);
    }
  }

  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    sources: inputFiles,
    count: merged.length,
    records: merged
  };
  const jsPayload =
    "window.CV_GSAT_EXTERNAL_DEPTS = " +
    JSON.stringify(merged, null, 2) +
    ";\n";

  await ensureDir(jsOut);
  await ensureDir(jsonOut);
  await ensureDir(reportOut);
  await fs.writeFile(jsOut, jsPayload, "utf8");
  await fs.writeFile(jsonOut, `${JSON.stringify(jsonPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(reportOut, `${report.join("\n")}\n`, "utf8");

  console.log(`已輸出 JS：${jsOut}`);
  console.log(`已輸出 JSON：${jsonOut}`);
  console.log(`已輸出報告：${reportOut}`);
  console.log(`成功筆數：${merged.length}`);
  console.log(`跳過筆數：${skipped.length}`);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
