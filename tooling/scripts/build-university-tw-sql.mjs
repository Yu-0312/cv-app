#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function getFlag(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return fallback;
  return args[index + 1];
}

function printHelp() {
  console.log(`
University TW SQL 匯入檔建置工具

用法：
  node scripts/build-university-tw-sql.mjs data/raw/university-tw-site.json --out data/sql/university-tw-seed.sql

說明：
  將 University TW 全站快照轉成可匯入 Supabase / PostgreSQL 的 SQL seed 檔。
  搭配 supabase-university-tw-schema.sql 一起使用。
`);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeUniversityCode(value, name = "") {
  const text = cleanText(value).toLowerCase();
  if (!text) {
    return cleanText(name);
  }
  if (/^[a-z]+\d+$/i.test(text)) {
    return text;
  }
  const digits = text.replace(/\D/g, "");
  if (!digits) {
    return cleanText(name);
  }
  if (digits.length >= 4) {
    return digits;
  }
  return digits.padStart(4, "0");
}

function dedupeRows(rows, buildKey, chooseRow = (current) => current) {
  const map = new Map();
  for (const row of rows) {
    const key = buildKey(row);
    if (!map.has(key)) {
      map.set(key, row);
      continue;
    }
    map.set(key, chooseRow(map.get(key), row));
  }
  return Array.from(map.values());
}

function buildRowKey(index, ...parts) {
  return [
    String(index + 1).padStart(4, "0"),
    ...parts.map((part) => cleanText(part).replace(/::/g, ":"))
  ].join("::");
}

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  const text = String(value).replace(/'/g, "''");
  return `'${text}'`;
}

function sqlInteger(value) {
  if (value === null || value === undefined || value === "") return "null";
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "null";
}

function sqlJson(value, fallback = null) {
  const payload = value ?? fallback;
  if (payload === null || payload === undefined) return "null";
  return `${sqlString(JSON.stringify(payload))}::jsonb`;
}

function parseYearLabel(value) {
  const match = cleanText(value).match(/(\d{2,3})年/);
  return match ? Number(match[1]) : null;
}

function buildRowMapByYear(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const year = parseYearLabel(row?.col0);
    if (!year) continue;
    const normalized = {};
    for (const [key, value] of Object.entries(row || {})) {
      if (key === "col0") continue;
      normalized[key] = cleanText(value);
    }
    map.set(year, normalized);
  }
  return map;
}

function buildHistoryReportMap(links) {
  const map = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    const year = parseYearLabel(link?.label);
    const url = cleanText(link?.url);
    if (!year || !url || !url.includes("/apply_his_report/")) continue;
    map.set(year, url);
  }
  return map;
}

function parseCompactCaacScoreRows(subjectText) {
  const text = cleanText(subjectText);
  if (!text || !text.includes("結果") || !/\d{2,3}年/.test(text)) return [];

  const tokens = text.split(" ").filter(Boolean);
  const yearIndexes = tokens
    .map((token, index) => ({ token, index, year: parseYearLabel(token) }))
    .filter((item) => item.year);

  if (!yearIndexes.length) return [];

  const headers = tokens.slice(0, yearIndexes[0].index).map((item) => cleanText(item));
  if (!headers.length) return [];

  const rows = [];
  for (let i = 0; i < yearIndexes.length; i += 1) {
    const current = yearIndexes[i];
    const nextIndex = yearIndexes[i + 1]?.index ?? tokens.length;
    const values = tokens.slice(current.index + 1, nextIndex);
    if (!values.length) continue;

    const payload = {};
    for (let j = 0; j < headers.length; j += 1) {
      payload[headers[j]] = cleanText(values[j] ?? "");
    }
    rows.push({
      year: current.year,
      payload
    });
  }

  return rows;
}

function buildSnapshotId(raw, explicitSnapshotId) {
  if (explicitSnapshotId) return explicitSnapshotId;
  const isoDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const year =
    raw?.sections?.uac?.schools?.[0]?.year ||
    raw?.sections?.caac?.schools?.[0]?.title?.match(/(\d{3})年/)?.[1] ||
    raw?.sections?.star?.schools?.[0]?.title?.match(/(\d{3})年/)?.[1] ||
    "unknown";
  return `university-tw-${year}-${isoDate}`;
}

