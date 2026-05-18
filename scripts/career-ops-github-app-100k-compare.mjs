#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_MANIFEST = "data/career-ops-profiles/manifest.json";
const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-github-app-100k-comparison.json";
const DEFAULT_REPORT_OUT = "data/app/career-ops-github-app-100k-comparison.md";
const DEFAULT_UPSTREAM_REPO = "/tmp/career-ops-upstream";
const APP_TRACKER_LIMIT = 1000;

const SCORE_WEIGHTS = { cvMatch: 0.25, northStar: 0.20, compensation: 0.15, culture: 0.15, redFlags: 0.15, effort: 0.10 };
const GITHUB_WEIGHTS = { cvMatch: 0.30, northStar: 0.25, compensation: 0.15, culture: 0.15, redFlags: 0.15 };

const STOPWORDS = new Set([
  "and", "the", "with", "for", "you", "your", "our", "are", "will", "that", "this", "from", "have", "has",
  "to", "or", "of", "in", "on", "at", "as", "by", "an", "be", "is", "we", "a",
  "我們", "以及", "或者", "或", "與", "和", "工作", "職缺", "能力", "相關", "負責", "具備", "優先"
]);

const SKILL_TERMS = [
  "javascript", "typescript", "react", "vue", "angular", "next.js", "nuxt", "svelte", "node.js", "python",
  "java", "go", "rust", "swift", "kotlin", "sql", "postgresql", "postgres", "mysql", "supabase", "firebase",
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "github actions", "ci/cd", "graphql", "rest api",
  "api", "html", "css", "sass", "tailwind", "tailwind css", "storybook", "figma", "design systems",
  "accessibility", "wcag", "analytics", "dashboard", "data visualization", "etl", "airflow", "spark", "dbt",
  "llm", "rag", "agents", "prompt engineering", "machine learning", "deep learning", "nlp", "computer vision",
  "pytorch", "tensorflow", "mlops", "product management", "crm", "seo", "growth", "sales", "operations",
  "excel", "tableau", "power bi", "中文", "英文", "日文", "資料分析", "數據分析", "前端", "後端", "全端",
  "產品", "設計系統", "無障礙", "機器學習", "人工智慧"
];

const GROWTH_TERMS = ["scale", "scalable", "growth", "0-1", "startup", "founding", "ownership", "lead", "platform", "data", "ai", "llm", "automation", "成長", "新創", "平台", "資料", "自動化"];
const RISK_TERMS = ["unpaid", "commission-only", "volunteer", "internship unpaid", "must be local", "on-site only", "無薪", "純抽成", "責任制", "無底薪"];
const LEGIT_RED = ["apply now via whatsapp", "wire transfer", "send bank", "advance fee", "buy equipment", "training fee", "deposit required", "salary upfront", "whatsapp only", "telegram only"];
const LEGIT_YELLOW = ["work from home guaranteed", "no experience needed", "earn up to", "must pay", "no interview", "quick hire"];
const COMP_TERMS = ["salary", "compensation", "薪資", "薪水", "待遇", "年薪", "月薪", "nt$", "twd", "$", "k/month"];
const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "ashby.io", "workable.com", "bamboohr.com", "smartrecruiters.com",
  "indeed.com", "linkedin.com", "104.com.tw", "yourator.co", "cakeresume.com", "myworkday.com",
  "taleo.net", "icims.com", "jobvite.com", "recruitee.com", "teamtailor.com", "workday.com",
  "japan-dev.com", "tokyodev.com", "amazon.jobs", "careers.microsoft.com", "boards.greenhouse.io",
  "jobs.ashbyhq.com", "wellfound.com", "jobs.lever.co"
];

function printHelp() {
  console.log(`Career Ops GitHub/app 100k comparison

Scores a sharded profile corpus against the CV Studio app-local job universe and
a deterministic scorer derived from upstream santifer/career-ops public rubric.

Usage:
  node scripts/career-ops-github-app-100k-compare.mjs

Options:
  --manifest <file>          Sharded profile manifest. Default: ${DEFAULT_MANIFEST}
  --jobs <file>              CV Studio Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --limit-profiles <n>       Profiles to score. Default: all records in manifest
  --limit-jobs <n>           Limit app-eligible jobs after import filtering
  --upstream-repo <path>     Local clone of santifer/career-ops. Default: ${DEFAULT_UPSTREAM_REPO}
  --out <file>               Summary JSON output. Default: ${DEFAULT_OUT}
  --report-out <file>        Markdown report output. Default: ${DEFAULT_REPORT_OUT}
  --help                     Show this help
`);
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    jobs: DEFAULT_JOBS,
    limitProfiles: 0,
    limitJobs: 0,
    upstreamRepo: DEFAULT_UPSTREAM_REPO,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT_OUT
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--manifest") args.manifest = argv[++i] || DEFAULT_MANIFEST;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--limit-profiles") args.limitProfiles = Number(argv[++i] || 0);
    else if (token === "--limit-jobs") args.limitJobs = Number(argv[++i] || 0);
    else if (token === "--upstream-repo") args.upstreamRepo = argv[++i] || DEFAULT_UPSTREAM_REPO;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT_OUT;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
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

