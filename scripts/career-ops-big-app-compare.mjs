#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DEFAULT_MANIFEST = "data/career-ops-profiles/manifest.json";
const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-big-app-comparison.json";
const DEFAULT_REPORT_OUT = "data/app/career-ops-big-app-comparison.md";
const DEFAULT_CSV_OUT = "data/app/career-ops-big-app-comparison-results.csv";
const DEFAULT_LIMIT_PROFILES = 1000;
const APP_TRACKER_LIMIT = 1000;
const APP_CV_FIELDS = ["name", "role", "email", "phone", "location", "website", "avatar", "summary", "skills", "highlights", "experience", "education", "projects", "awards"];
const SCORE_WEIGHTS = { cvMatch: 0.25, northStar: 0.20, compensation: 0.15, culture: 0.15, redFlags: 0.15, effort: 0.10 };

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
  console.log(`Career Ops big app comparison

Compares the CV Studio browser-local Career Ops engine with the backend Career Ops
batch scorer over a profile corpus and a job snapshot.

Usage:
  node scripts/career-ops-big-app-compare.mjs

Options:
  --manifest <file>       Sharded profile manifest. Default: ${DEFAULT_MANIFEST}
  --profiles <file>       Profile JSON or shard JSON. Overrides --manifest
  --jobs <file>           Career Ops jobs snapshot JSON. Default: ${DEFAULT_JOBS}
  --limit-profiles <n>    Profiles to load. Default: ${DEFAULT_LIMIT_PROFILES}
  --limit-jobs <n>        Jobs to compare after import/active filtering
  --include-expired       Include expired jobs in backend and app coverage
  --out <file>            Summary JSON output. Default: ${DEFAULT_OUT}
  --report-out <file>     Markdown report output. Default: ${DEFAULT_REPORT_OUT}
  --csv-out <file>        Pairwise CSV output. Default: ${DEFAULT_CSV_OUT}
  --no-csv                Skip pairwise CSV output
  --help                  Show this help
`);
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    profiles: "",
    jobs: DEFAULT_JOBS,
    limitProfiles: DEFAULT_LIMIT_PROFILES,
    limitJobs: 0,
    includeExpired: false,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT_OUT,
    csvOut: DEFAULT_CSV_OUT,
    writeCsv: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--manifest") args.manifest = argv[++i] || DEFAULT_MANIFEST;
    else if (token === "--profiles") args.profiles = argv[++i] || "";
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--limit-profiles") args.limitProfiles = Number(argv[++i] || DEFAULT_LIMIT_PROFILES);
    else if (token === "--limit-jobs") args.limitJobs = Number(argv[++i] || 0);
    else if (token === "--include-expired") args.includeExpired = true;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT_OUT;
    else if (token === "--csv-out") args.csvOut = argv[++i] || DEFAULT_CSV_OUT;
    else if (token === "--no-csv") args.writeCsv = false;
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

function includesTerm(source, term) {
  return includesLowerTerm(String(source || "").toLowerCase(), term);
}

const JOB_SCORE_CACHE = new WeakMap();

function scoreCache(job) {
  if (!job || typeof job !== "object") return null;
  let cache = JOB_SCORE_CACHE.get(job);
  if (!cache) {
    cache = { lower: new Map(), matches: new Map(), values: new Map() };
    JOB_SCORE_CACHE.set(job, cache);
  }
  return cache;
}

function cachedLower(job, key, value) {
  const cache = scoreCache(job);
  if (!cache) return String(value || "").toLowerCase();
  if (!cache.lower.has(key)) cache.lower.set(key, String(value || "").toLowerCase());
  return cache.lower.get(key);
}

function cachedValue(job, key, getter) {
  const cache = scoreCache(job);
  if (!cache) return getter();
  if (!cache.values.has(key)) cache.values.set(key, getter());
  return cache.values.get(key);
}

function cachedIncludes(job, area, lowerSource, term) {
  const cache = scoreCache(job);
  const needle = String(term || "").toLowerCase().trim();
  if (!cache) return includesLowerTerm(lowerSource, needle);
  const key = `${area}\u0000${needle}`;
  if (!cache.matches.has(key)) cache.matches.set(key, includesLowerTerm(lowerSource, needle));
  return cache.matches.get(key);
}

function tokenize(value) {
  return Array.from(new Set(String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOPWORDS.has(item))));
}

function splitTerms(value) {
  return String(value || "")
    .split(/\n|,|、|;|；|\//)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dateRange(item = {}) {
  return [item.startDate || item.start || item.from, item.endDate || item.end || item.to].map(text).filter(Boolean).join(" - ");
}

function locationText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return [value.city, value.region, value.country, value.countryCode].map(text).filter(Boolean).join(", ");
}

function formatWork(profile) {
  const source = array(profile.workExperience).length ? profile.workExperience : array(profile.employmentHistory).length ? profile.employmentHistory : profile.careerTimeline;
  const formatted = array(source).map((item) => {
    if (!item || typeof item !== "object") return text(item);
    const header = [item.position || item.title || item.role, item.company || item.organization, dateRange(item)].map(text).filter(Boolean).join(" | ");
    const highlights = array(item.highlights || item.bullets || item.responsibilities).map((line) => `- ${text(line)}`).filter((line) => line.length > 2).join("\n");
    return [header, item.summary, highlights].map(text).filter(Boolean).join("\n");
  }).filter(Boolean);
  return formatted.join("\n\n") || text(profile.experience || profile.resumeText);
}

