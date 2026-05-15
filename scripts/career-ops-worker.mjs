#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { resolveSourceAdapter } from "./career-ops-source-adapters.mjs";

const DEFAULT_JSON_OUT = "data/app/career-ops-jobs.json";
const DEFAULT_JS_OUT = "data/app/career-ops-jobs.js";
const DEFAULT_TIMEOUT_MS = 18000;

function printHelp() {
  console.log(`Career Ops worker

Fetch public job pages, extract JobPosting / meta data, and build a frontend snapshot.

Usage:
  node scripts/career-ops-worker.mjs --source data/career-ops-sources.json
  node scripts/career-ops-worker.mjs --url https://example.com/job --url https://example.com/another-job
  node scripts/career-ops-worker.mjs --url https://example.com/careers --max-discovered 40
  node scripts/career-ops-worker.mjs --url https://boards.greenhouse.io/example

Options:
  --source <file>      JSON source file. Supports {"sources":[{"name","url"}]} or {"urls":[]}
  --url <url>          Add one public job URL. Can be repeated.
  --json-out <file>    Output normalized JSON. Default: ${DEFAULT_JSON_OUT}
  --js-out <file>      Output browser JS snapshot. Default: ${DEFAULT_JS_OUT}
  --previous <file>    Previous snapshot for new/expired lifecycle detection. Default: json-out if it exists
  --include-expired    Keep expired jobs from the previous snapshot in the new output
  --limit <n>          Maximum URLs to fetch
  --max-discovered <n> Maximum job links to expand per company/careers page. Default: 25
  --no-discover        Do not expand likely job links from company careers pages
  --timeout <ms>       Per-request timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --help              Show this help

Notes:
  This worker fetches public pages only. Greenhouse, Lever, Ashby, Workable,
  SmartRecruiters, BambooHR, Workday, and Oracle run through source adapters in
  this worker, not frontend scraping code. Generic company
  careers pages still use link discovery. Login-only portals and authenticated
  search-result crawling should be implemented as explicit adapters so credentials,
  rate limits, and platform terms can be handled intentionally.
`);
}

