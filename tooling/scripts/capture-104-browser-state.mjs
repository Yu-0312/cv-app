#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import puppeteer from "puppeteer-core";

const CHROME_PATH =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP_URL = "https://student.104.com.tw/hs/apply/";

function getFlag(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return fallback;
  return args[index + 1];
}

function getNumberFlag(args, name, fallback = null) {
  const value = getFlag(args, name, null);
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} 必須是數字`);
  }
  return parsed;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function buildScorePayload(args) {
  const scoreYear = getNumberFlag(args, "--score-year");
  const roleType = getNumberFlag(args, "--role-type", 1);
  const chinese = getNumberFlag(args, "--chinese");
  const english = getNumberFlag(args, "--english");
  const mathA = getNumberFlag(args, "--mathA");
  const mathB = getNumberFlag(args, "--mathB");
  const society = getNumberFlag(args, "--society");
  const natural = getNumberFlag(args, "--natural");
  const apcsS = getNumberFlag(args, "--apcsS", 0);
  const apcsI = getNumberFlag(args, "--apcsI", 0);
  const eListening = getFlag(args, "--e-listening", "F");

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
    chinese,
    english,
    mathA,
    mathB,
    society,
    natural,
    apcsS,
    apcsI,
    eListening
  };
}

function printHelp() {
  console.log(`
104 瀏覽器態擷取器

用法：
  node scripts/capture-104-browser-state.mjs probe --score-year 115 --role-type 1 --chinese 12 --english 11 --mathA 10 --mathB 9 --society 12 --natural 12
  node scripts/capture-104-browser-state.mjs capture --score-year 115 --role-type 1 --chinese 12 --english 11 --mathA 10 --mathB 9 --society 12 --natural 12 --out data/raw/104-browser-capture.json --headed --manual-login

說明：
  probe    驗證瀏覽器態下 majorList / schoolNo / offset 是否生效。
  capture  攔截真實 majorList / recommendMajorList / landingPoint 回應並保存；登入後可滾動擷取更多批次。