function createCanonicalUniversityIndex(raw, snapshotId) {
  const map = new Map();

  function ensureUniversity(code, name, sectionName) {
    const schoolName = cleanText(name);
    if (!schoolName) return null;
    const normalizedCode = normalizeUniversityCode(code, schoolName);
    if (!map.has(schoolName)) {
      map.set(schoolName, {
        snapshotId,
        universityCode: normalizedCode,
        schoolNo: null,
        name: schoolName,
        uacDepartmentCount: 0,
        caacDepartmentCount: 0,
        starDepartmentCount: 0,
        femaleSummary: [],
        femaleTrends: [],
        registerTotal: {},
        sourceSections: {
          uac: false,
          caac: false,
          star: false,
          female: false,
          register: false
        }
      });
    }
    const row = map.get(schoolName);
    if (normalizedCode) {
      const current = row.universityCode || "";
      const shouldReplace =
        !current ||
        (sectionName !== "female" && sectionName !== "register" && current.length >= normalizedCode.length) ||
        current === schoolName;
      if (shouldReplace) {
        row.universityCode = normalizedCode;
      }
    }
    return row;
  }

  for (const school of raw?.sections?.uac?.schools || []) {
    const row = ensureUniversity(school.code, school.name, "uac");
    if (!row) continue;
    row.schoolNo = cleanText(school.schoolNo) || row.schoolNo;
    row.uacDepartmentCount = Number(school.departmentCount || school.departments?.length || 0);
    row.sourceSections.uac = true;
  }

  for (const school of raw?.sections?.caac?.schools || []) {
    const row = ensureUniversity(school.code, school.name, "caac");
    if (!row) continue;
    row.caacDepartmentCount = Array.isArray(school.departmentDetails) ? school.departmentDetails.length : 0;
    row.sourceSections.caac = true;
  }

  for (const school of raw?.sections?.star?.schools || []) {
    const row = ensureUniversity(school.code, school.name, "star");
    if (!row) continue;
    row.starDepartmentCount = Array.isArray(school.departmentDetails) ? school.departmentDetails.length : 0;
    row.sourceSections.star = true;
  }

  for (const school of raw?.sections?.female?.schools || []) {
    const row = ensureUniversity(school.code, school.name, "female");
    if (!row) continue;
    row.femaleSummary = Array.isArray(school.summary) ? school.summary : [];
    row.femaleTrends = Array.isArray(school.trends) ? school.trends : [];
    row.sourceSections.female = true;
  }

  for (const school of raw?.sections?.register?.schools || []) {
    const row = ensureUniversity(school.code, school.name, "register");
    if (!row) continue;
    row.registerTotal = school.total || {};
    row.sourceSections.register = true;
  }

  const universities = Array.from(map.values())
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
    .map((row) => ({ ...row }));

  const usedCodes = new Set();
  for (const row of universities) {
    const candidates = [
      cleanText(row.universityCode),
      normalizeUniversityCode(row.schoolNo, row.name),
      cleanText(row.name)
    ].filter(Boolean);
    let finalCode = candidates.find((candidate) => !usedCodes.has(candidate));
    if (!finalCode) {
      const base = candidates[0] || cleanText(row.name) || "university";
      let suffix = 2;
      finalCode = `${base}#${suffix}`;
      while (usedCodes.has(finalCode)) {
        suffix += 1;
        finalCode = `${base}#${suffix}`;
      }
    }
    row.universityCode = finalCode;
    usedCodes.add(finalCode);
  }

  const nameToCode = Object.fromEntries(universities.map((row) => [row.name, row.universityCode]));
  return { universities, nameToCode };
}

function buildInsert(table, columns, rows) {
  if (!rows.length) return `-- ${table}: no rows\n`;
  const values = rows
    .map((row) => `  (${columns.map((column) => row[column]).join(", ")})`)
    .join(",\n");
  return `insert into ${table} (${columns.join(", ")})\nvalues\n${values}\n;\n`;
}