function parseArgs(argv) {
  const args = {
    urls: [],
    source: "",
    jsonOut: DEFAULT_JSON_OUT,
    jsOut: DEFAULT_JS_OUT,
    previous: "",
    includeExpired: false,
    limit: 0,
    discover: true,
    maxDiscovered: 25,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--source") {
      args.source = argv[++i] || "";
    } else if (token === "--url") {
      args.urls.push(argv[++i] || "");
    } else if (token === "--json-out") {
      args.jsonOut = argv[++i] || DEFAULT_JSON_OUT;
    } else if (token === "--js-out") {
      args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    } else if (token === "--previous") {
      args.previous = argv[++i] || "";
    } else if (token === "--include-expired") {
      args.includeExpired = true;
    } else if (token === "--limit") {
      args.limit = Math.max(0, Number.parseInt(argv[++i] || "0", 10) || 0);
    } else if (token === "--max-discovered") {
      args.maxDiscovered = Math.max(0, Number.parseInt(argv[++i] || "25", 10) || 25);
    } else if (token === "--discover") {
      args.discover = true;
    } else if (token === "--no-discover") {
      args.discover = false;
    } else if (token === "--timeout") {
      args.timeoutMs = Math.max(3000, Number.parseInt(argv[++i] || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS);
    } else if (/^https?:\/\//i.test(token)) {
      args.urls.push(token);
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

function stableJobKey(job) {
  const url = normalizeUrl(job?.url || "");
  if (url) {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      parsed.searchParams.delete(key);
    }
    return `url:${parsed.href.toLowerCase()}`;
  }
  return `text:${[
    job?.company,
    job?.title,
    job?.location
  ].map((item) => String(item || "").trim().toLowerCase()).join("|")}`;
}

async function readPreviousSnapshot(filePath) {
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readSourceFile(filePath) {
  if (!filePath) return [];
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const globalTitleFilter = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed.titleFilter || {}
    : {};
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.sources)
      ? parsed.sources
      : Array.isArray(parsed.urls)
        ? parsed.urls
        : [];

  return list.map((item) => {
    if (typeof item === "string") return { url: item, titleFilter: globalTitleFilter };
    return {
      name: String(item?.name || "").trim(),
      url: item?.url || item?.href || "",
      source: String(item?.source || item?.site || item?.name || "").trim(),
      adapter: String(item?.adapter || "").trim().toLowerCase(),
      company: String(item?.company || "").trim(),
      companyIdentifier: String(item?.companyIdentifier || "").trim(),
      board: String(item?.board || "").trim(),
      boardName: String(item?.boardName || "").trim(),
      boardToken: String(item?.boardToken || "").trim(),
      site: String(item?.site || "").trim(),
      slug: String(item?.slug || "").trim(),
      tenant: String(item?.tenant || item?.workdayTenant || "").trim(),
      workdayTenant: String(item?.workdayTenant || "").trim(),
      workdaySite: String(item?.workdaySite || "").trim(),
      siteNumber: String(item?.siteNumber || item?.oracleSiteNumber || "").trim(),
      oracleSiteNumber: String(item?.oracleSiteNumber || "").trim(),
      language: String(item?.language || item?.lang || "").trim(),
      searchText: String(item?.searchText || "").trim(),
      keyword: String(item?.keyword || "").trim(),
      appliedFacets: item?.appliedFacets && typeof item.appliedFacets === "object" ? item.appliedFacets : undefined,
      region: String(item?.region || "").trim().toLowerCase(),
      apiUrl: item?.apiUrl || "",
      type: String(item?.type || item?.kind || "auto").trim().toLowerCase(),
      market: String(item?.market || item?.region || "").trim().toLowerCase(),
      industry: String(item?.industry || "").trim(),
      tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
      sourceStrategy: String(item?.sourceStrategy || "").trim(),
      titleFilter: item?.titleFilter || globalTitleFilter,
      discover: item?.discover === undefined ? undefined : Boolean(item.discover),
      maxDiscovered: Number.isFinite(Number(item?.maxDiscovered)) ? Math.max(0, Number(item.maxDiscovered)) : undefined,
      detailLimit: Number.isFinite(Number(item?.detailLimit)) ? Math.max(0, Number(item.detailLimit)) : undefined
    };
  });
}

function uniqueSources(sources) {
  const seen = new Set();
  const next = [];
  for (const source of sources) {
    const url = normalizeUrl(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    next.push({ ...source, url });
  }
  return next;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CV-Studio-Career-Ops/1.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CV-Studio-Career-Ops/1.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeHtml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim());
}

function getMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i");
  return decodeHtml((html.match(pattern) || html.match(reversePattern) || [])[1] || "");
}

function getTitle(html) {
  return decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectJobPostingNodes(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectJobPostingNodes(item, out));
    return out;
  }
  if (typeof value !== "object") return out;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item || "").toLowerCase() === "jobposting")) {
    out.push(value);
  }
  if (Array.isArray(value["@graph"])) collectJobPostingNodes(value["@graph"], out);
  return out;
}

function extractJsonLdJobs(html) {
  const jobs = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const parsed = safeJsonParse(decodeHtml(match[1]).trim());
    collectJobPostingNodes(parsed, jobs);
  }
  return jobs;
}

function extractAnchorLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] || "";
    const href = (attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const url = new URL(decodeHtml(href), baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      links.push({
        url: url.href,
        text: stripHtml(match[2] || "").replace(/\s+/g, " ").trim()
      });
    } catch {}
  }
  return links;
}

