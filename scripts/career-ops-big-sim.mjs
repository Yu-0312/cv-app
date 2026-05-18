#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROFILES = "data/career-ops-profile.example.json";
const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-big-sim-results.jsonl";
const DEFAULT_CSV_OUT = "data/app/career-ops-big-sim-results.csv";
const DEFAULT_SUMMARY_OUT = "data/app/career-ops-big-sim-summary.json";
const DEFAULT_REPORT_OUT = "data/app/career-ops-big-sim-report.md";

const STOPWORDS = new Set([
  "and", "the", "with", "for", "you", "your", "our", "are", "will", "that", "this", "from", "have", "has",
  "to", "or", "of", "in", "on", "at", "as", "by", "an", "be", "is", "we", "a",
  "我們", "以及", "或者", "或", "與", "和", "工作", "職缺", "能力", "相關", "負責", "具備", "優先"
]);

const SKILL_TERMS = [
  "javascript", "typescript", "react", "vue", "angular", "next.js", "nuxt", "svelte", "node.js", "python",
  "java", "go", "rust", "swift", "kotlin", "sql", "postgresql", "postgres", "mysql", "supabase", "firebase",
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "github actions", "ci/cd", "graphql", "rest api",
  "api", "html", "css", "sass", "tailwind", "storybook", "figma", "design systems", "accessibility", "wcag",
  "analytics", "dashboard", "data visualization", "etl", "airflow", "spark", "dbt", "llm", "rag", "agents",
  "prompt engineering", "machine learning", "deep learning", "nlp", "computer vision", "pytorch", "tensorflow",
  "product management", "crm", "seo", "growth", "sales", "operations", "excel", "tableau", "power bi",
  "中文", "英文", "日文", "資料分析", "數據分析", "前端", "後端", "全端", "產品", "設計系統", "無障礙", "機器學習", "人工智慧"
];

const GROWTH_TERMS = ["scale", "scalable", "growth", "0-1", "startup", "founding", "ownership", "lead", "platform", "data", "ai", "llm", "automation", "成長", "新創", "平台", "資料", "自動化"];
const RISK_TERMS = ["unpaid", "commission-only", "volunteer", "internship unpaid", "must be local", "on-site only", "無薪", "純抽成", "責任制", "無底薪"];
const LEGITIMACY_RED = ["apply now via whatsapp", "wire transfer", "send bank", "advance fee", "buy equipment", "training fee", "deposit required", "salary upfront", "whatsapp only", "telegram only"];
const LEGITIMACY_YELLOW = ["work from home guaranteed", "no experience needed", "earn up to", "must pay", "no interview", "quick hire"];
const COMP_TERMS = ["salary", "compensation", "薪資", "薪水", "待遇", "年薪", "月薪", "nt$", "twd", "$", "k/month"];
const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "ashby.io", "workable.com", "bamboohr.com", "smartrecruiters.com",
  "indeed.com", "linkedin.com", "104.com.tw", "yourator.co", "cakeresume.com", "myworkday.com",
  "taleo.net", "icims.com", "jobvite.com", "recruitee.com", "teamtailor.com", "workday.com",
  "japan-dev.com", "tokyodev.com", "amazon.jobs", "careers.microsoft.com", "boards.greenhouse.io",
  "jobs.ashbyhq.com", "wellfound.com", "jobs.lever.co"
];
const WEIGHTS = { cvMatch: 0.25, northStar: 0.20, compensation: 0.15, culture: 0.15, redFlags: 0.15, effort: 0.10 };