`);
}

async function openBrowser({ headed = false } = {}) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-app-104-"));
  const browser = await puppeteer.launch({
    headless: headed ? false : "new",
    executablePath: CHROME_PATH,
    userDataDir,
    args: ["--no-first-run", "--no-default-browser-check"]
  });
  return { browser, userDataDir };
}

async function bootstrapPage(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#app", { timeout: 120000 });
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

async function runInBrowser(page, scorePayload, queryPayload) {
  return page.evaluate(async ({ scorePayload, queryPayload }) => {
    const headers = { "content-type": "application/json" };
    const postJson = async (url, body) => {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body)
      });
      const json = await response.json();
      return {
        ok: response.ok,
        status: response.status,
        json
      };
    };
    const getJson = async (url) => {
      const response = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json" }
      });
      return response.json();
    };

    const landingPoint = await postJson("/api/v1.0/hs/landingPoint", {
      roleType: scorePayload.roleType,
      chinese: scorePayload.chinese,
      english: scorePayload.english,
      mathA: scorePayload.mathA,
      mathB: scorePayload.mathB,
      society: scorePayload.society,
      natural: scorePayload.natural,
      apcsS: scorePayload.apcsS,
      apcsI: scorePayload.apcsI,
      eListening: scorePayload.eListening
    });

    const majorList = await postJson("/api/v1.0/hs/majorList", queryPayload);
    return {
      landingPoint,
      majorList,
      schoolArea: await getJson("/api/v1.0/hs/schoolArea")
    };
  }, { scorePayload, queryPayload });
}

function buildMajorQuery(scorePayload, overrides = {}) {
  return {
    majorName: "",
    schoolNo: [],
    groupNo: [],
    hollands: [],
    risk: [],
    interview: [],
    page: { limit: 100, offset: 0 },
    score: {
      roleType: scorePayload.roleType,
      chinese: scorePayload.chinese,
      english: scorePayload.english,
      mathA: scorePayload.mathA,
      mathB: scorePayload.mathB,
      society: scorePayload.society,
      natural: scorePayload.natural,
      apcsS: scorePayload.apcsS,
      apcsI: scorePayload.apcsI,
      eListening: scorePayload.eListening
    },
    ...overrides
  };
}

async function probe(args) {
  const scorePayload = buildScorePayload(args);
  const { browser, userDataDir } = await openBrowser();
  try {
    const page = await browser.newPage();
    await bootstrapPage(page);

    const base = await runInBrowser(page, scorePayload, buildMajorQuery(scorePayload));
    const schoolFiltered = await runInBrowser(
      page,
      scorePayload,
      buildMajorQuery(scorePayload, { schoolNo: ["001"] })
    );
    const offsetPage = await runInBrowser(
      page,
      scorePayload,
      buildMajorQuery(scorePayload, { page: { limit: 100, offset: 20 } })
    );

    const summarize = (payload) => ({
      status: payload.majorList.status,
      total: payload.majorList.json?.data?.page?.total ?? null,
      limit: payload.majorList.json?.data?.page?.limit ?? null,
      offset: payload.majorList.json?.data?.page?.offset ?? null,
      count: Array.isArray(payload.majorList.json?.data?.major)
        ? payload.majorList.json.data.major.length
        : 0,
      firstSchool:
        payload.majorList.json?.data?.major?.[0]?.major?.school?.name ?? null,
      firstDepartment:
        payload.majorList.json?.data?.major?.[0]?.major?.major?.name ?? null
    });

    console.log(JSON.stringify({
      mode: "probe",
      base: summarize(base),
      schoolFiltered: summarize(schoolFiltered),
      offsetPage: summarize(offsetPage)
    }, null, 2));
  } finally {
    await browser.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

async function capture(args) {
  const out = getFlag(args, "--out");
  if (!out) throw new Error("缺少 --out");

  const scorePayload = buildScorePayload(args);
  const headed = args.includes("--headed");
  const manualLogin = args.includes("--manual-login");
  const maxScrolls = getNumberFlag(args, "--max-scrolls", 40);
  const waitMs = getNumberFlag(args, "--wait-ms", 1500);
  const { browser, userDataDir } = await openBrowser({ headed });
  try {
    const page = await browser.newPage();
    const captured = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (
        !url.includes("/api/v1.0/hs/majorList") &&
        !url.includes("/api/v1.0/hs/recommendMajorList") &&
        !url.includes("/api/v1.0/hs/landingPoint")
      ) {
        return;
      }

      let body = null;
      try {
        body = await response.json();
      } catch {
        try {
          body = await response.text();
        } catch {
          body = null;
        }
      }

      captured.push({
        url,
        status: response.status(),
        method: response.request().method(),
        postData: response.request().postData() || null,
        capturedAt: new Date().toISOString(),
        body
      });
    });

    await bootstrapPage(page);
    const result = await runInBrowser(page, scorePayload, buildMajorQuery(scorePayload));

    await page.goto("https://student.104.com.tw/hs/apply/result/", {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));

    if (manualLogin) {
      if (!headed) {
        throw new Error("--manual-login 需要搭配 --headed");
      }
      const rl = readline.createInterface({ input, output });
      console.log("請在開啟的 Chrome 視窗完成 104 登入，登入後回到終端按 Enter 繼續。");
      await rl.question("");
      rl.close();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    let previousLength = -1;
    const scrollSnapshots = [];
    for (let index = 0; index < maxScrolls; index += 1) {
      const snapshot = await page.evaluate(() => {
        const text = document.body.innerText;
        const cards = text.match(/看詳情/g) || [];
        return {
          url: location.href,
          cardCount: cards.length,
          hasPaywall: text.includes("加入會員看更多"),
          totalText: (text.match(/共\\s*(\\d+)\\s*筆/) || [])[1] || null
        };
      });
      scrollSnapshots.push(snapshot);
      if (snapshot.cardCount === previousLength) {
        break;
      }
      previousLength = snapshot.cardCount;
      await page.mouse.wheel({ deltaY: 2200 });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const payload = {
      capturedAt: new Date().toISOString(),
      scorePayload,
      result,
      scrollSnapshots,
      capturedRequests: captured
    };
    await ensureDir(out);
    await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`已輸出瀏覽器態擷取結果：${out}`);
    console.log(`攔截請求數：${captured.length}`);
  } finally {
    await browser.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (command === "probe") {
    await probe(args);
    return;
  }
  if (command === "capture") {
    await capture(args);
    return;
  }
  throw new Error(`未知指令：${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
