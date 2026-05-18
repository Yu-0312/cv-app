#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_JS_OUT = "data/app/career-ops-jobs.js";
const DEFAULT_REPORT = "data/app/career-ops-intelligence-report.md";
const DEFAULT_RUBRIC = fsSync.existsSync("data/career-ops-rubric.json")
  ? "data/career-ops-rubric.json"
  : "data/career-ops-rubric.example.json";

const STOPWORDS = new Set([
  "and", "the", "with", "for", "you", "your", "our", "are", "will", "that", "this", "from", "have", "has",
  "我們", "以及", "或者", "或", "與", "和", "工作", "職缺", "能力", "相關", "負責", "具備", "優先"
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
const LEGITIMACY_RED = ["apply now via whatsapp", "wire transfer", "send bank", "advance fee", "buy equipment", "training fee", "deposit required", "salary upfront", "whatsapp only", "telegram only"];
const LEGITIMACY_YELLOW = ["work from home guaranteed", "no experience needed", "earn up to", "must pay", "no interview", "quick hire"];
const COMP_TERMS = ["salary", "compensation", "薪資", "薪水", "待遇", "年薪", "月薪"];

// career-ops v2: 6 named dimensions + Block G
const DIM_WEIGHTS_V2 = {
  cvMatch:      0.25,
  northStar:    0.20,
  compensation: 0.15,
  culture:      0.15,
  redFlags:     0.15,
  effort:       0.10,
};

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
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: "",
    rubric: DEFAULT_RUBRIC,
    out: "",
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || "";
    else if (token === "--rubric") args.rubric = argv[++i] || DEFAULT_RUBRIC;
    else if (token === "--out") args.out = argv[++i] || "";
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--no-js") args.writeJs = false;
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
      .filter((term) => SKILL_TERMS.some((known) => known === term || known.includes(term) || term.includes(known)))
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
    skills,
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
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  if (/(intern|實習)/i.test(text)) return "Intern";
  if (/(junior|entry|associate|新鮮人|初階)/i.test(text)) return "Junior";
  if (/(senior|sr\.|lead|principal|staff|資深|主管)/i.test(text)) return "Senior+";
  if (/(manager|director|head of|vp|負責人|經理)/i.test(text)) return "Manager+";
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
  const fallbackWeights = {
    cvMatch:      0.25,
    northStar:    0.20,
    compensation: 0.15,
    culture:      0.15,
    redFlags:     0.15,
    effort:       0.10,
  };
  const weights = new Map(Object.entries(fallbackWeights));
  for (const dimension of dimensions) {
    const key = String(dimension?.key || "").trim();
    const weight = Number(dimension?.weight);
    if (key && Object.prototype.hasOwnProperty.call(fallbackWeights, key) && Number.isFinite(weight)) {
      weights.set(key, weight);
    }
  }
  const gradeThresholds = rubric?.gradeThresholds && typeof rubric.gradeThresholds === "object"
    ? rubric.gradeThresholds
    : { A: 85, B: 72, C: 58, D: 42, F: 0 };
  const recommendations = Array.isArray(rubric?.recommendations)
    ? rubric.recommendations
      .map((item) => ({ minScore: Number(item.minScore) || 0, label: String(item.label || "").trim() }))
      .filter((item) => item.label)
      .sort((a, b) => b.minScore - a.minScore)
    : [
      { minScore: 80, label: "強烈投遞" },
      { minScore: 70, label: "值得投遞" },
      { minScore: 56, label: "觀望" },
      { minScore: 0, label: "略過" }
    ];
  return {
    name: String(rubric?.name || "Career Ops default rubric").trim(),
    weights: Object.fromEntries(weights.entries()),
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

// ── Block G legitimacy ──────────────────────────────────────────────────────
function computeBlockG(job) {
  const text = `${job.title || ""} ${job.company || ""} ${job.description || ""}`.toLowerCase();
  const url  = String(job.url || "").toLowerCase();
  const redHits    = LEGITIMACY_RED.filter((t) => text.includes(t));
  const yellowHits = LEGITIMACY_YELLOW.filter((t) => text.includes(t));
  const noUrl      = !job.url;
  const suspiciousDomain = url && !/(greenhouse|lever|ashby|workable|bamboohr|smartrecruiters|indeed|linkedin|104|yourator|cakeresume)/i.test(url);
  if (redHits.length >= 2 || (redHits.length >= 1 && noUrl)) {
    return { tier: "Suspicious", confidence: "low", redHits, yellowHits };
  }
  if (redHits.length === 1 || yellowHits.length >= 2 || (noUrl && yellowHits.length >= 1) || (suspiciousDomain && yellowHits.length >= 1)) {
    return { tier: "Proceed with Caution", confidence: "medium", redHits, yellowHits };
  }
  return { tier: "High Confidence", confidence: "high", redHits, yellowHits };
}

// ── 6-dimension score (career-ops v2 model) ─────────────────────────────────
function score6D(job, profile, corpusSkillCounts) {
  const text = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}\n${job.employmentType || ""}`;
  const skills           = extractSkills(job);
  const profileSkills    = profile.skills.filter((s) => includesTerm(text, s));
  const missingProfileSkills = profile.skills.filter((s) => !includesTerm(text, s)).slice(0, 12);
  const targetRoleHits   = profile.targetRoles.filter((r) => includesTerm(`${job.title} ${job.description}`, r));
  const locationHits     = profile.preferredLocations.filter((l) => includesTerm(job.location || text, l));
  const companyHits      = profile.preferredCompanies.filter((c) => includesTerm(job.company, c));
  const avoidHits        = [...profile.avoidKeywords, ...RISK_TERMS].filter((t) => includesTerm(text, t));
  const rareHighValueSkills = skills.filter((s) => (corpusSkillCounts.get(s) || 0) <= 2).slice(0, 8);
  const family   = roleFamily(job);
  const level    = seniority(job);
  const mode     = workMode(job);
  const growthHits = GROWTH_TERMS.filter((t) => includesTerm(text, t));

  // --- dim: CV Match ---
  const atsRaw     = profile.skills.length ? Math.round((profileSkills.length / profile.skills.length) * 100) : Math.min(100, skills.length * 12);
  const profileRaw = Math.min(100, profileSkills.length * 14 + targetRoleHits.length * 18 + companyHits.length * 10);
  const cvMatchScore = Math.round((atsRaw * 0.45 + profileRaw * 0.55));

  // --- dim: North Star ---
  const roleFitRaw = targetRoleHits.length ? 92 : profile.role && includesTerm(`${job.title} ${job.description}`, profile.role) ? 86 : family === "Other" ? 45 : 68;
  const senFitRaw  = level === "Intern" && !/intern|實習/i.test(profile.role) ? 55 : level === "Senior+" ? 70 : 82;
  const northStarScore = Math.round(roleFitRaw * 0.65 + senFitRaw * 0.35);

  // --- dim: Compensation ---
  const hasSalary = COMP_TERMS.some((t) => new RegExp(t, "i").test(text));
  const hasRange  = /\d/.test(String(job.salary || job.compensation || ""));
  const compensationScore = hasSalary ? (hasRange ? 90 : 72) : 45;

  // --- dim: Culture Signals ---
  const freshness       = job.isExpired ? 0 : job.isNew ? 95 : job.datePosted ? 76 : 64;
  const locationFitRaw  = locationHits.length || (profile.remote && mode === "Remote") ? 95 : mode === "Remote" ? 82 : profile.preferredLocations.length ? 58 : 70;
  const growthRaw       = Math.min(100, 48 + growthHits.length * 9 + rareHighValueSkills.length * 4);
  const cultureScore    = Math.round(freshness * 0.35 + locationFitRaw * 0.30 + growthRaw * 0.35);

  // --- dim: Red Flags (inverted: 100 = clean) ---
  const riskHits    = RISK_TERMS.filter((t) => includesTerm(text, t));
  const riskPenalty = Math.min(80, avoidHits.length * 12 + riskHits.length * 18 + (job.isExpired ? 40 : 0) + (job.description?.length < 120 ? 15 : 0));
  const redFlagsScore = Math.max(0, 100 - riskPenalty);

  // --- dim: Application Effort ---
  const sourceQ  = /^adapter:/i.test(job.sourceType || "") ? 90 : job.sourceType === "json-ld" ? 78 : job.description?.length > 800 ? 72 : 55;
  const effortScore = Math.round((job.url ? (job.description?.length > 800 ? 88 : 72) : 48) * 0.5 + sourceQ * 0.5);

  const dim6 = {
    cvMatch:      { score: cvMatchScore,      grade: grade6D(cvMatchScore),      label: "CV Match",                   profileSkillHits: profileSkills, atsCoverage: atsRaw },
    northStar:    { score: northStarScore,    grade: grade6D(northStarScore),    label: "North Star Alignment",       targetRoleHits, roleFit: roleFitRaw },
    compensation: { score: compensationScore, grade: grade6D(compensationScore), label: "Compensation Competitiveness", hasSalary, hasRange },
    culture:      { score: cultureScore,      grade: grade6D(cultureScore),      label: "Culture Signals",            growthHits, workMode: mode },
    redFlags:     { score: redFlagsScore,     grade: grade6D(redFlagsScore),     label: "Red Flags",                  avoidHits, riskHits },
    effort:       { score: effortScore,       grade: grade6D(effortScore),       label: "Application Effort" },
  };

  const rawScore = Math.round(
    cvMatchScore      * DIM_WEIGHTS_V2.cvMatch      +
    northStarScore    * DIM_WEIGHTS_V2.northStar     +
    compensationScore * DIM_WEIGHTS_V2.compensation  +
    cultureScore      * DIM_WEIGHTS_V2.culture       +
    redFlagsScore     * DIM_WEIGHTS_V2.redFlags      +
    effortScore       * DIM_WEIGHTS_V2.effort
  );
  const score  = Math.max(0, Math.min(100, rawScore));
  const rating = Math.round(((score / 100) * 4 + 1) * 10) / 10;

  return {
    score,
    rating,
    grade: gradeFromScore(score, { A: 85, B: 72, C: 58, D: 42, F: 0 }),
    recommendation: score >= 80 ? "強烈投遞" : score >= 70 ? "值得投遞" : score >= 56 ? "觀望" : "略過",
    features: {
      roleFamily: family,
      seniority:  level,
      workMode:   mode,
      skills,
      profileSkillHits: profileSkills,
      missingProfileSkills,
      rareHighValueSkills,
      locationHits,
      avoidHits,
    },
    dimensions: dim6,
    blockG: computeBlockG(job),
  };
}

function grade6D(score) {
  if (score >= 87) return "A";
  if (score >= 74) return "B";
  if (score >= 60) return "C";
  if (score >= 44) return "D";
  return "F";
}

function scoreJob(job, profile, corpusSkillCounts, rubric) {
  // Use 6D model; rubric is kept for gradeThresholds / recommendations override
  const result = score6D(job, profile, corpusSkillCounts);

  // Allow rubric overrides for grade thresholds
  const thresholds = rubric?.gradeThresholds || { A: 85, B: 72, C: 58, D: 42, F: 0 };
  const recs = Array.isArray(rubric?.recommendations) && rubric.recommendations.length
    ? rubric.recommendations
    : [{ minScore: 80, label: "強烈投遞" }, { minScore: 70, label: "值得投遞" }, { minScore: 56, label: "觀望" }, { minScore: 0, label: "略過" }];

  return {
    ...result,
    grade: gradeFromScore(result.score, thresholds),
    recommendation: recommendationFromScore(result.score, recs),
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

  return {
    generatedAt: new Date().toISOString(),
    rubric: {
      name: rubric.name,
      weights: rubric.weights,
      gradeThresholds: rubric.gradeThresholds
    },
    activeJobCount: active.length,
    expiredJobCount: jobs.length - active.length,
    evaluatedJobCount: jobs.filter((job) => job.score !== undefined && job.score !== "").length,
    topSkills,
    profileSkillDemand,
    missingHighDemand,
    roleFamilies: countBy(active, roleFamily).slice(0, 10),
    seniority: countBy(active, seniority),
    workModes: countBy(active, workMode),
    markets: countBy(active, (job) => job.sourceMarket || job.market || job.countryCode || "Unknown").slice(0, 24),
    countries: countBy(active, (job) => job.country || job.countryCode || job.sourceCountry || "Unknown").slice(0, 24),
    locations: countBy(active, (job) => String(job.location || "Unknown").split(/[\/,]/)[0].trim() || "Unknown").slice(0, 12),
    sources: countBy(active, (job) => job.source || job.sourceType || "Unknown").slice(0, 12),
    recommendations: countBy(active, (job) => job.recommendation || "待評估"),
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
  const shouldOverwrite = next.score === undefined || next.score === ""
    || next.evaluation?.source === "career-ops-evaluate-heuristic"
    || next.evaluation?.source === "career-ops-evaluate-v2";
  if (shouldOverwrite) {
    next.score  = intelligence.score;
    next.rating = intelligence.rating;
    next.grade  = intelligence.grade;
    next.recommendation = intelligence.recommendation;
    next.status = next.status && next.status !== "待評估" ? next.status : intelligence.recommendation;
    next.evaluatedAt = new Date().toISOString();
    next.blockG  = intelligence.blockG;
    next.dimensions = intelligence.dimensions;
    const dims6 = intelligence.dimensions || {};
    const f = intelligence.features || {};
    next.evaluation = {
      source: "career-ops-intelligence-v2",
      overall: {
        grade: intelligence.grade,
        score: intelligence.score,
        rating: intelligence.rating,
        recommendation: intelligence.recommendation,
        legitimacyTier: intelligence.blockG?.tier || "High Confidence",
        summary: `6D 評分 ${intelligence.score}/100（${(intelligence.rating || 0).toFixed(1)}/5.0），Block G：${intelligence.blockG?.tier || "—"}。命中 ${f.profileSkillHits?.length || 0} 個履歷技能。`,
      },
      dimensions_summary: Object.entries(dims6).map(([key, d]) => `${d.label || key}：${d.grade}（${d.score}）`),
      decision_factors: [
        `職類：${f.roleFamily}；資歷：${f.seniority}；模式：${f.workMode}`,
        f.profileSkillHits?.length ? `CV Match 命中：${f.profileSkillHits.slice(0, 8).join("、")}` : "CV Match 命中偏低",
        dims6.northStar?.targetRoleHits?.length ? `North Star 目標職位命中：${dims6.northStar.targetRoleHits.slice(0, 4).join("、")}` : "",
        dims6.culture?.growthHits?.length ? `Culture 成長訊號：${dims6.culture.growthHits.slice(0, 5).join("、")}` : "",
        f.rareHighValueSkills?.length ? `稀有高價值技能：${f.rareHighValueSkills.join("、")}` : "",
      ].filter(Boolean),
      ats_keywords: {
        found: f.profileSkillHits?.slice(0, 16) || [],
        missing: f.missingProfileSkills?.slice(0, 12) || [],
      },
      risks: [
        ...(intelligence.blockG?.tier !== "High Confidence" ? [`Block G：${intelligence.blockG?.tier}`] : []),
        ...(f.avoidHits?.length ? [`排除訊號：${f.avoidHits.join("、")}`] : []),
        ...(dims6.redFlags?.riskHits?.length ? [`風險訊號：${dims6.redFlags.riskHits.join("、")}`] : []),
      ],
      next_actions: intelligence.score >= 70
        ? ["開啟職缺確認仍可投遞", "產生客製 ATS PDF（keyword injection）", "用同職類高分職缺校準關鍵字", "準備 STAR 故事與 cover letter hook"]
        : ["先與高分職缺比較，不急著投遞", "補齊 JD 或標記喜歡 / 不喜歡以改善後續排序"],
    };
  }
  return next;
}

function buildMarkdownReport(payload) {
  const insights = payload.marketInsights || {};
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const suspicious = jobs.filter((j) => j.blockG?.tier === "Suspicious").length;
  const caution    = jobs.filter((j) => j.blockG?.tier === "Proceed with Caution").length;
  const lines = [
    "# Career Ops Intelligence Report (v2 — 6D + Block G)",
    "",
    `Generated: ${insights.generatedAt || payload.intelligenceAt || ""}`,
    "",
    `- Active jobs: ${insights.activeJobCount ?? 0}`,
    `- Expired jobs: ${insights.expiredJobCount ?? 0}`,
    `- Duplicate groups: ${insights.integrity?.duplicateGroupCount ?? 0}`,
    `- Jobs without enough description: ${insights.integrity?.jobsWithoutDescription ?? 0}`,
    `- Rubric: ${insights.rubric?.name || "career-ops 6D v2"}`,
    "",
    "## Scoring Model (6 Dimensions + Block G)",
    ...Object.entries(insights.rubric?.weights || {}).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Block G Legitimacy Summary",
    `- High Confidence: ${jobs.length - suspicious - caution}`,
    `- Proceed with Caution: ${caution}`,
    `- Suspicious: ${suspicious}`,
    "",
    "## Top Skills",
    ...(insights.topSkills || []).slice(0, 12).map((item) => `- ${item.name}: ${item.count}`),
    "",
    "## Missing High-Demand Skills",
    ...(insights.missingHighDemand || []).slice(0, 10).map((item) => `- ${item.name}: ${item.count}`),
    "",
    "## Role Families",
    ...(insights.roleFamilies || []).map((item) => `- ${item.name}: ${item.count}`),
    "",
    "## Market Coverage",
    ...(insights.markets || []).map((item) => `- ${item.name}: ${item.count}`),
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
  await fs.writeFile(filePath, `${JSON.stringify(data)}\n`, "utf8");
}

async function writeJs(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `window.CV_CAREER_OPS_JOBS = ${JSON.stringify(data)};\n`, "utf8");
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
  const nextPayload = {
    ...payload,
    intelligenceAt: new Date().toISOString(),
    intelligenceBy: "career-ops-intelligence",
    jobCount: enrichedJobs.filter((job) => !job.isExpired).length,
    jobs: enrichedJobs,
    marketInsights: buildInsights(enrichedJobs, profile, duplicateGroups, rubric)
  };

  await writeJson(args.out, nextPayload);
  if (args.writeJs) await writeJs(args.jsOut, nextPayload);
  await writeText(args.reportOut, buildMarkdownReport(nextPayload));
  console.log(`[career-ops] intelligence ${enrichedJobs.length} job(s) -> ${args.out}`);
  if (args.writeJs) console.log(`[career-ops] wrote ${args.jsOut}`);
  console.log(`[career-ops] wrote ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