function printHelp() {
  console.log(`Career Ops big data simulation

Runs profile x job simulations and writes every simulated result.

Usage:
  node scripts/career-ops-big-sim.mjs

Options:
  --profiles <file>      Profile corpus JSON. Default: ${DEFAULT_PROFILES}
  --jobs <file>          Career Ops jobs JSON. Default: ${DEFAULT_JOBS}
  --out <file>           Per-result JSONL output. Default: ${DEFAULT_OUT}
  --csv-out <file>       Per-result CSV output. Default: ${DEFAULT_CSV_OUT}
  --summary-out <file>   Summary JSON output. Default: ${DEFAULT_SUMMARY_OUT}
  --report-out <file>    Markdown report output. Default: ${DEFAULT_REPORT_OUT}
  --limit-profiles <n>   Only simulate the first n profiles
  --limit-jobs <n>       Only simulate the first n jobs
  --include-expired      Include expired jobs. Default: active jobs only
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    profiles: DEFAULT_PROFILES,
    jobs: DEFAULT_JOBS,
    out: DEFAULT_OUT,
    csvOut: DEFAULT_CSV_OUT,
    summaryOut: DEFAULT_SUMMARY_OUT,
    reportOut: DEFAULT_REPORT_OUT,
    includeExpired: false,
    limitProfiles: 0,
    limitJobs: 0
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--profiles") args.profiles = argv[++i] || DEFAULT_PROFILES;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--csv-out") args.csvOut = argv[++i] || DEFAULT_CSV_OUT;
    else if (token === "--summary-out") args.summaryOut = argv[++i] || DEFAULT_SUMMARY_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT_OUT;
    else if (token === "--limit-profiles") args.limitProfiles = Number(argv[++i] || 0);
    else if (token === "--limit-jobs") args.limitJobs = Number(argv[++i] || 0);
    else if (token === "--include-expired") args.includeExpired = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function array(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value).flat();
  return value ? [value] : [];
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function tokenize(value) {
  return Array.from(new Set(String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOPWORDS.has(item))));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesTerm(source, term) {
  const textValue = String(source || "").toLowerCase();
  const needle = String(term || "").toLowerCase().trim();
  if (!needle || STOPWORDS.has(needle)) return false;
  if (needle.includes(" ")) return textValue.includes(needle);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, "iu").test(textValue);
}

function unique(items) {
  const seen = new Set();
  const output = [];
  for (const item of array(items).flat(Infinity)) {
    const value = text(item);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function normalizeProfiles(payload) {
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [payload];
  return profiles.map((profile, index) => {
    const preferences = profile.preferences && typeof profile.preferences === "object" ? profile.preferences : {};
    const skillExperience = array(profile.skillExperience || profile.skillMatrix).map((item) => item?.skill || item?.name || item);
    const groupedSkills = Object.values(profile.skillGroups && typeof profile.skillGroups === "object" ? profile.skillGroups : {}).flat();
    const summary = profile.professionalSummary || profile.summary || profile.description || profile.headline || "";
    const role = profile.targetRole || profile.role || profile.seniority || profile.basics?.label || "";
    const workText = text(profile.experience || profile.resumeText) || array(profile.workExperience || profile.employmentHistory || profile.careerTimeline).map((item) => {
      if (!item || typeof item !== "object") return text(item);
      return [item.position || item.title || item.role, item.company || item.organization, item.summary, array(item.highlights || item.bullets || item.responsibilities).join(" ")].map(text).filter(Boolean).join(" ");
    }).join("\n");
    const projectText = text(profile.projects || profile.projectHighlights) || array(profile.portfolioProjects || profile.projects).map((item) => {
      if (!item || typeof item !== "object") return text(item);
      return [item.name || item.title, item.summary || item.description, array(item.highlights || item.bullets || item.outcomes).join(" ")].map(text).filter(Boolean).join(" ");
    }).join("\n");
    const rawSkills = unique([
      profile.skills,
      groupedSkills,
      skillExperience,
      preferences.keywords,
      tokenize([role, summary, workText, projectText].join(" ")).filter((term) =>
        SKILL_TERMS.some((known) => known === term || known.includes(term) || term.includes(known)))
    ]);
    const targetRoles = unique([
      preferences.targetRoles,
      role,
      profile.targetRole
    ]).slice(0, 12);
    return {
      id: String(profile.id || profile.activeProfileId || profile.name || profile.fullName || `profile-${index + 1}`),
      name: String(profile.name || profile.fullName || profile.displayName || profile.basics?.name || `Profile ${index + 1}`),
      role: String(role || "").trim(),
      summary: String(summary || "").trim(),
      skills: rawSkills,
      targetRoles,
      preferredLocations: unique(preferences.locations || profile.location?.city || profile.location).map(String),
      preferredCompanies: unique(preferences.companies).map(String),
      avoidKeywords: unique(preferences.avoidKeywords || preferences.exclude).map(String),
      remote: Boolean(preferences.remote) || /(remote|wfh|遠端|hybrid|混合)/i.test([role, summary, workText, projectText].join(" ")),
      synthetic: Boolean(profile.synthetic)
    };
  });
}

function roleFamily(job) {
  const source = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  if (/(frontend|front-end|前端|react|vue|ui engineer)/i.test(source)) return "Frontend";
  if (/(backend|back-end|後端|api|server|database|infra)/i.test(source)) return "Backend";
  if (/(full[- ]?stack|全端)/i.test(source)) return "Full Stack";
  if (/(data scientist|machine learning|ml engineer|ai engineer|llm|rag|資料科學|機器學習|人工智慧)/i.test(source)) return "AI / Data";
  if (/(product manager|產品經理|pm\b|product owner)/i.test(source)) return "Product";
  if (/(designer|ux|ui\/ux|設計)/i.test(source)) return "Design";
  if (/(marketing|growth|seo|行銷)/i.test(source)) return "Marketing";
  if (/(sales|business development|bd|業務)/i.test(source)) return "Sales";
  if (/(operations|ops|營運)/i.test(source)) return "Operations";
  if (/(intern|實習)/i.test(source)) return "Internship";
  return "Other";
}

function seniority(job) {
  const source = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  if (/(intern|實習)/i.test(source)) return "Intern";
  if (/(junior|entry|associate|新鮮人|初階)/i.test(source)) return "Junior";
  if (/(manager|director|head of|vp|負責人|經理)/i.test(source)) return "Manager+";
  if (/(senior|sr\.|lead|principal|staff|資深|主管)/i.test(source)) return "Senior+";
  return "Mid";
}

function workMode(job) {
  const source = `${job.title || ""} ${job.location || ""} ${job.description || ""}`.toLowerCase();
  if (/(remote|work from home|wfh|遠端)/i.test(source)) return "Remote";
  if (/(hybrid|混合)/i.test(source)) return "Hybrid";
  if (/(on-site|onsite|現場|辦公室)/i.test(source)) return "On-site";
  return "Unknown";
}

function extractSkillsFromText(source) {
  return SKILL_TERMS.filter((skill) => includesTerm(source, skill)).slice(0, 28);
}

function grade6D(score) {
  if (score >= 87) return "A";
  if (score >= 74) return "B";
  if (score >= 60) return "C";
  if (score >= 44) return "D";
  return "F";
}

function gradeFromScore(score) {
  if (score >= 85) return "A";
  if (score >= 72) return "B";
  if (score >= 58) return "C";
  if (score >= 42) return "D";
  return "F";
}

function recommendation(score, blockG) {
  if (blockG?.tier === "Suspicious") return "略過";
  if (score >= 80) return "強烈投遞";
  if (score >= 70) return "值得投遞";
  if (score >= 56) return "觀望";
  return "略過";
}

function computeBlockG(job, textValue) {
  const lower = textValue.toLowerCase();
  const url = String(job.url || "").toLowerCase();
  const redHits = LEGITIMACY_RED.filter((term) => lower.includes(term));
  const yellowHits = LEGITIMACY_YELLOW.filter((term) => lower.includes(term));
  const isKnownAts = Boolean(url && ATS_DOMAINS.some((domain) => url.includes(domain)));
  const postDate = job.datePosted ? new Date(job.datePosted) : null;
  const daysOld = postDate && !Number.isNaN(postDate.getTime())
    ? Math.floor((Date.now() - postDate.getTime()) / 86400000)
    : null;
  const signals = [];
  if (daysOld !== null) {
    if (daysOld > 120) signals.push({ k: "yellow", msg: `Stale posting: ${daysOld}d old` });
    else if (daysOld > 60) signals.push({ k: "yellow", msg: `Aging posting: ${daysOld}d old` });
    else if (daysOld <= 14) signals.push({ k: "green", msg: `Fresh posting: ${daysOld}d old` });
  }
  if (isKnownAts) signals.push({ k: "green", msg: "Known ATS platform URL" });
  if (!job.url) signals.push({ k: "yellow", msg: "No job URL" });
  if (String(job.description || "").length < 200) signals.push({ k: "yellow", msg: "Very short job description" });
  const yellowCount = yellowHits.length + signals.filter((signal) => signal.k === "yellow").length;
  if (redHits.length >= 2 || (redHits.length >= 1 && !job.url)) return { tier: "Suspicious", confidence: "low", redHits, yellowHits, signals };
  if (redHits.length >= 1 || yellowCount >= 3 || (daysOld !== null && daysOld > 120)) return { tier: "Proceed with Caution", confidence: "medium", redHits, yellowHits, signals };
  return { tier: "High Confidence", confidence: isKnownAts ? "high" : "medium", redHits, yellowHits, signals };
}

function normalizeJobs(payload, includeExpired) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  return jobs
    .filter((job) => includeExpired || !job.isExpired)
    .map((job, index) => {
      const textValue = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
      const skills = extractSkillsFromText(textValue);
      return {
        ...job,
        id: String(job.id || job.jobKey || job.url || `job-${index + 1}`),
        simulationJobIndex: index + 1,
        textValue,
        lowerText: textValue.toLowerCase(),
        skills,
        roleFamily: roleFamily(job),
        seniority: seniority(job),
        workMode: workMode(job),
        growthHits: GROWTH_TERMS.filter((term) => includesTerm(textValue, term)),
        riskHits: RISK_TERMS.filter((term) => includesTerm(textValue, term)),
        hasSalary: COMP_TERMS.some((term) => String(textValue).toLowerCase().includes(term)),
        hasRange: /\d/.test(String(job.salary || job.compensation || "")),
        blockG: computeBlockG(job, textValue)
      };
    });
}

function topSkillCounts(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    for (const skill of job.skills) counts.set(skill, (counts.get(skill) || 0) + 1);
  }
  return counts;
}

function scoreProfileJob(profile, job, skillCounts) {
  const profileSkills = profile.skills.filter((skill) => includesTerm(job.textValue, skill)).slice(0, 18);
  const missingProfileSkills = profile.skills.filter((skill) => !includesTerm(job.textValue, skill)).slice(0, 12);
  const targetRoleHits = profile.targetRoles.filter((role) => includesTerm(`${job.title || ""} ${job.description || ""}`, role));
  const locationHits = profile.preferredLocations.filter((location) => includesTerm(`${job.location || ""} ${job.description || ""}`, location));
  const companyHits = profile.preferredCompanies.filter((company) => includesTerm(job.company || "", company));
  const avoidHits = [...profile.avoidKeywords, ...RISK_TERMS].filter((term) => includesTerm(job.textValue, term));
  const rareHighValueSkills = job.skills.filter((skill) => (skillCounts.get(skill) || 0) <= 2).slice(0, 8);

  const atsRaw = profile.skills.length ? Math.round((profileSkills.length / profile.skills.length) * 100) : Math.min(100, job.skills.length * 12);
  const profileRaw = Math.min(100, profileSkills.length * 14 + targetRoleHits.length * 18 + companyHits.length * 10);
  const cvMatch = Math.round(atsRaw * 0.45 + profileRaw * 0.55);

  const roleFitRaw = targetRoleHits.length ? 92 : profile.role && includesTerm(`${job.title || ""} ${job.description || ""}`, profile.role) ? 86 : job.roleFamily === "Other" ? 45 : 68;
  const senFitRaw = job.seniority === "Intern" && !/intern|實習/i.test(profile.role) ? 55 : job.seniority === "Senior+" ? 70 : 82;
  const northStar = Math.round(roleFitRaw * 0.65 + senFitRaw * 0.35);

  const compensation = job.hasSalary ? (job.hasRange ? 90 : 72) : 45;
  const freshness = job.isExpired ? 0 : job.isNew ? 95 : job.datePosted ? 76 : 64;
  const locationFitRaw = locationHits.length || (profile.remote && job.workMode === "Remote") ? 95 : job.workMode === "Remote" ? 82 : profile.preferredLocations.length ? 58 : 70;
  const growthRaw = Math.min(100, 48 + job.growthHits.length * 9 + rareHighValueSkills.length * 4);
  const culture = Math.round(freshness * 0.35 + locationFitRaw * 0.30 + growthRaw * 0.35);

  const riskPenalty = Math.min(80, avoidHits.length * 12 + job.riskHits.length * 18 + (job.isExpired ? 40 : 0) + (String(job.description || "").length < 120 ? 15 : 0));
  const redFlags = Math.max(0, 100 - riskPenalty);
  const sourceQ = /^adapter:/i.test(job.sourceType || "") ? 90 : job.sourceType === "json-ld" ? 78 : String(job.description || "").length > 800 ? 72 : 55;
  const effort = Math.round((job.url ? (String(job.description || "").length > 800 ? 88 : 72) : 48) * 0.5 + sourceQ * 0.5);

  const score = Math.max(0, Math.min(100, Math.round(
    cvMatch * WEIGHTS.cvMatch +
    northStar * WEIGHTS.northStar +
    compensation * WEIGHTS.compensation +
    culture * WEIGHTS.culture +
    redFlags * WEIGHTS.redFlags +
    effort * WEIGHTS.effort
  )));
  const rating = Math.round(((score / 100) * 4 + 1) * 10) / 10;
  const grade = gradeFromScore(score);
  const rec = recommendation(score, job.blockG);

  return {
    score,
    rating,
    grade,
    recommendation: rec,
    blockGTier: job.blockG.tier,
    dimensions: {
      cvMatch: { score: cvMatch, grade: grade6D(cvMatch) },
      northStar: { score: northStar, grade: grade6D(northStar) },
      compensation: { score: compensation, grade: grade6D(compensation) },
      culture: { score: culture, grade: grade6D(culture) },
      redFlags: { score: redFlags, grade: grade6D(redFlags) },
      effort: { score: effort, grade: grade6D(effort) }
    },
    profileSkillHits: profileSkills,
    missingProfileSkills,
    targetRoleHits,
    rareHighValueSkills,
    roleFamily: job.roleFamily,
    seniority: job.seniority,
    workMode: job.workMode
  };
}

function csv(value) {
  const raw = Array.isArray(value) ? value.join("|") : value;
  const str = String(raw ?? "");
  return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function pushTop(list, item, limit) {
  list.push(item);
  list.sort((a, b) => b.score - a.score || a.profileId.localeCompare(b.profileId));
  if (list.length > limit) list.length = limit;
}

function compactCounts(map) {
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function renderReport(summary) {
  const topLines = summary.topResults.slice(0, 20).map((item, index) =>
    `- ${index + 1}. ${item.score}/100 ${item.grade} ${item.recommendation} - ${item.profileName} -> ${item.company} / ${item.title}`
  );
  const profileLines = summary.profileSummaries.slice(0, 20).map((item, index) =>
    `- ${index + 1}. ${item.averageScore} avg / ${item.strongOrWorthCount} pursue - ${item.profileName} (${item.profileRole})`
  );
  const jobLines = summary.jobSummaries.slice(0, 20).map((item, index) =>
    `- ${index + 1}. ${item.averageScore} avg / ${item.strongOrWorthCount} pursue - ${item.company} / ${item.title}`
  );
  return [
    "# Career Ops Big Data Simulation",
    "",
    `Generated: ${summary.generatedAt}`,
    `Profiles: ${summary.profileCount}`,
    `Jobs: ${summary.jobCount}`,
    `Simulation rows: ${summary.resultCount}`,
    `Average score: ${summary.averageScore}`,
    "",
    "## Distributions",
    `- Grades: ${Object.entries(summary.gradeDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Recommendations: ${Object.entries(summary.recommendationDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Block G: ${Object.entries(summary.blockGDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "",
    "## Top Simulated Results",
    ...topLines,
    "",
    "## Top Profiles By Average Score",
    ...profileLines,
    "",
    "## Top Jobs By Average Score",
    ...jobLines,
    ""
  ].join("\n");
}

async function ensureDir(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const profilePayload = JSON.parse(await fsp.readFile(args.profiles, "utf8"));
  const jobsPayload = JSON.parse(await fsp.readFile(args.jobs, "utf8"));
  let profiles = normalizeProfiles(profilePayload);
  let jobs = normalizeJobs(jobsPayload, args.includeExpired);
  if (Number.isFinite(args.limitProfiles) && args.limitProfiles > 0) profiles = profiles.slice(0, args.limitProfiles);
  if (Number.isFinite(args.limitJobs) && args.limitJobs > 0) jobs = jobs.slice(0, args.limitJobs);
  if (!profiles.length) throw new Error("No profiles found.");
  if (!jobs.length) throw new Error("No jobs found.");

  const skillCounts = topSkillCounts(jobs);
  await Promise.all([ensureDir(args.out), ensureDir(args.csvOut), ensureDir(args.summaryOut), ensureDir(args.reportOut)]);
  const jsonl = fs.createWriteStream(args.out, { encoding: "utf8" });
  const csvOut = fs.createWriteStream(args.csvOut, { encoding: "utf8" });
  csvOut.write([
    "simulationId", "profileId", "profileName", "profileRole", "profileSynthetic",
    "jobId", "company", "title", "location", "url",
    "score", "rating", "grade", "recommendation", "blockGTier",
    "cvMatch", "northStar", "compensation", "culture", "redFlags", "effort",
    "roleFamily", "seniority", "workMode", "profileSkillHits", "missingProfileSkills", "rareHighValueSkills"
  ].join(",") + "\n");

  const gradeDistribution = new Map();
  const recommendationDistribution = new Map();
  const blockGDistribution = new Map();
  const profileAgg = new Map();
  const jobAgg = new Map();
  const topResults = [];
  let resultCount = 0;
  let scoreSum = 0;

  for (const profile of profiles) {
    const pAgg = { profileId: profile.id, profileName: profile.name, profileRole: profile.role, count: 0, sum: 0, strongOrWorthCount: 0, best: null };
    profileAgg.set(profile.id, pAgg);
    for (const job of jobs) {
      const result = scoreProfileJob(profile, job, skillCounts);
      resultCount += 1;
      scoreSum += result.score;
      increment(gradeDistribution, result.grade);
      increment(recommendationDistribution, result.recommendation);
      increment(blockGDistribution, result.blockGTier);
      if (result.recommendation === "強烈投遞" || result.recommendation === "值得投遞") pAgg.strongOrWorthCount += 1;
      pAgg.count += 1;
      pAgg.sum += result.score;

      const jobId = job.id;
      let jAgg = jobAgg.get(jobId);
      if (!jAgg) {
        jAgg = { jobId, company: job.company || "", title: job.title || "", location: job.location || "", count: 0, sum: 0, strongOrWorthCount: 0, best: null };
        jobAgg.set(jobId, jAgg);
      }
      if (result.recommendation === "強烈投遞" || result.recommendation === "值得投遞") jAgg.strongOrWorthCount += 1;
      jAgg.count += 1;
      jAgg.sum += result.score;

      const row = {
        simulationId: `sim-${resultCount}`,
        profileId: profile.id,
        profileName: profile.name,
        profileRole: profile.role,
        profileSynthetic: profile.synthetic,
        jobId,
        company: job.company || "",
        title: job.title || "",
        location: job.location || "",
        url: job.url || "",
        score: result.score,
        rating: result.rating,
        grade: result.grade,
        recommendation: result.recommendation,
        blockGTier: result.blockGTier,
        dimensions: result.dimensions,
        roleFamily: result.roleFamily,
        seniority: result.seniority,
        workMode: result.workMode,
        profileSkillHits: result.profileSkillHits,
        missingProfileSkills: result.missingProfileSkills,
        targetRoleHits: result.targetRoleHits,
        rareHighValueSkills: result.rareHighValueSkills
      };
      jsonl.write(`${JSON.stringify(row)}\n`);
      csvOut.write([
        row.simulationId, row.profileId, row.profileName, row.profileRole, row.profileSynthetic,
        row.jobId, row.company, row.title, row.location, row.url,
        row.score, row.rating, row.grade, row.recommendation, row.blockGTier,
        result.dimensions.cvMatch.score, result.dimensions.northStar.score, result.dimensions.compensation.score,
        result.dimensions.culture.score, result.dimensions.redFlags.score, result.dimensions.effort.score,
        row.roleFamily, row.seniority, row.workMode, row.profileSkillHits, row.missingProfileSkills, row.rareHighValueSkills
      ].map(csv).join(",") + "\n");

      const topItem = {
        simulationId: row.simulationId,
        profileId: profile.id,
        profileName: profile.name,
        profileRole: profile.role,
        jobId,
        company: row.company,
        title: row.title,
        score: result.score,
        grade: result.grade,
        recommendation: result.recommendation,
        blockGTier: result.blockGTier
      };
      if (!pAgg.best || result.score > pAgg.best.score) pAgg.best = topItem;
      if (!jAgg.best || result.score > jAgg.best.score) jAgg.best = topItem;
      pushTop(topResults, topItem, 100);
    }
  }

  await new Promise((resolve, reject) => jsonl.end(resolve).on("error", reject));
  await new Promise((resolve, reject) => csvOut.end(resolve).on("error", reject));

  const profileSummaries = Array.from(profileAgg.values())
    .map((item) => ({
      ...item,
      averageScore: item.count ? Math.round(item.sum / item.count) : 0,
      sum: undefined,
      best: item.best
    }))
    .sort((a, b) => b.averageScore - a.averageScore || b.strongOrWorthCount - a.strongOrWorthCount || a.profileName.localeCompare(b.profileName));
  const jobSummaries = Array.from(jobAgg.values())
    .map((item) => ({
      ...item,
      averageScore: item.count ? Math.round(item.sum / item.count) : 0,
      sum: undefined,
      best: item.best
    }))
    .sort((a, b) => b.averageScore - a.averageScore || b.strongOrWorthCount - a.strongOrWorthCount || a.company.localeCompare(b.company));
  const summary = {
    generatedAt: new Date().toISOString(),
    profilesFile: args.profiles,
    jobsFile: args.jobs,
    resultJsonl: args.out,
    resultCsv: args.csvOut,
    includeExpired: args.includeExpired,
    profileCount: profiles.length,
    jobCount: jobs.length,
    resultCount,
    averageScore: resultCount ? Math.round(scoreSum / resultCount) : 0,
    gradeDistribution: compactCounts(gradeDistribution),
    recommendationDistribution: compactCounts(recommendationDistribution),
    blockGDistribution: compactCounts(blockGDistribution),
    topResults,
    profileSummaries,
    jobSummaries,
    weights: WEIGHTS
  };
  await fsp.writeFile(args.summaryOut, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fsp.writeFile(args.reportOut, `${renderReport(summary)}\n`, "utf8");
  console.log(`[career-ops] simulated ${resultCount} profile-job result(s)`);
  console.log(`[career-ops] jsonl -> ${args.out}`);
  console.log(`[career-ops] csv -> ${args.csvOut}`);
  console.log(`[career-ops] summary -> ${args.summaryOut}`);
  console.log(`[career-ops] report -> ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
