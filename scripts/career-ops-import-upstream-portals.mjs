#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

const DEFAULT_PORTALS = "/tmp/career-ops-upstream/templates/portals.example.yml";
const DEFAULT_OUT = "data/career-ops-upstream-sources.json";
const DEFAULT_REPORT_OUT = "data/app/career-ops-upstream-sources-report.md";

function printHelp() {
  console.log(`Career Ops upstream portals importer

Converts santifer/career-ops portals.yml style templates into CV App worker
source JSON. This imports public upstream source definitions only; it does not
read private tracker, scan-history, or applications files from any user layer.

Usage:
  node scripts/career-ops-import-upstream-portals.mjs
  node scripts/career-ops-import-upstream-portals.mjs --portals /tmp/career-ops-upstream/templates/portals.example.yml

Options:
  --portals <file>       Upstream portals.yml or portals.example.yml. Default: ${DEFAULT_PORTALS}
  --out <file>           Worker source JSON output. Default: ${DEFAULT_OUT}
  --report-out <file>    Markdown report output. Default: ${DEFAULT_REPORT_OUT}
  --market <code>        Market label assigned to imported upstream sources. Default: upstream
  --include-company-pages
                         Also import non-ATS company pages for generic discovery.
                         Default skips them and keeps their scan_query as a signal.
  --include-disabled     Import entries with enabled: false
  --limit <n>            Limit imported sources after dedupe
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    portals: DEFAULT_PORTALS,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT_OUT,
    market: "upstream",
    includeCompanyPages: false,
    includeDisabled: false,
    limit: 0
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--portals") args.portals = argv[++i] || DEFAULT_PORTALS;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT_OUT;
    else if (token === "--market") args.market = String(argv[++i] || "upstream").trim().toLowerCase() || "upstream";
    else if (token === "--include-company-pages") args.includeCompanyPages = true;
    else if (token === "--include-disabled") args.includeDisabled = true;
    else if (token === "--limit") args.limit = Math.max(0, Number.parseInt(argv[++i] || "0", 10) || 0);
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function firstPathPart(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

function inferAdapter(entry) {
  const forced = cleanText(entry.provider || entry.adapter).toLowerCase();
  if (["greenhouse", "ashby", "lever", "workable", "smartrecruiters", "bamboohr", "workday", "oracle", "successfactors", "taleo"].includes(forced)) {
    return forced;
  }
  const url = normalizeUrl(entry.careers_url || entry.url);
  const api = normalizeUrl(entry.api || entry.apiUrl);
  const target = api || url;
  if (!target) return "";
  const parsed = new URL(target);
  const host = parsed.hostname.toLowerCase();
  if (host === "boards-api.greenhouse.io" || host.includes("greenhouse.io")) return "greenhouse";
  if (host === "api.ashbyhq.com" || host === "jobs.ashbyhq.com") return "ashby";
  if (host === "api.lever.co" || host === "api.eu.lever.co" || host === "jobs.lever.co" || host === "jobs.eu.lever.co") return "lever";
  if (host === "www.workable.com" || host === "apply.workable.com" || host.endsWith(".workable.com")) return "workable";
  if (host === "api.smartrecruiters.com" || host === "jobs.smartrecruiters.com") return "smartrecruiters";
  if (host.endsWith(".bamboohr.com")) return "bamboohr";
  if (host.endsWith("myworkdayjobs.com") || host.endsWith("myworkdaysite.com")) return "workday";
  if (host.endsWith("oraclecloud.com") || host.endsWith("oraclecloudapps.com")) return "oracle";
  if (host.includes("successfactors.com") || host.includes("jobs2web.com")) return "successfactors";
  if (host.endsWith("taleo.net")) return "taleo";
  return "";
}

function extractGreenhouseBoard(entry) {
  const api = normalizeUrl(entry.api || entry.apiUrl);
  const url = normalizeUrl(entry.careers_url || entry.url);
  const target = api || url;
  if (!target) return "";
  const parsed = new URL(target);
  if (parsed.hostname === "boards-api.greenhouse.io") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("boards");
    return index >= 0 ? parts[index + 1] || "" : "";
  }
  if (parsed.hostname.includes("greenhouse.io")) return firstPathPart(target);
  return "";
}

function extractLeverBoard(entry) {
  const url = normalizeUrl(entry.careers_url || entry.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname === "jobs.lever.co" || parsed.hostname === "jobs.eu.lever.co") return firstPathPart(url);
  return "";
}

function extractAshbyBoard(entry) {
  const url = normalizeUrl(entry.careers_url || entry.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname === "jobs.ashbyhq.com") return firstPathPart(url);
  return "";
}

function extractWorkableAccount(entry) {
  const url = normalizeUrl(entry.careers_url || entry.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname === "apply.workable.com") return firstPathPart(url);
  if (parsed.hostname.endsWith(".workable.com")) return parsed.hostname.split(".")[0] || "";
  return "";
}

function normalizeTitleFilter(config) {
  const filter = config?.title_filter || {};
  return {
    positive: Array.isArray(filter.positive) ? filter.positive.map(cleanText).filter(Boolean) : [],
    negative: Array.isArray(filter.negative) ? filter.negative.map(cleanText).filter(Boolean) : [],
    seniorityBoost: Array.isArray(filter.seniority_boost) ? filter.seniority_boost.map(cleanText).filter(Boolean) : []
  };
}

function normalizeSource(entry, args) {
  const url = normalizeUrl(entry.careers_url || entry.url);
  if (!url) return null;
  const adapter = inferAdapter(entry);
  const apiUrl = normalizeUrl(entry.api || entry.apiUrl);
  const source = {
    name: cleanText(entry.name),
    company: cleanText(entry.name),
    source: cleanText(entry.name),
    url,
    adapter,
    apiUrl: apiUrl || undefined,
    type: adapter ? adapter : "company",
    market: args.market,
    industry: "career-ops-upstream",
    tags: ["career-ops-upstream", adapter || "company"].filter(Boolean),
    sourceStrategy: "career-ops-upstream",
    discover: adapter ? undefined : true,
    maxDiscovered: adapter ? 250 : 40,
    notes: cleanText(entry.notes || entry.scan_query || "")
  };
  if (adapter === "greenhouse") source.boardToken = extractGreenhouseBoard(entry) || undefined;
  if (adapter === "lever") source.site = extractLeverBoard(entry) || undefined;
  if (adapter === "ashby") source.boardName = extractAshbyBoard(entry) || undefined;
  if (adapter === "workable") source.account = extractWorkableAccount(entry) || undefined;
  return source;
}

function normalizeSearchQueries(config, args) {
  const topLevelQueries = (Array.isArray(config?.search_queries) ? config.search_queries : [])
    .filter((item) => args.includeDisabled || item?.enabled !== false)
    .map((item) => ({
      market: args.market,
      name: cleanText(item?.name),
      query: cleanText(item?.query),
      source: "career-ops-upstream"
    }))
    .filter((item) => item.query);
  const companyQueries = (Array.isArray(config?.tracked_companies) ? config.tracked_companies : [])
    .filter((item) => args.includeDisabled || item?.enabled !== false)
    .map((item) => ({
      market: args.market,
      name: cleanText(item?.name) ? `${cleanText(item.name)} — scan query` : "Company scan query",
      query: cleanText(item?.scan_query),
      source: "career-ops-upstream-company"
    }))
    .filter((item) => item.query);
  const seen = new Set();
  return [...topLevelQueries, ...companyQueries].filter((item) => {
    const key = item.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = cleanText(item?.[key]) || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function countsTable(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");
}

function renderReport(payload, args, importedCount, skippedCount) {
  const adapterRows = countsTable(countBy(payload.sources, "adapter"));
  const sourceRows = payload.sources
    .slice(0, 160)
    .map((source) => `| ${source.name || "-"} | ${source.adapter || "company"} | ${source.url} |`)
    .join("\n");
  const queryRows = payload.searchQueries
    .slice(0, 80)
    .map((item) => `| ${item.name || "-"} | ${item.query.replace(/\|/g, "\\|")} |`)
    .join("\n");

  return `# Career Ops Upstream Sources Import

- Portals file: ${args.portals}
- Generated at: ${payload.generatedAt}
- Imported sources: ${payload.sourceCount}
- Skipped entries without URL: ${skippedCount}
- Enabled upstream entries considered: ${importedCount}
- Search query signals: ${payload.searchQueryCount}
- Company pages imported: ${args.includeCompanyPages ? "yes" : "no; non-ATS pages are preserved as search signals"}

## Sources by Adapter

| Adapter | Count |
|---|---:|
${adapterRows || "| - | 0 |"}

## Imported Sources

| Name | Adapter | URL |
|---|---|---|
${sourceRows || "| - | - | - |"}

${payload.sources.length > 160 ? `\n_Only first 160 sources shown; full inventory is in \`${args.out}\`._\n` : ""}

## Search Query Signals

These are preserved as strategy signals. The normal worker consumes source URLs;
query execution still needs a search adapter or an imported search-result file.

| Name | Query |
|---|---|
${queryRows || "| - | - |"}
`;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const raw = await fs.readFile(args.portals, "utf8");
  const config = yaml.load(raw);
  const titleFilter = normalizeTitleFilter(config);
  const sources = [];
  let importedCount = 0;
  let skippedCount = 0;
  const seen = new Set();
  for (const entry of Array.isArray(config?.tracked_companies) ? config.tracked_companies : []) {
    if (!args.includeDisabled && entry?.enabled === false) continue;
    importedCount += 1;
    const source = normalizeSource(entry, args);
    if (!source) {
      skippedCount += 1;
      continue;
    }
    if (!args.includeCompanyPages && !source.adapter) {
      skippedCount += 1;
      continue;
    }
    const key = source.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  const limitedSources = args.limit > 0 ? sources.slice(0, args.limit) : sources;
  const searchQueries = normalizeSearchQueries(config, args);
  const payload = {
    source: "career-ops-upstream-portals",
    generatedAt: new Date().toISOString(),
    upstreamPortals: args.portals,
    titleFilter,
    sourceCount: limitedSources.length,
    totalSourceCountBeforeLimit: sources.length,
    searchQueryCount: searchQueries.length,
    sources: limitedSources,
    searchQueries
  };

  await writeJson(args.out, payload);
  await writeText(args.reportOut, renderReport(payload, args, importedCount, skippedCount));
  console.log(`[career-ops] imported ${limitedSources.length}/${sources.length} upstream source(s)`);
  console.log(`[career-ops] preserved ${searchQueries.length} search query signal(s)`);
  console.log(`[career-ops] wrote ${args.out}`);
  console.log(`[career-ops] wrote ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
