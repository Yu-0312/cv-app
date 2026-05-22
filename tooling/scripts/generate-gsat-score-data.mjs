#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createArgParser, ensureDir } from "./lib/utils.mjs";

const DEFAULT_ROWS = 1_000_000;
const DEFAULT_YEAR = 115;
const DEFAULT_SEED = "gsat-score-synthetic-v1";
const DEFAULT_OUT = "tooling/data/app/gsat-score-synthetic-115.csv";
const DEFAULT_SUMMARY_OUT = "tooling/data/app/gsat-score-synthetic-115-summary.json";

const SUBJECTS = ["chinese", "english", "math_a", "math_b", "society", "natural"];
const SCORE_COLUMNS = new Set(SUBJECTS);
const HEADERS = [
  "student_id",
  "exam_year",
  "region",
  "school_type",
  "gender",
  "intended_track",
  "taken_subject_count",
  "chinese",
  "english",
  "math_a",
  "math_b",
  "society",
  "natural",
  "ce_total",
  "cea_total",
  "ceb_total",
  "natural_group_total",
  "social_group_total",
  "best_four_total",
  "score_band",
  "synthetic_seed"
];

const REGIONS = [
  ["北北基", 0.26, 0.10],
  ["桃竹苗", 0.15, 0.07],
  ["中彰投", 0.19, 0.00],
  ["雲嘉南", 0.13, -0.06],
  ["高屏", 0.16, -0.04],
  ["宜花東", 0.07, -0.14],
  ["離島", 0.04, -0.18]
];

const SCHOOL_TYPES = [
  ["公立高中", 0.43, 0.32],
  ["私立高中", 0.25, 0.04],
  ["公立高職", 0.13, -0.24],
  ["私立高職", 0.11, -0.38],
  ["實驗教育", 0.04, 0.10],
  ["重考自學", 0.04, 0.18]
];

const GENDERS = [
  ["F", 0.49],
  ["M", 0.49],
  ["X", 0.02]
];

const TRACKS = [
  {
    name: "資訊電機",
    weight: 0.14,
    take: { mathA: 0.97, mathB: 0.22, society: 0.18, natural: 0.94 },
    shift: { chinese: -0.02, english: 0.10, mathA: 0.55, mathB: 0.12, society: -0.18, natural: 0.42 }
  },
  {
    name: "醫藥生命",
    weight: 0.11,
    take: { mathA: 0.96, mathB: 0.18, society: 0.16, natural: 0.98 },
    shift: { chinese: 0.08, english: 0.18, mathA: 0.48, mathB: 0.08, society: -0.10, natural: 0.58 }
  },
  {
    name: "工程理學",
    weight: 0.16,
    take: { mathA: 0.93, mathB: 0.25, society: 0.20, natural: 0.90 },
    shift: { chinese: -0.04, english: 0.04, mathA: 0.46, mathB: 0.12, society: -0.12, natural: 0.44 }
  },
  {
    name: "商管財金",
    weight: 0.18,
    take: { mathA: 0.34, mathB: 0.90, society: 0.78, natural: 0.26 },
    shift: { chinese: 0.06, english: 0.20, mathA: 0.20, mathB: 0.40, society: 0.26, natural: -0.12 }
  },
  {
    name: "法政社科",
    weight: 0.14,
    take: { mathA: 0.18, mathB: 0.84, society: 0.94, natural: 0.14 },
    shift: { chinese: 0.26, english: 0.14, mathA: -0.08, mathB: 0.24, society: 0.44, natural: -0.24 }
  },
  {
    name: "文史外語",
    weight: 0.12,
    take: { mathA: 0.10, mathB: 0.68, society: 0.92, natural: 0.12 },
    shift: { chinese: 0.40, english: 0.34, mathA: -0.24, mathB: 0.02, society: 0.34, natural: -0.30 }
  },
  {
    name: "教育心理",
    weight: 0.08,
    take: { mathA: 0.16, mathB: 0.76, society: 0.88, natural: 0.22 },
    shift: { chinese: 0.24, english: 0.12, mathA: -0.14, mathB: 0.16, society: 0.36, natural: -0.10 }
  },
  {
    name: "設計藝術",
    weight: 0.07,
    take: { mathA: 0.12, mathB: 0.58, society: 0.74, natural: 0.18 },
    shift: { chinese: 0.18, english: 0.08, mathA: -0.22, mathB: -0.02, society: 0.22, natural: -0.18 }
  }
];

const SUBJECT_MODEL = {
  chinese: { base: 0.58, flavor: "verbal", noise: 0.62, bias: 0.02 },
  english: { base: 0.60, flavor: "verbal", noise: 0.64, bias: -0.04 },
  math_a: { base: 0.70, flavor: "quant", noise: 0.66, bias: -0.08 },
  math_b: { base: 0.64, flavor: "quant", noise: 0.64, bias: 0.10 },
  society: { base: 0.58, flavor: "humanities", noise: 0.64, bias: 0.06 },
  natural: { base: 0.64, flavor: "science", noise: 0.66, bias: -0.02 }
};

const { getFlag, hasFlag, getNumberFlag } = createArgParser(process.argv.slice(2));

