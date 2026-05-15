#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCES = "data/career-ops-sources.json";
const DEFAULT_OUT = "data/career-ops-rendered-sources.json";
const DEFAULT_REPORT = "data/app/career-ops-rendered-discover-report.md";

function printHelp() {
  console.log(`Career Ops rendered discovery

Optional browser-rendered discovery for JavaScript-heavy company careers pages.
Requires puppeteer-core and a local browser executable path.

Usage:
  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/career-ops-rendered-discover.mjs --source data/career-ops-sources.json

Options:
  --source <file>     Source JSON with company/careers pages. Default: ${DEFAULT_SOURCES}
  --out <file>        Output discovered sources JSON. Default: ${DEFAULT_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --limit <n>         Limit pages to render. Default: 20
  --max-links <n>     Max discovered links per page. Default: 40
  --timeout <ms>      Navigation timeout. Default: 25000
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCES,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT,
    limit: 20,
    maxLinks: 40,
    timeout: 25000
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--source") args.source = argv[++i] || DEFAULT_SOURCES;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--limit") args.limit = Math.max(1, Number.parseInt(argv[++i] || "20", 10) || 20);
    else if (token === "--max-links") args.maxLinks = Math.max(1, Number.parseInt(argv[++i] || "40", 10) || 40);
    else if (token === "--timeout") args.timeout = Math.max(5000, Number.parseInt(argv[++i] || "25000", 10) || 25000);
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function normalizeUrl(value, base) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, base);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function jobLinkScore(url, text = "") {
  const parsed = new URL(url);
  const haystack = `${parsed.hostname} ${parsed.pathname} ${text}`.toLowerCase();
  let score = 0;
  if (/(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|myworkdayjobs\.com|myworkdaysite\.com|successfactors\.com|oraclecloud\.com|taleo\.net)/i.test(haystack)) score += 8;
  if (/(\/job|\/jobs|\/position|\/opening|\/apply|\/career|\/recruit)/i.test(haystack)) score += 5;
  if (/(engineer|developer|designer|manager|analyst|scientist|intern|frontend|backend|職缺|職位|工程師|實習)/i.test(haystack)) score += 4;
  if (/(privacy|terms|cookie|blog|news|press|linkedin|facebook|instagram|login|signin)/i.test(haystack)) score -= 8;
  return score;
}

function inferAdapter(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("greenhouse.io")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  if (host.includes("ashbyhq.com")) return "ashby";
  if (host.includes("workable.com")) return "workable";
  if (host.includes("smartrecruiters.com")) return "smartrecruiters";
  if (host.includes("bamboohr.com")) return "bamboohr";
  if (host.includes("myworkdayjobs.com") || host.includes("myworkdaysite.com")) return "workday";
  if (host.includes("successfactors.com") || host.includes("jobs2web.com")) return "successfactors";
  if (host.includes("oraclecloud.com")) return "oracle";
  if (host.includes("taleo.net")) return "taleo";
  return "";
}

async function readSources(filePath) {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
  const sources = Array.isArray(payload.sources) ? payload.sources : Array.isArray(payload) ? payload : [];
  return sources.filter((source) => source?.url && source.type !== "job").slice(0);
}

async function launchBrowser() {
  const executablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "";
  if (!executablePath) {
    throw new Error("Set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH to enable rendered discovery.");
  }
  const puppeteer = await import("puppeteer-core");
  return puppeteer.default.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

async function discoverFromPage(browser, source, args) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(args.timeout);
  await page.goto(source.url, { waitUntil: "networkidle2", timeout: args.timeout });
  const links = await page.$$eval("a[href]", (nodes) => nodes.map((node) => ({
    href: node.href,
    text: (node.textContent || "").trim().replace(/\s+/g, " ")
  })));
  await page.close();
  const seen = new Set();
  return links
    .map((link) => {
      const url = normalizeUrl(link.href, source.url);
      return url ? { url, text: link.text, score: jobLinkScore(url, link.text) } : null;
    })
    .filter(Boolean)
    .filter((link) => link.score >= 5)
    .sort((a, b) => b.score - a.score)
    .filter((link) => {
      const key = link.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, args.maxLinks)
    .map((link) => ({
      name: `${source.name || source.company || "Rendered"}: ${link.text || "job link"}`.slice(0, 160),
      source: source.source || source.name || "Rendered careers page",
      company: source.company || source.name || "",
      url: link.url,
      type: inferAdapter(link.url) ? "company" : "job",
      adapter: inferAdapter(link.url),
      market: source.market || "",
      industry: source.industry || "",
      tags: [...new Set([...(Array.isArray(source.tags) ? source.tags : []), "rendered-discovery"])],
      sourceStrategy: "rendered-discovery"
    }));
}

function mergeSources(sources) {
  const seen = new Map();
  for (const source of sources) {
    const url = normalizeUrl(source.url);
    if (!url) continue;
    seen.set(url.toLowerCase(), { ...source, url });
  }
  return [...seen.values()];
}

function renderReport(rows, errors) {
  return `# Career Ops Rendered Discovery Report

- Discovered sources: ${rows.length}
- Errors: ${errors.length}

## Discovered

| Company | Adapter | URL |
|---|---|---|
${rows.map((row) => `| ${row.company || row.source || "-"} | ${row.adapter || "-"} | ${row.url} |`).join("\n") || "| - | - | - |"}

## Errors

${errors.map((error) => `- ${error.url}: ${error.message}`).join("\n") || "- None"}
`;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const sources = (await readSources(args.source)).slice(0, args.limit);
  const browser = await launchBrowser();
  const rows = [];
  const errors = [];
  try {
    for (const source of sources) {
      try {
        const discovered = await discoverFromPage(browser, source, args);
        rows.push(...discovered);
        console.log(`[career-ops] rendered ${source.url} -> ${discovered.length} link(s)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ url: source.url, message });
        console.warn(`[career-ops] rendered ${source.url} failed: ${message}`);
      }
    }
  } finally {
    await browser.close();
  }
  const discoveredSources = mergeSources(rows);
  const payload = {
    source: "career-ops-rendered-discover",
    generatedAt: new Date().toISOString(),
    sourceCount: discoveredSources.length,
    sources: discoveredSources,
    errors
  };
  await writeJson(args.out, payload);
  await writeText(args.reportOut, renderReport(discoveredSources, errors));
  console.log(`[career-ops] rendered discovery wrote ${args.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
