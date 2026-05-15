#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_JS_OUT = "data/app/career-ops-jobs.js";
const DEFAULT_REPORT = "data/app/career-ops-source-quality-report.md";

const DEFAULT_TARGET_MARKETS = ["tw", "cn", "jp", "kr", "sg", "global"];
const TARGET_LOCATION_TERMS = [
  "taiwan", "taipei", "hsinchu", "taichung", "kaohsiung", "台灣", "台北", "新竹", "tw",
  "china", "beijing", "shanghai", "shenzhen", "hangzhou", "中國", "北京", "上海", "深圳", "cn",
  "japan", "tokyo", "osaka", "kyoto", "日本", "東京", "大阪", "jp",
  "korea", "seoul", "pangyo", "south korea", "韓國", "首爾", "kr",
  "singapore", "新加坡", "sg",
  "remote", "hybrid", "global"
];
const MARKET_LOCATION_TERMS = {
  tw: ["taiwan", "taipei", "hsinchu", "taichung", "kaohsiung", "taoyuan", "tainan", "台灣", "台北", "新竹", "台中", "高雄", "桃園", "台南"],
  cn: ["china", "beijing", "shanghai", "shenzhen", "hangzhou", "suzhou", "guangzhou", "chengdu", "中國", "北京", "上海", "深圳", "杭州", "蘇州", "广州", "成都"],
  jp: ["japan", "tokyo", "osaka", "kyoto", "yokohama", "日本", "東京", "大阪", "京都", "横浜"],
  kr: ["korea", "south korea", "seoul", "pangyo", "suwon", "yongin", "韓國", "首爾", "서울", "수원"],
  sg: ["singapore", "新加坡", "singapore city"]
};
const OUTSIDE_LOCATION_TERMS = [
  "id", "indonesia", "jakarta", "surabaya", "republic of indonesia",
  "my", "malaysia", "kuala lumpur",
  "hk", "hong kong", "香港",
  "vn", "vietnam", "thailand", "philippines",
  "united states", "usa", "u.s.", "us-", "california", "new york", "texas", "arizona",
  "boise", "phoenix", "san jose", "santa clara", "austin", "cupertino", "mountain view",
  "india", "bengaluru", "bangalore", "hyderabad", "pune", "canada", "toronto",
  "germany", "france", "switzerland", "zurich", "united kingdom", "london"
];
const LANDING_PAGE_TERMS = [
  "jobs", "careers", "companies", "employers", "recruitment", "staffing", "resources",
  "campaigns", "events", "search", "人力銀行", "求職平台", "找工作", "徵才", "職缺2026",
  "工作機會 | cake", "招聘網", "搵工", "part time", "精準ai匹配"
];
const JOB_PATH_TERMS = [
  "/job/", "/jobs/", "/job_detail/", "/companies/", "/careers/", "/recruit/", "/positions/",
  ".shtml", "jobdetail", "job-detail"
];

