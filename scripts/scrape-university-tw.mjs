#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://university-tw.ldkrsi.men";
const DEFAULT_OUT = "data/raw/university-tw-site.json";
const DEFAULT_CONCURRENCY = 8;

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
University TW 全站資料抓取器

用法：
  node scripts/scrape-university-tw.mjs --out data/raw/university-tw-site.json

選項：
  --out           輸出 JSON 路徑，預設 ${DEFAULT_OUT}
  --concurrency   並行抓取數，預設 ${DEFAULT_CONCURRENCY}
  --help          顯示說明

說明：
  會抓取 University TW 的以下區塊：
  - 分發入學（uac）
  - 個人申請（caac）
  - 繁星推薦（star）
  - 大學男女比（female）
  - 大一新生註冊率（register）
`);
}

function decodeHtml(text = "") {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return String(text)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => named[name] ?? `&${name};`);
}

function stripTags(text = "") {
  return decodeHtml(String(text).replace(/<[^>]+>/g, " "));
}

function cleanText(text = "") {
  return stripTags(text)
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Codex scraper)"
    }
  });
  if (!response.ok) {
    throw new Error(`抓取失敗 ${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    map.set(keyFn(item), item);
  }
  return [...map.values()];
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function parseTitleYear(title = "") {
  const match = String(title).match(/(\d{2,3})年/);
  return match ? Number(match[1]) : null;
}