function splitTerms(value) {
  return String(value || "")
    .split(/\n|,|、|;|；|\//)
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenize(value) {
  return Array.from(new Set(String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOPWORDS.has(item))));
}

function isAsciiTermChar(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function hasAsciiBoundaryMatch(source, needle) {
  let index = source.indexOf(needle);
  while (index !== -1) {
    const before = index > 0 ? source[index - 1] : "";
    const after = index + needle.length < source.length ? source[index + needle.length] : "";
    if (!isAsciiTermChar(before) && !isAsciiTermChar(after)) return true;
    index = source.indexOf(needle, index + needle.length);
  }
  return false;
}

function includesLowerTerm(sourceText, term) {
  const needle = String(term || "").toLowerCase().trim();
  if (!needle || STOPWORDS.has(needle)) return false;
  if (needle.includes(" ")) return sourceText.includes(needle);
  if (!sourceText.includes(needle)) return false;
  if (/[^\x00-\x7F]/.test(needle)) return true;
  return hasAsciiBoundaryMatch(sourceText, needle);
}

function locationText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return [value.city, value.region, value.country, value.countryCode].map(text).filter(Boolean).join(", ");
}

function profileFromStructured(profile, index) {
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
  const targetRoles = unique([preferences.targetRoles, role, profile.targetRole]).slice(0, 12);
  return {
    id: String(profile.id || profile.activeProfileId || profile.name || profile.fullName || `profile-${index + 1}`),
    name: String(profile.name || profile.fullName || profile.displayName || profile.basics?.name || `Profile ${index + 1}`),
    role: String(role || "").trim(),
    skills: rawSkills.slice(0, 100),
    targetRoles,
    preferredLocations: unique(preferences.locations || profile.location?.city || locationText(profile.location)).map(String),
    preferredCompanies: unique(preferences.companies).map(String),
    avoidKeywords: unique(preferences.avoidKeywords || preferences.exclude).map(String),
    remote: Boolean(preferences.remote) || /(remote|wfh|遠端|hybrid|混合)/i.test([role, summary, workText, projectText].join(" "))
  };
}

function grade6D(score) {
  if (score >= 87) return "A";
  if (score >= 74) return "B";
  if (score >= 60) return "C";
  if (score >= 44) return "D";
  return "F";
}

function appGrade(score) {
  if (score >= 85) return "A";
  if (score >= 72) return "B";
  if (score >= 58) return "C";
  if (score >= 42) return "D";
  return "F";
}

function githubGrade(rating) {
  if (rating >= 4.5) return "A";
  if (rating >= 4.0) return "B";
  if (rating >= 3.5) return "C";
  if (rating >= 3.0) return "D";
  return "F";
}

function githubRecommendation(rating, blockGTier) {
  if (blockGTier === "Suspicious") return "do-not-apply";
  if (rating >= 4.5) return "apply-immediately";
  if (rating >= 4.0) return "worth-applying";
  if (rating >= 3.5) return "selective-only";
  return "recommend-against";
}

function appRecommendation(score, blockGTier) {
  if (blockGTier === "Suspicious") return "略過";
  if (score >= 80) return "強烈投遞";
  if (score >= 70) return "值得投遞";
  if (score >= 56) return "觀望";
  return "略過";
}

function normalizeAppAction(value) {
  if (value === "強烈投遞" || value === "值得投遞") return "apply";
  if (value === "觀望") return "selective";
  return "skip";
}

function normalizeGithubAction(value) {
  if (value === "apply-immediately" || value === "worth-applying") return "apply";
  if (value === "selective-only") return "selective";
  return "skip";
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

function computeBlockG(job, lowerTextValue, appGenericCareersSignal = false) {
  const url = String(job.url || "").toLowerCase();
  const redHits = LEGIT_RED.filter((term) => lowerTextValue.includes(term));
  const yellowHits = LEGIT_YELLOW.filter((term) => lowerTextValue.includes(term));
  const isKnownAts = Boolean(url && ATS_DOMAINS.some((domain) => url.includes(domain)));
  const postDate = job.datePosted ? new Date(job.datePosted) : null;
  const daysOld = postDate && !Number.isNaN(postDate.getTime())
    ? Math.floor((Date.now() - postDate.getTime()) / 86400000)
    : null;
  const signals = [];
  if (daysOld !== null) {
    if (daysOld > 120) signals.push("stale");
    else if (daysOld > 60) signals.push("aging");
    else if (daysOld <= 14) signals.push("fresh");
  }
  if (isKnownAts) signals.push("known-ats");
  else if (appGenericCareersSignal && url) {
    const urlPath = url.replace(/https?:\/\/[^/]+/, "");
    if (/^\/(careers?|jobs?)\/?(\?.*)?$/.test(urlPath)) signals.push("generic-careers");
  }
  if (!job.url) signals.push("no-url");
  if (String(job.description || "").length < 200) signals.push("thin-description");
  const yellowCount = yellowHits.length + signals.filter((signal) => ["stale", "aging", "generic-careers", "no-url", "thin-description"].includes(signal)).length;
  if (redHits.length >= 2 || (redHits.length >= 1 && !job.url)) return "Suspicious";
  if (redHits.length >= 1 || yellowCount >= 3 || (daysOld !== null && daysOld > 120)) return "Proceed with Caution";
  return "High Confidence";
}

function jobKey(job = {}, index = 0) {
  const url = String(job.url || "").trim();
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) => parsed.searchParams.delete(key));
      return `url:${parsed.href.toLowerCase()}`;
    } catch {}
  }
  const fallback = [job.company, job.title, job.location].map((item) => String(item || "").trim().toLowerCase()).join("|");
  return fallback ? `text:${fallback}` : `job-${index + 1}`;
}

