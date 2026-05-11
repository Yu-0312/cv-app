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
University TW 前端資料建置工具

用法：
  node scripts/build-university-tw-app-data.mjs data/raw/university-tw-site.json --js-out data/app/university-tw-app-data.js --json-out data/app/university-tw-app-data.json

說明：
  將 University TW 的全站原始快照轉成前端可直接載入的精簡資料。
`);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function keyByDepartment(items = [], mapper) {
  const result = {};
  for (const item of items) {
    const name = cleanText(item?.departmentName || item?.name);
    if (!name) continue;
    result[name] = mapper(item);
  }
  return result;
}

function keyByDepartmentWithVariants(items = [], mapper) {
  const result = {};
  for (const item of items) {
    const name = cleanText(item?.departmentName || item?.name);
    if (!name) continue;
    const entry = mapper(item);
    if (!result[name]) {
      result[name] = { ...entry, variants: [{ ...entry }] };
      continue;
    }
    result[name].variants.push({ ...entry });
  }
  return result;
}

function buildPayload(raw) {
  const schools = {};

  const uacSchools = raw?.sections?.uac?.schools || [];
  for (const school of uacSchools) {
    const name = cleanText(school.name);
    if (!name) continue;
    schools[name] ||= { code: school.code, name };
    schools[name].uac = {
      departmentCount: Number(school.departmentCount || 0),
      departments: keyByDepartment(school.departments, (item) => ({
        code: cleanText(item.departmentId),
        standardsText: cleanText(item.standardsText),
        subjectsText: cleanText(item.subjectsText)
      }))
    };
  }

  const caacSchools = raw?.sections?.caac?.schools || [];
  for (const school of caacSchools) {
    const name = cleanText(school.name);
    if (!name) continue;
    schools[name] ||= { code: school.code, name };
    schools[name].caac = {
      departmentCount: Array.isArray(school.departmentDetails) ? school.departmentDetails.length : 0,
      departments: keyByDepartment(school.departmentDetails, (item) => ({
        code: cleanText(item.code),
        examDate: cleanText(item.examDate),
        admissionInfo: cleanText(item.admissionInfo),
        subjectText: cleanText(item.subjectText),
        standards: Array.isArray(item.standards) ? item.standards : [],
        multipliers: Array.isArray(item.multipliers) ? item.multipliers : [],
        previousYearFilterResult: Array.isArray(item.previousYearFilterResult) ? item.previousYearFilterResult : []
      }))
    };
  }

  const starSchools = raw?.sections?.star?.schools || [];
  for (const school of starSchools) {
    const name = cleanText(school.name);
    if (!name) continue;
    schools[name] ||= { code: school.code, name };
    schools[name].star = {
      departmentCount: Array.isArray(school.departmentDetails) ? school.departmentDetails.length : 0,
      departments: keyByDepartment(school.departmentDetails, (item) => ({
        code: cleanText(item.code),
        group: cleanText(item.group),
        rule: cleanText(item.rule),
        admissionInfo: cleanText(item.admissionInfo),
        subjectText: cleanText(item.subjectText),
        standards: Array.isArray(item.standards) ? item.standards : [],
        rankingItems: Array.isArray(item.rankingItems) ? item.rankingItems : [],
        previousYearAdmissionSummary: cleanText(item.previousYearAdmissionSummary),
        previousYearAdmissionDetails: Array.isArray(item.previousYearAdmissionDetails) ? item.previousYearAdmissionDetails : []
      }))
    };
  }

  const femaleSchools = raw?.sections?.female?.schools || [];
  for (const school of femaleSchools) {
    const name = cleanText(school.name);
    if (!name) continue;
    schools[name] ||= { code: school.code, name };
    const base = schools[name];
    base.female = {
      summary: Array.isArray(school.summary) ? school.summary : [],
      departments: keyByDepartment(school.departments, (item) => ({
        femalePercent: cleanText(item.femalePercent),
        girls: cleanText(item.girls),
        boys: cleanText(item.boys)
      }))
    };
  }

  const registerSchools = raw?.sections?.register?.schools || [];
  for (const school of registerSchools) {
    const name = cleanText(school.name);
    if (!name) continue;
    schools[name] ||= { code: school.code, name };
    schools[name].register = {
      total: school.total || null,
      departments: keyByDepartmentWithVariants(school.departments, (item) => ({
        registrationRate: cleanText(item.registrationRate),
        registeredCount: cleanText(item.registeredCount),
        quotaMinusReserved: cleanText(item.quotaMinusReserved)
      }))
    };
  }

  return {
    source: "University TW",
    generatedAt: new Date().toISOString(),
    summary: raw?.summary || {},
    universities: schools
  };
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const inputPath = args[0];
  const jsOut = getFlag("--js-out");
  const jsonOut = getFlag("--json-out");

  if (!inputPath || !jsOut || !jsonOut) {
    throw new Error("請提供輸入檔、--js-out、--json-out");
  }

  const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const payload = buildPayload(raw);

  await Promise.all([ensureDir(jsOut), ensureDir(jsonOut)]);
  await fs.writeFile(jsonOut, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(jsOut, `window.CV_UNIVERSITY_TW_DATA = ${JSON.stringify(payload)};\n`, "utf8");

  console.log(`已輸出前端資料：${jsOut}`);
  console.log(`已輸出 JSON 資料：${jsonOut}`);
  console.log(JSON.stringify(payload.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