function parseMetaContent(html, propertyName) {
  const pattern = new RegExp(`<meta[^>]+content=([^>]+?)\\s+(?:name|property)=${propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`, "i");
  const match = html.match(pattern);
  if (!match) return "";
  return cleanText(match[1].replace(/^["']|["']$/g, ""));
}

function parseSchoolNameFromH1(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? cleanText(match[1]) : "";
}

function parseCodeFromUrl(url = "") {
  const match = String(url).match(/\/([A-Za-z0-9_]+)\/?$/);
  return match ? match[1] : "";
}

function parseSpecialLists(html, sectionPath) {
  const blockMatch = html.match(/<h2[^>]*>特別清單<\/h2><ul class=schools-small>([\s\S]*?)<\/ul>/i);
  if (!blockMatch) return [];
  return [...blockMatch[1].matchAll(/<li><a href=([^ >]+)>([^<]+)<\/a><div class=total>([^<]+)<\/div><\/li>/g)].map((match) => ({
    slug: parseCodeFromUrl(match[1]),
    name: cleanText(match[2]),
    totalText: cleanText(match[3]),
    url: new URL(match[1], `${BASE_URL}${sectionPath}`).toString()
  }));
}

function parseUacSchoolIndex(html) {
  return [...html.matchAll(/<li><a href=([A-Za-z0-9_]+) ?>(\([^)]+\)\s*[^<]+)<\/a><div class=total>([^<]+)<\/div><\/li>/g)]
    .map((match) => {
      const schoolCode = match[1];
      const label = cleanText(match[2]);
      const nameMatch = label.match(/\(([^)]+)\)\s*(.+)/);
      return {
        code: schoolCode,
        schoolNo: nameMatch ? nameMatch[1] : "",
        name: nameMatch ? nameMatch[2] : label,
        totalText: cleanText(match[3]),
        url: `${BASE_URL}/uac/${schoolCode}`
      };
    })
    .filter((item) => item.code);
}

function parseUacRow(rowHtml) {
  const codeS = rowHtml.match(/data-code-s=([0-9-]+)/)?.[1] ?? "";
  const codeW = rowHtml.match(/data-code-w=([0-9-]+)/)?.[1] ?? "";
  const linkMatch = rowHtml.match(/href="\/go-to\/uac\?title=([^"&]+)&id=([^"&]+)"/);
  const tdMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
  if (tdMatches.length < 3) return null;
  const departmentName = cleanText(tdMatches[0][1]);
  const standards = cleanText(tdMatches[1][1]);
  const subjects = cleanText(tdMatches[2][1]);
  return {
    departmentId: linkMatch ? decodeURIComponent(linkMatch[2]) : "",
    departmentName,
    standardsText: standards,
    subjectsText: subjects,
    standardCode: codeS,
    subjectCode: codeW
  };
}

function parseUacSchoolPage(html, school) {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  const bodyRows = [...html.matchAll(/<tr data-code-s=[\s\S]*?<\/tr>/g)]
    .map((match) => parseUacRow(match[0]))
    .filter(Boolean);

  return {
    ...school,
    title: cleanText(title),
    year: parseTitleYear(title),
    description: parseMetaContent(html, "description"),
    departmentCount: bodyRows.length,
    departments: bodyRows
  };
}

function parseCaacIndexJson(items) {
  return items.map((school) => ({
    code: school.key,
    name: school.name,
    url: `${BASE_URL}/caac/${school.key}/`,
    departments: Array.isArray(school.list)
      ? school.list.map((department) => ({
          code: department.key,
          name: department.name,
          url: new URL(department.url, BASE_URL).toString()
        }))
      : []
  }));
}

function parseStarIndexJson(items) {
  return items.map((school) => ({
    code: school.key,
    name: school.name,
    url: `${BASE_URL}/star/${school.key}/`,
    departments: Array.isArray(school.list)
      ? school.list.map((department) => ({
          code: department.key,
          name: department.name,
          group: department.group ?? "",
          url: new URL(department.url, BASE_URL).toString()
        }))
      : []
  }));
}

function parseCaacSchoolRow(rowHtml) {
  const codeS = rowHtml.match(/data-code-s=([0-9-]+)/)?.[1] ?? "";
  const codeW = rowHtml.match(/data-code-w=([0-9-]+)/)?.[1] ?? "";
  const cellMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
  if (cellMatches.length < 10) return null;

  const firstCell = cellMatches[0][1];
  const code = firstCell.match(/class=id-link[^>]*>([^<]+)<\/a>/)?.[1] ?? "";
  const departmentUrl = firstCell.match(/href=(\/caac\/[^ >]+) class=name-link/)?.[1] ?? "";
  const departmentName = firstCell.match(/class=name-link>([^<]+)<\/a>/)?.[1] ?? "";
  const subjects = firstCell.match(/<div class=subjects>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const subjectCells = ["國文", "英文", "數學A", "數學B", "社會", "自然"];
  const standards = {};
  const multipliers = {};
  for (let i = 0; i < subjectCells.length; i += 1) {
    const inner = cellMatches[i + 2]?.[1] ?? "";
    const parts = [...inner.matchAll(/<div>([^<]*)<\/div>/g)].map((match) => cleanText(match[1]));
    standards[subjectCells[i]] = parts[0] || "--";
    multipliers[subjectCells[i]] = parts[1] || "--";
  }

  return {
    code: cleanText(code),
    departmentName: cleanText(departmentName),
    departmentUrl: departmentUrl ? new URL(departmentUrl, BASE_URL).toString() : "",
    admissionCount: cleanText(cellMatches[1][1]),
    subjectText: cleanText(subjects.replace(/^採計：/, "")),
    standards,
    multipliers,
    englishListening: cleanText(cellMatches[8][1]),
    sumItem: cleanText(cellMatches[9][1]),
    standardCode: codeS,
    subjectCode: codeW
  };
}

function parseStarSchoolRow(rowHtml) {
  const codeS = rowHtml.match(/data-code-s=([0-9-]+)/)?.[1] ?? "";
  const codeW = rowHtml.match(/data-code-w=([0-9-]+)/)?.[1] ?? "";
  const cellMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
  if (cellMatches.length < 12) return null;

  const firstCell = cellMatches[0][1];
  const code = firstCell.match(/class=id-link[^>]*>([^<]+)<\/a>/)?.[1] ?? "";
  const departmentUrl = firstCell.match(/href=(\/star\/[^ >]+) class=name-link/)?.[1] ?? "";
  const departmentName = firstCell.match(/class=name-link>([^<]+)<\/a>/)?.[1] ?? "";
  const subjects = firstCell.match(/<div class=subjects>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const subjectCells = ["國文", "英文", "數學A", "數學B", "社會", "自然", "英聽"];
  const standards = {};
  for (let i = 0; i < subjectCells.length; i += 1) {
    standards[subjectCells[i]] = cleanText(cellMatches[i + 4]?.[1] ?? "--") || "--";
  }

  return {
    code: cleanText(code),
    departmentName: cleanText(departmentName),
    departmentUrl: departmentUrl ? new URL(departmentUrl, BASE_URL).toString() : "",
    group: cleanText(cellMatches[1][1]),
    admissionCount: cleanText(cellMatches[2][1]),
    subjectText: cleanText(cellMatches[3][1] || subjects.replace(/^採計：/, "")),
    standards,
    standardCode: codeS,
    subjectCode: codeW
  };
}

function parseStandardTable(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) =>
    [...match[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => cleanText(cell[1]))
  );

  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const record = {};
    for (let i = 0; i < header.length; i += 1) {
      record[header[i] || `col${i}`] = row[i] ?? "";
    }
    return record;
  });
}

