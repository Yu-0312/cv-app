#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCES = "data/career-ops-sources.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_RULES = "data/career-ops-source-flex.json";
const DEFAULT_OUT = "data/career-ops-sources.json";
const DEFAULT_REPORT = "data/app/career-ops-source-flex-report.md";

function printHelp() {
  console.log(`Career Ops source flex expander

Expands a fixed source list into flexible candidates and search queries using
markets, role aliases, ATS domains, job boards, and company career URL patterns.

Usage:
  node scripts/career-ops-source-flex.mjs
  node scripts/career-ops-source-flex.mjs --market tw --market cn

Options:
  --sources <file>   Source JSON to expand. Default: ${DEFAULT_SOURCES}
  --profile <file>   Profile JSON. Default: ${DEFAULT_PROFILE}
  --rules <file>     Flex rules JSON. Default: ${DEFAULT_RULES}
  --out <file>       Output sources JSON. Default: ${DEFAULT_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --market <code>    Include one market. Can be repeated
  --limit <n>        Limit generated candidate sources. Default: 200
  --help             Show this help
`);
}

function parseArgs(argv) {
  const args = {
    sources: DEFAULT_SOURCES,
    profile: DEFAULT_PROFILE,
    rules: DEFAULT_RULES,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT,
    markets: [],
    limit: 200
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--sources") args.sources = argv[++i] || DEFAULT_SOURCES;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--rules") args.rules = argv[++i] || DEFAULT_RULES;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--market") {
      const market = String(argv[++i] || "").trim().toLowerCase();
      if (market) args.markets.push(market);
    } else if (token === "--limit") {
      args.limit = Math.max(1, Number.parseInt(argv[++i] || "200", 10) || 200);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
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
  if (host.includes("oraclecloud.com") || host.includes("taleo.net")) return host.includes("taleo.net") ? "taleo" : "oracle";
  if (host.includes("successfactors.com") || host.includes("jobs2web.com")) return "successfactors";
  return "";
}

function profileRoles(profile, rules) {
  const preferences = profile.preferences && typeof profile.preferences === "object" ? profile.preferences : {};
  const roles = [
    profile.role,
    profile.targetRole,
    ...array(preferences.targetRoles)
  ].map((item) => String(item || "").trim()).filter(Boolean);
  const expanded = new Set(roles);
  for (const role of roles) {
    for (const aliasGroup of array(rules.roleAliases)) {
      const text = [aliasGroup.canonical, ...array(aliasGroup.aliases)].join(" ").toLowerCase();
      if (text.includes(role.toLowerCase()) || role.toLowerCase().includes(String(aliasGroup.canonical || "").toLowerCase())) {
        expanded.add(aliasGroup.canonical);
        array(aliasGroup.aliases).forEach((alias) => expanded.add(alias));
      }
    }
  }
  return [...expanded].slice(0, 30);
}

function selectedMarkets(rules, args) {
  const markets = array(rules.markets);
  if (!args.markets.length) return markets;
  return markets.filter((market) => args.markets.includes(String(market.code || "").toLowerCase()));
}

function sourceKey(source) {
  return normalizeUrl(source.url).toLowerCase();
}

function buildFlexCandidates(existingSources, profile, rules, args) {
  const titleFilter = existingSources.titleFilter || {};
  const roles = profileRoles(profile, rules);
  const markets = selectedMarkets(rules, args);
  const candidates = [];

  for (const company of array(rules.companyDomains).filter((item) => item?.enabled !== false)) {
    for (const pattern of array(rules.careerPathPatterns)) {
      const url = normalizeUrl(`https://${company.domain}${pattern}`);
      if (!url) continue;
      candidates.push({
        name: `${company.name} ${pattern}`,
        company: company.name,
        source: company.name,
        url,
        type: "company",
        adapter: inferAdapter(url),
        market: company.market || "global",
        industry: company.industry || "",
        tags: ["flex-company-pattern"],
        sourceStrategy: "flex-company-pattern",
        titleFilter,
        maxDiscovered: 30
      });
    }
  }

  for (const market of markets) {
    for (const board of array(market.jobBoards)) {
      const url = normalizeUrl(board);
      if (!url) continue;
      candidates.push({
        name: `${market.code.toUpperCase()} job board ${new URL(url).hostname}`,
        source: "Source flex job board",
        url,
        type: "company",
        market: market.code,
        tags: ["flex-job-board"],
        sourceStrategy: "flex-job-board",
        titleFilter,
        maxDiscovered: 50
      });
    }
  }

  const searchQueries = [];
  for (const market of markets) {
    for (const role of roles) {
      for (const location of array(market.locations).slice(0, 5)) {
        searchQueries.push({ market: market.code, query: `${role} ${location} careers jobs` });
      }
      for (const domain of array(rules.atsDomains)) {
        searchQueries.push({ market: market.code, query: `site:${domain} ${role} ${array(market.locations)[0] || market.code}` });
      }
    }
  }

  const merged = new Map();
  for (const source of array(existingSources.sources)) {
    const key = sourceKey(source);
    if (key) merged.set(key, source);
  }
  for (const source of candidates.slice(0, args.limit)) {
    const key = sourceKey(source);
    if (key && !merged.has(key)) merged.set(key, source);
  }

  return {
    sources: [...merged.values()],
    generatedCandidates: candidates,
    searchQueries: [
      ...array(existingSources.searchQueries),
      ...searchQueries
    ].filter((item, index, list) => list.findIndex((other) => other.query === item.query && other.market === item.market) === index)
  };
}

function renderReport(payload, generatedCandidates) {
  return `# Career Ops Source Flex Report

- Generated at: ${payload.generatedAt}
- Total sources: ${payload.sourceCount}
- Flex candidates: ${generatedCandidates.length}
- Search queries: ${payload.searchQueryCount}

## Flex Candidates

| Strategy | Market | Name | URL |
|---|---|---|---|
${generatedCandidates.slice(0, 80).map((source) => `| ${source.sourceStrategy || "-"} | ${source.market || "-"} | ${source.name || "-"} | ${source.url} |`).join("\n") || "| - | - | - | - |"}

## Search Query Expansion

${payload.searchQueries.slice(0, 80).map((item) => `- [${item.market || "global"}] ${item.query}`).join("\n") || "- None"}
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
  const existingSources = await readJsonIfExists(args.sources);
  const profile = await readJsonIfExists(args.profile);
  const rules = await readJsonIfExists(args.rules);
  const expanded = buildFlexCandidates(existingSources, profile, rules, args);
  const payload = {
    ...existingSources,
    source: "career-ops-source-flex",
    generatedAt: new Date().toISOString(),
    sourceCount: expanded.sources.length,
    searchQueryCount: expanded.searchQueries.length,
    sources: expanded.sources,
    searchQueries: expanded.searchQueries
  };
  await writeJson(args.out, payload);
  await writeText(args.reportOut, renderReport(payload, expanded.generatedCandidates));
  console.log(`[career-ops] source flex ${expanded.sources.length} source(s), ${expanded.searchQueries.length} search query signal(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
