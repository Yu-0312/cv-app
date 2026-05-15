#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STRATEGY = "data/career-ops-source-strategy.json";
const DEFAULT_OUT = "data/career-ops-sources.json";
const DEFAULT_REPORT_OUT = "data/app/career-ops-source-strategy-report.md";

function printHelp() {
  console.log(`Career Ops source strategy builder

Build a worker-ready source file from a career-ops-style source strategy.

Usage:
  node scripts/career-ops-build-sources.mjs --strategy data/career-ops-source-strategy.example.json --out data/career-ops-sources.json
  node scripts/career-ops-build-sources.mjs --market tw --market cn

Options:
  --strategy <file>       Strategy JSON. Default: ${DEFAULT_STRATEGY}
  --out <file>            Worker source JSON output. Default: ${DEFAULT_OUT}
  --report-out <file>     Markdown report output. Default: ${DEFAULT_REPORT_OUT}
  --market <code>         Include one market code. Can be repeated. Default: all markets in strategy
  --include-disabled      Include sources with enabled: false
  --limit <n>             Limit source count after dedupe
  --help                  Show this help
`);
}

function parseArgs(argv) {
  const args = {
    strategy: DEFAULT_STRATEGY,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT_OUT,
    markets: [],
    includeDisabled: false,
    limit: 0
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--strategy") {
      args.strategy = argv[++i] || DEFAULT_STRATEGY;
    } else if (token === "--out") {
      args.out = argv[++i] || DEFAULT_OUT;
    } else if (token === "--report-out") {
      args.reportOut = argv[++i] || DEFAULT_REPORT_OUT;
    } else if (token === "--market") {
      const market = String(argv[++i] || "").trim().toLowerCase();
      if (market) args.markets.push(market);
    } else if (token === "--include-disabled") {
      args.includeDisabled = true;
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
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includeByMarket(item, selectedMarkets) {
  if (!selectedMarkets.length) return true;
  const market = String(item?.market || item?.region || "global").trim().toLowerCase();
  return selectedMarkets.includes(market) || selectedMarkets.includes("all");
}

function includeByEnabled(item, includeDisabled) {
  return includeDisabled || item?.enabled !== false;
}

function normalizeSource(item, group, strategy) {
  const url = normalizeUrl(item?.url || item?.href);
  if (!url) return null;
  const tags = [...new Set(asArray(item?.tags).map((tag) => String(tag || "").trim()).filter(Boolean))];
  return {
    name: String(item?.name || item?.company || "").trim(),
    company: String(item?.company || item?.name || "").trim(),
    source: String(item?.source || item?.name || item?.company || "").trim(),
    url,
    type: String(item?.type || item?.kind || "company").trim().toLowerCase(),
    adapter: String(item?.adapter || "").trim().toLowerCase(),
    apiUrl: item?.apiUrl || undefined,
    companyIdentifier: String(item?.companyIdentifier || "").trim() || undefined,
    board: String(item?.board || "").trim() || undefined,
    boardName: String(item?.boardName || "").trim() || undefined,
    boardToken: String(item?.boardToken || "").trim() || undefined,
    site: String(item?.site || "").trim() || undefined,
    slug: String(item?.slug || "").trim() || undefined,
    tenant: String(item?.tenant || item?.workdayTenant || "").trim() || undefined,
    workdayTenant: String(item?.workdayTenant || "").trim() || undefined,
    workdaySite: String(item?.workdaySite || "").trim() || undefined,
    siteNumber: String(item?.siteNumber || item?.oracleSiteNumber || "").trim() || undefined,
    oracleSiteNumber: String(item?.oracleSiteNumber || "").trim() || undefined,
    language: String(item?.language || item?.lang || "").trim() || undefined,
    searchText: String(item?.searchText || "").trim() || undefined,
    keyword: String(item?.keyword || "").trim() || undefined,
    appliedFacets: item?.appliedFacets && typeof item.appliedFacets === "object" ? item.appliedFacets : undefined,
    market: String(item?.market || item?.region || "global").trim().toLowerCase(),
    industry: String(item?.industry || "").trim(),
    tags,
    sourceStrategy: group,
    titleFilter: item?.titleFilter || strategy.titleFilter || undefined,
    discover: item?.discover === undefined ? undefined : Boolean(item.discover),
    maxDiscovered: Number.isFinite(Number(item?.maxDiscovered)) ? Math.max(0, Number(item.maxDiscovered)) : undefined,
    detailLimit: Number.isFinite(Number(item?.detailLimit)) ? Math.max(0, Number(item.detailLimit)) : undefined
  };
}

function collectSources(strategy, args) {
  const groups = [
    ["tracked-company", strategy.trackedCompanies],
    ["ats-board", strategy.atsBoards],
    ["direct-source", strategy.directSources],
    ["source", strategy.sources]
  ];

  const dedupe = new Map();
  for (const [group, list] of groups) {
    for (const item of asArray(list)) {
      if (!includeByEnabled(item, args.includeDisabled)) continue;
      if (!includeByMarket(item, args.markets)) continue;
      const source = normalizeSource(item, group, strategy);
      if (!source) continue;
      const key = source.url.toLowerCase();
      if (!dedupe.has(key)) dedupe.set(key, source);
    }
  }

  const sources = [...dedupe.values()];
  return args.limit > 0 ? sources.slice(0, args.limit) : sources;
}

function collectSearchQueries(strategy, args) {
  return asArray(strategy.searchQueries)
    .filter((item) => includeByEnabled(item, args.includeDisabled))
    .filter((item) => includeByMarket(item, args.markets))
    .map((item) => ({
      market: String(item?.market || "global").trim().toLowerCase(),
      query: String(item?.query || "").trim()
    }))
    .filter((item) => item.query);
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = String(item?.[key] || "unknown").trim() || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function tableFromCounts(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");
}

function sourceRow(source) {
  return `| ${source.market || "global"} | ${source.name || source.company || "-"} | ${source.sourceStrategy || "-"} | ${source.adapter || source.type || "auto"} | ${source.url} |`;
}

function renderReport(strategy, payload, args) {
  const marketCounts = tableFromCounts(countBy(payload.sources, "market"));
  const strategyCounts = tableFromCounts(countBy(payload.sources, "sourceStrategy"));
  const sourceRows = payload.sources.map(sourceRow).join("\n");
  const queryRows = payload.searchQueries
    .map((item) => `| ${item.market || "global"} | ${item.query} |`)
    .join("\n");
  const selectedMarkets = args.markets.length ? args.markets.join(", ") : "all";

  return `# Career Ops Source Strategy Report

- Strategy: ${strategy.name || path.basename(args.strategy)}
- Built at: ${payload.generatedAt}
- Markets: ${selectedMarkets}
- Sources: ${payload.sources.length}
- Search queries: ${payload.searchQueries.length}

## Sources by Market

| Market | Count |
|---|---:|
${marketCounts || "| - | 0 |"}

## Sources by Strategy Group

| Group | Count |
|---|---:|
${strategyCounts || "| - | 0 |"}

## Source Inventory

| Market | Name | Group | Adapter / Type | URL |
|---|---|---|---|---|
${sourceRows || "| - | - | - | - | - |"}

## Search Expansion Queries

These queries are intentionally kept as strategy signals. Add a search adapter or curated result import before turning them into crawl targets.

| Market | Query |
|---|---|
${queryRows || "| - | - |"}
`;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
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
  if (args.help) {
    printHelp();
    return;
  }

  const strategy = await readJson(args.strategy);
  const generatedAt = new Date().toISOString();
  const sources = collectSources(strategy, args);
  const searchQueries = collectSearchQueries(strategy, args);
  const payload = {
    source: "career-ops-source-strategy",
    strategyName: String(strategy.name || "").trim(),
    generatedAt,
    targetMarkets: args.markets.length ? args.markets : asArray(strategy.targetMarkets),
    titleFilter: strategy.titleFilter || {},
    sourceCount: sources.length,
    searchQueryCount: searchQueries.length,
    sources,
    searchQueries
  };

  await writeJson(args.out, payload);
  await writeText(args.reportOut, renderReport(strategy, payload, args));
  console.log(`[career-ops] wrote ${args.out}`);
  console.log(`[career-ops] wrote ${args.reportOut}`);
  console.log(`[career-ops] ${sources.length} source(s), ${searchQueries.length} search query signal(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
