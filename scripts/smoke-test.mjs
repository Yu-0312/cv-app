#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
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
    const publicProfiles = new Map(JSON.parse(window.localStorage.getItem("__supabase_public_profiles") || "[]"));
    const uploads = new Map();
    let signOutGate = null;
    let releaseSignOutGate = null;
    let currentSession = readPersistedSession();
    let lastSignOutOptions = null;
    let hangNextGsatSnapshotQuery = false;

    function resolve(data, error = null) {
      return Promise.resolve({ data, error });
    }

    function getProjectRef() {
      try {
        return new URL(window.CV_STUDIO_CONFIG?.supabaseUrl || "").hostname.split(".")[0] || "test-project";
      } catch {
        return "test-project";
      }
    }

    function getStorageKey() {
      return \`sb-\${getProjectRef()}-auth-token\`;
    }

    function readPersistedSession() {
      try {
        const raw = window.localStorage.getItem(getStorageKey()) || window.sessionStorage.getItem(getStorageKey());
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.currentSession || null;
      } catch {
        return null;
      }
    }

    function persistSession(session) {
      currentSession = session;
      if (!session) return;
      window.localStorage.setItem(getStorageKey(), JSON.stringify({
        currentSession: session,
        expires_at: Math.floor(Date.now() / 1000) + 3600
      }));
      window.sessionStorage.setItem(getStorageKey(), JSON.stringify({
        currentSession: session,
        expires_at: Math.floor(Date.now() / 1000) + 3600
      }));
    }

    function persistPublicProfiles() {
      window.localStorage.setItem("__supabase_public_profiles", JSON.stringify([...publicProfiles.entries()]));
    }

    function findPublicProfile(filters) {
      if (filters.user_id) {
        return [...publicProfiles.values()].find((profile) => profile.user_id === filters.user_id) || null;
      }
      if (filters.slug) {
        return publicProfiles.get(filters.slug) || null;
      }
      return null;
    }

    function removePublicProfile(filters) {
      const profile = findPublicProfile(filters);
      if (profile?.slug) {
        publicProfiles.delete(profile.slug);
        persistPublicProfiles();
      }
    }

    function createBuilder(tableName) {
      const filters = {};
      let deleteMode = false;
      const builder = {
        select() { return builder; },
        delete() {
          deleteMode = true;
          return builder;
        },
        eq(column, value) {
          filters[column] = value;
          if (deleteMode) {
            if (tableName === "cv_public_profiles") removePublicProfile(filters);
            return resolve(null);
          }
          return builder;
        },
        order() { return builder; },
        limit() {
          if (tableName === "university_tw_snapshots") {
            if (hangNextGsatSnapshotQuery) {
              hangNextGsatSnapshotQuery = false;
              return new Promise(() => {});
            }
            return resolve([]);
          }
          return resolve([]);
        },
        range() { return resolve([]); },
        maybeSingle() {
          if (tableName === "cv_profiles") {
            return resolve(profiles.get(filters.user_id) || null);
          }
          if (tableName === "cv_public_profiles") {
            return resolve(findPublicProfile(filters));
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
          if (tableName === "cv_public_profiles" && payload?.slug) {
            const existing = findPublicProfile({ user_id: payload.user_id });
            if (existing?.slug && existing.slug !== payload.slug) {
              publicProfiles.delete(existing.slug);
            }
            publicProfiles.set(payload.slug, { ...payload });
            persistPublicProfiles();
          }
          return resolve(null);
        }
      };
      return builder;
    }

    function createStorage() {
      return {
        from(bucketName) {
          return {
            async upload(path, fileOrBlob, options = {}) {
              uploads.set(path, {
                bucketName,
                path,
                type: options.contentType || fileOrBlob?.type || "application/octet-stream",
                size: fileOrBlob?.size || 0
              });
              return { data: { path }, error: null };
            },
            getPublicUrl(path) {
              return { data: { publicUrl: \`https://storage.test/\${bucketName}/\${path}\` } };
            },
            async remove(paths) {
              (paths || []).forEach((path) => uploads.delete(path));
              return { data: null, error: null };
            }
          };
        }
      };
    }

    window.__supabaseTest = {
      authListeners,
      get storageKey() {
        return getStorageKey();
      },
      get lastSignOutOptions() {
        return lastSignOutOptions;
      },
      get publicProfiles() {
        return [...publicProfiles.values()];
      },
      get uploads() {
        return [...uploads.values()];
      },
      get profiles() {
        return [...profiles.values()];
      },
      setProfile(userId, content, templateId = "n-tech") {
        profiles.set(userId, {
          content,
          template_id: templateId
        });
      },
      delayNextSignOut() {
        signOutGate = new Promise((resolve) => {
          releaseSignOutGate = resolve;
        });
      },
      hangNextGsatSnapshotQuery() {
        hangNextGsatSnapshotQuery = true;
      },
      async finishSignOut() {
        const release = releaseSignOutGate;
        releaseSignOutGate = null;
        if (release) release();
        await Promise.resolve();
      },
      async emit(event, user = null) {
        const session = user ? { user } : null;
        if (event === "SIGNED_IN") persistSession(session);
        if (event === "SIGNED_OUT") currentSession = null;
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
              currentSession = currentSession || readPersistedSession();
              return { data: { session: currentSession }, error: null };
            },
            async exchangeCodeForSession() {
              return { error: null };
            },
            async signInWithOAuth() {
              return { error: null };
            },
            async signOut(options) {
              lastSignOutOptions = options || null;
              if (signOutGate) {
                const gate = signOutGate;
                signOutGate = null;
                await gate;
              }
              currentSession = null;
              for (const listener of [...authListeners]) {
                await listener("SIGNED_OUT", null);
              }
              return { error: null };
            }
          },
          from(tableName) {
            return createBuilder(tableName);
          },
          storage: createStorage()
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
  const tempDirs = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("dialog", async (dialog) => {
    await dialog.dismiss();
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

      await page.evaluate(() => {
        window.localStorage.removeItem("cv-studio-signed-out-draft-v1");
        window.localStorage.removeItem("cv-studio-cloud-profile-active-v1");
        window.localStorage.setItem("cv-studio-local-v2", JSON.stringify({
          name: "Legacy Cloud Name",
          role: "Legacy Role",
          email: "legacy@example.com"
        }));
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => Boolean(window.cvStudioState && window.switchCvStudioTab),
        { timeout: 120000 }
      );
      await page.waitForFunction(() => {
        const node = document.getElementById("authStatus");
        return node && /尚未登入/.test(node.textContent || "") && window.cvStudioState?.data?.name === "";
      });
      const previewText = await page.$eval("#cvPaper", (node) => node.textContent || "");
      assert.doesNotMatch(previewText, /Legacy Cloud Name/);
      const navState = await page.evaluate(() => ({
        shortcutCount: document.querySelectorAll(".nav-shortcut,[data-tab-shortcut]").length,
        primaryActionText: document.getElementById("navPrimaryActionBtn")?.textContent || ""
      }));
      assert.equal(navState.shortcutCount, 0);
      assert.match(navState.primaryActionText, /開始履歷/);

      await page.evaluate(() => window.switchCvStudioTab("cv"));
      await page.waitForFunction(() => /下載 PDF/.test(document.getElementById("navPrimaryActionBtn")?.textContent || ""));
      await page.waitForSelector("#cvStudioBar");
      const signedOutBrowserState = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("#cvStudioBar .cv-browser-section")).map((details) => {
          const panel = details.querySelector(".cv-browser-panel");
          return {
            id: details.id,
            open: details.open,
            panelVisible: Boolean(
              panel
                && getComputedStyle(panel).display !== "none"
                && panel.getClientRects().length
            )
          };
        });
      });
      assert.deepEqual(
        signedOutBrowserState,
        [
          { id: "roleBrowserDetails", open: false, panelVisible: false },
          { id: "templateBrowserDetails", open: false, panelVisible: false },
          { id: "cvToolsDetails", open: false, panelVisible: false }
        ]
      );
      await page.click("#roleBrowserDetails > summary");
      await page.waitForFunction(() => {
        const roleDetails = document.getElementById("roleBrowserDetails");
        const rolePanel = roleDetails?.querySelector(".cv-browser-panel");
        if (!roleDetails || !rolePanel) return false;
        return roleDetails?.open
          && getComputedStyle(rolePanel).display !== "none"
          && document.querySelectorAll("#jobRoleBar .job-chip").length >= 10;
      });
      await page.click("#templateBrowserDetails > summary");
      await page.waitForFunction(() => {
        const roleDetails = document.getElementById("roleBrowserDetails");
        const templateDetails = document.getElementById("templateBrowserDetails");
        const templatePanel = templateDetails?.querySelector(".cv-browser-panel");
        if (!roleDetails || !templateDetails || !templatePanel) return false;
        return !roleDetails?.open
          && templateDetails?.open
          && getComputedStyle(templatePanel).display !== "none"
          && document.querySelectorAll("#templateStrip .template-chip").length >= 20;
      });

      await page.waitForSelector("#name");
      await page.$eval("#name", (input, value) => {
        input.value = value;
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }, "未登入草稿");
      await page.click('[data-template-chip="dusk"]');
      await page.waitForFunction(() => {
        const raw = window.localStorage.getItem("cv-studio-signed-out-draft-v1");
        if (!raw) return false;
        const snapshot = JSON.parse(raw);
        return snapshot?.data?.name === "未登入草稿"
          && snapshot?.template === "dusk"
          && !window.localStorage.getItem("cv-studio-local-v2");
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => Boolean(window.cvStudioState && window.switchCvStudioTab),
        { timeout: 120000 }
      );
      await page.evaluate(() => window.switchCvStudioTab("cv"));
      await page.waitForFunction(() => {
        const paper = document.getElementById("cvPaper");
        return window.cvStudioState?.data?.name === "未登入草稿"
          && window.cvStudioState?.template === "dusk"
          && paper?.dataset?.template === "dusk"
          && (paper.textContent || "").includes("未登入草稿");
      });
      await page.evaluate(() => {
        window.localStorage.removeItem("cv-studio-signed-out-draft-v1");
      });
    });

    await withStep("登入／登出事件流", async () => {
      await page.evaluate(() => {
        Object.assign(window.cvStudioState.data, {
          name: "Local Draft",
          role: "Local Role",
          email: "local@example.com",
          summary: "Local draft summary"
        });
        window.localStorage.setItem("cv-studio-local-v2", JSON.stringify(window.cvStudioState.data));
        window.localStorage.setItem("pf-studio-local-v4", JSON.stringify({
          title: "Local Portfolio",
          studentName: "Local Draft",
          chapters: [{ id: "local", title: "Local Chapter", sections: [{ id: "local-sec", header: "Local Section", body: "Local body" }] }]
        }));
        window.__supabaseTest.setProfile("smoke-user", {
          name: "Cloud Person",
          role: "Cloud Role",
          email: "cloud@example.com",
          summary: "Cloud profile summary"
        });
      });

      await page.evaluate(async () => {
        window.localStorage.removeItem("cv-studio-auth-signed-out-v1");
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
      const cloudName = await page.evaluate(() => window.cvStudioState.data.name);
      assert.match(signedInAuthText, /Smoke Tester/);
      assert.equal(logoutVisible, true);
      assert.equal(cloudName, "Cloud Person");

      await page.evaluate(() => window.__supabaseTest.delayNextSignOut());
      await page.click("#headerLogoutBtn");
      await page.waitForFunction(() => {
        const authNode = document.getElementById("authStatus");
        const headerNode = document.getElementById("headerAuthStatus");
        const button = document.getElementById("headerLogoutBtn");
        return /登出中/.test(authNode?.textContent || "")
          && /登出中/.test(headerNode?.textContent || "")
          && /登出中/.test(button?.textContent || "")
          && button?.disabled === true
          && button?.hidden === false;
      });
      await page.evaluate(async () => {
        await window.__supabaseTest.finishSignOut();
      });
      await page.waitForFunction(() => {
        const node = document.getElementById("message");
        return node && /已登出/.test(node.textContent || "");
      });
      await page.waitForFunction(() => {
        const node = document.getElementById("authStatus");
        return node && /尚未登入/.test(node.textContent || "");
      });
      const restoredName = await page.evaluate(() => window.cvStudioState.data.name);
      assert.equal(restoredName, "");
      const signedOutCvStorage = await page.evaluate(() => window.localStorage.getItem("cv-studio-local-v2"));
      assert.equal(signedOutCvStorage, null);
      const signedOutPortfolioStorage = await page.evaluate(() => window.localStorage.getItem("pf-studio-local-v4"));
      assert.equal(signedOutPortfolioStorage, null);
      const signedOutPortfolioPreset = await page.evaluate(() => window.localStorage.getItem("pf-studio-preset-v1"));
      assert.equal(signedOutPortfolioPreset, null);
      const signOutOptions = await page.evaluate(() => window.__supabaseTest.lastSignOutOptions);
      const authStorageCleared = await page.evaluate(() => {
        const key = window.__supabaseTest.storageKey;
        return !window.localStorage.getItem(key) && !window.sessionStorage.getItem(key);
      });
      assert.deepEqual(signOutOptions, { scope: "local" });
      assert.equal(authStorageCleared, true);

      await page.evaluate(() => {
        const staleSession = {
          user: {
            id: "smoke-user",
            email: "smoke@example.com",
            user_metadata: { full_name: "Stale Session" }
          }
        };
        const payload = JSON.stringify({
          currentSession: staleSession,
          expires_at: Math.floor(Date.now() / 1000) + 3600
        });
        window.localStorage.setItem(window.__supabaseTest.storageKey, payload);
        window.sessionStorage.setItem(window.__supabaseTest.storageKey, payload);
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => Boolean(window.cvStudioState && window.switchCvStudioTab),
        { timeout: 120000 }
      );
      await page.waitForFunction(() => {
        const node = document.getElementById("authStatus");
        return node && /尚未登入/.test(node.textContent || "");
      });
      const reloadedName = await page.evaluate(() => window.cvStudioState.data.name);
      assert.equal(reloadedName, "");
      const staleStorageCleared = await page.evaluate(() => {
        const key = window.__supabaseTest.storageKey;
        return !window.localStorage.getItem(key) && !window.sessionStorage.getItem(key);
      });
      assert.equal(staleStorageCleared, true);

      await page.evaluateOnNewDocument(() => {
        const privateTokens = ["Stale Cached Person", "Stale Cached Portfolio"];
        window.__cvPrivacyLeakSeen = false;
        function scanForPrivateText() {
          const bodyText = document.body?.textContent || "";
          const stateName = window.cvStudioState?.data?.name || "";
          if (privateTokens.some((token) => bodyText.includes(token) || stateName.includes(token))) {
            window.__cvPrivacyLeakSeen = true;
          }
        }
        function startPrivacyObserver() {
          scanForPrivateText();
          if (document.documentElement) {
            new MutationObserver(scanForPrivateText).observe(document.documentElement, {
              childList: true,
              subtree: true,
              characterData: true
            });
          }
          window.setInterval(scanForPrivateText, 25);
        }
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", startPrivacyObserver, { once: true });
        } else {
          startPrivacyObserver();
        }
      });
      await page.evaluate(() => {
        const key = window.__supabaseTest.storageKey;
        window.localStorage.removeItem("cv-studio-auth-signed-out-v1");
        window.localStorage.setItem("cv-studio-cloud-profile-active-v1", "stale-user");
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
        window.localStorage.setItem("cv-studio-local-v2", JSON.stringify({
          name: "Stale Cached Person",
          role: "Should Stay Hidden",
          summary: "This cached CV should not render before auth is confirmed."
        }));
        window.localStorage.setItem("pf-studio-local-v4", JSON.stringify({
          title: "Stale Cached Portfolio",
          studentName: "Stale Cached Person",
          chapters: [{ id: "stale", title: "Private Chapter", sections: [{ id: "stale-sec", header: "Private", body: "Private body" }] }]
        }));
        window.localStorage.setItem("pf-studio-preset-v1", JSON.stringify({ group: "dept", id: "engineering" }));
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => Boolean(window.cvStudioState && window.switchCvStudioTab),
        { timeout: 120000 }
      );
      await page.waitForFunction(() => {
        const node = document.getElementById("authStatus");
        return node && /尚未登入/.test(node.textContent || "");
      });
      const staleCachePrivacy = await page.evaluate(() => ({
        leakSeen: Boolean(window.__cvPrivacyLeakSeen),
        name: window.cvStudioState.data.name,
        portfolioTitle: document.getElementById("pfTitle")?.value || "",
        cvStorage: window.localStorage.getItem("cv-studio-local-v2"),
        portfolioStorage: window.localStorage.getItem("pf-studio-local-v4"),
        portfolioPreset: window.localStorage.getItem("pf-studio-preset-v1")
      }));
      assert.deepEqual(staleCachePrivacy, {
        leakSeen: false,
        name: "",
        portfolioTitle: "",
        cvStorage: null,
        portfolioStorage: null,
        portfolioPreset: null
      });

      await page.evaluate(async () => {
        window.localStorage.removeItem("cv-studio-auth-signed-out-v1");
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

      await page.evaluate(async () => {
        await window.__supabaseTest.emit("SIGNED_OUT");
      });
      await page.waitForFunction(() => {
        const node = document.getElementById("authStatus");
        return node && /尚未登入/.test(node.textContent || "");
      });
    });

    await withStep("首頁狀態同步與本機 redirect", async () => {
      const redirectTo = await page.$eval("#headerLoginBtn", (node) => {
        return new URL(node.href).searchParams.get("redirect_to");
      });
      assert.equal(redirectTo, `${origin}/`);

      const initialHome = await page.evaluate(() => ({
        title: document.getElementById("homeStatusTitle")?.textContent || "",
        progress: document.getElementById("homeProgressValue")?.textContent || "",
        sync: document.getElementById("homeSyncState")?.textContent || "",
        cv: document.getElementById("homeTaskCvState")?.textContent || "",
        portfolio: document.getElementById("homeTaskPortfolioState")?.textContent || "",
        gsat: document.getElementById("homeTaskGsatState")?.textContent || ""
      }));
      assert.match(initialHome.title, /功能概覽/);
      assert.match(initialHome.progress, /登入後/);
      assert.match(initialHome.sync, /未登入/);
      assert.match(initialHome.cv, /可使用/);
      assert.match(initialHome.portfolio, /可使用/);
      assert.match(initialHome.gsat, /可使用/);

      await page.evaluate(() => {
        Object.assign(window.cvStudioState.data, {
          name: "首頁學生",
          role: "前端工程師",
          email: "home@example.com",
          summary: "具備前端開發、作品整理與跨裝置同步經驗，正在準備完整申請資料。",
          skills: "JavaScript\nHTML\nCSS",
          highlights: "完成作品集\n熟悉履歷優化",
          experience: "前端實習生|Studio|2026|負責介面開發與資料同步測試"
        });
        window.localStorage.setItem("cv-studio-local-v2", JSON.stringify(window.cvStudioState.data));
        window.localStorage.setItem("pf-studio-local-v4", JSON.stringify({
          title: "學習歷程測試",
          studentName: "首頁學生",
          school: "測試高中",
          coverImageUrl: "https://example.com/cover.png",
          accentTheme: "slate",
          chapters: [{
            id: "smoke-chapter",
            title: "專題成果",
            sections: [{
              id: "smoke-section",
              header: "網站專題",
              body: "整理需求、設計介面並完成互動測試。",
              imageUrl: "",
              imageCaption: "成果截圖"
            }]
          }]
        }));

        const tier = document.getElementById("gsatTierSelect");
        if (tier) {
          tier.value = "top";
          tier.dispatchEvent(new Event("change", { bubbles: true }));
        }
        ["國文", "英文", "數學A", "社會", "自然"].forEach((subject, index) => {
          const input = document.getElementById(`gsatScore${subject}`);
          if (!input) return;
          input.value = String(11 + index);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });

        window.dispatchEvent(new CustomEvent("cv:data-updated"));
        window.dispatchEvent(new CustomEvent("portfolio:data-updated"));
      });

      await page.waitForFunction(() => /登入後/.test(document.getElementById("homeProgressValue")?.textContent || ""));
      const signedOutUpdatedHome = await page.evaluate(() => ({
        title: document.getElementById("homeStatusTitle")?.textContent || "",
        progress: document.getElementById("homeProgressValue")?.textContent || "",
        sync: document.getElementById("homeSyncState")?.textContent || "",
        cv: document.getElementById("homeTaskCvState")?.textContent || "",
        portfolio: document.getElementById("homeTaskPortfolioState")?.textContent || "",
        gsat: document.getElementById("homeTaskGsatState")?.textContent || ""
      }));
      assert.match(signedOutUpdatedHome.title, /功能概覽/);
      assert.match(signedOutUpdatedHome.progress, /登入後/);
      assert.match(signedOutUpdatedHome.sync, /未登入/);
      assert.match(signedOutUpdatedHome.cv, /可使用/);
      assert.match(signedOutUpdatedHome.portfolio, /可使用/);
      assert.match(signedOutUpdatedHome.gsat, /可使用/);

      await page.evaluate(async () => {
        window.localStorage.removeItem("cv-studio-auth-signed-out-v1");
        await window.__supabaseTest.emit("SIGNED_IN", {
          id: "smoke-user",
          email: "smoke@example.com",
          user_metadata: { full_name: "Smoke Tester" }
        });
      });
      await page.waitForFunction(() => {
        const value = Number.parseInt(document.getElementById("homeProgressValue")?.textContent || "0", 10);
        return value >= 85;
      });
      const signedInHome = await page.evaluate(() => ({
        title: document.getElementById("homeStatusTitle")?.textContent || "",
        progress: document.getElementById("homeProgressValue")?.textContent || "",
        sync: document.getElementById("homeSyncState")?.textContent || "",
        cv: document.getElementById("homeTaskCvState")?.textContent || "",
        portfolio: document.getElementById("homeTaskPortfolioState")?.textContent || "",
        gsat: document.getElementById("homeTaskGsatState")?.textContent || ""
      }));
      assert.match(signedInHome.title, /目前進度/);
      assert.match(signedInHome.sync, /雲端已連線/);
      assert.match(signedInHome.cv, /資料完整/);
      assert.match(signedInHome.portfolio, /已整理/);
      assert.match(signedInHome.gsat, /可分析/);

      await page.click("[data-language-toggle]");
      await page.waitForFunction(() => /Finish one sendable/.test(document.querySelector(".home-title")?.textContent || ""));
      const englishHome = await page.evaluate(() => ({
        title: document.querySelector(".home-title")?.textContent || "",
        sync: document.getElementById("homeSyncState")?.textContent || "",
        cv: document.getElementById("homeTaskCvState")?.textContent || "",
        portfolio: document.getElementById("homeTaskPortfolioState")?.textContent || "",
        gsat: document.getElementById("homeTaskGsatState")?.textContent || ""
      }));
      assert.match(englishHome.sync, /Cloud Connected/);
      assert.match(englishHome.cv, /Complete/);
      assert.match(englishHome.portfolio, /Organized/);
      assert.match(englishHome.gsat, /Ready/);
      assert.doesNotMatch(Object.values(englishHome).join(" "), /[\u3400-\u9fff]/);

      await page.click("[data-language-toggle]");
      await page.waitForFunction(() => /今天先完成/.test(document.querySelector(".home-title")?.textContent || ""));
      await page.evaluate(async () => {
        await window.__supabaseTest.emit("SIGNED_OUT");
      });
      await page.waitForFunction(() => /未登入/.test(document.getElementById("homeSyncState")?.textContent || ""));
    });

    await withStep("CV 版本、雙語與公開分享隱私", async () => {
      await page.evaluate(async () => {
        window.localStorage.removeItem("cv-studio-auth-signed-out-v1");
        window.localStorage.removeItem("cv-studio-snapshots-v1");
        window.localStorage.removeItem("cv-studio-applications-v1");
        window.localStorage.removeItem("__supabase_public_profiles");
        await window.__supabaseTest.emit("SIGNED_IN", {
          id: "smoke-user",
          email: "smoke@example.com",
          user_metadata: { full_name: "Smoke Tester" }
        });
      });
      await page.waitForFunction(() => /Smoke Tester/.test(document.getElementById("authStatus")?.textContent || ""));

      await page.evaluate(() => {
        window.switchCvStudioTab("cv");
        const setInput = (id, value) => {
          const node = document.getElementById(id);
          if (!node) throw new Error(`Missing #${id}`);
          node.value = value;
          node.dispatchEvent(new Event("input", { bubbles: true }));
        };
        setInput("name", "王宇錡");
        setInput("role", "Frontend Engineer");
        setInput("email", "yu@example.com");
        setInput("summary", "中文摘要：具備前端開發與產品整理能力。");
        setInput("skills", "JavaScript, UI Testing");
      });
      await page.waitForSelector("#page-cv.active");
      log("[smoke] CV 基本資料已填入");

      await page.$eval("#snapshotNameInput", (node) => { node.value = "Frontend 版本"; });
      await page.$eval("#snapshotRoleInput", (node) => { node.value = "前端工程師"; });
      await page.$eval("#snapshotCompanyInput", (node) => { node.value = "測試公司"; });
      await page.$eval("#saveSnapshotBtn", (node) => node.click());
      await page.waitForFunction(() => /Frontend 版本/.test(document.getElementById("snapshotList")?.textContent || ""), { timeout: 10000 }).catch(async (error) => {
        const snapshotDebug = await page.evaluate(() => ({
          list: document.getElementById("snapshotList")?.textContent || "",
          message: document.getElementById("message")?.textContent || "",
          local: window.localStorage.getItem("cv-studio-snapshots-v1"),
          pageErrors: window.__pageErrors || null
        }));
        throw new Error(`${error.message} snapshotDebug=${JSON.stringify(snapshotDebug)}`);
      });
      log("[smoke] CV 版本已儲存");

      await page.$eval("#applicationCompanyInput", (node) => { node.value = "測試公司"; });
      await page.$eval("#applicationRoleInput", (node) => { node.value = "前端工程師"; });
      await page.select("#applicationStatusSelect", "已投遞");
      await page.$eval("#applicationDateInput", (node) => { node.value = "2026-05-12"; });
      await page.$eval("#applicationNoteInput", (node) => { node.value = "等待 HR 回覆"; });
      await page.$eval("#addApplicationBtn", (node) => node.click());
      await page.waitForFunction(() => /測試公司/.test(document.getElementById("applicationList")?.textContent || ""));
      log("[smoke] 投遞紀錄已新增");

      await page.evaluate(() => {
        window.confirm = () => true;
        const payload = {
          version: "cv-studio-v1",
          template: "\"><img src=x onerror=alert(1)>",
          layoutPrefs: "bad-layout",
          data: {
            ...window.cvStudioState.data,
            injectedUnknownField: "<script>window.__pwnedData=1</script>",
            avatar: "javascript:window.__pwnedAvatar=1"
          },
          cvVersions: [{
            id: "1);window.__pwnedSnapshot=1;//",
            name: "Injected Snapshot",
            template: "\"><img src=x onerror=alert(1)>",
            layoutPrefs: "bad-layout",
            data: window.cvStudioState.data
          }],
          applicationRecords: [{
            id: "2);window.__pwnedApplication=1;//",
            company: "Injected Company",
            role: "Injected Role",
            status: "已投遞",
            link: "javascript:window.__pwnedApplication=2",
            note: "Imported record should render safely."
          }]
        };
        const input = document.getElementById("importJsonInput");
        const transfer = new DataTransfer();
        transfer.items.add(new File([JSON.stringify(payload)], "malicious-cv.json", { type: "application/json" }));
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(() => /Injected Snapshot/.test(document.getElementById("snapshotList")?.textContent || "")).catch(async (error) => {
        const importedDebug = await page.evaluate(() => ({
          auth: document.getElementById("authStatus")?.textContent || "",
          snapshotText: document.getElementById("snapshotList")?.textContent || "",
          applicationText: document.getElementById("applicationList")?.textContent || "",
          snapshots: window.localStorage.getItem("cv-studio-snapshots-v1"),
          applications: window.localStorage.getItem("cv-studio-applications-v1"),
          signedOut: window.localStorage.getItem("cv-studio-auth-signed-out-v1"),
          active: window.localStorage.getItem("cv-studio-cloud-profile-active-v1"),
          storageKey: window.__supabaseTest?.storageKey || "",
          authStorage: window.localStorage.getItem(window.__supabaseTest?.storageKey || "")
        }));
        throw new Error(`${error.message} importedDebug=${JSON.stringify(importedDebug)}`);
      });
      const importedListSafety = await page.evaluate(() => ({
        snapshotInlineHandlers: document.querySelectorAll("#snapshotList [onclick]").length,
        applicationInlineHandlers: document.querySelectorAll("#applicationList [onclick]").length,
        javascriptLinks: [...document.querySelectorAll("#applicationList a[href]")].filter((node) => /^javascript:/i.test(node.getAttribute("href") || "")).length,
        snapshotButtonId: document.querySelector("[data-snapshot-id]")?.getAttribute("data-snapshot-id") || "",
        applicationButtonId: document.querySelector("[data-application-delete]")?.getAttribute("data-application-delete") || "",
        hasUnknownField: Object.prototype.hasOwnProperty.call(window.cvStudioState.data, "injectedUnknownField"),
        avatar: window.cvStudioState.data.avatar || "",
        template: window.cvStudioState.template || "",
        pwnedSnapshot: window.__pwnedSnapshot || 0,
        pwnedApplication: window.__pwnedApplication || 0,
        pwnedData: window.__pwnedData || 0,
        pwnedAvatar: window.__pwnedAvatar || 0
      }));
      assert.equal(importedListSafety.snapshotInlineHandlers, 0);
      assert.equal(importedListSafety.applicationInlineHandlers, 0);
      assert.equal(importedListSafety.javascriptLinks, 0);
      assert.match(importedListSafety.snapshotButtonId, /^[\w.-]+$/);
      assert.match(importedListSafety.applicationButtonId, /^[\w.-]+$/);
      assert.equal(importedListSafety.hasUnknownField, false);
      assert.equal(importedListSafety.avatar, "");
      assert.match(importedListSafety.template, /^[\w.-]+$/);
      assert.equal(importedListSafety.pwnedSnapshot, 0);
      assert.equal(importedListSafety.pwnedApplication, 0);
      assert.equal(importedListSafety.pwnedData, 0);
      assert.equal(importedListSafety.pwnedAvatar, 0);
      log("[smoke] 匯入紀錄已安全渲染");

      await page.select("#bilingualFieldSelect", "summary");
      await page.$eval("#bilingualZhInput", (node) => { node.value = "中文摘要：具備前端開發與產品整理能力。"; });
      await page.$eval("#bilingualEnInput", (node) => { node.value = "English summary with frontend and product delivery experience."; });
      await page.$eval("#saveBilingualBtn", (node) => node.click());
      await page.select("#resumeLanguageSelect", "en");
      await page.waitForFunction(() => /English summary with frontend/.test(document.getElementById("cvPaper")?.textContent || ""));
      log("[smoke] 雙語內容已切換");

      await page.waitForFunction(() => !document.getElementById("saveBtn")?.disabled, { timeout: 5000 }).catch(async (error) => {
        const buttonDebug = await page.evaluate(() => ({
          saveDisabled: document.getElementById("saveBtn")?.disabled || false
        }));
        throw new Error(`${error.message} buttonDebug=${JSON.stringify(buttonDebug)}`);
      });
      await page.click("#saveBtn");
      await page.waitForFunction(() => /CV 已成功儲存到雲端/.test(document.getElementById("message")?.textContent || "")).catch(async (error) => {
        const saveDebug = await page.evaluate(() => ({
          message: document.getElementById("message")?.textContent || "",
          saveDisabled: document.getElementById("saveBtn")?.disabled || false,
          saveText: document.getElementById("saveBtn")?.textContent || "",
          user: window.cvStudioState?.user?.email || "",
          authBusy: Boolean(window.cvStudioState?.authBusy),
          hasClient: Boolean(window.cvStudioState?.client),
          hasSupabaseGlobal: Boolean(window.supabase),
          hasUrl: Boolean(window.cvStudioState?.config?.supabaseUrl),
          hasAnon: Boolean(window.cvStudioState?.config?.supabaseAnonKey),
          profileCount: window.__supabaseTest?.profiles?.length || 0,
          pageErrors: window.__pageErrors || null
        }));
        throw new Error(`${error.message} saveDebug=${JSON.stringify(saveDebug)}`);
      });
      log("[smoke] 私人雲端 CV 已儲存");
      const savedProfile = await page.evaluate(() => window.__supabaseTest.profiles.at(-1)?.content || {});
      assert.ok(Array.isArray(savedProfile._cvVersions), "雲端私人 CV 應包含版本紀錄");
      assert.ok(Array.isArray(savedProfile._applicationRecords), "雲端私人 CV 應包含投遞紀錄");

      await page.$eval("#publishShareBtn", (node) => node.click());
      await page.waitForFunction(() => /公開分享頁已發布/.test(document.getElementById("message")?.textContent || ""));
      log("[smoke] 公開分享已發布");
      const shareAudit = await page.evaluate(() => {
        const profile = window.__supabaseTest.publicProfiles[0];
        return {
          slug: profile?.slug || "",
          contentKeys: Object.keys(profile?.content || {}),
          title: document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "",
          image: document.querySelector('meta[property="og:image"]')?.getAttribute("content") || ""
        };
      });
      assert.ok(shareAudit.slug, "公開分享應產生 slug");
      assert.equal(shareAudit.contentKeys.includes("_applicationRecords"), false, "公開分享不得包含投遞紀錄");
      assert.equal(shareAudit.contentKeys.includes("_cvVersions"), false, "公開分享不得包含 CV 版本");
      assert.equal(shareAudit.contentKeys.includes("_portfolioData"), false, "公開分享不得包含私人作品集資料");
      assert.match(shareAudit.title, /王宇錡/);
      assert.match(shareAudit.image, /storage\.test|og-image\.svg/);

      await page.goto(`${origin}/?share=${encodeURIComponent(shareAudit.slug)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => Boolean(window.cvStudioState && document.body.classList.contains("public-share-mode")),
        { timeout: 120000 }
      );
      const publicText = await page.$eval("#cvPaper", (node) => node.textContent || "");
      assert.match(publicText, /English summary with frontend/);
      assert.doesNotMatch(publicText, /等待 HR 回覆/);
      assert.doesNotMatch(publicText, /測試公司/);
    });

    await withStep("作品集素材庫與雲端附件", async () => {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(
        () => Boolean(window.cvStudioState && window.switchCvStudioTab),
        { timeout: 120000 }
      );
      await page.evaluate(async () => {
        window.localStorage.removeItem("cv-studio-auth-signed-out-v1");
        await window.__supabaseTest.emit("SIGNED_IN", {
          id: "smoke-user",
          email: "smoke@example.com",
          user_metadata: { full_name: "Smoke Tester" }
        });
        window.switchCvStudioTab("portfolio");
      });
      await page.waitForSelector("#page-portfolio.active");

      await page.$eval("#pfAssetNameInput", (node) => { node.value = "Cover Image"; });
      await page.$eval("#pfAssetUrlInput", (node) => { node.value = "https://example.com/cover.png"; });
      await page.$eval("#pfAddAssetUrlBtn", (node) => node.click());
      await page.waitForFunction(() => /Cover Image/.test(document.getElementById("pfAssetList")?.textContent || ""));
      await page.$eval("[data-pf-asset-cover]", (node) => node.click());
      await page.waitForFunction(() => document.getElementById("pfCoverImage")?.value === "https://example.com/cover.png");

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-smoke-asset-"));
      tempDirs.push(tempDir);
      const pdfPath = path.join(tempDir, "portfolio-evidence.pdf");
      fs.writeFileSync(pdfPath, "%PDF-1.4\\n% smoke portfolio evidence\\n");
      const fileInput = await page.$("#pfAssetFileInput");
      await fileInput.uploadFile(pdfPath);
      await page.waitForFunction(() => /素材已上傳並加入/.test(document.getElementById("pfAssetUploadStatus")?.textContent || ""));

      const assetAudit = await page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem("pf-studio-local-v4") || "{}");
        return {
          cover: stored.coverImageUrl,
          assetCount: stored.assets?.length || 0,
          uploads: window.__supabaseTest.uploads
        };
      });
      assert.equal(assetAudit.cover, "https://example.com/cover.png");
      assert.ok(assetAudit.assetCount >= 2, "素材庫應保存 URL 素材與上傳附件");
      assert.ok(assetAudit.uploads.some((item) => /portfolio-assets/.test(item.path)), "登入後附件應上傳到 Supabase Storage");
    });

    await withStep("Career 基本互動", async () => {
      await page.evaluate(() => {
        Object.assign(window.cvStudioState.data, {
          name: "測試學生",
          role: "前端工程師",
          summary: "熟悉網頁開發與介面優化。",
          skills: "JavaScript\nHTML\nCSS",
          importedPdfText: "PDF 原文：曾參與履歷匯入測試與求職顧問分析。",
          importedPdfFileName: "smoke-resume.pdf"
        });
        window.localStorage.setItem("cv-studio-local-v2", JSON.stringify(window.cvStudioState.data));
      });

      await page.evaluate(() => window.switchCvStudioTab("career"));
      await page.waitForSelector("#page-career.active");
      await page.waitForFunction(() => {
        const node = document.getElementById("careerCvSnippet");
        const text = node?.textContent || "";
        return node && /熟悉網頁開發與介面優化/.test(text) && !/smoke-resume\.pdf|PDF 原文/.test(text);
      });
      const uploadEntrypointsRemoved = await page.evaluate(() => {
        return Boolean(
          !document.getElementById("uploadCvPdfBtn") &&
          !document.getElementById("careerUploadCvBtn") &&
          !document.getElementById("importPdfInput") &&
          typeof window.openCvPdfImport === "undefined"
        );
      });
      assert.equal(uploadEntrypointsRemoved, true);

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

      await page.click(".career-mode-tab[data-mode='ops']");
      await page.waitForFunction(() => {
        const section = document.getElementById("careerOpsSection");
        const button = document.getElementById("careerAnalyzeBtn");
        return section && !section.hidden && button && /Career Ops/.test(button.textContent || "");
      });
      await page.$eval("#careerOpsImportInput", (node) => {
        node.value = `公司：Acme AI\n職稱：Frontend Engineer\n連結：https://example.com/jobs/frontend\n職責：Build dashboards with JavaScript, HTML, CSS, API integrations, accessibility, and analytics.\n要求：Frontend experience, product sense, ATS keyword optimization.\n---\n公司：DataWorks\n職稱：Product Analyst Intern\n職責：Analyze funnels, write SQL dashboards, collaborate with product and design.\n要求：SQL, communication, experimentation.`;
        node.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.click("#careerOpsImportBtn");
      await page.waitForFunction(() => {
        const area = document.getElementById("careerResultsArea");
        return area && /已匯入 2 筆職缺/.test(area.textContent || "") && /職缺總數\s*2/.test(area.textContent || "");
      });
      await page.$eval(".career-ops-status", (node) => {
        node.value = "觀望";
        node.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(() => /狀態已更新/.test(document.getElementById("careerResultsArea")?.textContent || ""));
      await page.click("[data-career-ops-action='fill']");
      await page.waitForFunction(() => {
        const section = document.getElementById("careerJdSection");
        const jd = document.getElementById("careerJdInput");
        return section && section.style.display !== "none" && /Acme AI|DataWorks/.test(jd?.value || "");
      });
    });

    await withStep("GSAT 雲端同步逾時 fallback", async () => {
      await page.evaluate(() => window.switchCvStudioTab("gsat"));
      await page.waitForSelector("#page-gsat.active");
      await page.evaluate(() => window.__supabaseTest.hangNextGsatSnapshotQuery());

      await page.$eval("#gsatScore國文", (node) => { node.value = "13"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore英文", (node) => { node.value = "13"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore數學A", (node) => { node.value = "15"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore社會", (node) => { node.value = "10"; node.dispatchEvent(new Event("input", { bubbles: true })); });
      await page.$eval("#gsatScore自然", (node) => { node.value = "13"; node.dispatchEvent(new Event("input", { bubbles: true })); });

      await page.$eval("#gsatAnalyzeBtn", (node) => node.click());
      await page.waitForFunction(() => /分析中/.test(document.getElementById("gsatResultsArea")?.textContent || ""), { timeout: 1000 });
      await page.waitForFunction(() => {
        const text = document.getElementById("gsatResultsArea")?.textContent || "";
        return /已輸入科目級分合計/.test(text) && /本地快照/.test(text);
      }, { timeout: 10000 });

      const buttonState = await page.$eval("#gsatAnalyzeBtn", (node) => ({
        disabled: node.disabled,
        text: node.textContent || ""
      }));
      assert.equal(buttonState.disabled, false);
      assert.match(buttonState.text, /開始落點分析/);
    });

    await withStep("GSAT 正向分析流程", async () => {
      await page.evaluate(() => window.switchCvStudioTab("gsat"));
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
      const resultText = await page.$eval("#gsatResultsArea", (node) => node.textContent || "");
      const scopeSummaryText = await page.$eval("#gsatDataScopeSummary", (node) => node.textContent || "");
      assert.match(sourceText, /本地快照/);
      assert.match(resultText, /指定科目|採計科目/);
      assert.match(resultText, /歷年篩選線|歷年均線/);
      assert.match(scopeSummaryText, /校系選項/);
      assert.doesNotMatch(resultText, /暫時沒有歷年切線/);
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
      const suggestionText = await page.$eval("#gsatResultsArea", (node) => node.textContent || "");
      assert.ok(actionCount >= 1, "無切線 fallback 應提供至少一個快速操作按鈕");
      assert.doesNotMatch(suggestionText, /土木工程學系|化學工程學系|材料科學與工程學系/);
    });

    await withStep("模板 placeholder 一致性", async () => {
      const audit = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const cvFields = ["name", "role", "email", "phone", "location", "website", "avatar", "summary", "skills", "highlights", "experience", "education", "projects", "awards"];
        const placeholderPattern = /^(姓名|職稱 \/ 角色|職稱|摘要|Email|電話|地點|網站 \/ 作品集|日期|職稱 \/ 名稱|單位 \/ 機構|內容說明)$/;

        window.switchCvStudioTab("cv");
        await wait(50);
        const cv = [];
        const templateIds = Array.from(document.querySelectorAll("[data-template-chip]")).map((node) => node.dataset.templateChip);
        for (const templateId of templateIds) {
          cvFields.forEach((field) => {
            window.cvStudioState.data[field] = "";
            const input = document.getElementById(field);
            if (input) input.value = "";
          });
          document.querySelector(`[data-template-chip="${CSS.escape(templateId)}"]`)?.click();
          await wait(15);
          const paper = document.getElementById("cvPaper");
          const actualPromptText = Array.from(paper.querySelectorAll('[contenteditable="true"][data-ph]'))
            .filter((node) => placeholderPattern.test((node.textContent || "").trim()))
            .map((node) => ({ field: node.dataset.field, text: (node.textContent || "").trim() }));
          const verticalContactPlaceholders = Array.from(paper.querySelectorAll('.contact-list [contenteditable="true"][data-ph]'))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight) || 16;
              return {
                field: node.dataset.field,
                placeholder: node.getAttribute("data-ph") || "",
                width: rect.width,
                height: rect.height,
                lineHeight
              };
            })
            .filter((item) => item.width < 48 || item.height > item.lineHeight * 1.8);
          cv.push({
            templateId,
            actualPromptText,
            verticalContactPlaceholders,
            overflowing: paper.scrollHeight > paper.clientHeight + 2 || paper.scrollWidth > paper.clientWidth + 2
          });
        }

        window.switchCvStudioTab("portfolio");
        await wait(50);
        const setInput = (selector, value) => {
          const input = document.querySelector(selector);
          if (!input) return;
          input.value = value;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        setInput("#pfTitle", "");
        setInput("#pfStudentName", "");
        setInput("#pfSchool", "");
        setInput("#pfCoverImage", "");
        setInput('[data-ch-title="0"]', "");
        setInput('[data-sec-hdr="0-0"]', "");
        setInput('[data-sec-body="0-0"]', "");
        setInput('[data-sec-img="0-0"]', "");
        setInput('[data-sec-cap="0-0"]', "");
        await wait(50);

        const portfolio = [];
        const themeIds = Array.from(document.querySelectorAll("[data-pf-theme]")).map((node) => node.dataset.pfTheme);
        for (const themeId of themeIds) {
          document.querySelector(`[data-pf-theme="${CSS.escape(themeId)}"]`)?.click();
          await wait(20);
          const area = document.getElementById("pfPreviewArea");
          const editables = Array.from(area.querySelectorAll(".pf-inline-editable"));
          const pagesOverflow = Array.from(area.querySelectorAll(".pf-page"))
            .map((pageNode, index) => ({
              index,
              overX: pageNode.scrollWidth > pageNode.clientWidth + 2,
              overY: pageNode.scrollHeight > pageNode.clientHeight + 2
            }))
            .filter((item) => item.overX || item.overY);
          portfolio.push({
            themeId,
            editableCount: editables.length,
            emptyEditableCount: editables.filter((node) => !(node.textContent || "").trim()).length,
            pagesOverflow
          });
        }

        return { cv, portfolio };
      });

      const badCv = audit.cv.filter((item) => item.actualPromptText.length || item.verticalContactPlaceholders.length || item.overflowing);
      assert.deepEqual(badCv, [], "CV 模板不得把 placeholder 當成實際文字，也不得溢出紙張");

      const badPortfolio = audit.portfolio.filter((item) => item.editableCount < 9 || item.pagesOverflow.length);
      assert.deepEqual(badPortfolio, [], "Portfolio 模板必須保留 inline placeholder，且不得溢出頁面");
    });

    assert.deepEqual(pageErrors, [], `頁面執行錯誤：\n${pageErrors.join("\n")}`);
    assert.deepEqual(consoleErrors, [], `瀏覽器 console error：\n${consoleErrors.join("\n")}`);

    log("\n[smoke] 全部通過");
  } finally {
    await browser.close();
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(`\n[smoke] 失敗：${error.message}`);
  process.exitCode = 1;
});
