#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const API_ORIGIN = "https://student.104.com.tw";
const STANDARD_SCORE_ENDPOINT = `${API_ORIGIN}/api/v1.0/hs/standardScore`;
const SUPPORTED_MAJOR_ENDPOINTS = [
  "/api/v1.0/hs/majorList",
  "/api/v1.0/hs/landingPoint",
  "/api/v1.0/hs/recommendMajorList",
  "/api/v1.0/ast/majorList"
];

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
104 學測落點資料匯入工具

用法：
  node scripts/import-104-gsat.mjs fetch-standard --year 115 --out data/raw/104-standard-115.json
  node scripts/import-104-gsat.mjs fetch-major-list --score-year 115 --role-type 1 --chinese 12 --english 11 --mathA 10 --mathB 9 --society 12 --natural 12 --out data/normalized/104-gsat-115.json
  node scripts/import-104-gsat.mjs extract-capture data/raw/104-browser-capture.json --score-year 115 --out data/normalized/104-gsat-115-browser.json
  node scripts/import-104-gsat.mjs extract-har path/to/104-session.har --score-year 115 --out data/normalized/104-gsat-115.json
  node scripts/import-104-gsat.mjs summarize data/normalized/104-gsat-115.json

說明：
  fetch-standard  下載 104 公開五標資料。
  fetch-major-list  直接以分數查詢 104 校系列表並輸出正規化 JSON。
  extract-capture  解析瀏覽器態擷取器輸出的 JSON，轉成正規化校系資料。
  extract-har     解析瀏覽器匯出的 HAR，萃取 104 落點 API 回應並正規化成校系資料。
  summarize       顯示已正規化 JSON 的校系筆數與來源摘要。

建議流程：
  1. 優先使用 fetch-major-list，直接用分數抓 104 校系列表
  2. 如果要保留瀏覽器查詢脈絡，再用 extract-har 解析 HAR
