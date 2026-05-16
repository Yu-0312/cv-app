#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = fsSync.existsSync("data/career-ops-profile.json")
  ? "data/career-ops-profile.json"
  : "data/career-ops-profile.example.json";
const DEFAULT_JS_OUT = "data/app/career-ops-jobs.js";
const DEFAULT_REPORT = "data/app/career-ops-intelligence-report.md";
const DEFAULT_RUBRIC = fsSync.existsSync("data/career-ops-rubric.json")
  ? "data/career-ops-rubric.json"
  : "data/career-ops-rubric.example.json";

const STOPWORDS = new Set([
  "a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my",
  "no", "of", "on", "or", "so", "to", "up", "us", "we",
  "and", "are", "but", "can", "did", "for", "had", "has", "her", "him", "his", "how", "its",
  "may", "not", "our", "out", "own", "she", "the", "was", "who", "why", "you",
  "also", "been", "each", "from", "have", "here", "into", "just", "more", "most", "such",
  "than", "that", "them", "then", "they", "this", "time", "very", "well", "were", "what",
  "when", "will", "with", "work", "year", "your",
  "about", "after", "being", "could", "every", "given", "great", "large", "other", "shall",
  "their", "these", "those", "three", "which", "while", "would",
  "我們", "以及", "或者", "或", "與", "和", "工作", "職缺", "能力", "相關", "負責", "具備", "優先",
  "可以", "需要", "必須", "希望", "透過", "提供", "進行", "達到", "幫助", "支持"
]);

const SKILL_TERMS = [
  "javascript", "typescript", "react", "vue", "angular", "next.js", "node.js", "python", "java", "go", "rust",
  "swift", "kotlin", "sql", "postgres", "mysql", "supabase", "firebase", "aws", "gcp", "azure", "docker",
  "kubernetes", "terraform", "graphql", "rest", "api", "html", "css", "tailwind", "figma", "accessibility",
  "analytics", "dashboard", "data visualization", "etl", "airflow", "spark", "dbt", "llm", "rag", "agents",
  "prompt engineering", "machine learning", "deep learning", "nlp", "computer vision", "pytorch", "tensorflow",
  "scikit", "product management", "crm", "seo", "growth", "sales", "operations", "excel", "tableau", "power bi",
  "中文", "英文", "資料分析", "數據分析", "前端", "後端", "全端", "產品", "設計系統", "無障礙", "機器學習", "人工智慧"
];

const GROWTH_TERMS = ["scale", "scalable", "growth", "0-1", "startup", "founding", "ownership", "lead", "platform", "data", "ai", "llm", "automation", "成長", "新創", "平台", "資料", "自動化"];
const RISK_TERMS = ["unpaid", "commission-only", "volunteer", "internship unpaid", "must be local", "on-site only", "無薪", "純抽成", "責任制"];