function formatSkills(profile) {
  const grouped = Object.values(profile.skillGroups && typeof profile.skillGroups === "object" ? profile.skillGroups : {}).flat();
  const skillYears = array(profile.skillExperience || profile.skillMatrix).map((item) => {
    if (!item || typeof item !== "object") return item;
    const years = item.years || item.yearsOfExperience || item.experienceYears;
    return [item.skill || item.name, years ? `${years}y` : "", item.level || item.proficiency].map(text).filter(Boolean).join(" ");
  });
  return unique([profile.skills, grouped, skillYears]).join(", ");
}

function formatHighlights(profile) {
  const proofPoints = array(profile.proofPoints).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.title || item.name, item.result || item.impact, array(item.metrics).join(", ")].map(text).filter(Boolean).join(": ");
  });
  const stories = array(profile.starStories).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.theme || item.title, item.star?.result || item.result].map(text).filter(Boolean).join(": ");
  });
  return unique([profile.headline, profile.highlights, proofPoints, stories]).join("\n");
}

function formatEducation(profile) {
  const source = array(profile.educationDetails).length ? profile.educationDetails : array(profile.educationHistory).length ? profile.educationHistory : profile.education;
  return array(source).map((item) => {
    if (!item || typeof item !== "object") return text(item);
    return [
      [item.institution || item.school || item.university, item.area || item.field, item.studyType || item.degree].map(text).filter(Boolean).join(" | "),
      dateRange(item) || text(item.graduationYear),
      item.summary || item.description
    ].map(text).filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

function formatProjects(profile) {
  const source = array(profile.portfolioProjects).length ? profile.portfolioProjects : array(profile.projects).length ? profile.projects : profile.projectHighlights;
  return array(source).map((item) => {
    if (!item || typeof item !== "object") return text(item);
    const header = [item.name || item.title, item.role, item.url].map(text).filter(Boolean).join(" | ");
    const highlights = array(item.highlights || item.bullets || item.outcomes).map((line) => `- ${text(line)}`).filter((line) => line.length > 2).join("\n");
    return [header, item.summary || item.description, highlights].map(text).filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

function formatAwards(profile) {
  const languages = array(profile.languageProficiencies || profile.languages).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.language || item.name, item.level || item.proficiency, item.test || item.evidence].map(text).filter(Boolean).join(" | ");
  });
  const certifications = array(profile.certifications).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.name || item.title, item.issuer, item.date || item.year].map(text).filter(Boolean).join(" | ");
  });
  return unique([profile.awards, certifications, languages]).join("\n");
}

function appCvProjection(profile) {
  const contact = profile.contact && typeof profile.contact === "object" ? profile.contact : {};
  const basics = profile.basics && typeof profile.basics === "object" ? profile.basics : {};
  const links = unique([
    profile.website,
    contact.website,
    basics.website,
    array(contact.profiles || basics.profiles).map((item) => item?.url || item?.username),
    array(profile.personalLinks).map((item) => item?.url || item?.href || item?.value)
  ]);
  return {
    name: profile.name || profile.fullName || profile.displayName || contact.name || basics.name,
    role: profile.targetRole || profile.role || profile.seniority || contact.label || basics.label,
    email: profile.email || contact.email || basics.email,
    phone: profile.phone || contact.phone || basics.phone,
    location: locationText(profile.location || contact.location || basics.location),
    website: links[0] || "",
    avatar: profile.avatar || "",
    summary: profile.professionalSummary || profile.summary || profile.description || profile.headline,
    skills: formatSkills(profile),
    highlights: formatHighlights(profile),
    experience: formatWork(profile),
    education: formatEducation(profile) || text(profile.education),
    projects: formatProjects(profile) || text(profile.projects),
    awards: formatAwards(profile)
  };
}

function appProfileFromProjection(cv) {
  const cvText = [cv.role, cv.summary, cv.skills, cv.highlights, cv.experience, cv.education, cv.projects, cv.awards].join("\n");
  const explicitSkills = splitTerms(cv.skills);
  const inferredSkills = SKILL_TERMS.filter((skill) => includesTerm(cvText, skill));
  const skills = unique([...explicitSkills, ...inferredSkills]).slice(0, 80);
  const targetRoles = unique([
    cv.role,
    ...splitTerms(cv.role).filter((item) => /engineer|developer|designer|manager|analyst|前端|後端|全端|產品|設計|資料/i.test(item))
  ]).slice(0, 12);
  return {
    name: String(cv.name || "").trim(),
    role: String(cv.role || "").trim(),
    skills,
    keywords: unique([...targetRoles, ...skills, ...tokenize(cv.summary).slice(0, 24)]),
    targetRoles,
    preferredLocations: splitTerms(cv.location),
    preferredCompanies: [],
    avoidKeywords: [],
    remote: /(remote|wfh|遠端|hybrid|混合)/i.test(cvText)
  };
}

function appProfileFromStructuredProfile(profile, index) {
  return {
    ...backendProfile(profile, index),
    appProfileMode: "structured-career-ops-profile"
  };
}