function parseDefinitionList(html) {
  const matches = [...html.matchAll(/<dt>([\s\S]*?)<\/dt><dd(?:[^>]*)>([\s\S]*?)<\/dd>/g)];
  const sections = {};
  for (const match of matches) {
    const key = cleanText(match[1]);
    sections[key] = match[2];
  }
  return sections;
}

function parseCaacDepartmentPage(html, schoolCode) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  const sections = parseDefinitionList(html);
  const code = cleanText(sections["代碼"]);
  return {
    code,
    schoolCode,
    title: cleanText(title),
    heading: cleanText(h1),
    examDate: cleanText(sections["甄試日期"]),
    admissionInfo: cleanText(sections["招收人數"]),
    subjectText: cleanText(sections["採計科目"]),
    standards: parseStandardTable(sections["學測檢定標準"] ?? ""),
    multipliers: parseStandardTable(sections["篩選倍率"] ?? ""),
    previousYearFilterResult: parseStandardTable(sections["114年篩選結果"] ?? ""),
    detailLinks: [...(sections["詳細申請資訊"] ?? "").matchAll(/<a href=([^ >]+)[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
      label: cleanText(match[2]),
      url: new URL(match[1].replace(/^"|"$/g, ""), BASE_URL).toString()
    })),
    historyLinks: [...html.matchAll(/<li><a href=([^ >]+)[^>]*>([\s\S]*?)<\/a><\/li>/g)]
      .map((match) => ({
        label: cleanText(match[2]),
        url: new URL(match[1].replace(/^"|"$/g, ""), BASE_URL).toString()
      }))
      .filter((item) => item.label.includes("年"))
  };
}

function parseStarDepartmentPage(html, schoolCode) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  const sections = parseDefinitionList(html);
  const code = cleanText(sections["代碼"]);
  const previousYearResultHtml = sections["114年比序結果"] ?? "";
  return {
    code,
    schoolCode,
    title: cleanText(title),
    heading: cleanText(h1),
    admissionInfo: cleanText(sections["招收人數"]),
    rule: cleanText(sections["繁星申請規定"]),
    subjectText: cleanText(sections["採計科目"]),
    standards: parseStandardTable(sections["學測檢定標準"] ?? ""),
    rankingItems: parseStandardTable(sections["分發比序項目"] ?? ""),
    previousYearAdmissionSummary: cleanText(previousYearResultHtml.split("<div class=table-wrap>")[0] ?? ""),
    previousYearAdmissionDetails: parseStandardTable(previousYearResultHtml),
    detailLinks: [...(sections["詳細申請資訊"] ?? "").matchAll(/<a href=([^ >]+)[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
      label: cleanText(match[2]),
      url: new URL(match[1].replace(/^"|"$/g, ""), BASE_URL).toString()
    })),
    historyLinks: [...html.matchAll(/<li><a href=([^ >]+)[^>]*>([\s\S]*?)<\/a><\/li>/g)]
      .map((match) => ({
        label: cleanText(match[2]),
        url: new URL(match[1].replace(/^"|"$/g, ""), BASE_URL).toString()
      }))
      .filter((item) => item.label.includes("年"))
  };
}

function extractSectionBlock(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) return "";
  const from = html.slice(start);
  if (!endMarker) return from;
  const endIndex = from.indexOf(endMarker);
  return endIndex === -1 ? from : from.slice(0, endIndex);
}

function parseFemaleOverview(html) {
  const panel1 = extractSectionBlock(html, '<div class=panel selected>', '<div class=panel>');
  const panel2 = extractSectionBlock(html, '<div class=panel>', '</section>');
  const parseRows = (block, scope) =>
    [...block.matchAll(/<div class=row data-dataset='([^']+)'[\s\S]*?<div class=name>\s*<a href=([^ >]+)>([^<]+)<\/a>[\s\S]*?<div class=percent>([^<]+)<\/div><div class=detail>([^<]+)<\/div>/g)].map((match) => ({
      scope,
      schoolCode: cleanText(match[2]),
      schoolName: cleanText(match[3]),
      percentText: cleanText(match[4]),
      detailText: cleanText(match[5]),
      metrics: parseJson(match[1], {})
    }));

  return {
    undergraduate: parseRows(panel1, "undergraduate"),
    allSchool: parseRows(panel2, "allSchool")
  };
}

