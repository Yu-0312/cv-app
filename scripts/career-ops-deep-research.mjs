#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_SOURCES = "data/career-ops-sources.json";
const DEFAULT_OUT = "data/app/career-ops-deep-research.json";
const DEFAULT_JS_OUT = "data/app/career-ops-deep-research.js";
const DEFAULT_REPORT = "data/app/career-ops-deep-research.md";

function printHelp() {
  console.log(`Career Ops deep research

Builds company/job research dossiers from ranked jobs, source strategy, public job
pages, and optional search APIs.

Search providers:
  - BRAVE_SEARCH_API_KEY  -> --search-provider brave
  - BING_SEARCH_API_KEY   -> --search-provider bing
  - SERPAPI_API_KEY       -> --search-provider serpapi

Usage:
  node scripts/career-ops-deep-research.mjs --search-provider brave
  node scripts/career-ops-deep-research.mjs --query "TSMC frontend engineer Taiwan"

Options:
  --jobs <file>             Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>          Profile JSON. Default: ${DEFAULT_PROFILE}
  --sources <file>          Source JSON. Default: ${DEFAULT_SOURCES}
  --out <file>              JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>           Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file>       Markdown report. Default: ${DEFAULT_REPORT}
  --search-provider <name>  brave, bing, serpapi, auto, or none. Default: auto
  --query <text>            Extra research query. Can be repeated
  --top <n>                 Number of ranked jobs/companies to research. Default: 8
  --per-query <n>           Results per query. Default: 5
  --timeout <ms>            Per-request timeout. Default: 15000
  --no-js                   Skip browser JS output
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: DEFAULT_PROFILE,
    sources: DEFAULT_SOURCES,
    out: DEFAULT_OUT,
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    searchProvider: "auto",
    queries: [],
    top: 8,
    perQuery: 5,
    timeout: 15000,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--sources") args.sources = argv[++i] || DEFAULT_SOURCES;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--search-provider") args.searchProvider = String(argv[++i] || "auto").toLowerCase();
    else if (token === "--query") args.queries.push(argv[++i] || "");
    else if (token === "--top") args.top = Math.max(1, Number.parseInt(argv[++i] || "8", 10) || 8);
    else if (token === "--per-query") args.perQuery = Math.max(1, Number.parseInt(argv[++i] || "5", 10) || 5);
    else if (token === "--timeout") args.timeout = Math.max(3000, Number.parseInt(argv[++i] || "15000", 10) || 15000);
    else if (token === "--no-js") args.writeJs = false;
    else throw new Error(`Unknown argument: ${token}`);
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
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "CV-Studio-Career-Ops-Research/1.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function pickSearchProvider(requested) {
  if (requested === "none") return "none";
  if ((requested === "auto" || requested === "brave") && process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if ((requested === "auto" || requested === "bing") && process.env.BING_SEARCH_API_KEY) return "bing";
  if ((requested === "auto" || requested === "serpapi") && process.env.SERPAPI_API_KEY) return "serpapi";
  return requested === "auto" ? "none" : requested;
}

async function fetchJson(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchWeb(query, provider, args) {
  if (!query || provider === "none") return [];
  if (provider === "brave") {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(args.perQuery));
    const data = await fetchJson(url.href, {
      headers: {
        "accept": "application/json",
        "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY || ""
      }
    }, args.timeout);
    return array(data.web?.results).map((item) => ({
      title: item.title || "",
      url: normalizeUrl(item.url),
      snippet: item.description || "",
      provider
    })).filter((item) => item.url);
  }
  if (provider === "bing") {
    const url = new URL("https://api.bing.microsoft.com/v7.0/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(args.perQuery));
    const data = await fetchJson(url.href, {
      headers: {
        "accept": "application/json",
        "Ocp-Apim-Subscription-Key": process.env.BING_SEARCH_API_KEY || ""
      }
    }, args.timeout);
    return array(data.webPages?.value).map((item) => ({
      title: item.name || "",
      url: normalizeUrl(item.url),
      snippet: item.snippet || "",
      provider
    })).filter((item) => item.url);
  }
  if (provider === "serpapi") {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", process.env.SERPAPI_API_KEY || "");
    url.searchParams.set("num", String(args.perQuery));
    const data = await fetchJson(url.href, { headers: { "accept": "application/json" } }, args.timeout);
    return array(data.organic_results).map((item) => ({
      title: item.title || "",
      url: normalizeUrl(item.link),
      snippet: item.snippet || "",
      provider
    })).filter((item) => item.url);
  }
  throw new Error(`Search provider "${provider}" is not configured. Use auto/none or set the matching API key.`);
}

function rankedJobs(payload, top) {
  return array(payload.jobs)
    .filter((job) => !job.isExpired)
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, top);
}

function buildQueries(jobs, profile, extraQueries) {
  const role = String(profile.role || array(profile.preferences?.targetRoles)[0] || "").trim();
  const queries = [];
  for (const job of jobs) {
    const company = String(job.company || "").trim();
    const title = String(job.title || role || "").trim();
    if (company) {
      queries.push(`${company} ${title} careers team product funding interview`);
      queries.push(`${company} compensation culture engineering interview`);
    }
  }
  queries.push(...extraQueries);
  return [...new Set(queries.map((item) => String(item || "").trim()).filter(Boolean))];
}

function sourcePagesForJobs(jobs, sources) {
  const byCompany = new Map();
  for (const source of sources) {
    const company = String(source.company || source.name || "").trim().toLowerCase();
    if (!company || !source.url) continue;
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(source.url);
  }
  const urls = [];
  for (const job of jobs) {
    if (job.url) urls.push(job.url);
    const company = String(job.company || "").trim().toLowerCase();
    for (const [sourceCompany, sourceUrls] of byCompany.entries()) {
      if (company && (sourceCompany.includes(company) || company.includes(sourceCompany))) {
        urls.push(...sourceUrls);
      }
    }
  }
  return [...new Set(urls.map(normalizeUrl).filter(Boolean))].slice(0, 24);
}

async function collectPageEvidence(urls, args) {
  const evidence = [];
  const errors = [];
  for (const url of urls) {
    try {
      const text = stripHtml(await fetchText(url, args.timeout)).slice(0, 1200);
      evidence.push({
        title: "",
        url,
        snippet: text,
        provider: "source-page"
      });
      console.log(`[career-ops] researched source page ${url}`);
    } catch (error) {
      errors.push({ url, message: error instanceof Error ? error.message : String(error) });
      console.warn(`[career-ops] source page failed ${url}: ${errors.at(-1).message}`);
    }
  }
  return { evidence, errors };
}

function groupEvidenceByCompany(jobs, evidence) {
  return jobs.map((job) => {
    const company = String(job.company || "").trim();
    const title = String(job.title || "").trim();
    const textNeedles = [company, title].filter(Boolean).map((item) => item.toLowerCase());
    const matches = evidence.filter((item) => {
      const text = `${item.title} ${item.url} ${item.snippet}`.toLowerCase();
      return textNeedles.some((needle) => needle && text.includes(needle.split(/\s+/)[0]));
    }).slice(0, 10);
    return buildDossier(job, matches.length ? matches : evidence.slice(0, 5));
  });
}

function buildDossier(job, evidence) {
  const snippets = evidence.map((item) => `${item.title} ${item.snippet}`.toLowerCase()).join("\n");
  const signals = [];
  if (/(ai|llm|machine learning|data|automation|platform)/i.test(snippets)) signals.push("AI / data / platform signal");
  if (/(funding|series|ipo|growth|scale|expansion)/i.test(snippets)) signals.push("growth or funding signal");
  if (/(layoff|lawsuit|risk|decline|controversy)/i.test(snippets)) signals.push("risk signal to inspect manually");
  if (/(remote|hybrid|flexible)/i.test(snippets)) signals.push("remote or hybrid signal");
  return {
    jobKey: job.jobKey || job.url || `${job.company}:${job.title}`,
    company: job.company || "",
    title: job.title || "",
    score: job.score ?? "",
    recommendation: job.recommendation || "",
    evidence,
    signals,
    researchQuestions: [
      `What business unit owns the ${job.title || "target"} role?`,
      "What measurable outcomes would this team expect in the first 90 days?",
      "What recent company/product signals change the risk or upside?",
      "Which CV proof points should be highlighted for this company?"
    ],
    interviewAngles: [
      "Ask about team success metrics and why the role is open.",
      "Ask how the company evaluates impact across the first two quarters.",
      "Prepare one story that maps directly to the highest-scoring ATS keywords."
    ]
  };
}

function renderReport(payload) {
  const lines = [
    "# Career Ops Deep Research",
    "",
    `Generated: ${payload.generatedAt}`,
    `Search provider: ${payload.searchProvider}`,
    `Queries: ${payload.queries.length}`,
    `Evidence items: ${payload.evidence.length}`,
    `Dossiers: ${payload.dossiers.length}`,
    ""
  ];
  for (const dossier of payload.dossiers) {
    lines.push(
      `## ${dossier.company || "Unknown Company"} - ${dossier.title}`,
      "",
      `- Score: ${dossier.score || "-"}`,
      `- Recommendation: ${dossier.recommendation || "-"}`,
      `- Signals: ${dossier.signals.join(", ") || "No strong signal detected"}`,
      "",
      "### Evidence",
      ...dossier.evidence.slice(0, 6).map((item) => `- ${item.title || item.provider}: ${item.url}${item.snippet ? ` — ${item.snippet.slice(0, 180)}` : ""}`),
      "",
      "### Research Questions",
      ...dossier.researchQuestions.map((item) => `- ${item}`),
      "",
      "### Interview Angles",
      ...dossier.interviewAngles.map((item) => `- ${item}`),
      ""
    );
  }
  if (payload.errors.length) {
    lines.push("## Errors", "", ...payload.errors.map((error) => `- ${error.url || error.query}: ${error.message}`), "");
  }
  return `${lines.join("\n")}\n`;
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
  const jobsPayload = await readJsonIfExists(args.jobs);
  const profile = await readJsonIfExists(args.profile);
  const sourcesPayload = await readJsonIfExists(args.sources);
  const sources = Array.isArray(sourcesPayload.sources) ? sourcesPayload.sources : [];
  const jobs = rankedJobs(jobsPayload, args.top);
  const provider = pickSearchProvider(args.searchProvider);
  const queries = buildQueries(jobs, profile, args.queries);
  const evidence = [];
  const errors = [];

  for (const query of queries) {
    try {
      const results = await searchWeb(query, provider, args);
      evidence.push(...results);
      if (provider !== "none") console.log(`[career-ops] ${provider} "${query}" -> ${results.length} result(s)`);
    } catch (error) {
      errors.push({ query, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const pageEvidence = await collectPageEvidence(sourcePagesForJobs(jobs, sources), args);
  evidence.push(...pageEvidence.evidence);
  errors.push(...pageEvidence.errors);

  const uniqueEvidence = [...new Map(evidence.filter((item) => item.url).map((item) => [item.url.toLowerCase(), item])).values()];
  const payload = {
    source: "career-ops-deep-research",
    generatedAt: new Date().toISOString(),
    searchProvider: provider,
    queries,
    evidence: uniqueEvidence,
    dossiers: groupEvidenceByCompany(jobs, uniqueEvidence),
    errors
  };

  await writeJson(args.out, payload);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_DEEP_RESEARCH = ${JSON.stringify(payload, null, 2)};\n`);
  await writeText(args.reportOut, renderReport(payload));
  console.log(`[career-ops] deep research wrote ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