function normalizeAppJob(source, index) {
  return {
    id: String(source.id || `job-${index}`),
    jobKey: String(source.jobKey || source.job_key || jobKey(source, index)).trim(),
    title: String(source.title || "").trim().slice(0, 180) || "未命名職缺",
    company: String(source.company || "").trim().slice(0, 160),
    url: String(source.url || "").trim().slice(0, 600),
    location: String(source.location || "").trim().slice(0, 120),
    description: String(source.description || "").trim().slice(0, 24000),
    source: String(source.source || "").trim().slice(0, 120),
    sourceType: String(source.sourceType || source.source_type || "").trim().slice(0, 80),
    employmentType: String(source.employmentType || source.employment_type || "").trim().slice(0, 80),
    salary: String(source.salary || "").trim().slice(0, 160),
    compensation: String(source.compensation || "").trim().slice(0, 160),
    datePosted: String(source.datePosted || source.date_posted || "").trim().slice(0, 40),
    isNew: Boolean(source.isNew || source.is_new),
    isExpired: Boolean(source.isExpired || source.is_expired)
  };
}

function appJobEligible(job) {
  return !job.isExpired && String(job.description || "").replace(String(job.url || ""), "").trim().length >= 80;
}

function prepareJobs(jobsPayload, limitJobs) {
  const allSnapshotJobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
  const importedJobs = allSnapshotJobs.slice(0, APP_TRACKER_LIMIT).map(normalizeAppJob);
  let jobs = importedJobs.filter(appJobEligible);
  if (Number.isFinite(limitJobs) && limitJobs > 0) jobs = jobs.slice(0, limitJobs);
  const skillCounts = new Map();
  const prepared = jobs.map((job, index) => {
    const textValue = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
    const lowerText = textValue.toLowerCase();
    const skills = SKILL_TERMS.filter((skill) => includesLowerTerm(lowerText, skill)).slice(0, 28);
    for (const skill of skills) skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
    return {
      ...job,
      index,
      textValue,
      lowerText,
      lowerTitleDescription: `${job.title || ""} ${job.description || ""}`.toLowerCase(),
      lowerLocationDescription: `${job.location || ""} ${job.description || ""}`.toLowerCase(),
      lowerCompany: String(job.company || "").toLowerCase(),
      skills,
      family: roleFamily(job),
      level: seniority(job),
      mode: workMode(job),
      growthHitCount: GROWTH_TERMS.filter((term) => includesLowerTerm(lowerText, term)).length,
      riskHitCount: RISK_TERMS.filter((term) => includesLowerTerm(lowerText, term)).length,
      hasSalary: COMP_TERMS.some((term) => lowerText.includes(term)),
      hasRange: /\d/.test(String(job.salary || job.compensation || "")),
      blockGApp: computeBlockG(job, lowerText, true),
      blockGGithub: computeBlockG(job, lowerText, false),
      sourceQ: /^adapter:/i.test(job.sourceType || "") ? 90 : job.sourceType === "json-ld" ? 78 : String(job.description || "").length > 800 ? 72 : 55,
      descriptionLength: String(job.description || "").length
    };
  });
  for (const job of prepared) {
    job.rareHighValueSkillCount = job.skills.filter((skill) => (skillCounts.get(skill) || 0) <= 2).slice(0, 8).length;
  }
  return {
    allSnapshotJobs,
    importedJobs,
    jobs: prepared,
    coverage: {
      snapshotJobs: allSnapshotJobs.length,
      snapshotActiveJobs: allSnapshotJobs.filter((job) => !job.isExpired).length,
      appImportedJobs: importedJobs.length,
      appActiveJobs: importedJobs.filter((job) => !job.isExpired).length,
      appEligibleJobs: prepared.length
    }
  };
}

function termPresenceFactory(jobs, area) {
  const cache = new Map();
  return (term) => {
    const needle = String(term || "").toLowerCase().trim();
    if (!needle || STOPWORDS.has(needle)) return [];
    if (cache.has(needle)) return cache.get(needle);
    const indices = [];
    for (const job of jobs) {
      const source = area === "title" ? job.lowerTitleDescription : area === "location" ? job.lowerLocationDescription : area === "company" ? job.lowerCompany : job.lowerText;
      if (includesLowerTerm(source, needle)) indices.push(job.index);
    }
    cache.set(needle, indices);
    return indices;
  };
}