function jobLinkScore(link) {
  const url = normalizeUrl(link.url);
  if (!url) return -100;
  const parsed = new URL(url);
  const text = `${link.text || ""} ${parsed.hostname} ${parsed.pathname}`.toLowerCase();
  let score = 0;

  if (/(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|jobs\.ashbyhq\.com)/i.test(url)) score += 6;
  if (/(\/jobs?\/|\/careers?\/|\/positions?\/|\/openings?\/|\/recruit|\/join-us|\/job-detail|\/job_post|\/apply)/i.test(parsed.pathname)) score += 4;
  if (/(engineer|developer|designer|manager|analyst|scientist|specialist|intern|frontend|backend|full[- ]?stack|product|marketing|sales|operations|職缺|職位|工程師|設計師|分析師|實習|招募|加入|工作)/i.test(text)) score += 4;
  if (/(privacy|terms|policy|cookie|blog|news|press|about|contact|login|signin|signup|facebook|instagram|twitter|linkedin\.com\/company)/i.test(text)) score -= 8;
  if (parsed.hash && !parsed.pathname.replace(/\/+$/, "")) score -= 4;

  return score;
}

function discoverJobLinks(html, baseUrl, maxLinks) {
  const seen = new Set();
  return extractAnchorLinks(html, baseUrl)
    .map((link) => ({ ...link, score: jobLinkScore(link) }))
    .filter((link) => link.score >= 4)
    .sort((a, b) => b.score - a.score)
    .filter((link) => {
      const key = normalizeUrl(link.url).replace(/#.*$/, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      link.url = key;
      return true;
    })
    .slice(0, maxLinks);
}

function firstText(value) {
  if (Array.isArray(value)) return firstText(value[0]);
  if (value && typeof value === "object") return value.name || value.text || value["@id"] || "";
  return String(value || "");
}

function normalizeLocation(value) {
  if (Array.isArray(value)) return value.map(normalizeLocation).filter(Boolean).join(" / ");
  if (!value || typeof value !== "object") return firstText(value);
  const address = value.address && typeof value.address === "object" ? value.address : {};
  return [
    address.addressLocality,
    address.addressRegion,
    address.addressCountry?.name || address.addressCountry
  ].map(firstText).filter(Boolean).join(", ");
}

function normalizeJobFromJsonLd(node, pageUrl, source = "") {
  const company = firstText(node.hiringOrganization || node.organization);
  const description = stripHtml(node.description || node.responsibilities || node.qualifications || "");
  return normalizeJob({
    source,
    sourceType: "json-ld",
    title: firstText(node.title),
    company,
    url: normalizeUrl(node.url) || pageUrl,
    location: normalizeLocation(node.jobLocation || node.applicantLocationRequirements),
    description,
    datePosted: firstText(node.datePosted),
    validThrough: firstText(node.validThrough),
    employmentType: Array.isArray(node.employmentType) ? node.employmentType.join(", ") : firstText(node.employmentType)
  });
}

function normalizeJob(job) {
  const normalized = {
    source: String(job.source || "").trim(),
    sourceType: String(job.sourceType || "").trim(),
    title: String(job.title || "").trim().slice(0, 180) || "未命名職缺",
    company: String(job.company || "").trim().slice(0, 160),
    url: normalizeUrl(job.url),
    location: String(job.location || "").trim().slice(0, 160),
    description: String(job.description || "").trim().slice(0, 24000),
    datePosted: String(job.datePosted || "").trim().slice(0, 80),
    validThrough: String(job.validThrough || "").trim().slice(0, 80),
    employmentType: String(job.employmentType || "").trim().slice(0, 120),
    firstSeenAt: String(job.firstSeenAt || "").trim(),
    lastSeenAt: String(job.lastSeenAt || "").trim(),
    isNew: Boolean(job.isNew),
    isExpired: Boolean(job.isExpired),
    expiredAt: String(job.expiredAt || "").trim(),
    jobKey: String(job.jobKey || "").trim(),
    sourceMarket: String(job.sourceMarket || "").trim().toLowerCase(),
    sourceIndustry: String(job.sourceIndustry || "").trim(),
    sourceStrategy: String(job.sourceStrategy || "").trim(),
    sourceTags: Array.isArray(job.sourceTags) ? job.sourceTags.map((tag) => String(tag || "").trim()).filter(Boolean) : []
  };
  normalized.jobKey = normalized.jobKey || stableJobKey(normalized);
  return normalized;
}

function fallbackJobFromHtml(html, pageUrl, source = "", sourceType = "meta") {
  const title = getMeta(html, "og:title") || getTitle(html);
  const description = getMeta(html, "description") || getMeta(html, "og:description");
  return normalizeJob({
    source,
    sourceType,
    title,
    company: getMeta(html, "og:site_name"),
    url: pageUrl,
    description: stripHtml(description)
  });
}

function dedupeJobs(jobs) {
  const seen = new Set();
  const next = [];
  for (const job of jobs) {
    const key = stableJobKey(job);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(job);
  }
  return next;
}

function normalizeTermList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((term) => String(term || "").trim().toLowerCase()).filter(Boolean);
}