function backendProfile(profile, index) {
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
    summary: String(summary || "").trim(),
    skills: rawSkills,
    targetRoles,
    preferredLocations: unique(preferences.locations || profile.location?.city || profile.location).map(String),
    preferredCompanies: unique(preferences.companies).map(String),
    avoidKeywords: unique(preferences.avoidKeywords || preferences.exclude).map(String),
    remote: Boolean(preferences.remote) || /(remote|wfh|遠端|hybrid|混合)/i.test([role, summary, workText, projectText].join(" ")),
    synthetic: Boolean(profile.synthetic)
  };
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

function appExtractSkills(job) {
  const source = `${job.title || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
  return extractSkillsFromText(source);
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

function computeBlockG(job, textValue, options = {}) {
  const lower = textValue.toLowerCase();
  const url = String(job.url || "").toLowerCase();
  const redHits = LEGIT_RED.filter((term) => lower.includes(term));
  const yellowHits = LEGIT_YELLOW.filter((term) => lower.includes(term));
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
  if (isKnownAts) {
    signals.push({ k: "green", msg: "Known ATS platform URL" });
  } else if (options.appGenericCareersSignal && url) {
    const urlPath = url.replace(/https?:\/\/[^/]+/, "");
    if (/^\/(careers?|jobs?)\/?(\?.*)?$/.test(urlPath)) signals.push({ k: "yellow", msg: "Generic careers page - no job-specific ID in URL" });
  }
  if (!job.url) signals.push({ k: "yellow", msg: "No job URL" });
  if (String(job.description || "").length < 200) signals.push({ k: "yellow", msg: "Very short job description" });
  const yellowCount = yellowHits.length + signals.filter((signal) => signal.k === "yellow").length;
  if (redHits.length >= 2 || (redHits.length >= 1 && !job.url)) return { tier: "Suspicious", confidence: "low", redHits, yellowHits, signals };
  if (redHits.length >= 1 || yellowCount >= 3 || (daysOld !== null && daysOld > 120)) return { tier: "Proceed with Caution", confidence: "medium", redHits, yellowHits, signals };
  return { tier: "High Confidence", confidence: isKnownAts ? "high" : "medium", redHits, yellowHits, signals };
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

function normalizeBackendJobs(payload, includeExpired) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  return jobs
    .filter((job) => includeExpired || !job.isExpired)
    .map((job, index) => {
      const textValue = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
      const skills = extractSkillsFromText(textValue);
      return {
        ...job,
        id: String(job.id || job.jobKey || job.url || jobKey(job, index)),
        jobKey: String(job.jobKey || jobKey(job, index)),
        simulationJobIndex: index + 1,
        textValue,
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

function normalizeAppJob(job, index = 0) {
  const source = job && typeof job === "object" ? job : {};
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
    validThrough: String(source.validThrough || source.valid_through || "").trim().slice(0, 40),
    status: String(source.status || "待評估"),
    isNew: Boolean(source.isNew || source.is_new),
    isExpired: Boolean(source.isExpired || source.is_expired),
    score: source.score,
    grade: source.grade,
    recommendation: source.recommendation,
    dimensions: source.dimensions && typeof source.dimensions === "object" ? source.dimensions : null,
    blockG: source.blockG && typeof source.blockG === "object" ? source.blockG : null,
    evaluation: source.evaluation && typeof source.evaluation === "object" ? source.evaluation : null,
    intelligence: source.intelligence && typeof source.intelligence === "object" ? source.intelligence : null
  };
}

function appJobEligible(job) {
  return !job.isExpired && String(job.description || "").replace(String(job.url || ""), "").trim().length >= 80;
}

function skillCounts(jobs, getter) {
  const counts = new Map();
  for (const job of jobs) {
    if (job.isExpired) continue;
    for (const skill of getter(job)) counts.set(skill, (counts.get(skill) || 0) + 1);
  }
  return counts;
}

function scoreProfileJob(profile, job, counts, options = {}) {
  const textValue = options.textValue
    ? options.textValue(job)
    : `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
  const lowerTextValue = cachedLower(job, "score:text", textValue);
  const lowerTitleDescription = cachedLower(job, "score:title-description", `${job.title || ""} ${job.description || ""}`);
  const lowerLocationDescription = cachedLower(job, "score:location-description", `${job.location || ""} ${job.description || ""}`);
  const lowerCompany = cachedLower(job, "score:company", job.company || "");
  const skills = options.skills
    ? cachedValue(job, "score:option-skills", () => options.skills(job))
    : job.skills || cachedValue(job, "score:extracted-skills", () => extractSkillsFromText(textValue));
  const family = job.roleFamily || roleFamily(job);
  const level = job.seniority || seniority(job);
  const mode = job.workMode || workMode(job);
  const growthHits = job.growthHits || cachedValue(job, "score:growth-hits", () =>
    GROWTH_TERMS.filter((term) => cachedIncludes(job, "text", lowerTextValue, term)));
  const riskHits = job.riskHits || cachedValue(job, "score:risk-hits", () =>
    RISK_TERMS.filter((term) => cachedIncludes(job, "text", lowerTextValue, term)));
  const blockG = options.blockG
    ? cachedValue(job, "score:option-block-g", () => options.blockG(job, textValue))
    : job.blockG || cachedValue(job, "score:block-g", () => computeBlockG(job, textValue));

  const profileSkills = profile.skills.filter((skill) => cachedIncludes(job, "text", lowerTextValue, skill)).slice(0, 18);
  const missingProfileSkills = profile.skills.filter((skill) => !cachedIncludes(job, "text", lowerTextValue, skill)).slice(0, 12);
  const targetRoleHits = profile.targetRoles.filter((role) => cachedIncludes(job, "title-description", lowerTitleDescription, role));
  const locationHits = profile.preferredLocations.filter((location) => cachedIncludes(job, "location-description", lowerLocationDescription, location));
  const companyHits = (profile.preferredCompanies || []).filter((company) => cachedIncludes(job, "company", lowerCompany, company));
  const avoidHits = [...(profile.avoidKeywords || []), ...RISK_TERMS].filter((term) => cachedIncludes(job, "text", lowerTextValue, term));
  const rareHighValueSkills = skills.filter((skill) => (counts.get(skill) || 0) <= 2).slice(0, 8);

  const atsRaw = profile.skills.length ? Math.round((profileSkills.length / profile.skills.length) * 100) : Math.min(100, skills.length * 12);
  const profileRaw = Math.min(100, profileSkills.length * 14 + targetRoleHits.length * 18 + companyHits.length * 10);
  const cvMatch = Math.round(atsRaw * 0.45 + profileRaw * 0.55);

  const roleFitRaw = targetRoleHits.length ? 92 : profile.role && cachedIncludes(job, "title-description", lowerTitleDescription, profile.role) ? 86 : family === "Other" ? 45 : 68;
  const senFitRaw = level === "Intern" && !/intern|實習/i.test(profile.role) ? 55 : level === "Senior+" ? 70 : 82;
  const northStar = Math.round(roleFitRaw * 0.65 + senFitRaw * 0.35);

  const hasSalary = options.hasSalary
    ? cachedValue(job, "score:option-has-salary", () => options.hasSalary(job, textValue))
    : cachedValue(job, "score:has-salary", () => COMP_TERMS.some((term) => lowerTextValue.includes(term)));
  const hasRange = /\d/.test(String(job.salary || job.compensation || ""));
  const compensation = hasSalary ? (hasRange ? 90 : 72) : 45;
  const freshness = job.isExpired ? 0 : job.isNew ? 95 : job.datePosted ? 76 : 64;
  const locationFitRaw = locationHits.length || (profile.remote && mode === "Remote") ? 95 : mode === "Remote" ? 82 : profile.preferredLocations.length ? 58 : 70;
  const growthRaw = Math.min(100, 48 + growthHits.length * 9 + rareHighValueSkills.length * 4);
  const culture = Math.round(freshness * 0.35 + locationFitRaw * 0.30 + growthRaw * 0.35);

  const riskPenalty = Math.min(80, avoidHits.length * 12 + riskHits.length * 18 + (job.isExpired ? 40 : 0) + (String(job.description || "").length < 120 ? 15 : 0));
  const redFlags = Math.max(0, 100 - riskPenalty);
  const sourceQ = /^adapter:/i.test(job.sourceType || "") ? 90 : job.sourceType === "json-ld" ? 78 : String(job.description || "").length > 800 ? 72 : 55;
  const effort = Math.round((job.url ? (String(job.description || "").length > 800 ? 88 : 72) : 48) * 0.5 + sourceQ * 0.5);

  const score = Math.max(0, Math.min(100, Math.round(
    cvMatch * SCORE_WEIGHTS.cvMatch +
    northStar * SCORE_WEIGHTS.northStar +
    compensation * SCORE_WEIGHTS.compensation +
    culture * SCORE_WEIGHTS.culture +
    redFlags * SCORE_WEIGHTS.redFlags +
    effort * SCORE_WEIGHTS.effort
  )));

  return {
    score,
    rating: Math.round(((score / 100) * 4 + 1) * 10) / 10,
    grade: gradeFromScore(score),
    recommendation: recommendation(score, blockG),
    blockGTier: blockG.tier,
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
    roleFamily: family,
    seniority: level,
    workMode: mode
  };
}