function parseFemaleSchoolPage(html, schoolCode) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  const summaryRows = [...html.matchAll(/<tbody><tr>\s*<th>([^<]+)<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map((match) => ({
    scope: cleanText(match[1]),
    boys: cleanText(match[2]),
    girls: cleanText(match[3]),
    femalePercent: cleanText(match[4])
  }));
  const trendJson = parseJson(html.match(/<canvas[^>]+data-data='([^']+)'/i)?.[1] ?? "", {});
  const departments = [...html.matchAll(/<tr class=row data-dataset='([^']+)'><td><\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map((match) => ({
    departmentName: cleanText(match[2]),
    boys: cleanText(match[3]),
    girls: cleanText(match[4]),
    femalePercent: cleanText(match[5]),
    metrics: parseJson(match[1], {})
  }));

  return {
    schoolCode,
    title: cleanText(title),
    heading: cleanText(h1),
    summary: summaryRows,
    trends: trendJson,
    departments
  };
}

function parseRegisterOverview(html) {
  const sectionRegex = /<section class=([a-z-0-9]+)><h2>([^<]+)<\/h2><table>[\s\S]*?<tbody>([\s\S]*?)<\/tbody><\/table><\/section>/g;
  const sections = [];
  for (const match of html.matchAll(sectionRegex)) {
    const rows = [...match[3].matchAll(/<tr><td>\s*<a href=([^ >]+)>([^<]+)<\/a><\/td><td[^>]*>([^<]+)<\/td><\/tr>/g)].map((row) => ({
      schoolCode: cleanText(row[1]),
      schoolName: cleanText(row[2]),
      registrationRate: cleanText(row[3])
    }));
    sections.push({
      key: cleanText(match[1]),
      title: cleanText(match[2]),
      schools: rows
    });
  }
  return sections;
}

function parseRegisterSchoolPage(html, schoolCode) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  const totalRow = html.match(/<table class=total>[\s\S]*?<tbody><tr>\s*<td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/i);
  const departmentRows = [...html.matchAll(/<tr class=row data-dataset='([^']+)'><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map((match) => ({
    departmentName: cleanText(match[2]),
    quotaMinusReserved: cleanText(match[3]),
    registeredCount: cleanText(match[4]),
    registrationRate: cleanText(match[5]),
    metrics: parseJson(match[1], {})
  }));

  return {
    schoolCode,
    title: cleanText(title),
    heading: cleanText(h1),
    total: totalRow
      ? {
          quota: cleanText(totalRow[1]),
          reserved: cleanText(totalRow[2]),
          registered: cleanText(totalRow[3]),
          registrationRate: cleanText(totalRow[4])
        }
      : null,
    departments: departmentRows
  };
}

