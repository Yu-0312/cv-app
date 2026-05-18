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
markets, role aliases, ATS domains, job boards, explicit seed sources, and
company career URL patterns.

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
  --limit <n>        Limit generated candidate sources. Default: 400
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
    limit: 400
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
      args.limit = Math.max(1, Number.parseInt(argv[++i] || "400", 10) || 400);
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

function uniqueStrings(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const item of array(list)) {
      const text = String(item || "").trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
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
  if (host.includes("taiwanjobs.gov.tw")) return "taiwanjobs";
  if (host.includes("careers.tencent.com")) return "tencent";
  if (host.includes("mycareersfuture.gov.sg")) return "mycareersfuture";
  if (host.includes("remoteok.com")) return "remoteok";
  if (host.includes("remotive.com")) return "remotive";
  if (host.includes("arbeitnow.com")) return "arbeitnow";
  if (host.includes("themuse.com")) return "themuse";
  if (host.includes("meet.jobs")) return "meetjobs";
  if (host.includes("japan-dev.com")) return "japan-dev";
  if (host.includes("jrecin.jst.go.jp")) return "jrecin";
  if (host.includes("daijob.com")) return "daijob";
  if (host.includes("zhipin.com")) return "boss-zhipin";
  if (host.endsWith("58.com") || host.includes(".58.com")) return "58";
  if (host.endsWith("1111.com.tw") || host.includes(".1111.com.tw")) return "1111";
  if (/sitemap/i.test(url)) return "sitemap";
  return "";
}

function mergeTitleFilters(...filters) {
  const merged = {};
  for (const filter of filters) {
    if (!filter || typeof filter !== "object") continue;
    for (const [key, value] of Object.entries(filter)) {
      const values = uniqueStrings(merged[key], value);
      if (values.length) merged[key] = values;
    }
  }
  return merged;
}

function sourceTitleFilter(baseFilter, marketFilter, source) {
  const mode = String(source?.titleFilterMode || "").trim().toLowerCase();
  if (mode === "replace") return source?.titleFilter && typeof source.titleFilter === "object" ? source.titleFilter : {};
  if (mode === "market") return mergeTitleFilters(marketFilter, source?.titleFilter);
  return mergeTitleFilters(baseFilter, marketFilter, source?.titleFilter);
}

function marketByCode(rules) {
  return new Map(array(rules.markets).map((market) => [String(market.code || "").toLowerCase(), market]));
}

