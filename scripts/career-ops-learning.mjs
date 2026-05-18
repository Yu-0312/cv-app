#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_SOURCES = "data/career-ops-sources.json";
const DEFAULT_OUT = "data/app/career-ops-learning.json";
const DEFAULT_JS_OUT = "data/app/career-ops-learning.js";
const DEFAULT_REPORT = "data/app/career-ops-learning-report.md";

function printHelp() {
  console.log(`Career Ops learning layer

Learns reusable preferences from job scores, statuses, feedback, source metadata,
and market insights. This narrows the gap with agentic systems that learn the
candidate over time.

Usage:
  node scripts/career-ops-learning.mjs

Options:
  --jobs <file>       Jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>    Profile JSON. Default: ${DEFAULT_PROFILE}
  --sources <file>    Sources JSON. Default: ${DEFAULT_SOURCES}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --no-js             Skip browser JS output
  --help              Show this help
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

function countWeighted(items, getter, weightGetter) {
  const counts = new Map();
  for (const item of items) {
    const values = array(getter(item)).map((value) => String(value || "").trim()).filter(Boolean);
    const weight = Number(weightGetter(item) || 0);
    for (const value of values) counts.set(value, (counts.get(value) || 0) + weight);
  }
  return [...counts.entries()]
    .map(([name, score]) => ({ name, score: Math.round(score * 10) / 10 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// Recognized skill/tech terms for filtering description tokens — mirrors intelligence.mjs SKILL_TERMS
const SKILL_TERMS = new Set([
  "javascript", "typescript", "react", "vue", "angular", "next.js", "node.js", "python", "java", "go", "rust",
  "swift", "kotlin", "sql", "postgres", "mysql", "supabase", "firebase", "aws", "gcp", "azure", "docker",
  "kubernetes", "terraform", "graphql", "rest", "api", "html", "css", "tailwind", "figma", "accessibility",
  "analytics", "dashboard", "data visualization", "etl", "airflow", "spark", "dbt", "llm", "rag", "agents",
  "prompt engineering", "machine learning", "deep learning", "nlp", "computer vision", "pytorch", "tensorflow",
  "scikit", "product management", "crm", "seo", "growth", "sales", "operations", "excel", "tableau", "power bi",
  "中文", "英文", "資料分析", "數據分析", "前端", "後端", "全端", "產品", "設計系統", "無障礙", "機器學習", "人工智慧"
]);

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by", "can", "do", "does",
  "for", "from", "had", "has", "have", "he", "her", "him", "his", "how", "if", "in", "into",
  "is", "it", "its", "me", "my", "no", "not", "of", "on", "or", "our", "out", "shall", "she",
  "so", "that", "the", "their", "them", "then", "there", "they", "this", "those", "through",
  "to", "up", "us", "was", "we", "were", "what", "when", "where", "which", "while", "who",
  "will", "with", "would", "you", "your",
  "我們", "以及", "或者", "工作", "職缺", "可以", "能夠", "需要", "必須", "相關", "負責", "具備", "優先"
]);

function tokenize(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOPWORDS.has(item)))];
}

function jobWeight(job) {
  const score = Number(job.score || 0);
  const statusBoost = /投遞|面試|offer/i.test(job.status || "") ? 2 : /略過|拒絕|下架/i.test(job.status || "") ? -1.5 : 0;
  const feedbackBoost = job.feedback === "喜歡" ? 3 : job.feedback === "不喜歡" ? -2.5 : 0;
  return Math.max(-4, Math.min(6, score / 20 + statusBoost + feedbackBoost));
}

function buildLearning(jobsPayload, profile, sourcesPayload) {
  const jobs = array(jobsPayload.jobs).filter((job) => !job.isExpired);
  const positive = jobs.filter((job) => jobWeight(job) > 2.5);
  const negative = jobs.filter((job) => jobWeight(job) < 0);
  const preferredSkills = countWeighted(positive, (job) => {
    // Only count recognized skill terms — avoids company name fragments and prose noise.
    // Structured signals (features.skills, ats_keywords.found) are already filtered by intelligence.
    // For title tokens, only include items that match SKILL_TERMS to prevent noise like "we", "money".
    const titleTokens = tokenize(job.title || "").filter((t) => SKILL_TERMS.has(t));
    return [
      ...array(job.intelligence?.features?.skills),
      ...array(job.evaluation?.ats_keywords?.found),
      ...titleTokens
    ];
  }, jobWeight).slice(0, 18);
  const avoidSignals = countWeighted(negative, (job) => {
    // For avoid signals, only count structured avoidHits and skill terms from title — not raw description
    const titleSkills = tokenize(job.title || "").filter((t) => SKILL_TERMS.has(t));
    return [
      ...array(job.intelligence?.features?.avoidHits),
      ...titleSkills
    ];
  }, (job) => Math.abs(jobWeight(job))).slice(0, 14);
  const preferredCompanies = countWeighted(positive, (job) => [job.company], jobWeight).slice(0, 12);
  const preferredSources = countWeighted(positive, (job) => [job.sourceStrategy, job.sourceMarket, job.sourceIndustry], jobWeight).slice(0, 12);
  const roleFamilies = countWeighted(positive, (job) => [job.intelligence?.features?.roleFamily], jobWeight).slice(0, 8);
  const sourceCoverage = {
    sourceCount: array(sourcesPayload.sources).length,
    searchQueryCount: array(sourcesPayload.searchQueries).length,
    markets: [...new Set(array(sourcesPayload.sources).map((source) => source.market).filter(Boolean))]
  };
  return {
    activeJobCount: jobs.length,
    positiveSignalCount: positive.length,
    negativeSignalCount: negative.length,
    preferredSkills,
    avoidSignals,
    preferredCompanies,
    preferredSources,
    roleFamilies,
    sourceCoverage,
    nextStrategy: [
      preferredSkills.length ? `Expand searches around ${preferredSkills.slice(0, 5).map((item) => item.name).join(", ")}.` : "Collect evaluated jobs to learn preferred skills.",
      preferredSources.length ? `Prioritize sources like ${preferredSources.slice(0, 4).map((item) => item.name).join(", ")}.` : "Keep sources broad until positive signals emerge.",
      avoidSignals.length ? `Down-rank roles mentioning ${avoidSignals.slice(0, 5).map((item) => item.name).join(", ")}.` : "No strong avoid pattern learned yet.",
      "Refresh this learning layer after each batch evaluation or feedback session."
    ],
    profilePatchSuggestion: {
      preferences: {
        keywords: [...new Set([
          ...array(profile.preferences?.keywords),
          ...preferredSkills.slice(0, 8).map((item) => item.name)
        ])].slice(0, 18),
        avoidKeywords: [...new Set([
          ...array(profile.preferences?.avoidKeywords || profile.preferences?.exclude),
          ...avoidSignals.slice(0, 8).map((item) => item.name)
        ])].slice(0, 18),
        companies: [...new Set([
          ...array(profile.preferences?.companies),
          ...preferredCompanies.slice(0, 8).map((item) => item.name)
        ])].slice(0, 18)
      }
    }
  };
}

function renderReport(payload) {
  const l = payload.learning;
  return `# Career Ops Learning Report

- Generated: ${payload.generatedAt}
- Active jobs: ${l.activeJobCount}
- Positive signals: ${l.positiveSignalCount}
- Negative signals: ${l.negativeSignalCount}
- Source coverage: ${l.sourceCoverage.sourceCount} sources / ${l.sourceCoverage.searchQueryCount} queries / markets ${l.sourceCoverage.markets.join(", ") || "-"}

## Preferred Skills

${l.preferredSkills.map((item) => `- ${item.name}: ${item.score}`).join("\n") || "- Not enough feedback yet"}

## Avoid Signals

${l.avoidSignals.map((item) => `- ${item.name}: ${item.score}`).join("\n") || "- None learned yet"}

## Preferred Companies

${l.preferredCompanies.map((item) => `- ${item.name}: ${item.score}`).join("\n") || "- None learned yet"}

## Next Strategy

${l.nextStrategy.map((item) => `- ${item}`).join("\n")}
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
  const jobsPayload = await readJsonIfExists(args.jobs);
  const profile = await readJsonIfExists(args.profile);
  const sourcesPayload = await readJsonIfExists(args.sources);
  const payload = {
    source: "career-ops-learning",
    generatedAt: new Date().toISOString(),
    learning: buildLearning(jobsPayload, profile, sourcesPayload)
  };
  await writeJson(args.out, payload);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_LEARNING = ${JSON.stringify(payload, null, 2)};\n`);
  await writeText(args.reportOut, renderReport(payload));
  console.log(`[career-ops] learning active=${payload.learning.activeJobCount}, positive=${payload.learning.positiveSignalCount}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
