#!/usr/bin/env node

/**
 * Career Ops batch evaluator — v3
 *
 * Scores each job across 8 named dimensions (matching career-ops A–F / 1–5 system)
 * plus a separate Block G legitimacy tier.
 *
 * Dimensions (default weights, tunable via lib/career-ops-scoring-config.mjs or --config):
 *   cvMatch        0.20  — profile keyword / skills match
 *   experience     0.15  — work-history relevance + promotion trajectory      (NEW v3)
 *   northStar      0.15  — role / career-direction alignment
 *   compensation   0.12  — salary competitiveness signals            (noData → redistributed)
 *   redFlags       0.12  — risk / concern signals (inverted: 100 = clean)
 *   fieldMatch     0.10  — field-of-study ↔ role-domain alignment    (NEW v3, noData → redistributed)
 *   culture        0.10  — growth / culture / work-mode signals
 *   effort         0.06  — application feasibility (has URL, quality JD)
 *
 * Block G  (separate)  — legitimacy tier: High Confidence | Proceed with Caution | Suspicious
 *
 * Global score: weighted average 0–100, mapped to 1–5 and A–F.
 * Any dimension reporting `noData` is dropped and its weight redistributed
 * proportionally across the remaining dimensions.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SCORING_CONFIG,
  loadScoringConfig,
  inferSeniority,
} from "./lib/career-ops-scoring-config.mjs";

export const SCHEMA_VERSION = "career-ops/3.0";

// ── helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`Career Ops batch evaluator v3

Scores jobs across 8 dimensions + Block G legitimacy. Output includes per-dimension
A–F grades and a 1–5 global rating matching the career-ops evaluation standard.

Usage:
  node scripts/career-ops-evaluate.mjs --jobs data/app/career-ops-jobs.json \\
    --profile data/career-ops-profile.json --out data/app/career-ops-jobs.json

Options:
  --jobs <file>     Input Career Ops snapshot JSON
  --profile <file>  CV/profile JSON. Supports {role, skills, summary, experience, projects,
                    education, workHistory, preferences}
  --config <file>   Optional scoring-config override JSON (deep-merged over defaults)
  --out <file>      Output JSON. Default: overwrite --jobs
  --help            Show this help
`);
}

function parseArgs(argv) {
  const args = { jobs: "", profile: "", out: "", config: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") { args.help = true; }
    else if (token === "--jobs")    { args.jobs    = argv[++i] || ""; }
    else if (token === "--profile") { args.profile = argv[++i] || ""; }
    else if (token === "--config")  { args.config  = argv[++i] || ""; }
    else if (token === "--out")     { args.out     = argv[++i] || ""; }
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function stopwordRegex(stopwords) {
  const escaped = stopwords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(${escaped.join("|")})$`);
}

export function tokenize(value, config = DEFAULT_SCORING_CONFIG) {
  const stop = config.__stopRe || (config.__stopRe = stopwordRegex(config.stopwords));
  return Array.from(new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !stop.test(t))
  ));
}

function includes(text, term) {
  const src = String(text || "").toLowerCase();
  const needle = String(term || "").toLowerCase();
  if (!needle) return false;
  if (needle.includes(" ")) return src.includes(needle);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu").test(src);
}

// ── profile normalisation ────────────────────────────────────────────────────

/** Coerce various education shapes into a flat list of major/field strings. */
function normalizeEducation(profile) {
  const out = [];
  const push = (v) => { const s = String(v || "").trim(); if (s) out.push(s); };
  const edu = profile.education;
  if (typeof edu === "string") push(edu);
  else if (Array.isArray(edu)) {
    for (const e of edu) {
      if (typeof e === "string") push(e);
      else if (e && typeof e === "object") { push(e.major); push(e.field); push(e.department); push(e.degree && e.field ? "" : e.study); }
    }
  } else if (edu && typeof edu === "object") { push(edu.major); push(edu.field); push(edu.department); }
  // also accept top-level convenience keys
  push(profile.major); push(profile.field);
  return out;
}