async function scrapeUac(concurrency) {
  const url = `${BASE_URL}/uac/`;
  const html = await fetchText(url);
  const schools = uniqueBy(parseUacSchoolIndex(html), (item) => item.code);
  const schoolPages = await mapLimit(schools, concurrency, async (school) => {
    const schoolHtml = await fetchText(school.url);
    return parseUacSchoolPage(schoolHtml, school);
  });

  return {
    url,
    title: cleanText(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    year: parseTitleYear(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    specialLists: parseSpecialLists(html, "/uac/"),
    schoolCount: schoolPages.length,
    departmentCount: schoolPages.reduce((sum, school) => sum + school.departmentCount, 0),
    schools: schoolPages
  };
}

async function scrapeCaac(concurrency) {
  const url = `${BASE_URL}/caac/`;
  const html = await fetchText(url);
  const assetPath = html.match(/data-fetch-url=([^ >]+)/)?.[1] ?? "";
  const indexJson = parseJson(await fetchText(new URL(assetPath, BASE_URL)), []);
  const schools = parseCaacIndexJson(indexJson);

  const schoolPages = await mapLimit(schools, concurrency, async (school) => {
    const schoolHtml = await fetchText(school.url);
    const schoolRows = [...schoolHtml.matchAll(/<tr data-code-s=[\s\S]*?<\/tr>/g)]
      .map((match) => parseCaacSchoolRow(match[0]))
      .filter(Boolean);

    const departmentDetails = await mapLimit(school.departments, Math.max(2, Math.floor(concurrency / 2)), async (department) => {
      const depHtml = await fetchText(department.url);
      return {
        ...department,
        ...parseCaacDepartmentPage(depHtml, school.code)
      };
    });

    return {
      ...school,
      title: cleanText(schoolHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
      year: parseTitleYear(schoolHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
      specialLists: [],
      schoolRows,
      departmentDetails
    };
  });

  return {
    url,
    title: cleanText(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    year: parseTitleYear(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    assetUrl: new URL(assetPath, BASE_URL).toString(),
    specialLists: parseSpecialLists(html, "/caac/"),
    schoolCount: schoolPages.length,
    departmentCount: schoolPages.reduce((sum, school) => sum + school.departmentDetails.length, 0),
    schools: schoolPages
  };
}

async function scrapeStar(concurrency) {
  const url = `${BASE_URL}/star/`;
  const html = await fetchText(url);
  const assetPath = html.match(/data-fetch-url=([^ >]+)/)?.[1] ?? "";
  const indexJson = parseJson(await fetchText(new URL(assetPath, BASE_URL)), []);
  const schools = parseStarIndexJson(indexJson);

  const schoolPages = await mapLimit(schools, concurrency, async (school) => {
    const schoolHtml = await fetchText(school.url);
    const schoolRows = [...schoolHtml.matchAll(/<tr data-code-s=[\s\S]*?<\/tr>/g)]
      .map((match) => parseStarSchoolRow(match[0]))
      .filter(Boolean);

    const departmentDetails = await mapLimit(school.departments, Math.max(2, Math.floor(concurrency / 2)), async (department) => {
      const depHtml = await fetchText(department.url);
      return {
        ...department,
        ...parseStarDepartmentPage(depHtml, school.code)
      };
    });

    return {
      ...school,
      title: cleanText(schoolHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
      year: parseTitleYear(schoolHtml.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
      schoolRows,
      departmentDetails
    };
  });

  return {
    url,
    title: cleanText(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    year: parseTitleYear(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    assetUrl: new URL(assetPath, BASE_URL).toString(),
    specialLists: parseSpecialLists(html, "/star/"),
    schoolCount: schoolPages.length,
    departmentCount: schoolPages.reduce((sum, school) => sum + school.departmentDetails.length, 0),
    schools: schoolPages
  };
}

async function scrapeFemale(concurrency) {
  const url = `${BASE_URL}/female/`;
  const html = await fetchText(url);
  const overview = parseFemaleOverview(html);
  const schoolCodes = uniqueBy(
    [...overview.undergraduate, ...overview.allSchool].map((row) => ({
      code: row.schoolCode,
      name: row.schoolName,
      url: `${BASE_URL}/female/${row.schoolCode}`
    })),
    (item) => item.code
  );

  const schools = await mapLimit(schoolCodes, concurrency, async (school) => {
    const schoolHtml = await fetchText(school.url);
    return {
      ...school,
      ...parseFemaleSchoolPage(schoolHtml, school.code)
    };
  });

  return {
    url,
    title: cleanText(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    description: parseMetaContent(html, "description"),
    overview,
    schoolCount: schools.length,
    schools
  };
}

async function scrapeRegister(concurrency) {
  const url = `${BASE_URL}/register/`;
  const html = await fetchText(url);
  const sections = parseRegisterOverview(html);
  const schoolCodes = uniqueBy(
    sections.flatMap((section) =>
      section.schools.map((school) => ({
        code: school.schoolCode,
        name: school.schoolName,
        url: `${BASE_URL}/register/${school.schoolCode}`
      }))
    ),
    (item) => item.code
  );

  const schools = await mapLimit(schoolCodes, concurrency, async (school) => {
    const schoolHtml = await fetchText(school.url);
    return {
      ...school,
      ...parseRegisterSchoolPage(schoolHtml, school.code)
    };
  });

  return {
    url,
    title: cleanText(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? ""),
    description: parseMetaContent(html, "description"),
    sections,
    schoolCount: schools.length,
    schools
  };
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const out = getFlag("--out", DEFAULT_OUT);
  const concurrencyValue = Number(getFlag("--concurrency", String(DEFAULT_CONCURRENCY)));
  const concurrency = Number.isFinite(concurrencyValue) && concurrencyValue > 0
    ? Math.floor(concurrencyValue)
    : DEFAULT_CONCURRENCY;

  const startedAt = new Date().toISOString();
  const [uac, caac, star, female, register] = await Promise.all([
    scrapeUac(concurrency),
    scrapeCaac(concurrency),
    scrapeStar(concurrency),
    scrapeFemale(concurrency),
    scrapeRegister(concurrency)
  ]);

  const payload = {
    source: "University TW",
    baseUrl: BASE_URL,
    fetchedAt: new Date().toISOString(),
    startedAt,
    sections: {
      uac,
      caac,
      star,
      female,
      register
    },
    summary: {
      uacSchools: uac.schoolCount,
      uacDepartments: uac.departmentCount,
      caacSchools: caac.schoolCount,
      caacDepartments: caac.departmentCount,
      starSchools: star.schoolCount,
      starDepartments: star.departmentCount,
      femaleSchools: female.schoolCount,
      registerSchools: register.schoolCount
    }
  };

  await ensureDir(out);
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`已輸出 University TW 全站資料：${out}`);
  console.log(JSON.stringify(payload.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