function incrementPresence(counts, indices) {
  for (let i = 0; i < indices.length; i += 1) counts[indices[i]] += 1;
}

function scoreRowsForProfile(profile, jobs, presence, reusable) {
  const n = jobs.length;
  const skillHits = reusable.skillHits;
  const roleHits = reusable.roleHits;
  const roleExactHits = reusable.roleExactHits;
  const locationHits = reusable.locationHits;
  const companyHits = reusable.companyHits;
  const avoidHits = reusable.avoidHits;
  skillHits.fill(0);
  roleHits.fill(0);
  roleExactHits.fill(0);
  locationHits.fill(0);
  companyHits.fill(0);
  avoidHits.fill(0);

  for (const skill of profile.skills) incrementPresence(skillHits, presence.text(skill));
  for (const role of profile.targetRoles) incrementPresence(roleHits, presence.title(role));
  if (profile.role) incrementPresence(roleExactHits, presence.title(profile.role));
  for (const location of profile.preferredLocations) incrementPresence(locationHits, presence.location(location));
  for (const company of profile.preferredCompanies) incrementPresence(companyHits, presence.company(company));
  for (const avoid of profile.avoidKeywords) incrementPresence(avoidHits, presence.text(avoid));

  return { n, skillHits, roleHits, roleExactHits, locationHits, companyHits, avoidHits };
}