function parseYear(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return null;
  if (/(present|current|now|迄今|至今|現在|目前)/.test(s)) return new Date().getFullYear();
  const m = s.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** Build a structured work history [{title, rank, level, start, end}] from profile. */
function normalizeWorkHistory(profile, config) {
  const entries = [];
  const raw = profile.workHistory || profile.work_history || profile.jobs || [];
  if (Array.isArray(raw)) {
    for (const w of raw) {
      if (!w || typeof w !== "object") continue;
      const title = String(w.title || w.role || w.position || "").trim();
      const sen = w.seniority
        ? { level: String(w.seniority), rank: config.seniorityRank[w.seniority] || inferSeniority(title, config.seniorityPatterns).rank }
        : inferSeniority(`${title} ${w.level || ""}`, config.seniorityPatterns);
      entries.push({
        title,
        company: String(w.company || "").trim(),
        level: sen.level,
        rank: sen.rank,
        start: parseYear(w.start || w.from || w.startDate),
        end: parseYear(w.end || w.to || w.endDate || "present"),
      });
    }
  }
  // stable chronological order (earliest start first); unknown starts sink to front
  entries.sort((a, b) => (a.start || 0) - (b.start || 0));
  return entries;
}

/** Total years of experience: prefer workHistory span, fall back to prose signals. */
function inferTotalYears(profile, workHistory) {
  const years = workHistory.map((w) => w.start).filter((y) => Number.isFinite(y));
  const ends = workHistory.map((w) => w.end).filter((y) => Number.isFinite(y));
  if (years.length && ends.length) return Math.max(0, Math.max(...ends) - Math.min(...years));
  if (typeof profile.yearsOfExperience === "number") return profile.yearsOfExperience;
  const prose = [profile.summary, profile.experience].filter(Boolean).join(" ");
  const m = prose.match(/(\d+)\s*\+?\s*(?:years|yrs|年)/i);
  return m ? Number(m[1]) : null;
}

export function normalizeProfile(profile, config = DEFAULT_SCORING_CONFIG) {
  const prefs = (profile.preferences && typeof profile.preferences === "object") ? profile.preferences : {};
  const keywords = tokenize([
    profile.role,
    profile.summary,
    profile.skills,
    typeof profile.experience === "string" ? profile.experience : "",
    typeof profile.projects === "string" ? profile.projects : "",
    prefs.keywords,
    prefs.targetRoles,
  ].flat().join(" "), config);
  const avoid = tokenize([prefs.avoidKeywords, prefs.exclude].flat().join(" "), config);
  const workHistory = normalizeWorkHistory(profile, config);
  const latest = workHistory[workHistory.length - 1] || null;
  const selfSeniority = latest && latest.rank
    ? { level: latest.level, rank: latest.rank }
    : inferSeniority(`${profile.role || ""} ${profile.summary || ""}`, config.seniorityPatterns);
  return {
    keywords,
    avoid,
    role: String(profile.role || "").trim(),
    rawSkills: [].concat(profile.skills || prefs.keywords || []).map(s => String(s).trim()).filter(Boolean),
    targetRoles: [].concat(prefs.targetRoles || []).map(String),
    preferredLocations: tokenize([].concat(prefs.locations || []).concat(prefs.remote ? ["remote"] : []).join(" "), config),
    preferredCompanies: tokenize([].concat(prefs.companies || []).join(" "), config),
    northStarGoals: tokenize(String(prefs.northStar || prefs.goals || prefs.targetIndustry || ""), config),
    salaryMin: Number(prefs.salaryMin || 0),
    remote: Boolean(prefs.remote),
    education: normalizeEducation(profile),
    workHistory,
    seniority: selfSeniority,
    totalYears: inferTotalYears(profile, workHistory),
  };
}

// ── lightweight role-family inference (intelligence.mjs runs AFTER evaluate) ──

const ROLE_FAMILY_PATTERNS = [
  { fam: "Frontend",   re: /(front.?end|前端|react|vue|angular|ui engineer)/i },
  { fam: "Backend",    re: /(back.?end|後端|server|golang|java\b|node\.?js|api engineer)/i },
  { fam: "Full Stack", re: /(full.?stack|全端|全棧)/i },
  { fam: "AI/Data",    re: /(machine learning|ml engineer|data scien|deep learning|人工智慧|演算法|ai engineer|llm)/i },
  { fam: "Data/Analytics", re: /(data analyst|data engineer|analytics|資料工程|數據分析|bi\b)/i },
  { fam: "Product",    re: /(product manager|產品經理|product owner|\bpm\b)/i },
  { fam: "Design",     re: /(designer|設計師|ux|ui\/ux|視覺|graphic)/i },
  { fam: "Marketing",  re: /(marketing|行銷|growth marketer|seo|社群)/i },
  { fam: "Sales",      re: /(sales|業務|銷售|account executive|bd\b)/i },
  { fam: "Hardware",   re: /(hardware|硬體|ic design|電路|firmware|韌體|embedded|嵌入式)/i },
  { fam: "Operations", re: /(operations|營運|ops engineer|supply chain|客服)/i },
];

function inferRoleFamily(job) {
  const text = `${job.title || ""} ${job.description || ""}`;
  for (const p of ROLE_FAMILY_PATTERNS) if (p.re.test(text)) return p.fam;
  return "General";
}

// ── dimension scorers (each returns 0–100, or {score:null,noData:true}) ───────

function scoreCvMatch(job, profile, config) {
  const jdText = [job.title, job.company, job.location, job.description, job.employmentType]
    .filter(Boolean).join(" ");
  const jdTokens = new Set(tokenize(jdText, config));

  const skillHits   = (profile.rawSkills || []).filter(s => includes(jdText, s));
  const skillMissed = (profile.rawSkills || []).filter(s => !includes(jdText, s));
  const tokenHits = profile.keywords.filter(k => jdTokens.has(k));

  const foundSet = new Set(skillHits.map(s => s.toLowerCase()));
  const extraTokens = tokenHits.filter(t => !foundSet.has(t)).slice(0, 6);
  const found = [...skillHits, ...extraTokens].slice(0, 16);

  const base = Math.min(100, 40 + skillHits.length * 6 + tokenHits.length * 2);
  return { score: Math.max(0, base), found, missing: skillMissed.slice(0, 14) };
}

function scoreNorthStar(job, profile) {
  const text = `${job.title || ""} ${job.description || ""}`;
  const targetHit = profile.targetRoles.some((r) => includes(text, r));
  const roleHit   = profile.role && includes(text, profile.role);
  const nsHits    = profile.northStarGoals.filter((g) => includes(text, g));
  let score = 50;
  if (targetHit) score = Math.min(100, score + 30);
  else if (roleHit) score = Math.min(100, score + 20);
  score = Math.min(100, score + nsHits.length * 8);
  return { score, targetHit, roleHit, nsHits };
}

// ── NEW v3: field-of-study ↔ role-domain match (科系匹配度) ───────────────────

function candidateDomains(profile, config) {
  const domains = new Set();
  const majors = (profile.education || []).map((m) => m.toLowerCase());
  if (!majors.length) return domains;
  for (const [domain, keywords] of Object.entries(config.fieldDomains)) {
    if (keywords.some((kw) => majors.some((m) => m.includes(kw.toLowerCase())))) domains.add(domain);
  }
  return domains;
}

function jobDomains(job, config) {
  const domains = new Set();
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  // 1. Explicit major mentions in the JD ("資工相關科系", "CS degree")
  for (const [domain, keywords] of Object.entries(config.fieldDomains)) {
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) domains.add(domain);
  }
  // 2. Role-family implied domains
  const fam = inferRoleFamily(job);
  for (const d of (config.roleFamilyDomains[fam] || [])) domains.add(d);
  return { domains, roleFamily: fam };
}