`);
}

function getFlag(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return fallback;
  }
  return args[index + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function decodeHarText(content = {}) {
  if (!content.text) return null;
  if (content.encoding === "base64") {
    return Buffer.from(content.text, "base64").toString("utf8");
  }
  return content.text;
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function parseScoreRows(rows = []) {
  return rows
    .map((row) => ({
      year: row?.year ?? null,
      score: Array.isArray(row?.score) ? row.score : []
    }))
    .filter((row) => row.year || row.score.length);
}

function normalizeStandardItems(items = []) {
  return items
    .map((item) => ({
      level: item?.level ?? "",
      name: item?.name ?? ""
    }))
    .filter((item) => item.level || item.name);
}

function normalizeLinks(items = []) {
  return items
    .map((item) => ({
      name: item?.name ?? "",
      link: item?.link ?? ""
    }))
    .filter((item) => item.name || item.link);
}

function normalizeSubjects(items = []) {
  return items
    .map((item) => ({
      name: item?.name ?? "",
      power: item?.power ?? item?.score ?? ""
    }))
    .filter((item) => item.name || item.power);
}

function normalizeMajorRecord(rawMajor, context = {}) {
  const major = rawMajor?.major ?? {};
  const detail = rawMajor?.detail ?? {};
  const school = major.school ?? {};
  const department = major.major ?? {};
  const firstStage = major.firstStage ?? {};
  const secondStage = major.secondStage ?? {};
  const dynamic = rawMajor?.dynamic ?? {};

  return {
    source: "104",
    scoreYear: context.scoreYear ?? null,
    endpoint: context.endpoint ?? "",
    requestPayload: context.requestPayload ?? null,
    schoolName: school.name ?? "",
    schoolLink: school.link ?? "",
    departmentName: department.name ?? "",
    departmentLink: department.link ?? "",
    schoolTypeName: major.schoolTypeName ?? "",
    area: major.area ?? "",
    categoryName: major.categoryName ?? major.groupName ?? "",
    enrollmentMajorNo: rawMajor?.enrollmentMajorNo ?? rawMajor?.enrollmentNo ?? "",
    enrollmentSchoolNo: rawMajor?.enrollmentSchoolNo ?? "",
    reportRisk: rawMajor?.reportRisk ?? null,
    acceptanceRate: rawMajor?.acceptanceRate ?? null,
    wantMajor: rawMajor?.wantMajor ?? false,
    firstStage: {
      power: Array.isArray(firstStage.power) ? firstStage.power : [],
      standard: normalizeStandardItems(firstStage.standard ?? major.standard?.subject ?? [])
    },
    secondStage: {
      steps: Array.isArray(secondStage.steps) ? secondStage.steps : [],
      selectDate: secondStage.selectDate ?? null,
      selectStudentNumber: secondStage.selectStudentNumber ?? detail.selectStudentNumber ?? null,
      enrollStudentNumber: secondStage.enrollStudentNumber ?? detail.enrollStudentNumber ?? null
    },
    lowScorePreYear: parseScoreRows(detail?.lowScore?.scoreList ?? detail?.acceptScores ?? []),
    lowScoreThisYear: parseScoreRows(detail?.lowScore?.thisYearScore ?? []),
    acceptSubjects:
      Array.isArray(detail?.acceptSubjects)
        ? detail.acceptSubjects.map((item) => ({
            year: item?.year ?? null,
            subjects: normalizeSubjects(item?.subjects ?? [])
          }))
        : [],
    registration: detail.registration ?? null,
    teacherStudentRatio: detail.teacherStudentRatio ?? null,
    selectCharge: detail.selectCharge ?? null,
    enrollmentQuota: Array.isArray(detail.enrollmentQuota) ? detail.enrollmentQuota : [],
    excess: Array.isArray(detail.excess) ? detail.excess : [],
    distribution: Array.isArray(detail.distribution) ? detail.distribution : [],
    interest: Array.isArray(major.interest) ? major.interest : [],
    links: normalizeLinks(major.link),
    dynamic: {
      views: dynamic.frequency ?? dynamic.view ?? null,
      average: Array.isArray(dynamic.average) ? dynamic.average : [],
      overTotalScore: dynamic.excessTotal ?? dynamic.total ?? null,
      secondStageScore: Array.isArray(dynamic.secondAverage) ? dynamic.secondAverage : [],
      avg: dynamic.avg ?? null
    }
  };
}

function majorKey(item) {
  return [
    item.schoolName,
    item.departmentName,
    item.enrollmentMajorNo,
    item.endpoint
  ].join("::");
}

function extractMajorList(responseJson) {
  if (!responseJson || typeof responseJson !== "object") return [];
  const data = responseJson.data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.major)) return data.major;
  if (Array.isArray(data.positive)) return data.positive;
  return [];
}

function getNumberFlag(name, fallback = null) {
  const value = getFlag(name, null);
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} 必須是數字`);
  }
  return parsed;
}

function getOptionalScore(name, fallback = 0) {
  const value = getFlag(name, null);
  if (value === null || value === undefined) return fallback;
  if (value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} 必須是數字`);
  }
  return parsed;
}

function buildDirectScorePayload() {
  const scoreYear = getNumberFlag("--score-year");
  const roleType = getNumberFlag("--role-type", 1);
  const chinese = getNumberFlag("--chinese");
  const english = getNumberFlag("--english");
  const mathA = getNumberFlag("--mathA");
  const mathB = getNumberFlag("--mathB");
  const society = getNumberFlag("--society");
  const natural = getNumberFlag("--natural");
  const apcsS = getOptionalScore("--apcsS", 0);
  const apcsI = getOptionalScore("--apcsI", 0);
  const eListening = getFlag("--e-listening", "F");

  const required = {
    "--score-year": scoreYear,
    "--chinese": chinese,
    "--english": english,
    "--mathA": mathA,
    "--mathB": mathB,
    "--society": society,
    "--natural": natural
  };

  const missing = Object.entries(required)
    .filter(([, value]) => value === null || value === undefined)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`缺少必要參數：${missing.join(", ")}`);
  }

  return {
    scoreYear,
    roleType,
    score: {
      chinese,
      english,
      mathA,
      mathB,
      society,
      natural,
      apcsS,
      apcsI,
      eListening
    }
  };
}

function mergeCookieJar(cookieJar, response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);

  for (const cookie of setCookies) {
    const pair = String(cookie).split(";", 1)[0]?.trim();
    if (!pair || !pair.includes("=")) continue;
    const [name, ...rest] = pair.split("=");
    cookieJar.set(name, `${name}=${rest.join("=")}`);
  }
}

function withCookies(headers, cookieJar) {
  if (!cookieJar.size) return headers;
  return {
    ...headers,
    cookie: [...cookieJar.values()].join("; ")
  };
}

async function fetchJson(url, options = {}, cookieJar = null) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`104 API 請求失敗：${response.status} ${response.statusText}`);
  }
  if (cookieJar) {
    mergeCookieJar(cookieJar, response);
  }
  return response.json();
}

async function fetchStandardScore() {
  const year = getFlag("--year");
  const out = getFlag("--out");

  if (!year) {
    throw new Error("缺少 --year，例如 --year 115");
  }

  const url = `${STANDARD_SCORE_ENDPOINT}?scoreYear=${encodeURIComponent(year)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`104 standardScore 請求失敗：${response.status}`);
  }

  const json = await response.json();
  const payload = {
    source: "104",
    fetchedAt: new Date().toISOString(),
    scoreYear: Number(year),
    url,
    data: json
  };

  if (out) {
    await ensureDir(out);
    await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`已輸出五標資料：${out}`);
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