function containsAnyTerm(text, terms) {
  if (!terms.length) return false;
  const haystack = String(text || "").toLowerCase();
  return terms.some((term) => {
    if (!term) return false;
    if (/^[a-z0-9][a-z0-9 +#.-]*[a-z0-9]$/i.test(term)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
    }
    return haystack.includes(term);
  });
}

function passesJobFilter(job, filter = {}) {
  const title = String(job?.title || "");
  const location = String(job?.location || "");
  const allText = [
    job?.title,
    job?.company,
    job?.location,
    job?.employmentType,
    job?.description
  ].join("\n");

  const positive = normalizeTermList(filter.positive);
  const negative = normalizeTermList(filter.negative);
  const titlePositive = normalizeTermList(filter.titlePositive);
  const titleNegative = normalizeTermList(filter.titleNegative);
  const locationPositive = normalizeTermList(filter.locationPositive);
  const locationNegative = normalizeTermList(filter.locationNegative);

  if (positive.length && !containsAnyTerm(allText, positive)) return false;
  if (negative.length && containsAnyTerm(allText, negative)) return false;
  if (titlePositive.length && !containsAnyTerm(title, titlePositive)) return false;
  if (titleNegative.length && containsAnyTerm(title, titleNegative)) return false;
  if (locationPositive.length && !containsAnyTerm(location, locationPositive)) return false;
  if (locationNegative.length && containsAnyTerm(location, locationNegative)) return false;
  return true;
}

function enrichJobWithSource(job, source) {
  return normalizeJob({
    ...job,
    sourceMarket: source.market,
    sourceIndustry: source.industry,
    sourceStrategy: source.sourceStrategy,
    sourceTags: source.tags
  });
}

function applyJobLifecycle(currentJobs, previousSnapshot, options) {
  const now = new Date().toISOString();
  const previousJobs = Array.isArray(previousSnapshot?.jobs) ? previousSnapshot.jobs.map(normalizeJob) : [];
  const previousByKey = new Map(previousJobs.map((job) => [job.jobKey || stableJobKey(job), job]));
  const currentKeys = new Set();
  const active = currentJobs.map((job) => {
    const normalized = normalizeJob(job);
    const key = normalized.jobKey || stableJobKey(normalized);
    currentKeys.add(key);
    const previous = previousByKey.get(key);
    return normalizeJob({
      ...normalized,
      jobKey: key,
      firstSeenAt: previous?.firstSeenAt || normalized.firstSeenAt || now,
      lastSeenAt: now,
      isNew: !previous,
      isExpired: false,
      expiredAt: ""
    });
  });

  if (!options.includeExpired) return active;

  const expired = previousJobs
    .filter((job) => !currentKeys.has(job.jobKey || stableJobKey(job)))
    .map((job) => normalizeJob({
      ...job,
      isNew: false,
      isExpired: true,
      expiredAt: job.expiredAt || now
    }));
  return [...active, ...expired];
}

function shouldDiscoverFromSource(source, options, jsonLdJobs) {
  if (!options.discover || source.discover === false) return false;
  if (source.type === "job" || source.type === "job-page") return false;
  if (source.type === "company" || source.type === "careers" || source.type === "career-page" || source.discover === true) return true;
  return jsonLdJobs.length === 0;
}

async function scrapeJobPage(source, options, sourceType = "job-page") {
  const html = await fetchText(source.url, options.timeoutMs);
  const jsonLdJobs = extractJsonLdJobs(html).map((node) => normalizeJobFromJsonLd(node, source.url, source.source || source.name));
  const jobs = jsonLdJobs.length ? jsonLdJobs : [fallbackJobFromHtml(html, source.url, source.source || source.name, sourceType)];
  return jobs.filter((job) => job.title || job.description || job.url);
}

async function scrapeSource(source, options) {
  const adapter = resolveSourceAdapter(source);
  if (adapter) {
    const jobs = await adapter.scrape(source, options, {
      fetchText,
      fetchJson,
      normalizeJob,
      normalizeJobFromJsonLd,
      extractJsonLdJobs,
      discoverJobLinks,
      scrapeJobPage,
      stripHtml
    });
    console.log(`[career-ops] adapter:${adapter.id} ${source.url} -> ${jobs.length} job(s)`);
    return jobs.filter((job) => job.title || job.description || job.url);
  }

  const html = await fetchText(source.url, options.timeoutMs);
  const sourceName = source.source || source.name;
  const jsonLdJobs = extractJsonLdJobs(html).map((node) => normalizeJobFromJsonLd(node, source.url, sourceName));
  const shouldDiscover = shouldDiscoverFromSource(source, options, jsonLdJobs);
  const maxLinks = Math.max(0, Number(source.maxDiscovered ?? options.maxDiscovered ?? 25));

  if (shouldDiscover && maxLinks > 0) {
    const links = discoverJobLinks(html, source.url, maxLinks);
    if (links.length) {
      const jobs = [...jsonLdJobs];
      for (const link of links) {
        try {
          const extracted = await scrapeJobPage({ ...source, url: link.url, source: sourceName }, options, "discovered-link");
          jobs.push(...extracted);
          console.log(`[career-ops] discovered ${link.url} -> ${extracted.length} job(s)`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[career-ops] discovered ${link.url} failed: ${message}`);
        }
      }
      if (jobs.length) return jobs;
    }
  }

  if (jsonLdJobs.length) return jsonLdJobs;
  if (source.type === "company" || source.type === "careers" || source.type === "career-page") return [];
  return [fallbackJobFromHtml(html, source.url, sourceName)].filter((job) => job.title || job.description || job.url);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeJs(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `window.CV_CAREER_OPS_JOBS = ${JSON.stringify(data, null, 2)};\n`,
    "utf8"
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const fileSources = await readSourceFile(args.source);
  const cliSources = args.urls.map((url) => ({ url }));
  let sources = uniqueSources([...fileSources, ...cliSources]);
  if (args.limit > 0) sources = sources.slice(0, args.limit);
  if (!sources.length) {
    throw new Error("No sources provided. Use --source <file> or --url <url>. Run with --help for examples.");
  }

  const jobs = [];
  const errors = [];
  for (const source of sources) {
    try {
      const extracted = await scrapeSource(source, args);
      const filtered = extracted
        .filter((job) => passesJobFilter(job, source.titleFilter))
        .map((job) => enrichJobWithSource(job, source));
      jobs.push(...filtered);
      const skipped = extracted.length - filtered.length;
      const filterNote = skipped > 0 ? `, ${skipped} filtered` : "";
      console.log(`[career-ops] ${source.url} -> ${filtered.length} job(s)${filterNote}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ url: source.url, message });
      console.warn(`[career-ops] ${source.url} failed: ${message}`);
    }
  }

  const previousSnapshot = await readPreviousSnapshot(args.previous || args.jsonOut);
  const lifecycleJobs = dedupeJobs(applyJobLifecycle(dedupeJobs(jobs), previousSnapshot, args));
  const payload = {
    source: "career-ops-worker",
    extractedAt: new Date().toISOString(),
    sourceCount: sources.length,
    jobCount: lifecycleJobs.filter((job) => !job.isExpired).length,
    newJobCount: lifecycleJobs.filter((job) => job.isNew && !job.isExpired).length,
    expiredJobCount: lifecycleJobs.filter((job) => job.isExpired).length,
    jobs: lifecycleJobs,
    errors
  };

  await writeJson(args.jsonOut, payload);
  await writeJs(args.jsOut, payload);
  console.log(`[career-ops] wrote ${args.jsonOut}`);
  console.log(`[career-ops] wrote ${args.jsOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