function scoreFieldMatch(job, profile, config) {
  const candDomains = candidateDomains(profile, config);
  if (!candDomains.size) {
    return { score: null, noData: true, candidateDomains: [], jobDomains: [] };
  }
  const { domains: jDomains, roleFamily } = jobDomains(job, config);
  if (!jDomains.size) {
    // Job gives no domain signal — neutral, don't penalise the candidate.
    return { score: 60, noData: false, candidateDomains: [...candDomains], jobDomains: [], roleFamily, overlap: [] };
  }
  const overlap = [...candDomains].filter((d) => jDomains.has(d));
  let score;
  if (overlap.length) {
    // Same-field → higher. Full coverage of the job's domains earns the top band.
    const coverage = overlap.length / jDomains.size;
    score = Math.min(100, 68 + Math.round(coverage * 27) + (overlap.length - 1) * 4);
  } else {
    // Candidate's field is unrelated to the role's domain → below neutral.
    score = 38;
  }
  return { score, noData: false, candidateDomains: [...candDomains], jobDomains: [...jDomains], roleFamily, overlap };
}

// ── NEW v3: work-experience relevance + promotion trajectory (工作經驗) ───────

function scoreExperience(job, profile, config) {
  const cfg = config.experience;
  const wh = profile.workHistory || [];
  const totalYears = profile.totalYears;
  const hasSignal = wh.length > 0 || (typeof totalYears === "number") || (profile.seniority?.rank > 0);
  if (!hasSignal) {
    return { score: null, noData: true, reasons: ["profile has no work-history / seniority signal"] };
  }

  const reasons = [];
  let score = cfg.base;

  // 1. Role/seniority fit against the posting (工作經驗高 → 看崗位是否符合)
  const jobSen = inferSeniority(`${job.title || ""} ${job.description || ""}`, config.seniorityPatterns);
  const candRank = profile.seniority?.rank || 0;
  if (jobSen.rank && candRank) {
    const gap = candRank - jobSen.rank;
    if (gap === 0 || gap === 1) { score += cfg.roleFitBonus; reasons.push(`seniority matches posting (${profile.seniority.level} ≈ ${jobSen.level})`); }
    else if (gap <= -2) { score -= cfg.underLevelPenalty; reasons.push(`candidate below posting level (${profile.seniority.level} < ${jobSen.level})`); }
    else if (gap >= 2)  { score -= cfg.overQualifiedPenalty; reasons.push(`candidate over-qualified for posting (${profile.seniority.level} > ${jobSen.level})`); }
  }

  // 2. Domain relevance of prior titles to this role (崗位符合 → 加分)
  const roleFamily = inferRoleFamily(job);
  const jobText = `${job.title || ""} ${job.description || ""}`;
  const relevantRoles = wh.filter((w) => includes(jobText, w.title) || inferRoleFamily({ title: w.title, description: "" }) === roleFamily);
  if (wh.length) {
    if (relevantRoles.length) { score += Math.min(14, relevantRoles.length * 7); reasons.push(`${relevantRoles.length} prior role(s) relevant to this position`); }
    else { score -= 6; reasons.push("no prior role clearly matches this position"); }
  }

  // 3. Promotion trajectory (經驗久但沒晉升 → 扣分)
  // Keep zero-rank titles (no seniority keyword, e.g. plain "Engineer"): staying
  // at the same undifferentiated title for many years is itself a stagnation signal.
  let promotions = 0;
  if (wh.length >= 2) {
    const ranks = wh.map((w) => w.rank);
    for (let i = 1; i < ranks.length; i += 1) if (ranks[i] > ranks[i - 1]) promotions += 1;
    const flat = new Set(ranks).size === 1; // every role at the same level
    if (promotions > 0) {
      const bonus = Math.min(cfg.promotionBonusCap, promotions * cfg.promotionBonusPerStep);
      score += bonus; reasons.push(`${promotions} promotion(s) across roles (+${bonus})`);
    } else if (flat && typeof totalYears === "number" && totalYears >= cfg.stagnationYears) {
      score -= cfg.stagnationPenalty;
      reasons.push(`${totalYears}y experience with no promotion — stagnation (-${cfg.stagnationPenalty})`);
    }
  } else if (typeof totalYears === "number" && totalYears >= cfg.stagnationYears && candRank <= 3) {
    // Long tenure, still non-senior, single flat entry → soft stagnation signal.
    score -= Math.round(cfg.stagnationPenalty / 2);
    reasons.push(`${totalYears}y experience but still ${profile.seniority?.level || "non-senior"} — soft stagnation`);
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    noData: false,
    totalYears,
    seniority: profile.seniority?.level,
    promotions,
    reasons,
  };
}