function scorePair(profile, job, counts, index) {
  const profileSkillHitCount = counts.skillHits[index];
  const targetRoleHitCount = counts.roleHits[index];
  const companyHitCount = counts.companyHits[index];
  const locationHitCount = counts.locationHits[index];
  const avoidHitCount = counts.avoidHits[index] + job.riskHitCount;
  const profileSkillCount = profile.skills.length;

  const atsRaw = profileSkillCount ? Math.round((profileSkillHitCount / profileSkillCount) * 100) : Math.min(100, job.skills.length * 12);
  const profileRaw = Math.min(100, profileSkillHitCount * 14 + targetRoleHitCount * 18 + companyHitCount * 10);
  const cvMatch = Math.round(atsRaw * 0.45 + profileRaw * 0.55);

  const roleFitRaw = targetRoleHitCount ? 92 : profile.role && counts.roleExactHits[index] ? 86 : job.family === "Other" ? 45 : 68;
  const senFitRaw = job.level === "Intern" && !/intern|實習/i.test(profile.role) ? 55 : job.level === "Senior+" ? 70 : 82;
  const northStar = Math.round(roleFitRaw * 0.65 + senFitRaw * 0.35);

  const compensation = job.hasSalary ? (job.hasRange ? 90 : 72) : 45;
  const freshness = job.isExpired ? 0 : job.isNew ? 95 : job.datePosted ? 76 : 64;
  const locationFitRaw = locationHitCount || (profile.remote && job.mode === "Remote") ? 95 : job.mode === "Remote" ? 82 : profile.preferredLocations.length ? 58 : 70;
  const growthRaw = Math.min(100, 48 + job.growthHitCount * 9 + job.rareHighValueSkillCount * 4);
  const culture = Math.round(freshness * 0.35 + locationFitRaw * 0.30 + growthRaw * 0.35);

  const riskPenalty = Math.min(80, avoidHitCount * 12 + job.riskHitCount * 18 + (job.isExpired ? 40 : 0) + (job.descriptionLength < 120 ? 15 : 0));
  const redFlags = Math.max(0, 100 - riskPenalty);
  const effort = Math.round((job.url ? (job.descriptionLength > 800 ? 88 : 72) : 48) * 0.5 + job.sourceQ * 0.5);

  const appScore = Math.max(0, Math.min(100, Math.round(
    cvMatch * SCORE_WEIGHTS.cvMatch +
    northStar * SCORE_WEIGHTS.northStar +
    compensation * SCORE_WEIGHTS.compensation +
    culture * SCORE_WEIGHTS.culture +
    redFlags * SCORE_WEIGHTS.redFlags +
    effort * SCORE_WEIGHTS.effort
  )));

  const githubScore100 = Math.max(0, Math.min(100, Math.round(
    cvMatch * GITHUB_WEIGHTS.cvMatch +
    northStar * GITHUB_WEIGHTS.northStar +
    compensation * GITHUB_WEIGHTS.compensation +
    culture * GITHUB_WEIGHTS.culture +
    redFlags * GITHUB_WEIGHTS.redFlags
  )));
  const appRating = Math.round(((appScore / 100) * 4 + 1) * 10) / 10;
  const githubRating = Math.round(((githubScore100 / 100) * 4 + 1) * 10) / 10;
  const appRec = appRecommendation(appScore, job.blockGApp);
  const githubRec = githubRecommendation(githubRating, job.blockGGithub);

  return {
    appScore,
    githubScore100,
    appRating,
    githubRating,
    appGrade: appGrade(appScore),
    githubGrade: githubGrade(githubRating),
    appRecommendation: appRec,
    githubRecommendation: githubRec,
    appAction: normalizeAppAction(appRec),
    githubAction: normalizeGithubAction(githubRec),
    appBlockG: job.blockGApp,
    githubBlockG: job.blockGGithub,
    dimensions: { cvMatch, northStar, compensation, culture, redFlags, effort }
  };
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function compactCounts(map) {
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function average(value, count, digits = 2) {
  if (!count) return 0;
  const factor = 10 ** digits;
  return Math.round((value / count) * factor) / factor;
}

function pushTop(list, item, limit) {
  const abs = item.absRatingDelta;
  if (list.length < limit) {
    list.push(item);
    list.sort((a, b) => b.absRatingDelta - a.absRatingDelta || b.githubRating - a.githubRating);
    return;
  }
  if (abs <= list[list.length - 1].absRatingDelta) return;
  list[list.length - 1] = item;
  list.sort((a, b) => b.absRatingDelta - a.absRatingDelta || b.githubRating - a.githubRating);
}

function addJobAgg(map, job, appScore, githubScore100, appAction, githubAction) {
  const key = job.jobKey || jobKey(job, job.index);
  let item = map.get(key);
  if (!item) {
    item = { jobId: key, company: job.company || "", title: job.title || "", count: 0, appSum: 0, githubSum: 0, actionDiffCount: 0 };
    map.set(key, item);
  }
  item.count += 1;
  item.appSum += appScore;
  item.githubSum += githubScore100;
  if (appAction !== githubAction) item.actionDiffCount += 1;
}

function addRoleAgg(map, profile, appScore, githubScore100, appAction, githubAction) {
  const key = profile.role || "unknown";
  let item = map.get(key);
  if (!item) item = { role: key, count: 0, profileCount: new Set(), appSum: 0, githubSum: 0, actionDiffCount: 0 };
  item.count += 1;
  item.profileCount.add(profile.id);
  item.appSum += appScore;
  item.githubSum += githubScore100;
  if (appAction !== githubAction) item.actionDiffCount += 1;
  map.set(key, item);
}

function summarizeJobs(map) {
  return Array.from(map.values())
    .map((item) => ({
      jobId: item.jobId,
      company: item.company,
      title: item.title,
      count: item.count,
      appAverageScore: average(item.appSum, item.count),
      githubAverageScore100: average(item.githubSum, item.count),
      averageDelta100: average(item.appSum - item.githubSum, item.count),
      actionDiffCount: item.actionDiffCount
    }))
    .sort((a, b) => Math.abs(b.averageDelta100) - Math.abs(a.averageDelta100) || b.actionDiffCount - a.actionDiffCount)
    .slice(0, 25);
}

function summarizeRoles(map) {
  return Array.from(map.values())
    .map((item) => ({
      role: item.role,
      profiles: item.profileCount.size,
      rows: item.count,
      appAverageScore: average(item.appSum, item.count),
      githubAverageScore100: average(item.githubSum, item.count),
      averageDelta100: average(item.appSum - item.githubSum, item.count),
      actionDiffCount: item.actionDiffCount
    }))
    .sort((a, b) => Math.abs(b.averageDelta100) - Math.abs(a.averageDelta100) || b.rows - a.rows)
    .slice(0, 30);
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") await fsp.mkdir(dir, { recursive: true });
}

function upstreamMetadata(repoPath) {
  const meta = {
    repoPath,
    available: fs.existsSync(repoPath),
    commit: "",
    commitDate: "",
    portalTemplate: { trackedCompanies: 0, enabledTrackedCompanies: 0, searchQueries: 0, enabledSearchQueries: 0 }
  };
  if (!meta.available) return meta;
  const git = spawnSync("git", ["-C", repoPath, "log", "-1", "--format=%H%n%ci"], { encoding: "utf8" });
  if (git.status === 0) {
    const [commit, commitDate] = git.stdout.trim().split("\n");
    meta.commit = commit || "";
    meta.commitDate = commitDate || "";
  }
  const portalsPath = path.join(repoPath, "templates/portals.example.yml");
  if (!fs.existsSync(portalsPath)) return meta;
  const lines = fs.readFileSync(portalsPath, "utf8").split(/\r?\n/);
  let section = "";
  let lastItem = "";
  for (const line of lines) {
    if (/^search_queries:\s*$/.test(line)) section = "search";
    else if (/^tracked_companies:\s*$/.test(line)) section = "tracked";
    else if (/^\S/.test(line) && !/^#/.test(line) && !/^(title_filter|location_filter):/.test(line)) section = "";
    if (/^\s*-\s+name:\s+/.test(line)) {
      lastItem = section;
      if (section === "tracked") {
        meta.portalTemplate.trackedCompanies += 1;
        meta.portalTemplate.enabledTrackedCompanies += 1;
      } else if (section === "search") {
        meta.portalTemplate.searchQueries += 1;
        meta.portalTemplate.enabledSearchQueries += 1;
      }
    }
    if (/^\s*enabled:\s*false\s*$/.test(line)) {
      if (lastItem === "tracked") meta.portalTemplate.enabledTrackedCompanies -= 1;
      if (lastItem === "search") meta.portalTemplate.enabledSearchQueries -= 1;
    }
  }
  return meta;
}

function renderReport(summary) {
  const d = summary.resultDifferences;
  return [
    "# 100k Resume Scoring: CV App vs GitHub career-ops",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Execution",
    `- Profiles scored: ${summary.coverage.profileCount}`,
    `- App imported jobs: ${summary.coverage.appImportedJobs}`,
    `- App eligible jobs compared: ${summary.coverage.appEligibleJobs}`,
    `- Pairwise scoring rows: ${summary.coverage.comparedRows}`,
    `- Upstream repo: santifer/career-ops ${summary.upstream.commit ? `@ ${summary.upstream.commit.slice(0, 12)}` : "(not found)"}`,
    `- Upstream portal template: ${summary.upstream.portalTemplate.enabledTrackedCompanies}/${summary.upstream.portalTemplate.trackedCompanies} enabled tracked companies, ${summary.upstream.portalTemplate.enabledSearchQueries}/${summary.upstream.portalTemplate.searchQueries} enabled search queries`,
    "",
    "## Result Differences",
    `- App average score: ${summary.app.averageScore100}/100 (${summary.app.averageRating5}/5)`,
    `- GitHub career-ops rubric-compatible average: ${summary.githubCareerOps.averageScore100}/100 (${summary.githubCareerOps.averageRating5}/5)`,
    `- Average delta (app - GitHub rubric): ${d.averageDelta100} points / ${d.averageDeltaRating5} rating`,
    `- Average absolute delta: ${d.averageAbsDelta100} points / ${d.averageAbsDeltaRating5} rating`,
    `- Max absolute rating delta: ${d.maxAbsDeltaRating5}`,
    `- Rating exact match: ${d.ratingExactMatchRate}%`,
    `- Within 0.1 rating: ${d.withinPoint1Rate}%`,
    `- Within 0.3 rating: ${d.withinPoint3Rate}%`,
    `- Within 0.5 rating: ${d.withinPoint5Rate}%`,
    `- Grade match: ${d.gradeMatchRate}%`,
    `- Action match: ${d.actionMatchRate}%`,
    `- Block G match: ${d.blockGMatchRate}%`,
    "",
    "## App Distribution",
    `- Grades: ${Object.entries(summary.app.gradeDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Recommendations: ${Object.entries(summary.app.recommendationDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "",
    "## GitHub career-ops Distribution",
    `- Grades: ${Object.entries(summary.githubCareerOps.gradeDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Recommendations: ${Object.entries(summary.githubCareerOps.recommendationDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "",
    "## Largest Rating Divergences",
    ...d.topDivergences.slice(0, 10).map((item, index) =>
      `- ${index + 1}. Δ ${item.ratingDelta >= 0 ? "+" : ""}${item.ratingDelta} - ${item.profileId} -> ${item.company} / ${item.title} (app ${item.appRating}, GitHub ${item.githubRating})`
    ),
    "",
    "## Jobs With Largest Average Delta",
    ...d.jobsByAverageDelta.slice(0, 10).map((item, index) =>
      `- ${index + 1}. Δ ${item.averageDelta100 >= 0 ? "+" : ""}${item.averageDelta100} - ${item.company} / ${item.title} (rows ${item.count}, action diff ${item.actionDiffCount})`
    ),
    "",
    "## Roles With Largest Average Delta",
    ...d.rolesByAverageDelta.slice(0, 10).map((item, index) =>
      `- ${index + 1}. Δ ${item.averageDelta100 >= 0 ? "+" : ""}${item.averageDelta100} - ${item.role} (${item.profiles} profiles, rows ${item.rows})`
    ),
    "",
    "## Functional Differences",
    ...summary.featureDifferences.flatMap((item) => [
      `### ${item.area}`,
      `- App: ${item.app}`,
      `- GitHub career-ops: ${item.githubCareerOps}`,
      `- Difference: ${item.difference}`
    ]),
    "",
    "## Notes",
    ...summary.notes.map((note) => `- ${note}`)
  ].join("\n");
}

function featureDifferences(coverage, upstream) {
  return [
    {
      area: "資料模型",
      app: "CV App 已可保留 Career Ops 結構化 profile，並用前台 tracker 對匯入 jobs 做互動式評分。",
      githubCareerOps: "原版 GitHub career-ops 以單一 `cv.md`、`profile.yml`、`portals.yml` 和本機 tracker 為中心，沒有內建 10 萬份 resume corpus。",
      difference: "本次 10 萬筆是用本地批量 scorer 跑完整 corpus；原版若逐筆用 agent A-G 報告跑，會變成 10 萬次以上的 LLM 工作流。"
    },
    {
      area: "職缺 coverage",
      app: `App tracker 上限是 ${APP_TRACKER_LIMIT} jobs；本次共同比較 ${coverage.appEligibleJobs} 筆 app-eligible jobs。`,
      githubCareerOps: `上游模板目前約 ${upstream.portalTemplate.enabledTrackedCompanies}/${upstream.portalTemplate.trackedCompanies} enabled companies + ${upstream.portalTemplate.enabledSearchQueries}/${upstream.portalTemplate.searchQueries} enabled search queries，但 repo 不附即時 jobs snapshot。`,
      difference: "結果比較使用同一批 app jobs 以排除資料來源差；功能比較則列出上游 scan/pipeline 能力。"
    },
    {
      area: "評分方式",
      app: "Browser-local deterministic 100 分制，含 CV match、north star、compensation、culture、red flags、effort，並轉成投遞建議。",
      githubCareerOps: "公開 rubric 是 1-5 分制 A-G agent report：A-F 評估加 Block G legitimacy，理想流程會讀 CV 行號、做 WebSearch compensation/company research、生成 PDF 與 tracker。",
      difference: "本次使用 GitHub rubric-compatible deterministic scorer 批量近似；它不能取代原版逐職缺 LLM 報告，但可做 10 萬筆統計比較。"
    },
    {
      area: "輸出",
      app: "適合前台操作、排序、狀態追蹤、CSV export、客製 ATS PDF。",
      githubCareerOps: "適合 slash-command/agent workflow、Markdown report、PDF、TSV tracker、batch workers、Go TUI dashboard。",
      difference: "App 更像產品化 UI；GitHub career-ops 更像本地 agent 作業系統。"
    }
  ];
}

async function loadShardProfiles(manifest, shard) {
  const shardPath = shard.path || path.join(manifest.directory || path.dirname(DEFAULT_MANIFEST), shard.file);
  const payload = await readJson(shardPath);
  return Array.isArray(payload) ? payload : Array.isArray(payload.profiles) ? payload.profiles : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const [manifest, jobsPayload] = await Promise.all([readJson(args.manifest), readJson(args.jobs)]);
  const upstream = upstreamMetadata(args.upstreamRepo);
  const { jobs, coverage: jobCoverage } = prepareJobs(jobsPayload, args.limitJobs);
  if (!jobs.length) throw new Error("No app-eligible jobs found.");

  const profileLimit = Number.isFinite(args.limitProfiles) && args.limitProfiles > 0
    ? Math.min(args.limitProfiles, Number(manifest.totalRecords || args.limitProfiles))
    : Number(manifest.totalRecords || 0) || Infinity;

  const presence = {
    text: termPresenceFactory(jobs, "text"),
    title: termPresenceFactory(jobs, "title"),
    location: termPresenceFactory(jobs, "location"),
    company: termPresenceFactory(jobs, "company")
  };
  const reusable = {
    skillHits: new Uint16Array(jobs.length),
    roleHits: new Uint16Array(jobs.length),
    roleExactHits: new Uint16Array(jobs.length),
    locationHits: new Uint16Array(jobs.length),
    companyHits: new Uint16Array(jobs.length),
    avoidHits: new Uint16Array(jobs.length)
  };

  const appGrades = new Map();
  const githubGrades = new Map();
  const appRec = new Map();
  const githubRec = new Map();
  const appBlockG = new Map();
  const githubBlockG = new Map();
  const jobsAgg = new Map();
  const rolesAgg = new Map();
  const topDivergences = [];

  let profileCount = 0;
  let comparedRows = 0;
  let appScoreSum = 0;
  let githubScoreSum = 0;
  let appRatingSum = 0;
  let githubRatingSum = 0;
  let delta100Sum = 0;
  let absDelta100Sum = 0;
  let deltaRatingSum = 0;
  let absDeltaRatingSum = 0;
  let maxAbsDeltaRating = 0;
  let ratingExact = 0;
  let withinPoint1 = 0;
  let withinPoint3 = 0;
  let withinPoint5 = 0;
  let gradeMatch = 0;
  let actionMatch = 0;
  let blockGMatch = 0;

  const startedAt = Date.now();
  for (const shard of manifest.shards || []) {
    if (profileCount >= profileLimit) break;
    const rawProfiles = await loadShardProfiles(manifest, shard);
    for (const rawProfile of rawProfiles) {
      if (profileCount >= profileLimit) break;
      const profile = profileFromStructured(rawProfile, profileCount);
      const counts = scoreRowsForProfile(profile, jobs, presence, reusable);
      profileCount += 1;

      for (let index = 0; index < counts.n; index += 1) {
        const job = jobs[index];
        const result = scorePair(profile, job, counts, index);
        const delta100 = result.appScore - result.githubScore100;
        const absDelta100 = Math.abs(delta100);
        const ratingDelta = Math.round((result.appRating - result.githubRating) * 10) / 10;
        const absRatingDelta = Math.abs(ratingDelta);

        comparedRows += 1;
        appScoreSum += result.appScore;
        githubScoreSum += result.githubScore100;
        appRatingSum += result.appRating;
        githubRatingSum += result.githubRating;
        delta100Sum += delta100;
        absDelta100Sum += absDelta100;
        deltaRatingSum += ratingDelta;
        absDeltaRatingSum += absRatingDelta;
        if (absRatingDelta > maxAbsDeltaRating) maxAbsDeltaRating = absRatingDelta;
        if (ratingDelta === 0) ratingExact += 1;
        if (absRatingDelta <= 0.1) withinPoint1 += 1;
        if (absRatingDelta <= 0.3) withinPoint3 += 1;
        if (absRatingDelta <= 0.5) withinPoint5 += 1;
        if (result.appGrade === result.githubGrade) gradeMatch += 1;
        if (result.appAction === result.githubAction) actionMatch += 1;
        if (result.appBlockG === result.githubBlockG) blockGMatch += 1;

        increment(appGrades, result.appGrade);
        increment(githubGrades, result.githubGrade);
        increment(appRec, result.appRecommendation);
        increment(githubRec, result.githubRecommendation);
        increment(appBlockG, result.appBlockG);
        increment(githubBlockG, result.githubBlockG);
        addJobAgg(jobsAgg, job, result.appScore, result.githubScore100, result.appAction, result.githubAction);
        addRoleAgg(rolesAgg, profile, result.appScore, result.githubScore100, result.appAction, result.githubAction);
        pushTop(topDivergences, {
          profileId: profile.id,
          profileRole: profile.role,
          jobId: job.jobKey,
          company: job.company,
          title: job.title,
          appRating: result.appRating,
          githubRating: result.githubRating,
          ratingDelta,
          absRatingDelta,
          appScore: result.appScore,
          githubScore100: result.githubScore100,
          appGrade: result.appGrade,
          githubGrade: result.githubGrade,
          appRecommendation: result.appRecommendation,
          githubRecommendation: result.githubRecommendation
        }, 50);
      }
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[career-ops] profiles ${profileCount}/${profileLimit} rows ${comparedRows} elapsed ${elapsed}s`);
  }

  const rate = (value) => comparedRows ? Math.round((value / comparedRows) * 10000) / 100 : 0;
  const summary = {
    generatedAt: new Date().toISOString(),
    executionMode: "full-corpus-summary; github-career-ops-rubric-compatible-deterministic-scorer",
    inputs: {
      manifest: args.manifest,
      jobs: args.jobs,
      limitProfiles: Number.isFinite(profileLimit) ? profileLimit : 0,
      limitJobs: args.limitJobs,
      upstreamRepo: args.upstreamRepo
    },
    outputs: {
      json: args.out,
      report: args.reportOut
    },
    upstream,
    coverage: {
      profileCount,
      ...jobCoverage,
      comparedRows
    },
    app: {
      averageScore100: average(appScoreSum, comparedRows),
      averageRating5: average(appRatingSum, comparedRows),
      gradeDistribution: compactCounts(appGrades),
      recommendationDistribution: compactCounts(appRec),
      blockGDistribution: compactCounts(appBlockG)
    },
    githubCareerOps: {
      averageScore100: average(githubScoreSum, comparedRows),
      averageRating5: average(githubRatingSum, comparedRows),
      gradeDistribution: compactCounts(githubGrades),
      recommendationDistribution: compactCounts(githubRec),
      blockGDistribution: compactCounts(githubBlockG)
    },
    resultDifferences: {
      averageDelta100: average(delta100Sum, comparedRows),
      averageAbsDelta100: average(absDelta100Sum, comparedRows),
      averageDeltaRating5: average(deltaRatingSum, comparedRows),
      averageAbsDeltaRating5: average(absDeltaRatingSum, comparedRows),
      maxAbsDeltaRating5: Math.round(maxAbsDeltaRating * 10) / 10,
      ratingExactMatchRate: rate(ratingExact),
      withinPoint1Rate: rate(withinPoint1),
      withinPoint3Rate: rate(withinPoint3),
      withinPoint5Rate: rate(withinPoint5),
      gradeMatchRate: rate(gradeMatch),
      actionMatchRate: rate(actionMatch),
      blockGMatchRate: rate(blockGMatch),
      topDivergences,
      jobsByAverageDelta: summarizeJobs(jobsAgg),
      rolesByAverageDelta: summarizeRoles(rolesAgg)
    },
    featureDifferences: featureDifferences({ ...jobCoverage, profileCount, comparedRows }, upstream),
    notes: [
      "Original GitHub career-ops is prompt/agent driven and does not ship a bulk 100k profile scoring API.",
      "This run uses the upstream public 1-5 rubric shape as a deterministic scorer so the full 100k corpus can be evaluated locally and repeatably.",
      "The comparison uses the same app-eligible job set for both scorers to isolate scoring/function differences from data-source differences.",
      "No pairwise CSV was written because 100000 profiles x app-eligible jobs would create a very large row-level artifact."
    ]
  };

  await Promise.all([ensureDir(args.out), ensureDir(args.reportOut)]);
  await fsp.writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fsp.writeFile(args.reportOut, `${renderReport(summary)}\n`, "utf8");
  console.log(`[career-ops] compared ${comparedRows} row(s)`);
  console.log(`[career-ops] summary -> ${args.out}`);
  console.log(`[career-ops] report -> ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