async function fetchMajorListDirect() {
  const out = getFlag("--out");
  if (!out) {
    throw new Error("缺少 --out，請指定輸出 JSON 檔案");
  }

  const { scoreYear, roleType, score } = buildDirectScorePayload();
  const limit = getNumberFlag("--limit", 100);
  const maxPages = getNumberFlag("--max-pages", null);
  const includeRecommend = hasFlag("--include-recommend");
  const origin = `${API_ORIGIN}/hs/apply/result/`;
  const cookieJar = new Map();
  const baseHeaders = {
    "content-type": "application/json",
    origin: API_ORIGIN,
    referer: origin,
    "user-agent": "Mozilla/5.0"
  };

  const landingPayload = {
    roleType,
    ...score
  };

  const landingJson = await fetchJson(`${API_ORIGIN}/api/v1.0/hs/landingPoint`, {
    method: "POST",
    headers: withCookies(baseHeaders, cookieJar),
    body: JSON.stringify(landingPayload)
  }, cookieJar);

  const requestPayloadBase = {
    majorName: "",
    schoolNo: [],
    groupNo: [],
    hollands: [],
    risk: [],
    interview: [],
    score: {
      roleType,
      chinese: score.chinese,
      english: score.english,
      mathA: score.mathA,
      mathB: score.mathB,
      society: score.society,
      natural: score.natural,
      apcsS: score.apcsS,
      apcsI: score.apcsI,
      eListening: score.eListening
    }
  };

  const deduped = new Map();
  const requestSummaries = [];
  let offset = 0;
  let pageCount = 0;
  let total = null;

  while (true) {
    const requestPayload = {
      ...requestPayloadBase,
      page: {
        limit,
        offset
      }
    };

    const responseJson = await fetchJson(`${API_ORIGIN}/api/v1.0/hs/majorList`, {
      method: "POST",
      headers: withCookies(baseHeaders, cookieJar),
      body: JSON.stringify(requestPayload)
    }, cookieJar);

    const rawMajors = extractMajorList(responseJson);
    const pageMeta = responseJson?.data?.page ?? {};
    total = pageMeta.total ?? total;
    requestSummaries.push({
      endpoint: "/api/v1.0/hs/majorList",
      url: `${API_ORIGIN}/api/v1.0/hs/majorList`,
      requestPayload,
      page: {
        limit: pageMeta.limit ?? limit,
        offset: pageMeta.offset ?? offset,
        total: pageMeta.total ?? total
      }
    });

    for (const rawMajor of rawMajors) {
      const normalized = normalizeMajorRecord(rawMajor, {
        scoreYear,
        endpoint: "/api/v1.0/hs/majorList",
        requestPayload
      });

      if (!normalized.schoolName || !normalized.departmentName) {
        continue;
      }

      deduped.set(majorKey(normalized), normalized);
    }

    pageCount += 1;
    const responseOffset = pageMeta.offset ?? offset;
    const responseLimit = pageMeta.limit ?? limit;
    const nextOffset = responseOffset + responseLimit;
    if (!rawMajors.length || total === null || nextOffset >= total) break;
    if (maxPages !== null && pageCount >= maxPages) break;
    offset = nextOffset;
  }

  if (includeRecommend) {
    const recommendPayload = {
      ...requestPayloadBase
    };

    const responseJson = await fetchJson(`${API_ORIGIN}/api/v1.0/hs/recommendMajorList`, {
      method: "POST",
      headers: withCookies(baseHeaders, cookieJar),
      body: JSON.stringify(recommendPayload)
    }, cookieJar);

    const rawMajors = extractMajorList(responseJson);
    requestSummaries.push({
      endpoint: "/api/v1.0/hs/recommendMajorList",
      url: `${API_ORIGIN}/api/v1.0/hs/recommendMajorList`,
      requestPayload: recommendPayload
    });

    for (const rawMajor of rawMajors) {
      const normalized = normalizeMajorRecord(rawMajor, {
        scoreYear,
        endpoint: "/api/v1.0/hs/recommendMajorList",
        requestPayload: recommendPayload
      });

      if (!normalized.schoolName || !normalized.departmentName) {
        continue;
      }

      deduped.set(majorKey(normalized), normalized);
    }
  }

  const majors = [...deduped.values()].sort((a, b) => {
    if (a.schoolName !== b.schoolName) {
      return a.schoolName.localeCompare(b.schoolName, "zh-Hant");
    }
    return a.departmentName.localeCompare(b.departmentName, "zh-Hant");
  });

  const payload = {
    source: "104",
    extractedAt: new Date().toISOString(),
    scoreYear,
    inputMethod: "direct-api",
    requestCount: requestSummaries.length,
    pageCount,
    majorCount: majors.length,
    requestSummaries,
    landingPoint: {
      roleType: landingJson?.data?.roleType ?? roleType,
      wantMajorCount: landingJson?.data?.wantMajorCount ?? 0,
      score: landingJson?.data?.score ?? {
        scoreYear,
        ...score
      }
    },
    majors
  };

  await ensureDir(out);
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`已直接抓取 104 校系資料：${out}`);
  console.log(`查詢頁數：${pageCount}`);
  console.log(`校系筆數：${majors.length}`);
}