function scoreCompensation(job, config) {
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const hasSalary = config.compTerms.some((t) => new RegExp(t, "i").test(text));
  const salary = job.salary || job.compensation || "";
  const hasRange = /\d/.test(String(salary));
  if (!hasSalary && !hasRange) {
    return { score: null, hasSalary: false, hasRange: false, noData: true };
  }
  let score = hasSalary ? 72 : 50;
  if (hasRange) score = Math.min(100, score + 18);
  return { score, hasSalary, hasRange, noData: false };
}

function scoreCulture(job, config) {
  const text = `${job.title || ""} ${job.location || ""} ${job.description || ""}`;
  const growthHits = config.growthTerms.filter((t) => includes(text, t));
  const remote = /(remote|work from home|wfh|遠端)/i.test(text);
  const hybrid = /(hybrid|混合)/i.test(text);
  const missionDriven = /(mission|impact|purpose|使命|影響力)/i.test(text);
  let score = 48 + growthHits.length * 7;
  if (remote || hybrid) score = Math.min(100, score + 12);
  if (missionDriven)    score = Math.min(100, score + 8);
  return { score: Math.min(100, score), growthHits, remote, hybrid };
}

function scoreRedFlags(job, profile, config) {
  const text = `${job.title || ""} ${job.company || ""} ${job.description || ""}`;
  const avoidHits = profile.avoid.filter((k) => includes(text, k));
  const riskHits  = config.riskTerms.filter((t) => includes(text, t));
  const expiredPenalty = job.isExpired ? 40 : 0;
  const tooShort = (!job.description || job.description.length < 120) ? 15 : 0;
  const penalty = Math.min(80, avoidHits.length * 12 + riskHits.length * 18 + expiredPenalty + tooShort);
  return { score: Math.max(0, 100 - penalty), avoidHits, riskHits };
}