function buildSql(raw, snapshotId) {
  const generatedAt = new Date().toISOString();
  const summary = raw?.summary || {};
  const { universities, nameToCode } = createCanonicalUniversityIndex(raw, snapshotId);

  const uacRows = [];
  for (const school of raw?.sections?.uac?.schools || []) {
    for (const department of school.departments || []) {
      const code = cleanText(department.departmentId);
      const name = cleanText(department.departmentName);
      if (!code || !name) continue;
      uacRows.push({
        snapshot_id: sqlString(snapshotId),
        university_code: sqlString(nameToCode[cleanText(school.name)] || normalizeUniversityCode(school.code, school.name)),
        department_code: sqlString(code),
        department_name: sqlString(name),
        standards_text: sqlString(cleanText(department.standardsText)),
        subjects_text: sqlString(cleanText(department.subjectsText)),
        standard_code: sqlString(cleanText(department.standardCode)),
        subject_code: sqlString(cleanText(department.subjectCode))
      });
    }
  }

  const caacRows = [];
  const caacScoreRows = [];
  for (const school of raw?.sections?.caac?.schools || []) {
    for (const department of school.departmentDetails || []) {
      const code = cleanText(department.code);
      const name = cleanText(department.name);
      if (!code || !name) continue;
      const universityCode =
        nameToCode[cleanText(school.name)] || normalizeUniversityCode(school.code, school.name);
      const standardsByYear = buildRowMapByYear(department.standards);
      const multipliersByYear = buildRowMapByYear(department.multipliers);
      const compactRowsByYear = new Map(
        parseCompactCaacScoreRows(department.subjectText).map((row) => [row.year, row.payload])
      );
      const historyReportsByYear = buildHistoryReportMap(department.historyLinks);
      const years = new Set([
        ...standardsByYear.keys(),
        ...multipliersByYear.keys(),
        ...compactRowsByYear.keys()
      ]);
      const currentYear = years.size ? Math.max(...years) : null;

      caacRows.push({
        snapshot_id: sqlString(snapshotId),
        university_code: sqlString(universityCode),
        department_code: sqlString(code),
        department_name: sqlString(name),
        exam_date: sqlString(cleanText(department.examDate)),
        admission_info: sqlString(cleanText(department.admissionInfo)),
        subject_text: sqlString(cleanText(department.subjectText)),
        standards: sqlJson(Array.isArray(department.standards) ? department.standards : [], []),
        multipliers: sqlJson(Array.isArray(department.multipliers) ? department.multipliers : [], []),
        previous_year_filter_result: sqlJson(
          Array.isArray(department.previousYearFilterResult) ? department.previousYearFilterResult : [],
          []
        ),
        detail_links: sqlJson(Array.isArray(department.detailLinks) ? department.detailLinks : [], []),
        history_links: sqlJson(Array.isArray(department.historyLinks) ? department.historyLinks : [], []),
        source_url: sqlString(cleanText(department.url)),
        title: sqlString(cleanText(department.title)),
        heading: sqlString(cleanText(department.heading))
      });

      for (const year of Array.from(years).sort((a, b) => b - a)) {
        const standards = standardsByYear.get(year) || {};
        const multipliers = multipliersByYear.get(year) || {};
        const scorePayload = compactRowsByYear.get(year) || {};
        caacScoreRows.push({
          snapshot_id: sqlString(snapshotId),
          university_code: sqlString(universityCode),
          department_code: sqlString(code),
          department_name: sqlString(name),
          admission_year: sqlInteger(year),
          exam_date: sqlString(cleanText(department.examDate)),
          admission_info: sqlString(cleanText(department.admissionInfo)),
          subject_text: sqlString(cleanText(department.subjectText)),
          standards: sqlJson(standards, {}),
          multipliers: sqlJson(multipliers, {}),
          filter_result: sqlJson(
            currentYear !== null && year === currentYear - 1 && Array.isArray(department.previousYearFilterResult)
              ? department.previousYearFilterResult
              : [],
            []
          ),
          score_payload: sqlJson(scorePayload, {}),
          history_report_url: sqlString(cleanText(historyReportsByYear.get(year))),
          source_url: sqlString(cleanText(department.url))
        });
      }
    }
  }

  const starRows = [];
  for (const school of raw?.sections?.star?.schools || []) {
    for (const department of school.departmentDetails || []) {
      const code = cleanText(department.code);
      const name = cleanText(department.name);
      if (!code || !name) continue;
      starRows.push({
        snapshot_id: sqlString(snapshotId),
        university_code: sqlString(nameToCode[cleanText(school.name)] || normalizeUniversityCode(school.code, school.name)),
        department_code: sqlString(code),
        department_name: sqlString(name),
        group_name: sqlString(cleanText(department.group)),
        admission_info: sqlString(cleanText(department.admissionInfo)),
        rule_text: sqlString(cleanText(department.rule)),
        subject_text: sqlString(cleanText(department.subjectText)),
        standards: sqlJson(Array.isArray(department.standards) ? department.standards : [], []),
        ranking_items: sqlJson(Array.isArray(department.rankingItems) ? department.rankingItems : [], []),
        previous_year_admission_summary: sqlString(cleanText(department.previousYearAdmissionSummary)),
        previous_year_admission_details: sqlJson(
          Array.isArray(department.previousYearAdmissionDetails) ? department.previousYearAdmissionDetails : [],
          []
        ),
        detail_links: sqlJson(Array.isArray(department.detailLinks) ? department.detailLinks : [], []),
        history_links: sqlJson(Array.isArray(department.historyLinks) ? department.historyLinks : [], []),
        source_url: sqlString(cleanText(department.url)),
        title: sqlString(cleanText(department.title)),
        heading: sqlString(cleanText(department.heading))
      });
    }
  }

  const genderRows = [];
  for (const school of raw?.sections?.female?.schools || []) {
    for (const department of school.departments || []) {
      const name = cleanText(department.departmentName);
      if (!name) continue;
      genderRows.push({
        snapshot_id: sqlString(snapshotId),
        university_code: sqlString(nameToCode[cleanText(school.name)] || normalizeUniversityCode(school.code, school.name)),
        department_name: sqlString(name),
        girls_text: sqlString(cleanText(department.girls)),
        boys_text: sqlString(cleanText(department.boys)),
        female_percent_text: sqlString(cleanText(department.femalePercent)),
        metrics: sqlJson(department.metrics || {}, {})
      });
    }
  }

  const registrationRows = [];
  for (const school of raw?.sections?.register?.schools || []) {
    for (const [index, department] of (school.departments || []).entries()) {
      const name = cleanText(department.departmentName);
      if (!name) continue;
      const quotaMinusReserved = cleanText(department.quotaMinusReserved);
      const registeredCount = cleanText(department.registeredCount);
      const registrationRate = cleanText(department.registrationRate);
      registrationRows.push({
        snapshot_id: sqlString(snapshotId),
        university_code: sqlString(nameToCode[cleanText(school.name)] || normalizeUniversityCode(school.code, school.name)),
        row_key: sqlString(buildRowKey(index, name, quotaMinusReserved, registeredCount, registrationRate)),
        department_name: sqlString(name),
        quota_minus_reserved_text: sqlString(quotaMinusReserved),
        registered_count_text: sqlString(registeredCount),
        registration_rate_text: sqlString(registrationRate),
        metrics: sqlJson(department.metrics || {}, {})
      });
    }
  }

  const universityRows = universities.map((row) => ({
    snapshot_id: sqlString(snapshotId),
    university_code: sqlString(row.universityCode),
    school_no: sqlString(row.schoolNo),
    name: sqlString(row.name),
    uac_department_count: sqlInteger(row.uacDepartmentCount),
    caac_department_count: sqlInteger(row.caacDepartmentCount),
    star_department_count: sqlInteger(row.starDepartmentCount),
    female_summary: sqlJson(row.femaleSummary, []),
    female_trends: sqlJson(row.femaleTrends, []),
    register_total: sqlJson(row.registerTotal, {}),
    source_sections: sqlJson(row.sourceSections, {})
  }));

  const uniqueUacRows = dedupeRows(
    uacRows,
    (row) => `${row.snapshot_id}|${row.university_code}|${row.department_code}`
  );
  const uniqueCaacRows = dedupeRows(
    caacRows,
    (row) => `${row.snapshot_id}|${row.university_code}|${row.department_code}`
  );
  const uniqueStarRows = dedupeRows(
    starRows,
    (row) => `${row.snapshot_id}|${row.university_code}|${row.department_code}`
  );
  const uniqueCaacScoreRows = dedupeRows(
    caacScoreRows,
    (row) => `${row.snapshot_id}|${row.university_code}|${row.department_code}|${row.admission_year}`
  );
  const uniqueGenderRows = dedupeRows(
    genderRows,
    (row) => `${row.snapshot_id}|${row.university_code}|${row.department_name}`
  );
  const uniqueRegistrationRows = dedupeRows(
    registrationRows,
    (row) => `${row.snapshot_id}|${row.university_code}|${row.row_key}`
  );

  return `-- University TW seed generated at ${generatedAt}
-- Snapshot ID: ${snapshotId}
-- Summary: ${JSON.stringify(summary)}

begin;

insert into public.university_tw_snapshots (
  snapshot_id,
  source_name,
  source_url,
  generated_at,
  summary
)
values (
  ${sqlString(snapshotId)},
  'University TW',
  'https://university-tw.ldkrsi.men/',
  ${sqlString(generatedAt)}::timestamptz,
  ${sqlJson(summary, {})}
)
on conflict (snapshot_id) do update
set
  source_name = excluded.source_name,
  source_url = excluded.source_url,
  generated_at = excluded.generated_at,
  summary = excluded.summary
;

delete from public.university_tw_registration_departments where snapshot_id = ${sqlString(snapshotId)};
delete from public.university_tw_gender_departments where snapshot_id = ${sqlString(snapshotId)};
delete from public.university_tw_star_departments where snapshot_id = ${sqlString(snapshotId)};
delete from public.university_tw_caac_scores where snapshot_id = ${sqlString(snapshotId)};
delete from public.university_tw_caac_departments where snapshot_id = ${sqlString(snapshotId)};
delete from public.university_tw_uac_departments where snapshot_id = ${sqlString(snapshotId)};
delete from public.university_tw_universities where snapshot_id = ${sqlString(snapshotId)};

${buildInsert(
  "public.university_tw_universities",
  [
    "snapshot_id",
    "university_code",
    "school_no",
    "name",
    "uac_department_count",
    "caac_department_count",
    "star_department_count",
    "female_summary",
    "female_trends",
    "register_total",
    "source_sections"
  ],
  universityRows
)}
${buildInsert(
  "public.university_tw_uac_departments",
  [
    "snapshot_id",
    "university_code",
    "department_code",
    "department_name",
    "standards_text",
    "subjects_text",
    "standard_code",
    "subject_code"
  ],
  uniqueUacRows
)}
${buildInsert(
  "public.university_tw_caac_departments",
  [
    "snapshot_id",
    "university_code",
    "department_code",
    "department_name",
    "exam_date",
    "admission_info",
    "subject_text",
    "standards",
    "multipliers",
    "previous_year_filter_result",
    "detail_links",
    "history_links",
    "source_url",
    "title",
    "heading"
  ],
  uniqueCaacRows
)}
${buildInsert(
  "public.university_tw_caac_scores",
  [
    "snapshot_id",
    "university_code",
    "department_code",
    "department_name",
    "admission_year",
    "exam_date",
    "admission_info",
    "subject_text",
    "standards",
    "multipliers",
    "filter_result",
    "score_payload",
    "history_report_url",
    "source_url"
  ],
  uniqueCaacScoreRows
)}
${buildInsert(
  "public.university_tw_star_departments",
  [
    "snapshot_id",
    "university_code",
    "department_code",
    "department_name",
    "group_name",
    "admission_info",
    "rule_text",
    "subject_text",
    "standards",
    "ranking_items",
    "previous_year_admission_summary",
    "previous_year_admission_details",
    "detail_links",
    "history_links",
    "source_url",
    "title",
    "heading"
  ],
  uniqueStarRows
)}
${buildInsert(
  "public.university_tw_gender_departments",
  [
    "snapshot_id",
    "university_code",
    "department_name",
    "girls_text",
    "boys_text",
    "female_percent_text",
    "metrics"
  ],
  uniqueGenderRows
)}
${buildInsert(
  "public.university_tw_registration_departments",
  [
    "snapshot_id",
    "university_code",
    "row_key",
    "department_name",
    "quota_minus_reserved_text",
    "registered_count_text",
    "registration_rate_text",
    "metrics"
  ],
  uniqueRegistrationRows
)}
commit;
`;
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const inputPath = args[0];
  const out = getFlag("--out");
  const snapshotId = getFlag("--snapshot-id");

  if (!inputPath || !out) {
    throw new Error("請提供輸入檔與 --out");
  }

  const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const finalSnapshotId = buildSnapshotId(raw, snapshotId);
  const sql = buildSql(raw, finalSnapshotId);

  await ensureDir(out);
  await fs.writeFile(out, sql, "utf8");

  console.log(`已輸出 SQL seed：${out}`);
  console.log(`snapshot_id=${finalSnapshotId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