async function extractHar() {
  const input = args[1];
  const out = getFlag("--out");
  const scoreYear = getFlag("--score-year", null);

  if (!input) {
    throw new Error("缺少 HAR 路徑，例如 extract-har exports/104-session.har");
  }
  if (!out) {
    throw new Error("缺少 --out，請指定輸出 JSON 檔案");
  }

  const raw = await fs.readFile(input, "utf8");
  const har = JSON.parse(raw);
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];

  const matchedEntries = entries.filter((entry) =>
    SUPPORTED_MAJOR_ENDPOINTS.some((endpoint) =>
      String(entry?.request?.url ?? "").includes(endpoint)
    )
  );

  const requestSummaries = [];
  const deduped = new Map();

  for (const entry of matchedEntries) {
    const url = String(entry?.request?.url ?? "");
    const endpoint =
      SUPPORTED_MAJOR_ENDPOINTS.find((item) => url.includes(item)) ?? url;
    const requestPayload = safeJsonParse(entry?.request?.postData?.text ?? "", null);
    const responseText = decodeHarText(entry?.response?.content);
    const responseJson = safeJsonParse(responseText, null);
    const rawMajors = extractMajorList(responseJson);

    requestSummaries.push({
      endpoint,
      url,
      startedDateTime: entry?.startedDateTime ?? null,
      status: entry?.response?.status ?? null,
      requestPayload
    });

    for (const rawMajor of rawMajors) {
      const normalized = normalizeMajorRecord(rawMajor, {
        scoreYear: scoreYear ? Number(scoreYear) : null,
        endpoint,
        requestPayload
      });

      if (!normalized.schoolName || !normalized.departmentName) {
        continue;
      }

      deduped.set(majorKey(normalized), normalized);
    }
  }

  const majors = [...deduped.values()].sort((a, b) => {
    if (a.schoolName !== b.schoolName) {
      return a.schoolName.localeCompare(b.schoolName, "zh-Hant");
    }
    return a.departmentName.localeCompare(b.departmentName, "zh-Hant");
  });

  const payload = {
    source: "104",
    extractedAt: new Date().toISOString(),
    scoreYear: scoreYear ? Number(scoreYear) : null,
    inputHar: input,
    requestCount: matchedEntries.length,
    majorCount: majors.length,
    requestSummaries,
    majors
  };

  await ensureDir(out);
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`已輸出 104 校系資料：${out}`);
  console.log(`API 請求數：${matchedEntries.length}`);
  console.log(`校系筆數：${majors.length}`);
}