function scoreEffort(job) {
  const hasUrl  = Boolean(job.url);
  const descLen = String(job.description || "").length;
  let score = hasUrl ? 70 : 30;
  if (descLen > 800) score = Math.min(100, score + 20);
  else if (descLen > 300) score = Math.min(100, score + 10);
  if (job.isNew) score = Math.min(100, score + 10);
  return { score };
}

// ── Block G legitimacy tier ──────────────────────────────────────────────────

function blockG(job, config) {
  const text = [job.title, job.company, job.description].filter(Boolean).join(" ").toLowerCase();
  const url  = String(job.url || "").toLowerCase();

  const redHits    = config.legitimacyRed.filter(t => text.includes(t));
  const yellowHits = config.legitimacyYellow.filter(t => text.includes(t));
  const noUrl      = !job.url;

  const signals = [];
  const postDate = job.datePosted ? new Date(job.datePosted) : null;
  const daysOld  = postDate && !Number.isNaN(postDate.getTime())
    ? Math.floor((Date.now() - postDate.getTime()) / 86400000) : null;
  if (daysOld !== null) {
    if (daysOld > 120)      signals.push({ k: "yellow", msg: `Stale posting: ${daysOld}d old` });
    else if (daysOld > 60)  signals.push({ k: "yellow", msg: `Aging posting: ${daysOld}d old` });
    else if (daysOld <= 14) signals.push({ k: "green",  msg: `Fresh posting: ${daysOld}d old` });
  }

  const isKnownAts = Boolean(url && config.atsDomains.some(d => url.includes(d)));
  if (isKnownAts) {
    signals.push({ k: "green", msg: "Known ATS platform URL" });
  } else if (url) {
    const urlPath = url.replace(/https?:\/\/[^/]+/, "");
    if (/^\/(careers?|jobs?)\/?(\?.*)?$/.test(urlPath)) {
      signals.push({ k: "yellow", msg: "Generic careers page — no job-specific ID in URL" });
    }
  }

  if (String(job.description || "").length < 200) {
    signals.push({ k: "yellow", msg: "Very short job description" });
  }

  const yellowCount = yellowHits.length + signals.filter(s => s.k === "yellow").length;

  if (redHits.length >= 2 || (redHits.length >= 1 && noUrl)) {
    return { tier: "Suspicious", confidence: "low", redHits, yellowHits, signals };
  }
  if (
    redHits.length >= 1 ||
    yellowCount    >= 3 ||
    (noUrl && yellowHits.length >= 1) ||
    (!isKnownAts && url && yellowHits.length >= 1) ||
    (daysOld !== null && daysOld > 120)
  ) {
    return { tier: "Proceed with Caution", confidence: "medium", redHits, yellowHits, signals };
  }
  return { tier: "High Confidence", confidence: isKnownAts ? "high" : "medium", redHits: [], yellowHits: [], signals };
}

