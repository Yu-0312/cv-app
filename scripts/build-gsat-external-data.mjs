#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const SUBJECT_ALIASES = new Map([
  ["國", "國文"],
  ["國文", "國文"],
  ["英", "英文"],
  ["英文", "英文"],
  ["數學a", "數學A"],
  ["數學ａ", "數學A"],
  ["數a", "數學A"],
  ["數ａ", "數學A"],
  ["數甲", "數學A"],
  ["數學b", "數學B"],
  ["數學ｂ", "數學B"],
  ["數b", "數學B"],
  ["數ｂ", "數學B"],
  ["數乙", "數學B"],
  ["社", "社會"],
  ["社會", "社會"],
  ["自", "自然"],
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

const SUBJECT_SHORT_LABELS = new Map([
  ["國文", "國"],
  ["英文", "英"],
  ["數學A", "數A"],
  ["數學B", "數B"],
  ["社會", "社"],
  ["自然", "自"]
]);

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
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith("-browser.json"))
    .map((entry) => path.join(inputPath, entry.name))
    .sort();
}

function normalizeSubjectName(name = "") {
  const key = String(name)
    .trim()
    .replace(/[Ａａ]/g, "a")
    .replace(/[Ｂｂ]/g, "b")
    .toLowerCase();
  return SUBJECT_ALIASES.get(key) || "";
}

function normalizeLevel(level = "") {
  return LEVEL_MAP.get(String(level).trim()) || "";
}

function parseSubjectCombo(name = "") {
  const text = String(name || "")
    .replace(/[Ａａ]/g, "A")
    .replace(/[Ｂｂ]/g, "B")
    .replace(/\s+/g, "")
    .replace(/之?級分總和|級分|總和|科/g, "");
  const subjects = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    if (rest.startsWith("國文")) {
      subjects.push("國文");
      index += 2;
    } else if (rest.startsWith("國")) {
      subjects.push("國文");
      index += 1;
    } else if (rest.startsWith("英文")) {
      subjects.push("英文");
      index += 2;
    } else if (rest.startsWith("英")) {
      subjects.push("英文");
      index += 1;
    } else if (/^數學?A/i.test(rest) || rest.startsWith("數甲")) {
      subjects.push("數學A");
      index += rest.startsWith("數學") ? 3 : 2;
    } else if (/^數學?B/i.test(rest) || rest.startsWith("數乙")) {
      subjects.push("數學B");
      index += rest.startsWith("數學") ? 3 : 2;
    } else if (rest.startsWith("社會")) {
      subjects.push("社會");
      index += 2;
    } else if (rest.startsWith("社")) {
      subjects.push("社會");
      index += 1;
    } else if (rest.startsWith("自然")) {
      subjects.push("自然");
      index += 2;
    } else if (rest.startsWith("自")) {
      subjects.push("自然");
      index += 1;
    } else {
      index += 1;
    }
  }
  return [...new Set(subjects)];
}

function canonicalSubjectCombo(name = "") {
  const subjects = parseSubjectCombo(name);
  return subjects.map((subject) => SUBJECT_SHORT_LABELS.get(subject) || subject).join("");
}

function subjectsToWeights(subjects = []) {
  return subjects.reduce((acc, subject) => {
    if (subject) acc[subject] = 1;
    return acc;
  }, {});
}

