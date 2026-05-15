#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STRATEGY = "data/career-ops-source-strategy.json";
const DEFAULT_OUT = "data/career-ops-search-sources.json";
const DEFAULT_REPORT = "data/app/career-ops-search-report.md";

function printHelp() {
  console.log(`Career Ops search adapter

Converts curated search results into worker-ready sources. This intentionally does
not scrape Google/Bing directly; feed it exported SERP JSON, copied result HTML,
or a plain text URL list from your search provider/browser workflow.

Usage:
  node scripts/career-ops-search-adapter.mjs --strategy data/career-ops-source-strategy.json --results data/raw/search-results.html
  node scripts/career-ops-search-adapter.mjs --results data/raw/serp.json --append data/career-ops-sources.json --out data/career-ops-sources.json

Options:
  --strategy <file>   Source strategy with searchQueries. Default: ${DEFAULT_STRATEGY}
  --results <file>    Search results file. Can be repeated. Supports JSON, HTML, or text.
  --append <file>     Existing sources JSON to merge with discovered search sources
  --out <file>        Output sources JSON. Default: ${DEFAULT_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --market <code>     Keep one market code. Can be repeated
  --limit <n>         Limit discovered search sources
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    strategy: DEFAULT_STRATEGY,
    results: [],
    append: "",
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT,
    markets: [],
    limit: 0
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--strategy") args.strategy = argv[++i] || DEFAULT_STRATEGY;
    else if (token === "--results") args.results.push(argv[++i] || "");
    else if (token === "--append") args.append = argv[++i] || "";
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--market") {
      const market = String(argv[++i] || "").trim().toLowerCase();
      if (market) args.markets.push(market);
    } else if (token === "--limit") {
      args.limit = Math.max(0, Number.parseInt(argv[++i] || "0", 10) || 0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function normalizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      url.searchParams.delete(key);
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function inferAdapter(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("greenhouse.io")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  if (host.includes("ashbyhq.com")) return "ashby";
  if (host.includes("workable.com")) return "workable";
  if (host.includes("smartrecruiters.com")) return "smartrecruiters";
  if (host.includes("bamboohr.com")) return "bamboohr";
  return "";
}

function inferType(url) {
  const parsed = new URL(url);
  const text = `${parsed.hostname} ${parsed.pathname}`.toLowerCase();
  if (/(\/job|\/jobs\/|\/position|\/opening|\/apply)/i.test(text)) return "job";
  return "company";
}

function flattenJson(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenJson(item, out));
    return out;
  }
  if (typeof value === "object") {
    for (const key of ["url", "link", "href", "jobUrl", "applyUrl"]) {
      if (value[key]) out.push(String(value[key]));
    }
    for (const item of Object.values(value)) flattenJson(item, out);
  }
  return out;
}

function extractUrls(text) {
  const decoded = decodeHtml(text);
  const urls = new Set();
  for (const match of decoded.matchAll(/https?:\/\/[^\s"'<>),，。]+/gi)) {
    const url = normalizeUrl(match[0]);
    if (url) urls.add(url);
  }
  for (const match of decoded.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const url = normalizeUrl(match[1]);
    if (url) urls.add(url);
  }
  return [...urls];
}

function includeMarket(item, markets) {
  if (!markets.length) return true;
  return markets.includes(String(item.market || "global").toLowerCase()) || markets.includes("all");
}

function searchQueries(strategy, markets) {
  const queries = Array.isArray(strategy.searchQueries) ? strategy.searchQueries : [];
  return queries
    .filter((item) => item?.enabled !== false)
    .filter((item) => includeMarket(item, markets))
    .map((item) => ({
      market: String(item.market || "global").toLowerCase(),
      query: String(item.query || "").trim()
    }))
    .filter((item) => item.query);
}

function sourceFromUrl(url, index, market = "global") {
  return {
    name: `Search Result ${index + 1}`,
    source: "Search adapter",
    url,
    type: inferType(url),
    adapter: inferAdapter(url),
    market,
    sourceStrategy: "search-result",
    tags: ["search-result"],
    maxDiscovered: inferType(url) === "company" ? 25 : undefined
  };
}

async function readJsonIfExists(filePath) {
  if (!filePath) return {};
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function readSearchUrls(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return flattenJson(JSON.parse(raw)).map(normalizeUrl).filter(Boolean);
  } catch {
    return extractUrls(raw);
  }
}

function mergeSources(existing, discovered) {
  const out = new Map();
  for (const source of [...existing, ...discovered]) {
    const url = normalizeUrl(source?.url);
    if (!url) continue;
    out.set(url.toLowerCase(), { ...source, url });
  }
  return [...out.values()];
}

function renderReport({ strategy, queries, discovered, outputSources }) {
  return `# Career Ops Search Adapter Report

- Strategy: ${strategy.name || ""}
- Search query signals: ${queries.length}
- Discovered search sources: ${discovered.length}
- Output source count: ${outputSources.length}

## Query Signals

${queries.map((item) => `- [${item.market}] ${item.query}`).join("\n") || "- None"}

## Discovered Sources

| Type | Adapter | URL |
|---|---|---|
${discovered.map((source) => `| ${source.type || "auto"} | ${source.adapter || "-"} | ${source.url} |`).join("\n") || "| - | - | - |"}
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
  const strategy = await readJsonIfExists(args.strategy);
  const queries = searchQueries(strategy, args.markets);
  const urls = [];
  for (const filePath of args.results) {
    urls.push(...await readSearchUrls(filePath));
  }
  const uniqueUrls = [...new Set(urls)].slice(0, args.limit > 0 ? args.limit : undefined);
  const defaultMarket = args.markets[0] || queries[0]?.market || "global";
  const discovered = uniqueUrls.map((url, index) => sourceFromUrl(url, index, defaultMarket));
  const appendPayload = await readJsonIfExists(args.append);
  const existing = Array.isArray(appendPayload.sources) ? appendPayload.sources : Array.isArray(appendPayload) ? appendPayload : [];
  const sources = mergeSources(existing, discovered);
  const payload = {
    source: "career-ops-search-adapter",
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    searchQueryCount: queries.length,
    sources,
    searchQueries: queries
  };
  await writeJson(args.out, payload);
  await writeText(args.reportOut, renderReport({ strategy, queries, discovered, outputSources: sources }));
  console.log(`[career-ops] search adapter wrote ${args.out}`);
  console.log(`[career-ops] ${discovered.length} discovered source(s), ${sources.length} output source(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