function printHelp() {
  console.log(`Career Ops source quality gate

Scores collected jobs for source quality before expensive scoring, research, PDF,
or LLM stages. It removes obvious job-board landing pages, incomplete records,
non-target locations, and weak descriptions by default.

Usage:
  node scripts/career-ops-source-quality.mjs --jobs data/app/career-ops-jobs.json

Options:
  --jobs <file>       Input Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --out <file>        Output JSON. Default: overwrite --jobs
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --min-score <n>     Minimum active quality score to keep. Default: 45
  --annotate-only     Keep all jobs but add quality metadata
  --no-js             Skip browser JS output
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    out: "",
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    minScore: 45,
    annotateOnly: false,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--out") args.out = argv[++i] || "";
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--min-score") args.minScore = Math.max(0, Math.min(100, Number.parseInt(argv[++i] || "45", 10) || 45));
    else if (token === "--annotate-only") args.annotateOnly = true;
    else if (token === "--no-js") args.writeJs = false;
    else throw new Error(`Unknown argument: ${token}`);
  }
  args.out = args.out || args.jobs;
  return args;
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      url.searchParams.delete(key);
    }
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function includesAny(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function titleLooksLikeLanding(title) {
  const clean = String(title || "").toLowerCase();
  if (!clean) return true;
  if (clean.length > 120 && includesAny(clean, ["工作職缺", "jobs", "careers"])) return true;
  return LANDING_PAGE_TERMS.some((term) => clean === term || clean.includes(term));
}

function urlLooksLikeJob(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  const parsed = new URL(normalized);
  const pathText = `${parsed.pathname}${parsed.search}`.toLowerCase();
  return includesAny(pathText, JOB_PATH_TERMS) || /\d{5,}/.test(pathText);
}

function hasTargetMarket(job) {
  const location = `${job.location || ""} ${job.description || ""} ${job.title || ""}`;
  if (hasExplicitOutsideTargetLocation(job)) return false;
  const market = String(job.sourceMarket || "").toLowerCase();
  if (DEFAULT_TARGET_MARKETS.includes(market)) return true;
  return includesAny(location, TARGET_LOCATION_TERMS);
}

function hasExplicitOutsideTargetLocation(job) {
  const location = String(job.location || "").toLowerCase();
  if (!location) return false;
  const market = String(job.sourceMarket || "").toLowerCase();
  const marketTerms = MARKET_LOCATION_TERMS[market] || [];
  if (marketTerms.length && includesAny(location, marketTerms)) return false;
  if (marketTerms.length) {
    const matchedOtherTargetMarket = Object.entries(MARKET_LOCATION_TERMS)
      .some(([key, terms]) => key !== market && includesAny(location, terms));
    if (matchedOtherTargetMarket) return true;
  }
  if (market === "global" && includesAny(location, TARGET_LOCATION_TERMS)) return false;
  return OUTSIDE_LOCATION_TERMS.some((term) => location === term || location.includes(term));
}

function scoreJob(job) {
  const reasons = [];
  let score = 100;
  const title = String(job.title || "").trim();
  const company = String(job.company || "").trim();
  const description = String(job.description || "").trim();
  const url = normalizeUrl(job.url);

  if (!url) {
    score -= 35;
    reasons.push("missing-url");
  }
  if (!company) {
    score -= 18;
    reasons.push("missing-company");
  }
  if (!title || title === "未命名職缺") {
    score -= 28;
    reasons.push("missing-title");
  }
  if (titleLooksLikeLanding(title)) {
    score -= 45;
    reasons.push("landing-or-search-title");
  }
  if (!description || description.length < 180) {
    score -= 18;
    reasons.push("thin-description");
  }
  if (!urlLooksLikeJob(url)) {
    score -= 12;
    reasons.push("weak-job-url");
  }
  if (!hasTargetMarket(job)) {
    score -= 22;
    reasons.push("outside-target-market");
  }
  if (/employers|staffing|recruitment-consulting|resources|events|campaigns|companies\?/.test(url)) {
    score -= 40;
    reasons.push("job-board-landing-url");
  }
  if (hasExplicitOutsideTargetLocation(job)) {
    score -= 35;
    reasons.push("low-priority-region");
  }

  const bounded = Math.max(0, Math.min(100, score));
  return {
    score: bounded,
    tier: bounded >= 75 ? "high" : bounded >= 55 ? "medium" : bounded >= 45 ? "low" : "exclude",
    reasons
  };
}

function applyQuality(payload, args) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const annotated = jobs.map((job) => ({
    ...job,
    sourceQuality: scoreJob(job)
  }));
  const kept = args.annotateOnly
    ? annotated
    : annotated.filter((job) => job.isExpired || Number(job.sourceQuality?.score || 0) >= args.minScore);
  const filtered = annotated.filter((job) => !job.isExpired && Number(job.sourceQuality?.score || 0) < args.minScore);
  return {
    ...payload,
    qualityGate: {
      source: "career-ops-source-quality",
      generatedAt: new Date().toISOString(),
      mode: args.annotateOnly ? "annotate-only" : "filter",
      minScore: args.minScore,
      inputJobCount: jobs.filter((job) => !job.isExpired).length,
      keptJobCount: kept.filter((job) => !job.isExpired).length,
      filteredJobCount: filtered.length,
      filteredSamples: filtered.slice(0, 12).map((job) => ({
        title: job.title,
        company: job.company,
        url: job.url,
        score: job.sourceQuality.score,
        reasons: job.sourceQuality.reasons
      }))
    },
    jobCount: kept.filter((job) => !job.isExpired).length,
    newJobCount: kept.filter((job) => job.isNew && !job.isExpired).length,
    expiredJobCount: kept.filter((job) => job.isExpired).length,
    jobs: kept
  };
}

function renderReport(payload) {
  const gate = payload.qualityGate || {};
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const active = jobs.filter((job) => !job.isExpired);
  const tiers = active.reduce((acc, job) => {
    const tier = job.sourceQuality?.tier || "unknown";
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});
  return `# Career Ops Source Quality

- Generated: ${gate.generatedAt || ""}
- Mode: ${gate.mode || ""}
- Minimum score: ${gate.minScore ?? ""}
- Input active jobs: ${gate.inputJobCount ?? 0}
- Kept active jobs: ${gate.keptJobCount ?? 0}
- Filtered active jobs: ${gate.filteredJobCount ?? 0}
- Quality tiers: high ${tiers.high || 0} / medium ${tiers.medium || 0} / low ${tiers.low || 0}

## Filtered Samples

${(gate.filteredSamples || []).map((item) => `- ${item.score} ${item.company || "Unknown"} - ${item.title || "Untitled"} (${item.reasons.join(", ")})`).join("\n") || "- None"}

## Kept Samples

${active.slice(0, 12).map((job) => `- ${job.sourceQuality?.score ?? "?"} ${job.company || "Unknown"} - ${job.title}`).join("\n") || "- None"}
`;
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const payload = JSON.parse(await fs.readFile(args.jobs, "utf8"));
  const next = applyQuality(payload, args);
  await writeText(args.out, `${JSON.stringify(next, null, 2)}\n`);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_JOBS = ${JSON.stringify(next, null, 2)};\n`);
  await writeText(args.reportOut, renderReport(next));
  console.log(`[career-ops] source quality kept ${next.qualityGate.keptJobCount}/${next.qualityGate.inputJobCount} active job(s), filtered ${next.qualityGate.filteredJobCount}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