function getPowerMultiplier(item = {}) {
  const value = item.level ?? item.power ?? item.multiplier ?? "";
  const normalized = String(value).replace(/[^\d.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePowerItems(record) {
  const rawItems = Array.isArray(record?.firstStage?.power) ? record.firstStage.power : [];
  return rawItems
    .map((item) => {
      const name = String(item?.name || "").trim();
      const subjects = parseSubjectCombo(name);
      if (!name || !subjects.length) return null;
      return {
        name,
        subjects,
        multiplier: getPowerMultiplier(item)
      };
    })
    .filter(Boolean);
}

function parseScoreItem(value) {
  const text = String(value || "").replace(/\s+/g, "");
  const match = text.match(/^(.+?)(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const label = match[1];
  const score = Number(match[2]);
  const subjects = parseSubjectCombo(label);
  if (!Number.isFinite(score) || !subjects.length) return null;
  return {
    label,
    canonicalLabel: canonicalSubjectCombo(label),
    subjects,
    score
  };
}

function extractScreeningRules(record) {
  const rows = [
    ...(Array.isArray(record.lowScoreThisYear) ? record.lowScoreThisYear : []),
    ...(Array.isArray(record.lowScorePreYear) ? record.lowScorePreYear : [])
  ];

  const rules = rows
    .map((row) => ({
      year: Number(row?.year) || null,
      items: (Array.isArray(row?.score) ? row.score : [])
        .map(parseScoreItem)
        .filter(Boolean)
    }))
    .filter((row) => row.items.length);

  const seen = new Set();
  return rules.filter((rule) => {
    const key = `${rule.year || ""}::${rule.items.map((item) => `${item.label}${item.score}`).join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickPrimaryScreening(record, rules = []) {
  const ruleItem = rules
    .flatMap((rule) => (rule.items || []).map((item) => ({ ...item, year: Number(rule.year || 0) })))
    .sort((a, b) => (
      b.year - a.year ||
      b.subjects.length - a.subjects.length ||
      b.score - a.score
    ))[0];
  if (ruleItem) {
    return {
      label: ruleItem.label,
      canonicalLabel: ruleItem.canonicalLabel,
      subjects: ruleItem.subjects
    };
  }

  const powerItems = normalizePowerItems(record);
  if (powerItems.length) {
    const sorted = [...powerItems].sort((a, b) => {
      const aMultiplier = a.multiplier ?? Number.MAX_SAFE_INTEGER;
      const bMultiplier = b.multiplier ?? Number.MAX_SAFE_INTEGER;
      return aMultiplier - bMultiplier || b.subjects.length - a.subjects.length;
    });
    return {
      label: sorted[0].name,
      canonicalLabel: canonicalSubjectCombo(sorted[0].name),
      subjects: sorted[0].subjects
    };
  }

  const excess = Array.isArray(record.excess) ? record.excess : [];
  const excessItem = excess.map((item) => String(item || "").trim()).find((item) => parseSubjectCombo(item).length);
  if (excessItem) {
    return {
      label: excessItem,
      canonicalLabel: canonicalSubjectCombo(excessItem),
      subjects: parseSubjectCombo(excessItem)
    };
  }

  return null;
}

function inferTrack(record) {
  const standards = Array.isArray(record?.firstStage?.standard) ? record.firstStage.standard : [];
  const subjectSet = new Set(
    [
      ...standards.map((item) => item?.name),
      ...normalizePowerItems(record).map((item) => item.name),
      ...(Array.isArray(record.excess) ? record.excess : [])
    ]
      .map((item) => normalizeSubjectName(item))
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
  const rules = extractScreeningRules(record);
  const primary = pickPrimaryScreening(record, rules);
  if (primary?.subjects?.length) {
    return subjectsToWeights(primary.subjects);
  }

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

function extractHistory(record, primary, rules = extractScreeningRules(record)) {
  const values = rules
    .map((rule) => {
      if (!rule.items.length) return null;
      const matching = primary?.canonicalLabel
        ? rule.items.find((item) => item.canonicalLabel === primary.canonicalLabel)
        : null;
      const picked = matching || [...rule.items].sort((a, b) => (
        b.subjects.length - a.subjects.length ||
        b.score - a.score
      ))[0];
      return picked?.score ?? null;
    })
    .filter((value) => value !== null);

  return values.slice(0, 3);
}

function buildNote(record) {
  const base = ["來源：104 落點分析"];
  if (record.schoolTypeName) base.push(record.schoolTypeName);
  if (record.reportRisk !== null && record.reportRisk !== undefined) {
    const risk = Number(record.reportRisk);
    base.push(`104風險值 ${Number.isFinite(risk) ? +risk.toFixed(1) : record.reportRisk}`);
  }
  return base.join("・");
}

function toAppRecord(record) {
  const track = inferTrack(record);
  if (!track) {
    return { skipped: true, reason: "無法判斷自然組或社會組" };
  }

  const screeningRules = extractScreeningRules(record);
  const primary = pickPrimaryScreening(record, screeningRules);
  const history = extractHistory(record, primary, screeningRules);
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
      source: "104",
      criteriaName: primary?.label || "",
      criteriaSubjects: primary?.subjects || [],
      screeningPower: normalizePowerItems(record),
      screeningRules
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
  const reasonEntries = Object.entries(reasonCount);
  if (!reasonEntries.length) {
    report.push("- 無");
  }
  for (const [reason, count] of reasonEntries) {
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