async function extractCapture() {
  const input = args[1];
  const out = getFlag("--out");
  const scoreYear = getFlag("--score-year", null);

  if (!input) {
    throw new Error("缺少擷取 JSON 路徑，例如 extract-capture data/raw/104-browser-capture.json");
  }
  if (!out) {
    throw new Error("缺少 --out，請指定輸出 JSON 檔案");
  }

  const raw = JSON.parse(await fs.readFile(input, "utf8"));
  const entries = Array.isArray(raw?.capturedRequests) ? raw.capturedRequests : [];
  const matchedEntries = entries.filter((entry) =>
    SUPPORTED_MAJOR_ENDPOINTS.some((endpoint) =>
      String(entry?.url ?? "").includes(endpoint.replace("/api/v1.0", ""))
    ) ||
    SUPPORTED_MAJOR_ENDPOINTS.some((endpoint) => String(entry?.url ?? "").includes(endpoint))
  );

  const requestSummaries = [];
  const deduped = new Map();

  for (const entry of matchedEntries) {
    const url = String(entry?.url ?? "");
    const endpoint =
      SUPPORTED_MAJOR_ENDPOINTS.find((item) => url.includes(item)) ?? url;
    const requestPayload = safeJsonParse(entry?.postData ?? "", null);
    const responseJson =
      entry?.body && typeof entry.body === "object" ? entry.body : null;
    const rawMajors = extractMajorList(responseJson);

    requestSummaries.push({
      endpoint,
      url,
      capturedAt: entry?.capturedAt ?? null,
      status: entry?.status ?? null,
      requestPayload
    });

    for (const rawMajor of rawMajors) {
      const normalized = normalizeMajorRecord(rawMajor, {
        scoreYear: scoreYear ? Number(scoreYear) : null,
        endpoint,
        requestPayload
      });

      if (!normalized.schoolName || !normalized.departmentName) {
        continue;
      }

      deduped.set(majorKey(normalized), normalized);
    }
  }

  const majors = [...deduped.values()].sort((a, b) => {
    if (a.schoolName !== b.schoolName) {
      return a.schoolName.localeCompare(b.schoolName, "zh-Hant");
    }
    return a.departmentName.localeCompare(b.departmentName, "zh-Hant");
  });

  const payload = {
    source: "104",
    extractedAt: new Date().toISOString(),
    scoreYear: scoreYear ? Number(scoreYear) : null,
    inputCapture: input,
    requestCount: matchedEntries.length,
    majorCount: majors.length,
    requestSummaries,
    majors
  };

  await ensureDir(out);
  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`已輸出瀏覽器態校系資料：${out}`);
  console.log(`擷取請求數：${matchedEntries.length}`);
  console.log(`校系筆數：${majors.length}`);
}

async function summarizeNormalized() {
  const input = args[1];
  if (!input) {
    throw new Error("缺少正規化 JSON 路徑，例如 summarize data/normalized/104-gsat-115.json");
  }

  const payload = JSON.parse(await fs.readFile(input, "utf8"));
  const majors = Array.isArray(payload?.majors) ? payload.majors : [];
  const schoolSet = new Set(majors.map((item) => item.schoolName).filter(Boolean));
  const endpointSet = new Set(majors.map((item) => item.endpoint).filter(Boolean));

  console.log(`來源：${payload?.source ?? "unknown"}`);
  console.log(`學年度：${payload?.scoreYear ?? "unknown"}`);
  console.log(`校系筆數：${majors.length}`);
  console.log(`學校數：${schoolSet.size}`);
  console.log(`端點數：${endpointSet.size}`);
  console.log(`端點：${[...endpointSet].join(", ")}`);
}

async function main() {
  if (!command || hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  if (command === "fetch-standard") {
    await fetchStandardScore();
    return;
  }

  if (command === "extract-har") {
    await extractHar();
    return;
  }

  if (command === "extract-capture") {
    await extractCapture();
    return;
  }

  if (command === "fetch-major-list") {
    await fetchMajorListDirect();
    return;
  }

  if (command === "summarize") {
    await summarizeNormalized();
    return;
  }

  throw new Error(`未知指令：${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
