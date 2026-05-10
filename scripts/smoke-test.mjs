#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
].filter(Boolean);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const SUPABASE_STUB_SOURCE = `
  (() => {
    const authListeners = [];
    const profiles = new Map();

    function resolve(data, error = null) {
      return Promise.resolve({ data, error });
    }

    function createBuilder(tableName) {
      const filters = {};
      const builder = {
        select() { return builder; },
        eq(column, value) {
          filters[column] = value;
          return builder;
        },
        order() { return builder; },
        limit() {
          if (tableName === "university_tw_snapshots") return resolve([]);
          return resolve([]);
        },
        range() { return resolve([]); },
        maybeSingle() {
          if (tableName === "cv_profiles") {
            return resolve(profiles.get(filters.user_id) || null);
          }
          return resolve(null);
        },
        upsert(payload) {
          if (tableName === "cv_profiles" && payload?.user_id) {
            profiles.set(payload.user_id, {
              content: payload.content || null,
              template_id: payload.template_id || null
            });
          }
          return resolve(null);
        }
      };
      return builder;
    }

    window.__supabaseTest = {
      authListeners,
      async emit(event, user = null) {
        const session = user ? { user } : null;
        for (const listener of [...authListeners]) {
          await listener(event, session);
        }
      }
    };

    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange(callback) {
              authListeners.push(callback);
              return {
                data: {
                  subscription: {
                    unsubscribe() {
                      const index = authListeners.indexOf(callback);
                      if (index >= 0) authListeners.splice(index, 1);
                    }
                  }
                }
              };
            },
            async getSession() {
              return { data: { session: null }, error: null };
            },
            async exchangeCodeForSession() {
              return { error: null };
            },
            async signInWithOAuth() {
              return { error: null };
            },
            async signOut() {
              return { error: null };
            }
          },
          from(tableName) {
            return createBuilder(tableName);
          }
        };
      }
    };
  })();
`;

const HTML2PDF_STUB_SOURCE = `
  window.html2pdf = function html2pdfStub() {
    return {
      set() { return this; },
      from() { return this; },
      toPdf() { return this; },
      async get() {
        return {
          output() {
            return new Blob([], { type: "application/pdf" });
          }
        };
      },
      async save() {
        return undefined;
      }
    };
  };
`;

const QRCODE_STUB_SOURCE = `
  window.QRCode = {
    toCanvas(canvas, text, options, callback) {
      if (typeof callback === "function") callback(null);
    },
    async toDataURL() {
      return "data:image/png;base64,";
    }
  };
`;

function log(message) {
  console.log(message);
}

function findChromeExecutable() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("找不到可用的 Chromium / Chrome。可用 CHROME_PATH 指定瀏覽器路徑。");
}

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function startStaticServer(rootDir) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(rootDir, normalized);

    fs.readFile(filePath, (error, buffer) => {
      if (error) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }
      response.writeHead(200, { "Content-Type": getMimeType(filePath), "Cache-Control": "no-store" });
      response.end(buffer);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    server,
    origin: `http://127.0.0.1:${port}`
  };
}

async function withStep(name, fn) {
  log(`\n[smoke] ${name}`);
  await fn();
  log(`[pass] ${name}`);
}