function printHelp() {
  console.log(`
產生學測合成成績資料

用法：
  node scripts/generate-gsat-score-data.mjs --rows 1000000 --out data/app/gsat-score-synthetic-115.csv --summary-out data/app/gsat-score-synthetic-115-summary.json --gzip

選項：
  --rows <n>         產生筆數。預設：${DEFAULT_ROWS}
  --year <n>         學測年度。預設：${DEFAULT_YEAR}
  --seed <value>     固定亂數種子。預設：${DEFAULT_SEED}
  --out <file>       CSV 輸出路徑。預設：${DEFAULT_OUT}
  --summary-out <f>  摘要 JSON 輸出路徑。預設：${DEFAULT_SUMMARY_OUT}
  --gzip             另外產生 .gz 壓縮檔
  --help             顯示說明
`);
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = hashSeed(seed) || 1;
  return function rng() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNormal(rng) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

function weightedPick(items, rng) {
  const total = items.reduce((sum, item) => sum + item[1], 0);
  let cursor = rng() * total;
  for (const item of items) {
    cursor -= item[1];
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function weightedTrack(rng) {
  const total = TRACKS.reduce((sum, track) => sum + track.weight, 0);
  let cursor = rng() * total;
  for (const track of TRACKS) {
    cursor -= track.weight;
    if (cursor <= 0) return track;
  }
  return TRACKS[TRACKS.length - 1];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function chance(probability, rng) {
  return rng() < clamp(probability, 0.01, 0.995);
}

function toScore(z) {
  return clamp(Math.round(8 + z * 2.55), 0, 15);
}

function scoreBand(bestFourTotal) {
  if (bestFourTotal >= 56) return "頂尖";
  if (bestFourTotal >= 50) return "高分";
  if (bestFourTotal >= 44) return "中上";
  if (bestFourTotal >= 36) return "中段";
  return "待加強";
}

function sumIfAvailable(values, keys) {
  let total = 0;
  for (const key of keys) {
    if (values[key] === "") return "";
    total += values[key];
  }
  return total;
}

function makeSummary(rows, seed, year, out, summaryOut) {
  const subjectStats = Object.fromEntries(SUBJECTS.map((subject) => [
    subject,
    {
      count: 0,
      min: 15,
      max: 0,
      mean: 0,
      distribution: Object.fromEntries(Array.from({ length: 16 }, (_, score) => [score, 0]))
    }
  ]));
  return {
    dataset: "synthetic_gsat_scores",
    generatedAt: new Date().toISOString(),
    rowCount: rows,
    examYear: year,
    seed,
    csvPath: path.resolve(out),
    summaryPath: path.resolve(summaryOut),
    columns: HEADERS,
    notes: [
      "合成資料，不代表真實考生或大考中心官方分布。",
      "各科級分範圍為 0-15；未選考科目以空白欄位表示。",
      "student_id、seed 與產生器版本固定時，可重現相同資料。"
    ],
    subjectStats,
    takenSubjectCount: {},
    regionCounts: {},
    schoolTypeCounts: {},
    trackCounts: {},
    scoreBandCounts: {},
    groupTotals: {
      ce_total: { count: 0, mean: 0 },
      cea_total: { count: 0, mean: 0 },
      ceb_total: { count: 0, mean: 0 },
      natural_group_total: { count: 0, mean: 0 },
      social_group_total: { count: 0, mean: 0 },
      best_four_total: { count: 0, mean: 0 }
    },
    sampleRows: []
  };
}

function addCount(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function addMean(target, value) {
  if (value === "") return;
  target.mean += value;
  target.count += 1;
}

function updateSummary(summary, rowObject) {
  for (const subject of SUBJECTS) {
    const value = rowObject[subject];
    if (value === "") continue;
    const stats = summary.subjectStats[subject];
    stats.count += 1;
    stats.mean += value;
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
    stats.distribution[value] += 1;
  }
  addCount(summary.takenSubjectCount, rowObject.taken_subject_count);
  addCount(summary.regionCounts, rowObject.region);
  addCount(summary.schoolTypeCounts, rowObject.school_type);
  addCount(summary.trackCounts, rowObject.intended_track);
  addCount(summary.scoreBandCounts, rowObject.score_band);
  for (const key of Object.keys(summary.groupTotals)) addMean(summary.groupTotals[key], rowObject[key]);
  if (summary.sampleRows.length < 5) {
    summary.sampleRows.push(Object.fromEntries(HEADERS.map((header) => [header, rowObject[header]])));
  }
}

function finalizeSummary(summary) {
  for (const stats of Object.values(summary.subjectStats)) {
    if (stats.count === 0) {
      stats.min = null;
      stats.max = null;
      continue;
    }
    stats.mean = Number((stats.mean / stats.count).toFixed(3));
  }
  for (const stats of Object.values(summary.groupTotals)) {
    stats.mean = stats.count ? Number((stats.mean / stats.count).toFixed(3)) : null;
  }
  return summary;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function buildRow(index, year, seed, rng, normal) {
  const [region, , regionEffect] = weightedPick(REGIONS, rng);
  const [schoolType, , schoolEffect] = weightedPick(SCHOOL_TYPES, rng);
  const [gender] = weightedPick(GENDERS, rng);
  const track = weightedTrack(rng);

  const base = normal() * 0.88 + regionEffect + schoolEffect;
  const verbal = base * 0.62 + normal() * 0.58;
  const quant = base * 0.70 + normal() * 0.62;
  const humanities = base * 0.60 + normal() * 0.62;
  const science = base * 0.66 + normal() * 0.62;

  const ability = { verbal, quant, humanities, science };
  const extraSubjectChance = clamp((base - 0.05) * 0.045, -0.06, 0.08);
  const taken = {
    chinese: true,
    english: true,
    math_a: chance(track.take.mathA + extraSubjectChance, rng),
    math_b: chance(track.take.mathB + extraSubjectChance, rng),
    society: chance(track.take.society + extraSubjectChance, rng),
    natural: chance(track.take.natural + extraSubjectChance, rng)
  };

  if (!taken.math_a && !taken.math_b) {
    if (track.take.mathA >= track.take.mathB) taken.math_a = true;
    else taken.math_b = true;
  }
  if (!taken.society && !taken.natural) {
    if (track.take.natural >= track.take.society) taken.natural = true;
    else taken.society = true;
  }

  const values = {};
  for (const subject of SUBJECTS) {
    if (!taken[subject]) {
      values[subject] = "";
      continue;
    }
    const model = SUBJECT_MODEL[subject];
    const shiftKey = subject === "math_a" ? "mathA" : subject === "math_b" ? "mathB" : subject;
    const z = ability[model.flavor] * model.base
      + base * 0.22
      + normal() * model.noise
      + model.bias
      + (track.shift[shiftKey] || 0);
    values[subject] = toScore(z);
  }

  const takenScores = SUBJECTS.map((subject) => values[subject]).filter((value) => value !== "");
  const bestFourTotal = takenScores.length >= 4
    ? takenScores.toSorted((a, b) => b - a).slice(0, 4).reduce((sum, score) => sum + score, 0)
    : "";

  const rowObject = {
    student_id: `GSAT${year}-${String(index).padStart(7, "0")}`,
    exam_year: year,
    region,
    school_type: schoolType,
    gender,
    intended_track: track.name,
    taken_subject_count: takenScores.length,
    ...values,
    ce_total: sumIfAvailable(values, ["chinese", "english"]),
    cea_total: sumIfAvailable(values, ["chinese", "english", "math_a"]),
    ceb_total: sumIfAvailable(values, ["chinese", "english", "math_b"]),
    natural_group_total: sumIfAvailable(values, ["chinese", "english", "math_a", "natural"]),
    social_group_total: sumIfAvailable(values, ["chinese", "english", "math_b", "society"]),
    best_four_total: bestFourTotal,
    score_band: scoreBand(bestFourTotal),
    synthetic_seed: seed
  };

  for (const column of SCORE_COLUMNS) {
    if (rowObject[column] === undefined) rowObject[column] = "";
  }
  return rowObject;
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve) => stream.once("drain", resolve));
  }
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const rows = getNumberFlag("--rows", DEFAULT_ROWS);
  const year = getNumberFlag("--year", DEFAULT_YEAR);
  const seed = getFlag("--seed", DEFAULT_SEED);
  const out = getFlag("--out", DEFAULT_OUT);
  const summaryOut = getFlag("--summary-out", DEFAULT_SUMMARY_OUT);
  const gzip = hasFlag("--gzip");

  if (!Number.isInteger(rows) || rows < 1) throw new Error("--rows 必須是正整數");
  if (!Number.isInteger(year) || year < 1) throw new Error("--year 必須是正整數");

  await ensureDir(out);
  await ensureDir(summaryOut);

  const rng = createRng(seed);
  const normal = createNormal(rng);
  const summary = makeSummary(rows, seed, year, out, summaryOut);
  const stream = fs.createWriteStream(out, { encoding: "utf8" });

  await writeChunk(stream, `${HEADERS.join(",")}\n`);

  const buffer = [];
  const flushEvery = 10_000;
  for (let index = 1; index <= rows; index += 1) {
    const row = buildRow(index, year, seed, rng, normal);
    updateSummary(summary, row);
    buffer.push(HEADERS.map((header) => csvCell(row[header])).join(","));
    if (buffer.length >= flushEvery) {
      await writeChunk(stream, `${buffer.join("\n")}\n`);
      buffer.length = 0;
    }
  }

  if (buffer.length > 0) await writeChunk(stream, `${buffer.join("\n")}\n`);
  stream.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  await fsp.writeFile(summaryOut, `${JSON.stringify(finalizeSummary(summary), null, 2)}\n`, "utf8");

  if (gzip) {
    await pipeline(
      fs.createReadStream(out),
      createGzip({ level: 9 }),
      fs.createWriteStream(`${out}.gz`)
    );
  }

  console.log(JSON.stringify({
    rows,
    out: path.resolve(out),
    summaryOut: path.resolve(summaryOut),
    gzipOut: gzip ? path.resolve(`${out}.gz`) : null
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