function printHelp() {
  console.log(`Career Ops intelligence layer

Turns a collected job snapshot into high-volume comparison data: dedupe signals,
feature extraction, multi-dimensional scoring, clusters, and market insights.

Usage:
  node scripts/career-ops-intelligence.mjs --jobs data/app/career-ops-jobs.json --profile data/career-ops-profile.json

Options:
  --jobs <file>       Input/output Career Ops snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>    Optional profile JSON. Supports role, skills, summary, experience, projects, preferences
  --rubric <file>     Optional scoring rubric JSON. Default: ${DEFAULT_RUBRIC}
  --out <file>        Output JSON. Default: overwrite --jobs
  --js-out <file>     Browser snapshot output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown intelligence report. Default: ${DEFAULT_REPORT}
  --no-js             Skip browser JS output
  --include-expired   Keep expired jobs in output (default: prune them)
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: DEFAULT_PROFILE,
    rubric: DEFAULT_RUBRIC,
    out: "",
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    writeJs: true,
    includeExpired: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--rubric") args.rubric = argv[++i] || DEFAULT_RUBRIC;
    else if (token === "--out") args.out = argv[++i] || "";
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--no-js") args.writeJs = false;
    else if (token === "--include-expired") args.includeExpired = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  args.out = args.out || args.jobs;
  return args;
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function tokenize(value) {
  return Array.from(new Set(String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !STOPWORDS.has(item))));
}

function includesTerm(text, term) {
  const source = String(text || "").toLowerCase();
  const needle = String(term || "").toLowerCase();
  if (!needle) return false;
  return needle.includes(" ") ? source.includes(needle) : new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}([^\\p{L}\\p{N}]|$)`, "iu").test(source);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countBy(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function normalizeProfile(profile) {
  const preferences = profile.preferences && typeof profile.preferences === "object" ? profile.preferences : {};
  const rawSkills = [
    ...array(profile.skills),
    ...array(preferences.keywords),
    ...tokenize([profile.role, profile.summary, profile.experience, profile.projects].join(" "))
      .filter((term) => term.length >= 3 && SKILL_TERMS.some((known) => known === term || known.includes(term) || term.includes(known)))
  ].map((item) => String(item || "").trim()).filter(Boolean);
  const seenSkills = new Set();
  const skills = rawSkills.filter((skill) => {
    const key = skill.toLowerCase();
    if (seenSkills.has(key)) return false;
    seenSkills.add(key);
    return true;
  });
  return {
    role: String(profile.role || "").trim(),
    summary: String(profile.summary || "").trim(),
    name: String(profile.name || profile.fullName || profile.displayName || "").trim(),
    skills,
    languages: array(profile.languages).map((l) => String(l).trim()).filter(Boolean),
    targetRoles: array(preferences.targetRoles).map(String),
    preferredLocations: array(preferences.locations).map(String),
    preferredCompanies: array(preferences.companies).map(String),
    avoidKeywords: array(preferences.avoidKeywords || preferences.exclude).map(String),
    remote: Boolean(preferences.remote)
  };
}

function roleFamily(job) {
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  if (/(frontend|front-end|前端|react|vue|ui engineer)/i.test(text)) return "Frontend";
  if (/(backend|back-end|後端|api|server|database|infra)/i.test(text)) return "Backend";
  if (/(full[- ]?stack|全端)/i.test(text)) return "Full Stack";
  if (/(data scientist|machine learning|ml engineer|ai engineer|llm|rag|資料科學|機器學習|人工智慧)/i.test(text)) return "AI / Data";
  if (/(product manager|產品經理|pm\b|product owner)/i.test(text)) return "Product";
  if (/(designer|ux|ui\/ux|設計)/i.test(text)) return "Design";
  if (/(marketing|growth|seo|行銷)/i.test(text)) return "Marketing";
  if (/(sales|business development|bd|業務)/i.test(text)) return "Sales";
  if (/(operations|ops|營運)/i.test(text)) return "Operations";
  if (/(intern|實習)/i.test(text)) return "Internship";
  return "Other";
}

function seniority(job) {
  const title = String(job.title || "").toLowerCase();
  const desc = String(job.description || "").toLowerCase();
  // Check title first for precision, then description with word boundaries to avoid false matches like "international"
  if (/\b(intern|internship|實習生?)\b/i.test(title)) return "Intern";
  if (/\b(junior|entry.?level|associate|新鮮人|初階)\b/i.test(title)) return "Junior";
  if (/\b(senior|sr\.|lead|principal|staff|資深|主管)\b/i.test(title)) return "Senior+";
  if (/\b(manager|director|head of|vp|vice.?president|負責人|經理)\b/i.test(title)) return "Manager+";
  // Fall back to description with strict word boundaries
  if (/\b(internship|實習生?)\b/i.test(desc)) return "Intern";
  if (/\b(junior|entry.?level|associate|新鮮人|初階)\b/i.test(desc)) return "Junior";
  if (/\b(senior|sr\.|lead|principal|staff|資深|主管)\b/i.test(desc)) return "Senior+";
  if (/\b(manager|director|head of|vp|vice.?president|負責人|經理)\b/i.test(desc)) return "Manager+";
  return "Mid";
}

function workMode(job) {
  const text = `${job.title || ""} ${job.location || ""} ${job.description || ""}`.toLowerCase();
  if (/(remote|work from home|wfh|遠端)/i.test(text)) return "Remote";
  if (/(hybrid|混合)/i.test(text)) return "Hybrid";
  if (/(on-site|onsite|現場|辦公室)/i.test(text)) return "On-site";
  return "Unknown";
}

function extractSkills(job) {
  const text = `${job.title || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
  return SKILL_TERMS.filter((term) => includesTerm(text, term)).slice(0, 28);
}

function normalizeRubric(rubric) {
  const dimensions = Array.isArray(rubric?.dimensions) ? rubric.dimensions : [];
  const weights = new Map();
  for (const dimension of dimensions) {
    const key = String(dimension?.key || "").trim();
    const weight = Number(dimension?.weight);
    if (key && Number.isFinite(weight)) weights.set(key, weight);
  }
  const fallbackWeights = {
    profileMatch: 0.22,
    atsCoverage: 0.16,
    roleFit: 0.14,
    seniorityFit: 0.08,
    locationFit: 0.1,
    sourceQuality: 0.08,
    freshness: 0.08,
    compensationSignal: 0.04,
    growthSignal: 0.08,
    applicationEffort: 0.02
  };
  const gradeThresholds = rubric?.gradeThresholds && typeof rubric.gradeThresholds === "object"
    ? rubric.gradeThresholds
    : { A: 85, B: 72, C: 58, D: 42, F: 0 };
  const recommendations = Array.isArray(rubric?.recommendations)
    ? rubric.recommendations
      .map((item) => ({ minScore: Number(item.minScore) || 0, label: String(item.label || "").trim() }))
      .filter((item) => item.label)
      .sort((a, b) => b.minScore - a.minScore)
    : [
      { minScore: 82, label: "強烈投遞" },
      { minScore: 70, label: "值得投遞" },
      { minScore: 56, label: "觀望" },
      { minScore: 0, label: "略過" }
    ];
  return {
    name: String(rubric?.name || "Career Ops default rubric").trim(),
    weights: {
      ...fallbackWeights,
      ...Object.fromEntries(weights.entries())
    },
    gradeThresholds,
    recommendations
  };
}

function gradeFromScore(score, thresholds) {
  const ordered = Object.entries(thresholds)
    .map(([grade, min]) => ({ grade, min: Number(min) || 0 }))
    .sort((a, b) => b.min - a.min);
  return ordered.find((item) => score >= item.min)?.grade || "F";
}

function recommendationFromScore(score, recommendations) {
  return recommendations.find((item) => score >= item.minScore)?.label || "略過";
}

function weightedScore(dimensions, rubric) {
  const total = Object.entries(rubric.weights).reduce((sum, [key, weight]) => {
    const value = Number(dimensions[key] ?? 0);
    return sum + value * Number(weight || 0);
  }, 0);
  return Math.round(total - Number(dimensions.riskPenalty || 0));
}

function scoreJob(job, profile, corpusSkillCounts, rubric) {
  const text = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
  const skills = extractSkills(job);
  const profileSkills = profile.skills.filter((skill) => includesTerm(text, skill));
  // Profile skills the JD doesn't mention — not a gap; JD may use different wording
  const profileSkillsNotInJd = profile.skills.filter((skill) => !includesTerm(text, skill)).slice(0, 12);
  // JD skills the profile doesn't claim — these are the actual candidate gaps
  const jdSkillsMissingFromProfile = skills
    .filter((skill) => !profile.skills.some((ps) => includesTerm(skill, ps) || includesTerm(ps, skill)))
    .slice(0, 12);
  const targetRoleHits = profile.targetRoles.filter((role) => includesTerm(`${job.title} ${job.description}`, role));
  const locationHits = profile.preferredLocations.filter((location) => includesTerm(job.location || text, location));
  const companyHits = profile.preferredCompanies.filter((company) => includesTerm(job.company, company));
  const avoidHits = [...profile.avoidKeywords, ...RISK_TERMS].filter((term) => includesTerm(text, term));
  // Language requirement not covered by profile languages or skills
  const profileLanguages = [...profile.languages, ...profile.skills].map((l) => String(l).toLowerCase());
  const requiresJapanese = /(日語|日本語|JLPT|N[1-5]\b|japanese\s+(required|proficiency|fluency|speaker)|require.*japanese|fluent.*japanese)/i.test(text);
  const requiresKorean = /(한국어|Korean\s+(required|proficiency|fluency)|require.*korean|fluent.*korean)/i.test(text);
  const requiresUnknownLanguage = (requiresJapanese && !profileLanguages.some((l) => /(japanese|日語|日本語)/.test(l)))
    || (requiresKorean && !profileLanguages.some((l) => /(korean|한국어)/.test(l)));
  const rareHighValueSkills = skills.filter((skill) => (corpusSkillCounts.get(skill) || 0) <= 2).slice(0, 8);
  const family = roleFamily(job);
  const level = seniority(job);
  const mode = workMode(job);

  const profileMatch = Math.min(100, profileSkills.length * 14 + targetRoleHits.length * 18 + companyHits.length * 10);
  const atsCoverage = profile.skills.length ? Math.round((profileSkills.length / profile.skills.length) * 100) : Math.min(100, skills.length * 12);
  const roleFit = targetRoleHits.length ? 92 : profile.role && includesTerm(`${job.title} ${job.description}`, profile.role) ? 86 : family === "Other" ? 45 : 68;
  const seniorityFit = level === "Intern" && !/intern|實習/i.test(profile.role) ? 55 : level === "Senior+" ? 70 : 82;
  const locationFit = locationHits.length || (profile.remote && mode === "Remote") ? 95 : mode === "Remote" ? 82 : profile.preferredLocations.length ? 58 : 70;
  const sourceQuality = /^adapter:/i.test(job.sourceType || "") ? 90 : job.sourceType === "json-ld" ? 78 : job.description?.length > 800 ? 72 : 55;
  const freshness = job.isExpired ? 0 : job.isNew ? 95 : job.datePosted ? 76 : 64;
  const compensationSignal = /(salary|compensation|薪資|待遇|\$|nt\$|twd)/i.test(text) ? 78 : 52;
  const growthSignal = Math.min(100, 48 + GROWTH_TERMS.filter((term) => includesTerm(text, term)).length * 9 + rareHighValueSkills.length * 4);
  const applicationEffort = job.url ? (job.description?.length > 800 ? 86 : 72) : 48;
  const riskPenalty = Math.min(45, avoidHits.length * 15 + (job.isExpired ? 40 : 0) + (job.description?.length < 120 ? 12 : 0) + (requiresUnknownLanguage ? 20 : 0));
  const dimensions = {
    profileMatch,
    atsCoverage,
    roleFit,
    seniorityFit,
    locationFit,
    sourceQuality,
    freshness,
    compensationSignal,
    growthSignal,
    applicationEffort,
    riskPenalty
  };
  const weighted = weightedScore(dimensions, rubric);
  const score = Math.max(0, Math.min(100, weighted));
  const grade = gradeFromScore(score, rubric.gradeThresholds);
  const recommendation = recommendationFromScore(score, rubric.recommendations);

  return {
    score,
    grade,
    recommendation,
    features: {
      roleFamily: family,
      seniority: level,
      workMode: mode,
      skills,
      profileSkillHits: profileSkills,
      profileSkillsNotInJd,
      jdSkillsMissingFromProfile,
      requiresUnknownLanguage,
      rareHighValueSkills,
      locationHits,
      avoidHits
    },
    dimensions
  };
}

function duplicateKey(job) {
  const company = String(job.company || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const title = String(job.title || "").toLowerCase().replace(/\b(senior|sr|jr|junior|lead|principal)\b/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
  return `${company}|${title}`;
}

function buildDuplicateGroups(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = duplicateKey(job);
    if (!key || key === "|") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => ({
      company: group[0].company || "",
      title: group[0].title || "",
      count: group.length,
      urls: group.map((job) => job.url).filter(Boolean).slice(0, 5)
    }));
}

function topSkillCounts(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    for (const skill of extractSkills(job)) counts.set(skill, (counts.get(skill) || 0) + 1);
  }
  return counts;
}

function scoreProfileCompleteness(profile) {
  const checks = [
    { key: "name", label: "候選人名字（name）", pass: Boolean(profile.name) },
    { key: "summary", label: "專業摘要（summary，建議 >50 字）", pass: String(profile.summary || "").length >= 50 },
    { key: "skills", label: "技能列表（skills，建議 ≥8 項）", pass: (profile.skills || []).length >= 8 },
    { key: "experience", label: "工作經歷（experience，建議 >100 字）", pass: String(profile.experience || "").length >= 100 },
    { key: "projects", label: "專案描述（projects，建議 >80 字）", pass: String(profile.projects || "").length >= 80 },
    { key: "targetRoles", label: "目標職稱（preferences.targetRoles）", pass: (profile.targetRoles || []).length > 0 },
    { key: "companies", label: "目標公司（preferences.companies）", pass: (profile.preferredCompanies || []).length > 0 },
    { key: "languages", label: "語言能力（languages）", pass: (profile.languages || []).length > 0 }
  ];
  const passed = checks.filter((c) => c.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  const missing = checks.filter((c) => !c.pass).map((c) => c.label);
  return {
    score,
    passed,
    total: checks.length,
    grade: score >= 87 ? "A" : score >= 62 ? "B" : score >= 37 ? "C" : "D",
    missing,
    note: missing.length
      ? `補充以下 ${missing.length} 個欄位可提升所有 Layer 的輸出品質：${missing.slice(0, 3).join("、")}${missing.length > 3 ? "…" : ""}`
      : "Profile 欄位完整，輸出品質最佳。"
  };
}

function buildGlobalSkillGaps(jobs, profile) {
  // Across all active jobs, tally JD skills the profile doesn't cover — weighted by job score.
  // This gives a learning priority list: skills that appear most in high-score jobs but are absent from the profile.
  const gapCounts = new Map();
  for (const job of jobs.filter((j) => !j.isExpired)) {
    const misses = array(job.intelligence?.features?.jdSkillsMissingFromProfile);
    const weight = Math.max(0.5, Number(job.score || 50) / 50);
    for (const skill of misses) {
      gapCounts.set(skill, (gapCounts.get(skill) || 0) + weight);
    }
  }
  return Array.from(gapCounts.entries())
    .map(([skill, weightedCount]) => ({ skill, weightedCount: Math.round(weightedCount * 10) / 10 }))
    .sort((a, b) => b.weightedCount - a.weightedCount || a.skill.localeCompare(b.skill))
    .slice(0, 15);
}

function buildInsights(jobs, profile, duplicateGroups, rubric) {
  const active = jobs.filter((job) => !job.isExpired);
  const skillCounts = topSkillCounts(active);
  const topSkills = Array.from(skillCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 16);
  const profileSkillDemand = profile.skills
    .map((name) => ({ name, count: skillCounts.get(String(name).toLowerCase()) || skillCounts.get(name) || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const missingHighDemand = topSkills
    .filter((skill) => !profile.skills.some((profileSkill) => profileSkill.toLowerCase() === skill.name.toLowerCase()))
    .slice(0, 10);
  const globalSkillGaps = buildGlobalSkillGaps(jobs, profile);
  // Flag if no preferred companies appeared in results
  const preferredCompaniesFound = profile.preferredCompanies.length
    ? active.filter((job) => profile.preferredCompanies.some((c) => includesTerm(job.company || "", c))).length
    : null;

  return {
    generatedAt: new Date().toISOString(),
    rubric: {
      name: rubric.name,
      weights: rubric.weights,
      gradeThresholds: rubric.gradeThresholds
    },
    profileCompleteness: scoreProfileCompleteness(profile),
    activeJobCount: active.length,
    expiredJobCount: jobs.length - active.length,
    evaluatedJobCount: jobs.filter((job) => job.score !== undefined && job.score !== "").length,
    topSkills,
    profileSkillDemand,
    missingHighDemand,
    roleFamilies: countBy(active, roleFamily).slice(0, 10),
    seniority: countBy(active, seniority),
    workModes: countBy(active, workMode),
    locations: countBy(active, (job) => String(job.location || "Unknown").split(/[\/,]/)[0].trim() || "Unknown").slice(0, 12),
    sources: countBy(active, (job) => job.source || job.sourceType || "Unknown").slice(0, 12),
    recommendations: countBy(active, (job) => job.recommendation || "待評估"),
    globalSkillGaps,
    preferredCompanyAlert: preferredCompaniesFound === 0
      ? `None of your preferred companies (${profile.preferredCompanies.slice(0, 4).join(", ")}) appeared in current results. Add direct company career page sources to data/career-ops-sources.json.`
      : null,
    duplicateGroups,
    integrity: {
      duplicateGroupCount: duplicateGroups.length,
      jobsWithoutUrl: active.filter((job) => !job.url).length,
      jobsWithoutDescription: active.filter((job) => !job.description || job.description.length < 120).length,
      expiredCount: jobs.filter((job) => job.isExpired).length
    },
    searchQueries: Array.from(new Set([
      ...profile.targetRoles,
      ...profile.skills.slice(0, 8),
      ...missingHighDemand.slice(0, 5).map((item) => item.name)
    ].filter(Boolean))).slice(0, 18)
  };
}

function enrichJob(job, intelligence) {
  const next = { ...job, intelligence };
  // Always rebuild evaluation so ats_keywords, features, and dimensions stay in sync with the current profile.
  // Preserve user-set score/grade/status only if it was NOT set by a previous intelligence run
  // (i.e., allow manual overrides and external evaluator scores to persist).
  const wasIntelligenceScored = job.evaluation?.source === "career-ops-intelligence";
  const hasNoScore = job.score === undefined || job.score === "";
  if (hasNoScore || wasIntelligenceScored || job.evaluation?.source === "career-ops-evaluate-heuristic") {
    next.score = intelligence.score;
    next.grade = intelligence.grade;
    next.recommendation = intelligence.recommendation;
    next.status = next.status && next.status !== "待評估" ? next.status : intelligence.recommendation;
    next.evaluatedAt = new Date().toISOString();
  }
  // Always refresh the evaluation block (features, ats_keywords, risks) — these depend on the current profile
  next.evaluation = {
    source: "career-ops-intelligence",
    overall: {
      grade: next.grade || intelligence.grade,
      score: next.score ?? intelligence.score,
      recommendation: next.recommendation || intelligence.recommendation,
      summary: `以 ${Object.keys(intelligence.dimensions).length} 個維度比對，命中 ${intelligence.features.profileSkillHits.length} 個履歷技能，市場技能命中 ${intelligence.features.skills.length} 個。`
    },
    decision_factors: [
      `職類：${intelligence.features.roleFamily}；資歷：${intelligence.features.seniority}；模式：${intelligence.features.workMode}`,
      intelligence.features.profileSkillHits.length ? `履歷技能命中：${intelligence.features.profileSkillHits.slice(0, 8).join("、")}` : "履歷技能命中偏低",
      intelligence.features.rareHighValueSkills.length ? `稀有高價值技能：${intelligence.features.rareHighValueSkills.join("、")}` : "未偵測到明顯稀有技能訊號"
    ],
    ats_keywords: {
      found: intelligence.features.profileSkillHits.slice(0, 16),
      missing: intelligence.features.jdSkillsMissingFromProfile.slice(0, 12)
    },
    risks: intelligence.features.avoidHits.length
      ? [`命中風險或排除訊號：${intelligence.features.avoidHits.join("、")}`]
      : [],
    next_actions: intelligence.score >= 70
      ? ["開啟職缺確認仍可投遞", "產生客製 ATS PDF", "用同職類高分職缺校準履歷關鍵字"]
      : ["先與高分職缺比較，不急著投遞", "補齊 JD 或標記喜歡 / 不喜歡以改善後續排序"]
  };
  return next;
}

function buildMarkdownReport(payload) {
  const insights = payload.marketInsights || {};
  const lines = [
    "# Career Ops Intelligence Report",
    "",
    `Generated: ${insights.generatedAt || payload.intelligenceAt || ""}`,
    "",
    `- Active jobs: ${insights.activeJobCount ?? 0}`,
    `- Expired jobs: ${insights.expiredJobCount ?? 0}`,
    `- Duplicate groups: ${insights.integrity?.duplicateGroupCount ?? 0}`,
    `- Jobs without enough description: ${insights.integrity?.jobsWithoutDescription ?? 0}`,
    `- Rubric: ${insights.rubric?.name || "Career Ops default rubric"}`,
    "",
    "## Rubric Weights",
    ...Object.entries(insights.rubric?.weights || {}).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Top Skills",
    ...(insights.topSkills || []).slice(0, 12).map((item) => `- ${item.name}: ${item.count}`),
    "",
    "## Missing High-Demand Skills",
    ...(insights.missingHighDemand || []).slice(0, 10).map((item) => `- ${item.name}: ${item.count}`),
    "",
    "## Global Skill Gap Priority (weighted by job score)",
    ...(insights.globalSkillGaps || []).slice(0, 12).map((item) => `- ${item.skill}: ${item.weightedCount}`),
    "",
    ...(insights.preferredCompanyAlert ? ["## ⚠ Preferred Company Alert", insights.preferredCompanyAlert, ""] : []),
    "## Role Families",
    ...(insights.roleFamilies || []).map((item) => `- ${item.name}: ${item.count}`),
    "",
    "## Recommended Search Queries",
    ...(insights.searchQueries || []).map((item) => `- ${item}`),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

async function readJsonIfExists(filePath) {
  if (!filePath) return {};
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeJs(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `window.CV_CAREER_OPS_JOBS = ${JSON.stringify(data, null, 2)};\n`, "utf8");
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const payload = JSON.parse(await fs.readFile(args.jobs, "utf8"));
  const profile = normalizeProfile(await readJsonIfExists(args.profile));
  const rubric = normalizeRubric(await readJsonIfExists(args.rubric));
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const corpusSkillCounts = topSkillCounts(jobs.filter((job) => !job.isExpired));
  const duplicateGroups = buildDuplicateGroups(jobs);
  const enrichedJobs = jobs
    .map((job) => enrichJob(job, scoreJob(job, profile, corpusSkillCounts, rubric)))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const outputJobs = args.includeExpired ? enrichedJobs : enrichedJobs.filter((job) => !job.isExpired);
  const prunedCount = enrichedJobs.length - outputJobs.length;
  if (prunedCount > 0) console.log(`[career-ops] pruned ${prunedCount} expired job(s) from output (use --include-expired to keep)`);
  const nextPayload = {
    ...payload,
    intelligenceAt: new Date().toISOString(),
    intelligenceBy: "career-ops-intelligence",
    jobCount: outputJobs.length,
    jobs: outputJobs,
    marketInsights: buildInsights(outputJobs, profile, duplicateGroups, rubric)
  };

  await writeJson(args.out, nextPayload);
  if (args.writeJs) await writeJs(args.jsOut, nextPayload);
  await writeText(args.reportOut, buildMarkdownReport(nextPayload));
  console.log(`[career-ops] intelligence ${outputJobs.length} job(s) -> ${args.out}`);
  if (args.writeJs) console.log(`[career-ops] wrote ${args.jsOut}`);
  console.log(`[career-ops] wrote ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