async function main() {
  assert.ok(fs.existsSync(path.join(DIST_DIR, "index.html")), "找不到 dist/index.html，請先執行 npm run build");

  const executablePath = findChromeExecutable();
  const { server, origin } = await startStaticServer(DIST_DIR);
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: ["--no-first-run", "--no-default-browser-check"]
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (/@supabase\/supabase-js@2/.test(url)) {
      request.respond({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: SUPABASE_STUB_SOURCE
      });
      return;
    }
    if (/html2pdf(\.bundle)?\.min\.js/.test(url)) {
      request.respond({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: HTML2PDF_STUB_SOURCE
      });
      return;
    }
    if (/qrcode\/build\/qrcode\.min\.js/.test(url)) {
      request.respond({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: QRCODE_STUB_SOURCE
      });
      return;
    }
    request.continue();
  });

  await page.evaluateOnNewDocument(() => {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.register === "function") {
      navigator.serviceWorker.register = async () => ({
        active: null,
        installing: null,
        waiting: null,
        scope: window.location.origin
      });
    }
  });

  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(
      () => Boolean(window.cvStudioState && window.switchCvStudioTab),
      { timeout: 120000 }
    );

    await withStep("登入狀態 shell", async () => {
      await page.waitForSelector("#authStatus");
      const authText = await page.$eval("#authStatus", (node) => node.textContent || "");
      const headerText = await page.$eval("#headerAuthStatus", (node) => node.textContent || "");
      const loginVisible = await page.$eval("#headerLoginBtn", (node) => getComputedStyle(node).display !== "none");
      assert.match(authText, /尚未登入/);
      assert.match(headerText, /尚未登入/);
      assert.equal(loginVisible, true);
    });

    await withStep("登入／登出事件流", async () => {
      await page.evaluate(async () => {
        await window.__supabaseTest.emit("SIGNED_IN", {
          id: "smoke-user",
          email: "smoke@example.com",
          user_metadata: { full_name: "Smoke Tester" }
        });
      });
      await page.waitForFunction(() => {
        const node = document.getElementById("authStatus");
        return node && /Smoke Tester/.test(node.textContent || "");
      });

      const signedInAuthText = await page.$eval("#authStatus", (node) => node.textContent || "");
      const logoutVisible = await page.$eval("#headerLogoutBtn", (node) => !node.hidden);
      assert.match(signedInAuthText, /Smoke Tester/);
      assert.equal(logoutVisible, true);

      await page.evaluate(async () => {
        await window.__supabaseTest.emit("SIGNED_OUT");
      });
      await page.waitForFunction(() => {
        const node = document.getElementById("authStatus");
        return node && /尚未登入/.test(node.textContent || "");
      });
    });

    await withStep("Career 基本互動", async () => {
      await page.evaluate(() => {
        Object.assign(window.cvStudioState.data, {
          name: "測試學生",
          role: "前端工程師",
          summary: "熟悉網頁開發與介面優化。",
          skills: "JavaScript\nHTML\nCSS"
        });
        window.localStorage.setItem("cv-studio-local-v2", JSON.stringify(window.cvStudioState.data));
      });

      await page.click("[data-tab='career']");
      await page.waitForSelector("#page-career.active");
      await page.waitForFunction(() => {
        const node = document.getElementById("careerCvSnippet");
        return node && /測試學生|前端工程師/.test(node.textContent || "");
      });

      await page.click(".career-mode-tab[data-mode='position']");
      await page.waitForFunction(() => {
        const section = document.getElementById("careerJdSection");
        const button = document.getElementById("careerAnalyzeBtn");
        return section && section.style.display === "none" && button && /分析我適合哪些崗位/.test(button.textContent || "");
      });

      await page.click("#careerAnalyzeBtn");
      await page.waitForFunction(() => {
        const node = document.getElementById("careerResultsArea");
        return node && /請先填入 API Key/.test(node.textContent || "");
      });
    });

    await withStep("GSAT 正向分析流程", async () => {
      await page.click("[data-tab='gsat']");
      await page.waitForSelector("#page-gsat.active");

      const departmentDisabled = await page.$eval("#gsatDepartmentSelect", (node) => node.disabled);
      assert.equal(departmentDisabled, true);

      await page.select("#gsatTierSelect", "top");
      await page.select("#gsatUniversitySelect", "國立臺灣大學");
      await page.waitForFunction(() => {
        const select = document.getElementById("gsatDepartmentSelect");
        return select && !select.disabled && Array.from(select.options).some((option) => option.value === "資訊工程學系");
      });
      await page.select("#gsatDepartmentSelect", "資訊工程學系");

      await page.$eval("#gsatScore國文", (node) => { node.value = "13"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore英文", (node) => { node.value = "13"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore數學A", (node) => { node.value = "15"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore社會", (node) => { node.value = "10"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore自然", (node) => { node.value = "13"; node.dispatchEvent(new Event("input", { bubbles: true })); });

      await page.click("#gsatAnalyzeBtn");
      await page.waitForSelector("#gsatResultsArea .gsat-total-bar");
      await page.waitForFunction(() => {
        const node = document.getElementById("gsatResultsArea");
        return node && /國立臺灣大學/.test(node.textContent || "") && /資訊工程學系/.test(node.textContent || "");
      });

      const sourceText = await page.$eval(".gsat-source-chip", (node) => node.textContent || "");
      assert.match(sourceText, /本地快照/);
    });

    await withStep("GSAT 無切線 fallback", async () => {
      await page.select("#gsatDepartmentSelect", "人類學系");
      await page.click("#gsatAnalyzeBtn");
      await page.waitForSelector("#gsatResultsArea .gsat-empty-note");
      await page.waitForFunction(() => {
        const node = document.getElementById("gsatResultsArea");
        return node && /沒有可直接計算的歷年切線/.test(node.textContent || "") && /校系資料庫摘要/.test(node.textContent || "");
      });

      const actionCount = await page.$$eval("#gsatResultsArea [data-gsat-action]", (nodes) => nodes.length);
      assert.ok(actionCount >= 1, "無切線 fallback 應提供至少一個快速操作按鈕");
    });

    assert.deepEqual(pageErrors, [], `頁面執行錯誤：\n${pageErrors.join("\n")}`);
    assert.deepEqual(consoleErrors, [], `瀏覽器 console error：\n${consoleErrors.join("\n")}`);

    log("\n[smoke] 全部通過");
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(`\n[smoke] 失敗：${error.message}`);
  process.exitCode = 1;
});