// ── global scoring ───────────────────────────────────────────────────────────

function dimGrade(score, t = DEFAULT_SCORING_CONFIG.thresholds.dimGrade) {
  if (score === null || score === undefined) return "N/A";
  if (score >= t.A) return "A";
  if (score >= t.B) return "B";
  if (score >= t.C) return "C";
  if (score >= t.D) return "D";
  return "F";
}

function globalTo15(score) {
  return Math.round(((score / 100) * 4 + 1) * 10) / 10;
}

function globalGrade(score, t = DEFAULT_SCORING_CONFIG.thresholds.globalGrade) {
  if (score >= t.A) return "A";
  if (score >= t.B) return "B";
  if (score >= t.C) return "C";
  if (score >= t.D) return "D";
  return "F";
}

function recommendation(score, legitimacyTier, t = DEFAULT_SCORING_CONFIG.thresholds.recommend) {
  if (legitimacyTier === "Suspicious") return "略過";
  if (score >= t.pursue) return "值得投遞";
  if (score >= t.watch) return "觀望";
  return "略過";
}

// ── main evaluator ────────────────────────────────────────────────────────────

export function evaluateJob(job, profile, config = DEFAULT_SCORING_CONFIG) {
  const cvMatch      = scoreCvMatch(job, profile, config);
  const experience   = scoreExperience(job, profile, config);
  const fieldMatch   = scoreFieldMatch(job, profile, config);
  const northStar    = scoreNorthStar(job, profile);
  const compensation = scoreCompensation(job, config);
  const culture      = scoreCulture(job, config);
  const redFlags     = scoreRedFlags(job, profile, config);
  const effort       = scoreEffort(job);
  const legitimacy   = blockG(job, config);

  const W = config.weights;
  // Assemble each dimension's contribution, dropping noData dims and
  // redistributing their weight proportionally across the rest.
  const parts = [
    { key: "cvMatch",      score: cvMatch.score,       w: W.cvMatch },
    { key: "experience",   score: experience.noData   ? null : experience.score,   w: W.experience },
    { key: "northStar",    score: northStar.score,     w: W.northStar },
    { key: "compensation", score: compensation.noData ? null : compensation.score, w: W.compensation },
    { key: "redFlags",     score: redFlags.score,      w: W.redFlags },
    { key: "fieldMatch",   score: fieldMatch.noData   ? null : fieldMatch.score,   w: W.fieldMatch },
    { key: "culture",      score: culture.score,       w: W.culture },
    { key: "effort",       score: effort.score,        w: W.effort },
  ];
  const active = parts.filter((p) => p.score !== null && p.score !== undefined);
  const totalW = active.reduce((s, p) => s + p.w, 0) || 1;
  const rawScore = Math.round(active.reduce((s, p) => s + p.score * p.w, 0) / totalW);
  const score   = Math.max(0, Math.min(100, rawScore));
  const rating  = globalTo15(score);
  const grade   = globalGrade(score, config.thresholds.globalGrade);
  const rec     = recommendation(score, legitimacy.tier, config.thresholds.recommend);
  const dg = (s) => dimGrade(s, config.thresholds.dimGrade);

  const dimensions = {
    cvMatch:      { score: cvMatch.score,      grade: dg(cvMatch.score),      label: "CV Match",                  found: cvMatch.found,      missing: cvMatch.missing },
    experience:   { score: experience.score,   grade: dg(experience.score),   label: "Experience & Trajectory",   noData: experience.noData || false, totalYears: experience.totalYears ?? null, seniority: experience.seniority ?? null, promotions: experience.promotions ?? 0, reasons: experience.reasons || [] },
    northStar:    { score: northStar.score,    grade: dg(northStar.score),    label: "North Star Alignment" },
    compensation: { score: compensation.score, grade: dg(compensation.score), label: "Compensation Competitiveness", noData: compensation.noData || false },
    fieldMatch:   { score: fieldMatch.score,   grade: dg(fieldMatch.score),   label: "Field-of-Study Match",      noData: fieldMatch.noData || false, candidateDomains: fieldMatch.candidateDomains || [], jobDomains: fieldMatch.jobDomains || [], overlap: fieldMatch.overlap || [] },
    culture:      { score: culture.score,      grade: dg(culture.score),      label: "Culture Signals",           growthHits: culture.growthHits },
    redFlags:     { score: redFlags.score,     grade: dg(redFlags.score),     label: "Red Flags",                 avoidHits: redFlags.avoidHits, riskHits: redFlags.riskHits },
    effort:       { score: effort.score,       grade: dg(effort.score),       label: "Application Effort" },
  };

  return {
    ...job,
    score,
    rating,
    grade,
    recommendation: rec,
    status: job.status && job.status !== "待評估" ? job.status : rec,
    evaluatedAt: new Date().toISOString(),
    blockG: legitimacy,
    dimensions,
    evaluation: {
      source: "career-ops-evaluate-v3",
      overall: {
        grade,
        score,
        rating,
        recommendation: rec,
        legitimacyTier: legitimacy.tier,
        summary: buildSummary(score, rating, dimensions, legitimacy, cvMatch),
      },
      decision_factors: buildDecisionFactors(dimensions, northStar, culture, fieldMatch, experience),
      ats_keywords: { found: cvMatch.found, missing: cvMatch.missing },
      risks: buildRisks(redFlags, legitimacy, job),
      next_actions: buildNextActions(score, legitimacy.tier),
    },
  };
}