function replaceMarketTokens(value, market, marketCode) {
  if (typeof value !== "string") return value;
  const firstLocation = String(array(market?.locations)[0] || marketCode || "").trim();
  return value
    .replaceAll("{market}", marketCode)
    .replaceAll("{marketCode}", marketCode)
    .replaceAll("{location}", firstLocation);
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
        titleFilter: mergeTitleFilters(titleFilter, company.titleFilter),
        maxDiscovered: 30
      });
    }
  }

  const marketsByCode = marketByCode(rules);
  for (const seed of array(rules.sourceSeeds).filter((item) => item?.enabled !== false)) {
    const requestedMarkets = seed.markets !== undefined ? seed.markets : seed.market || "global";
    const marketCodes = uniqueStrings(requestedMarkets)
      .map((item) => item.toLowerCase())
      .filter((marketCode) => !args.markets.length || args.markets.includes(marketCode));
    for (const marketCode of marketCodes.length ? marketCodes : ["global"]) {
      const market = marketsByCode.get(marketCode) || { code: marketCode };
      const rawUrl = replaceMarketTokens(seed.url || "", market, marketCode);
      const normalizedUrl = normalizeUrl(rawUrl);
      if (!normalizedUrl) continue;
      let url = normalizedUrl;
      if (seed.scopeUrlByMarket !== false && marketCodes.length > 1) {
        const parsed = new URL(url);
        parsed.searchParams.set("cv_market", marketCode);
        url = parsed.href;
      }
      const name = replaceMarketTokens(seed.name || seed.company || "Seed source", market, marketCode);
      candidates.push({
        name: marketCode === "global" ? name : `${name} ${marketCode.toUpperCase()}`,
        company: replaceMarketTokens(seed.company || seed.name || "", market, marketCode),
        source: replaceMarketTokens(seed.source || seed.company || seed.name || "Source seed", market, marketCode),
        url,
        type: String(seed.type || "company").trim().toLowerCase(),
        adapter: String(seed.adapter || inferAdapter(url)).trim().toLowerCase(),
        apiUrl: replaceMarketTokens(seed.apiUrl || "", market, marketCode) || undefined,
        companyIdentifier: replaceMarketTokens(seed.companyIdentifier || "", market, marketCode) || undefined,
        board: replaceMarketTokens(seed.board || "", market, marketCode) || undefined,
        boardName: replaceMarketTokens(seed.boardName || "", market, marketCode) || undefined,
        boardToken: replaceMarketTokens(seed.boardToken || "", market, marketCode) || undefined,
        site: replaceMarketTokens(seed.site || "", market, marketCode) || undefined,
        slug: replaceMarketTokens(seed.slug || "", market, marketCode) || undefined,
        tenant: replaceMarketTokens(seed.tenant || seed.workdayTenant || "", market, marketCode) || undefined,
        workdayTenant: replaceMarketTokens(seed.workdayTenant || "", market, marketCode) || undefined,
        workdaySite: replaceMarketTokens(seed.workdaySite || "", market, marketCode) || undefined,
        siteNumber: replaceMarketTokens(seed.siteNumber || seed.oracleSiteNumber || "", market, marketCode) || undefined,
        oracleSiteNumber: replaceMarketTokens(seed.oracleSiteNumber || "", market, marketCode) || undefined,
        language: replaceMarketTokens(seed.language || seed.lang || "", market, marketCode) || undefined,
        searchText: replaceMarketTokens(seed.searchText || market.searchText || "", market, marketCode) || undefined,
        keyword: replaceMarketTokens(seed.keyword || "", market, marketCode) || undefined,
        jobUrlPattern: replaceMarketTokens(seed.jobUrlPattern || "", market, marketCode) || undefined,
        sitemapFilePattern: replaceMarketTokens(seed.sitemapFilePattern || "", market, marketCode) || undefined,
        appliedFacets: seed.appliedFacets && typeof seed.appliedFacets === "object" ? seed.appliedFacets : undefined,
        market: marketCode,
        industry: String(seed.industry || "").trim(),
        tags: uniqueStrings(seed.tags, ["flex-seed-source"]),
        sourceStrategy: seed.sourceStrategy || "flex-seed-source",
        titleFilter: sourceTitleFilter(titleFilter, market.titleFilter, seed),
        discover: seed.discover === undefined ? undefined : Boolean(seed.discover),
        maxDiscovered: Number.isFinite(Number(seed.maxDiscovered)) ? Math.max(0, Number(seed.maxDiscovered)) : 60,
        maxSitemapFiles: Number.isFinite(Number(seed.maxSitemapFiles)) ? Math.max(1, Number(seed.maxSitemapFiles)) : undefined,
        detailLimit: Number.isFinite(Number(seed.detailLimit)) ? Math.max(0, Number(seed.detailLimit)) : undefined
      });
    }
  }

  for (const market of markets) {
    for (const board of array(market.jobBoards)) {
      const normalizedUrl = normalizeUrl(board);
      if (!normalizedUrl) continue;
      let url = normalizedUrl;
      if (market.scopeJobBoardByMarket !== false) {
        const parsed = new URL(url);
        parsed.searchParams.set("cv_market", market.code);
        url = parsed.href;
      }
      candidates.push({
        name: `${market.code.toUpperCase()} job board ${new URL(url).hostname}`,
        source: "Source flex job board",
        url,
        type: "company",
        market: market.code,
        tags: ["flex-job-board"],
        sourceStrategy: "flex-job-board",
        titleFilter: mergeTitleFilters(titleFilter, market.titleFilter),
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
    if (key) {
      merged.set(key, {
        ...source,
        titleFilter: mergeTitleFilters(titleFilter, source.titleFilter)
      });
    }
  }
  for (const source of candidates.slice(0, args.limit)) {
    const key = sourceKey(source);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing || String(existing.sourceStrategy || "").startsWith("flex-")) {
      merged.set(key, source);
    }
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
- Target markets: ${array(payload.targetMarkets).join(", ") || "-"}
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
  existingSources.titleFilter = mergeTitleFilters(existingSources.titleFilter, rules.titleFilter);
  const expanded = buildFlexCandidates(existingSources, profile, rules, args);
  const targetMarkets = uniqueStrings(
    existingSources.targetMarkets,
    expanded.sources.map((source) => source.market),
    expanded.searchQueries.map((query) => query.market)
  );
  const payload = {
    ...existingSources,
    source: "career-ops-source-flex",
    generatedAt: new Date().toISOString(),
    targetMarkets,
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