async function loadProfiles(args) {
  const limit = Number.isFinite(args.limitProfiles) && args.limitProfiles > 0 ? args.limitProfiles : Infinity;
  if (args.profiles) {
    const payload = await readJson(args.profiles);
    const profiles = Array.isArray(payload) ? payload : Array.isArray(payload.profiles) ? payload.profiles : [payload];
    return profiles.slice(0, limit);
  }
  const manifest = await readJson(args.manifest);
  const profiles = [];
  for (const shard of manifest.shards || []) {
    if (profiles.length >= limit) break;
    const shardPath = shard.path || path.join(manifest.directory || path.dirname(args.manifest), shard.file);
    const payload = await readJson(shardPath);
    const shardProfiles = Array.isArray(payload) ? payload : Array.isArray(payload.profiles) ? payload.profiles : [];
    for (const profile of shardProfiles) {
      profiles.push(profile);
      if (profiles.length >= limit) break;
    }
  }
  return profiles;
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function compactCounts(map) {
  return Object.fromEntries(Array.from(map.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function pushTop(list, item, limit, sorter = (a, b) => b.absDelta - a.absDelta || b.backendScore - a.backendScore) {
  list.push(item);
  list.sort(sorter);
  if (list.length > limit) list.length = limit;
}

function csv(value) {
  const raw = Array.isArray(value) ? value.join("|") : value;
  const str = String(raw ?? "");
  return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
}

function average(value, count) {
  return count ? Math.round((value / count) * 100) / 100 : 0;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function jobSummaryFromAgg(map) {
  return Array.from(map.values())
    .map((item) => ({
      jobId: item.jobId,
      company: item.company,
      title: item.title,
      count: item.count,
      backendAverage: average(item.backendSum, item.count),
      appAverage: average(item.appSum, item.count),
      averageDelta: average(item.appSum - item.backendSum, item.count),
      recommendationDiffCount: item.recommendationDiffCount
    }))
    .sort((a, b) => Math.abs(b.averageDelta) - Math.abs(a.averageDelta) || b.backendAverage - a.backendAverage)
    .slice(0, 25);
}

function profileSummaryFromAgg(map) {
  return Array.from(map.values())
    .map((item) => ({
      profileId: item.profileId,
      profileName: item.profileName,
      profileRole: item.profileRole,
      count: item.count,
      backendAverage: average(item.backendSum, item.count),
      appAverage: average(item.appSum, item.count),
      averageDelta: average(item.appSum - item.backendSum, item.count),
      recommendationDiffCount: item.recommendationDiffCount
    }))
    .sort((a, b) => Math.abs(b.averageDelta) - Math.abs(a.averageDelta) || a.profileId.localeCompare(b.profileId))
    .slice(0, 25);
}

function featureDifferences(coverage) {
  return [
    {
      area: "資料吞吐量",
      app: `職業分析 app 的 tracker 上限是 ${APP_TRACKER_LIMIT} 筆 jobs；此 snapshot 會匯入 ${coverage.appImportedJobs} 筆，其中 ${coverage.appActiveJobs} 筆 active。`,
      careerOps: `Career Ops 後端可直接跑 profile corpus x job snapshot；本次跑 ${coverage.profileCount} profiles x ${coverage.backendActiveJobs} active jobs。`,
      difference: "app 適合互動式追蹤與人工檢視；career-ops 適合批次、可重跑、可稽核的大量比對。"
    },
    {
      area: "可評分 coverage",
      app: `本機 app 引擎只評分描述足夠的 active jobs，本次 ${coverage.appEligibleJobs}/${coverage.appActiveJobs} 筆可重算。`,
      careerOps: `後端 deterministic scorer 本次評估 ${coverage.backendActiveJobs} 筆 active jobs。`,
      difference: `${coverage.backendOnlyActiveJobs} 筆 active jobs 在後端有分數，但 app 本機引擎因 JD 太短或只有 URL 而不重算。`
    },
    {
      area: "Profile 結構",
      app: "app 匯入 Career Ops profile 時會保留原始結構化 profile；本機引擎優先使用 preferences、skillExperience、proofPoints、starStories，再以 14 個 CV 欄位 fallback。",
      careerOps: "後端保留 structured profile 欄位，例如 preferences、proofPoints、starStories、skillExperience、work authorization、compensation anchors。",
      difference: "結構化 profile 的評分已高度還原後端；純手填 CV 欄位仍會是較輕量的 projection 模式。"
    },
    {
      area: "Scoring engine",
      app: "browser-local 6D + Block G，支援互動式重算、localStorage/cloud tracker、客製 PDF 和 optional AI 評估。",
      careerOps: "CLI pipeline 產生 jobs、quality gate、intelligence、deep research、compensation、story bank、parallel report、decision report 等 artifacts。",
      difference: "app 是前台操作面，career-ops 是資料管線與報告層；兩者分數接近時可互補，分歧時通常來自資料結構與 coverage。"
    },
    {
      area: "Block G",
      app: "app 額外把泛用 careers/jobs 首頁 URL 視為 caution signal。",
      careerOps: "後端 Block G 使用 ATS domain、日期、描述長度、紅黃旗關鍵字等 deterministic checks。",
      difference: "泛用公司職涯頁在 app 可能比後端更保守。"
    }
  ];
}

function renderReport(summary) {
  const topDivergence = summary.resultDifferences.topDivergences.slice(0, 10).map((item, index) =>
    `- ${index + 1}. Δ ${item.delta >= 0 ? "+" : ""}${item.delta}（app ${item.appScore} / backend ${item.backendScore}）- ${item.profileName} -> ${item.company} / ${item.title}`
  );
  const topJobs = summary.resultDifferences.jobsByAverageDelta.slice(0, 10).map((item, index) =>
    `- ${index + 1}. Δ ${item.averageDelta >= 0 ? "+" : ""}${item.averageDelta} avg - ${item.company} / ${item.title}（app ${item.appAverage}, backend ${item.backendAverage}, diff rec ${item.recommendationDiffCount}/${item.count}）`
  );
  const topProfiles = summary.resultDifferences.profilesByAverageDelta.slice(0, 10).map((item, index) =>
    `- ${index + 1}. Δ ${item.averageDelta >= 0 ? "+" : ""}${item.averageDelta} avg - ${item.profileName} (${item.profileRole})（app ${item.appAverage}, backend ${item.backendAverage}）`
  );
  return [
    "# Career Ops vs 職業分析 App：1000 筆大數據比對",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Coverage",
    `- Profiles: ${summary.coverage.profileCount}`,
    `- Jobs snapshot: ${summary.coverage.snapshotJobs} total / ${summary.coverage.snapshotActiveJobs} active`,
    `- App import: ${summary.coverage.appImportedJobs} jobs；app local engine eligible active jobs: ${summary.coverage.appEligibleJobs}`,
    `- Backend Career Ops active jobs: ${summary.coverage.backendActiveJobs}`,
    `- Pairwise compared rows: ${summary.coverage.comparedRows}`,
    `- Backend-only active rows: ${summary.coverage.backendOnlyRows}`,
    "",
    "## Result Differences",
    `- Backend all-active average score: ${summary.backendAllActive.averageScore}`,
    `- Common eligible backend average: ${summary.resultDifferences.backendAverageScore}`,
    `- Common eligible app average: ${summary.resultDifferences.appAverageScore}`,
    `- Average delta (app - backend): ${summary.resultDifferences.averageDelta}`,
    `- Average absolute delta: ${summary.resultDifferences.averageAbsDelta}`,
    `- Median absolute delta: ${summary.resultDifferences.medianAbsDelta}`,
    `- P95 absolute delta: ${summary.resultDifferences.p95AbsDelta}`,
    `- Score exact match: ${summary.resultDifferences.scoreExactMatchRate}%`,
    `- Within 3 points: ${summary.resultDifferences.within3Rate}%；within 5 points: ${summary.resultDifferences.within5Rate}%`,
    `- Grade match: ${summary.resultDifferences.gradeMatchRate}%`,
    `- Recommendation match: ${summary.resultDifferences.recommendationMatchRate}%`,
    `- Block G match: ${summary.resultDifferences.blockGMatchRate}%`,
    "",
    "## Backend Distribution",
    `- Grades: ${Object.entries(summary.backendAllActive.gradeDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Recommendations: ${Object.entries(summary.backendAllActive.recommendationDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "",
    "## App Distribution",
    `- Grades: ${Object.entries(summary.appEligible.gradeDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Recommendations: ${Object.entries(summary.appEligible.recommendationDistribution).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    "",
    "## Biggest Score Divergences",
    ...topDivergence,
    "",
    "## Jobs With Largest Average Delta",
    ...topJobs,
    "",
    "## Profiles With Largest Average Delta",
    ...topProfiles,
    "",
    "## Dimension Average Delta",
    ...Object.entries(summary.resultDifferences.dimensionAverageDelta).map(([key, value]) => `- ${key}: ${value >= 0 ? "+" : ""}${value}`),
    "",
    "## Functional Differences",
    ...summary.featureDifferences.flatMap((item) => [
      `### ${item.area}`,
      `- App: ${item.app}`,
      `- Career Ops: ${item.careerOps}`,
      `- Difference: ${item.difference}`
    ]),
    ""
  ].join("\n");
}

async function ensureDir(filePath) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const [rawProfiles, jobsPayload] = await Promise.all([loadProfiles(args), readJson(args.jobs)]);
  if (!rawProfiles.length) throw new Error("No profiles found.");
  const limitedRawProfiles = rawProfiles.slice(0, args.limitProfiles || rawProfiles.length);
  const allSnapshotJobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
  const importedAppJobs = allSnapshotJobs.slice(0, APP_TRACKER_LIMIT).map(normalizeAppJob);
  const appJobs = importedAppJobs.filter((job) => args.includeExpired || !job.isExpired);
  const appEligibleJobs = appJobs.filter((job) => args.includeExpired || appJobEligible(job));
  let backendJobs = normalizeBackendJobs(jobsPayload, args.includeExpired);
  if (Number.isFinite(args.limitJobs) && args.limitJobs > 0) {
    backendJobs = backendJobs.slice(0, args.limitJobs);
  }

  const appEligibleByKey = new Map(appEligibleJobs.map((job) => [job.jobKey || jobKey(job), job]));
  const commonJobs = backendJobs
    .map((backendJob) => ({ backendJob, appJob: appEligibleByKey.get(backendJob.jobKey || jobKey(backendJob)) }))
    .filter((pair) => pair.appJob);

  const backendCounts = skillCounts(backendJobs, (job) => job.skills || extractSkillsFromText(job.textValue));
  const appCounts = skillCounts(appJobs, appExtractSkills);

  await Promise.all([ensureDir(args.out), ensureDir(args.reportOut), args.writeCsv ? ensureDir(args.csvOut) : Promise.resolve()]);
  const csvOut = args.writeCsv ? fs.createWriteStream(args.csvOut, { encoding: "utf8" }) : null;
  if (csvOut) {
    csvOut.write([
      "profileId", "profileName", "profileRole", "jobId", "company", "title",
      "appScore", "backendScore", "delta", "absDelta",
      "appGrade", "backendGrade", "appRecommendation", "backendRecommendation", "appBlockG", "backendBlockG",
      "cvMatchDelta", "northStarDelta", "compensationDelta", "cultureDelta", "redFlagsDelta", "effortDelta"
    ].join(",") + "\n");
  }

  const backendAllGrade = new Map();
  const backendAllRec = new Map();
  const backendAllBlockG = new Map();
  const appGrade = new Map();
  const appRec = new Map();
  const appBlockG = new Map();
  const commonBackendGrade = new Map();
  const commonBackendRec = new Map();
  const commonBackendBlockG = new Map();

  const dimensionSumDelta = { cvMatch: 0, northStar: 0, compensation: 0, culture: 0, redFlags: 0, effort: 0 };
  const dimensionAbsSumDelta = { cvMatch: 0, northStar: 0, compensation: 0, culture: 0, redFlags: 0, effort: 0 };
  const topDivergences = [];
  const recommendationDivergences = [];
  const blockGDivergences = [];
  const jobsAgg = new Map();
  const profilesAgg = new Map();
  const absDeltas = [];
  let backendAllRows = 0;
  let backendAllScoreSum = 0;
  let comparedRows = 0;
  let backendScoreSum = 0;
  let appScoreSum = 0;
  let deltaSum = 0;
  let absDeltaSum = 0;
  let scoreExact = 0;
  let within1 = 0;
  let within3 = 0;
  let within5 = 0;
  let gradeMatch = 0;
  let recommendationMatch = 0;
  let blockGMatch = 0;

  for (let profileIndex = 0; profileIndex < limitedRawProfiles.length; profileIndex += 1) {
    const rawProfile = limitedRawProfiles[profileIndex];
    const bProfile = backendProfile(rawProfile, profileIndex);
    const aProfile = appProfileFromStructuredProfile(rawProfile, profileIndex);

    for (const job of backendJobs) {
      const result = scoreProfileJob(bProfile, job, backendCounts);
      backendAllRows += 1;
      backendAllScoreSum += result.score;
      increment(backendAllGrade, result.grade);
      increment(backendAllRec, result.recommendation);
      increment(backendAllBlockG, result.blockGTier);
    }

    for (const { backendJob, appJob } of commonJobs) {
      const backendResult = scoreProfileJob(bProfile, backendJob, backendCounts);
      const appResult = scoreProfileJob(aProfile, appJob, appCounts, {
        textValue: (job) => `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}\n${job.employmentType || ""}`,
        skills: appExtractSkills,
        blockG: (job, value) => computeBlockG(job, value, { appGenericCareersSignal: true })
      });
      const delta = appResult.score - backendResult.score;
      const absDelta = Math.abs(delta);
      comparedRows += 1;
      backendScoreSum += backendResult.score;
      appScoreSum += appResult.score;
      deltaSum += delta;
      absDeltaSum += absDelta;
      absDeltas.push(absDelta);
      if (delta === 0) scoreExact += 1;
      if (absDelta <= 1) within1 += 1;
      if (absDelta <= 3) within3 += 1;
      if (absDelta <= 5) within5 += 1;
      if (appResult.grade === backendResult.grade) gradeMatch += 1;
      if (appResult.recommendation === backendResult.recommendation) recommendationMatch += 1;
      if (appResult.blockGTier === backendResult.blockGTier) blockGMatch += 1;

      increment(appGrade, appResult.grade);
      increment(appRec, appResult.recommendation);
      increment(appBlockG, appResult.blockGTier);
      increment(commonBackendGrade, backendResult.grade);
      increment(commonBackendRec, backendResult.recommendation);
      increment(commonBackendBlockG, backendResult.blockGTier);

      for (const key of Object.keys(dimensionSumDelta)) {
        const dimDelta = appResult.dimensions[key].score - backendResult.dimensions[key].score;
        dimensionSumDelta[key] += dimDelta;
        dimensionAbsSumDelta[key] += Math.abs(dimDelta);
      }

      const jobId = backendJob.jobKey || jobKey(backendJob);
      let jAgg = jobsAgg.get(jobId);
      if (!jAgg) {
        jAgg = { jobId, company: backendJob.company || "", title: backendJob.title || "", count: 0, backendSum: 0, appSum: 0, recommendationDiffCount: 0 };
        jobsAgg.set(jobId, jAgg);
      }
      jAgg.count += 1;
      jAgg.backendSum += backendResult.score;
      jAgg.appSum += appResult.score;
      if (appResult.recommendation !== backendResult.recommendation) jAgg.recommendationDiffCount += 1;

      let pAgg = profilesAgg.get(bProfile.id);
      if (!pAgg) {
        pAgg = { profileId: bProfile.id, profileName: bProfile.name, profileRole: bProfile.role, count: 0, backendSum: 0, appSum: 0, recommendationDiffCount: 0 };
        profilesAgg.set(bProfile.id, pAgg);
      }
      pAgg.count += 1;
      pAgg.backendSum += backendResult.score;
      pAgg.appSum += appResult.score;
      if (appResult.recommendation !== backendResult.recommendation) pAgg.recommendationDiffCount += 1;

      const compact = {
        profileId: bProfile.id,
        profileName: bProfile.name,
        profileRole: bProfile.role,
        jobId,
        company: backendJob.company || "",
        title: backendJob.title || "",
        appScore: appResult.score,
        backendScore: backendResult.score,
        delta,
        absDelta,
        appGrade: appResult.grade,
        backendGrade: backendResult.grade,
        appRecommendation: appResult.recommendation,
        backendRecommendation: backendResult.recommendation,
        appBlockG: appResult.blockGTier,
        backendBlockG: backendResult.blockGTier
      };
      pushTop(topDivergences, compact, 50);
      if (appResult.recommendation !== backendResult.recommendation) pushTop(recommendationDivergences, compact, 50);
      if (appResult.blockGTier !== backendResult.blockGTier) pushTop(blockGDivergences, compact, 50);

      if (csvOut) {
        csvOut.write([
          bProfile.id, bProfile.name, bProfile.role, jobId, backendJob.company || "", backendJob.title || "",
          appResult.score, backendResult.score, delta, absDelta,
          appResult.grade, backendResult.grade, appResult.recommendation, backendResult.recommendation, appResult.blockGTier, backendResult.blockGTier,
          appResult.dimensions.cvMatch.score - backendResult.dimensions.cvMatch.score,
          appResult.dimensions.northStar.score - backendResult.dimensions.northStar.score,
          appResult.dimensions.compensation.score - backendResult.dimensions.compensation.score,
          appResult.dimensions.culture.score - backendResult.dimensions.culture.score,
          appResult.dimensions.redFlags.score - backendResult.dimensions.redFlags.score,
          appResult.dimensions.effort.score - backendResult.dimensions.effort.score
        ].map(csv).join(",") + "\n");
      }
    }
  }

  if (csvOut) await new Promise((resolve, reject) => csvOut.end(resolve).on("error", reject));

  const coverage = {
    profileCount: limitedRawProfiles.length,
    snapshotJobs: allSnapshotJobs.length,
    snapshotActiveJobs: allSnapshotJobs.filter((job) => !job.isExpired).length,
    appImportedJobs: importedAppJobs.length,
    appActiveJobs: appJobs.filter((job) => !job.isExpired).length,
    appEligibleJobs: appEligibleJobs.length,
    backendActiveJobs: backendJobs.length,
    commonEligibleJobs: commonJobs.length,
    backendOnlyActiveJobs: Math.max(0, backendJobs.length - commonJobs.length),
    comparedRows,
    backendAllRows,
    backendOnlyRows: Math.max(0, backendAllRows - comparedRows)
  };

  const rate = (value) => comparedRows ? Math.round((value / comparedRows) * 10000) / 100 : 0;
  const summary = {
    generatedAt: new Date().toISOString(),
    inputs: {
      manifest: args.profiles ? "" : args.manifest,
      profiles: args.profiles,
      jobs: args.jobs,
      limitProfiles: args.limitProfiles,
      includeExpired: args.includeExpired,
      appProfileMode: "structured-career-ops-profile"
    },
    outputs: {
      json: args.out,
      report: args.reportOut,
      csv: args.writeCsv ? args.csvOut : ""
    },
    coverage,
    backendAllActive: {
      averageScore: average(backendAllScoreSum, backendAllRows),
      gradeDistribution: compactCounts(backendAllGrade),
      recommendationDistribution: compactCounts(backendAllRec),
      blockGDistribution: compactCounts(backendAllBlockG)
    },
    backendCommonEligible: {
      averageScore: average(backendScoreSum, comparedRows),
      gradeDistribution: compactCounts(commonBackendGrade),
      recommendationDistribution: compactCounts(commonBackendRec),
      blockGDistribution: compactCounts(commonBackendBlockG)
    },
    appEligible: {
      averageScore: average(appScoreSum, comparedRows),
      gradeDistribution: compactCounts(appGrade),
      recommendationDistribution: compactCounts(appRec),
      blockGDistribution: compactCounts(appBlockG)
    },
    resultDifferences: {
      backendAverageScore: average(backendScoreSum, comparedRows),
      appAverageScore: average(appScoreSum, comparedRows),
      averageDelta: average(deltaSum, comparedRows),
      averageAbsDelta: average(absDeltaSum, comparedRows),
      medianAbsDelta: percentile(absDeltas, 50),
      p95AbsDelta: percentile(absDeltas, 95),
      maxAbsDelta: percentile(absDeltas, 100),
      scoreExactMatchRate: rate(scoreExact),
      within1Rate: rate(within1),
      within3Rate: rate(within3),
      within5Rate: rate(within5),
      gradeMatchRate: rate(gradeMatch),
      recommendationMatchRate: rate(recommendationMatch),
      blockGMatchRate: rate(blockGMatch),
      dimensionAverageDelta: Object.fromEntries(Object.entries(dimensionSumDelta).map(([key, value]) => [key, average(value, comparedRows)])),
      dimensionAverageAbsDelta: Object.fromEntries(Object.entries(dimensionAbsSumDelta).map(([key, value]) => [key, average(value, comparedRows)])),
      topDivergences,
      recommendationDivergences,
      blockGDivergences,
      jobsByAverageDelta: jobSummaryFromAgg(jobsAgg),
      profilesByAverageDelta: profileSummaryFromAgg(profilesAgg)
    },
    featureDifferences: featureDifferences(coverage),
    notes: [
      "App comparison mimics the browser-local CV Studio Career Ops engine after the structured profile parity upgrade.",
      "When a Career Ops profile is imported, the app now keeps the original structured profile and uses it before falling back to CV fields.",
      "Backend comparison uses the structured Career Ops profile normalization and deterministic scorer.",
      "The app can still display backend-imported scores for jobs it does not locally re-score."
    ]
  };

  await fsp.writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fsp.writeFile(args.reportOut, `${renderReport(summary)}\n`, "utf8");
  console.log(`[career-ops] compared ${comparedRows} app/backend row(s)`);
  console.log(`[career-ops] backend all-active rows ${backendAllRows}`);
  console.log(`[career-ops] summary -> ${args.out}`);
  console.log(`[career-ops] report -> ${args.reportOut}`);
  if (args.writeCsv) console.log(`[career-ops] csv -> ${args.csvOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