function buildSummary(score, rating, dims, legitimacy, cvMatch) {
  const parts = [
    `整體評分 ${score}/100（${rating.toFixed(1)}/5.0），${dims.cvMatch.grade} CV Match，${dims.northStar.grade} North Star。`,
    cvMatch.found.length ? `已覆蓋 ${cvMatch.found.length} 個技能/偏好關鍵字。` : "技能關鍵字命中偏低。",
    legitimacy.tier !== "High Confidence" ? `合法性：${legitimacy.tier}。` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function buildDecisionFactors(dims, northStar, culture, fieldMatch, experience) {
  const factors = [];
  if (northStar.targetHit) factors.push("命中目標職位類型");
  else if (northStar.roleHit) factors.push("符合目標職稱關鍵字");
  if (northStar.nsHits?.length) factors.push(`職涯方向吻合訊號：${northStar.nsHits.slice(0, 4).join("、")}`);
  if (!fieldMatch.noData && fieldMatch.overlap?.length) factors.push(`科系相符領域：${fieldMatch.overlap.join("、")}`);
  if (!experience.noData && experience.promotions > 0) factors.push(`具晉升軌跡（${experience.promotions} 次）`);
  if (!experience.noData && experience.reasons?.some((r) => r.includes("stagnation"))) factors.push("年資久但缺乏晉升，需留意職涯停滯");
  if (culture.growthHits?.length) factors.push(`成長/文化訊號：${culture.growthHits.slice(0, 5).join("、")}`);
  if (culture.remote) factors.push("支援遠端工作");
  if (dims.compensation.noData) factors.push("薪資未揭露（不影響整體評分）");
  else if (dims.compensation.grade === "A" || dims.compensation.grade === "B") factors.push("薪資透明度良好");
  if (!factors.length) factors.push("尚無明顯正向訊號，建議補齊 JD 後重新評估");
  return factors;
}

function buildRisks(redFlags, legitimacy, job) {
  const risks = [];
  if (legitimacy.tier === "Suspicious")          risks.push(`合法性疑慮（Block G：Suspicious）：${legitimacy.redHits.join("、")}`);
  else if (legitimacy.tier === "Proceed with Caution") risks.push(`合法性提醒（Block G：Proceed with Caution）`);
  if (redFlags.riskHits?.length)  risks.push(`偵測到風險訊號：${redFlags.riskHits.join("、")}`);
  if (redFlags.avoidHits?.length) risks.push(`命中排除關鍵字：${redFlags.avoidHits.join("、")}`);
  if (job.isExpired)               risks.push("職缺已下架，建議確認是否重新開放");
  if (!job.description || job.description.length < 120) risks.push("JD 描述過短，評分信心較低");
  return risks;
}

function buildNextActions(score, legitimacyTier) {
  if (legitimacyTier === "Suspicious") {
    return ["跳過此職缺或向公司官網二次確認", "若仍有興趣請從官方 careers 頁直接申請"];
  }
  if (score >= 80) {
    return ["確認職缺仍開放", "產生客製 ATS PDF（keyword injection）", "安排 48 小時內投遞", "準備 STAR 故事與 cover letter hook"];
  }
  if (score >= 62) {
    return ["補充 JD 細節或手動標記偏好後重新評估", "與分數更高的職缺比較後決定"];
  }
  return ["暫時略過，等待更好機會或補強相關技能"];
}

// ── entry point ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (!args.jobs || !args.profile) throw new Error("Use --jobs <file> and --profile <file>.");

  const config      = await loadScoringConfig(args.config);
  const jobsPayload = JSON.parse(await fs.readFile(args.jobs, "utf8"));
  const profile     = normalizeProfile(JSON.parse(await fs.readFile(args.profile, "utf8")), config);
  const jobs        = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
  // Full coverage: every non-expired job is scored (expired ones are passed through untouched).
  const evaluated   = jobs.map((job) => job.isExpired ? job : evaluateJob(job, profile, config));

  const payload = {
    ...jobsPayload,
    schemaVersion: SCHEMA_VERSION,
    evaluatedAt: new Date().toISOString(),
    evaluatedBy: "career-ops-evaluate-v3",
    scoringModel: {
      version: "v3",
      schemaVersion: SCHEMA_VERSION,
      dimensions: Object.keys(config.weights),
      weights: config.weights,
      scale: "0–100 + 1.0–5.0 + A–F + Block G",
    },
    jobs: evaluated,
  };

  const out = args.out || args.jobs;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`[career-ops] evaluated ${evaluated.length} job(s) with 8D+BlockG (schema ${SCHEMA_VERSION}) -> ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

// Exports for unit tests
export { scoreFieldMatch, scoreExperience, inferRoleFamily, blockG };
