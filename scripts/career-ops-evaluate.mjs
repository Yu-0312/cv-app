#!/usr/bin/env node

/**
 * Career Ops batch evaluator — v2
 *
 * Scores each job across 6 named dimensions (matching career-ops A–F / 1–5 system)
 * plus a separate Block G legitimacy tier.
 *
 * Dimensions (weights):
 *   cvMatch        0.25  — profile keyword / skills match
 *   northStar      0.20  — role / career-direction alignment
 *   compensation   0.15  — salary competitiveness signals
 *   culture        0.15  — growth / culture / work-mode signals
 *   redFlags       0.15  — risk / concern signals (inverted: 100 = clean)
 *   effort         0.10  — application feasibility (has URL, quality JD)
 *
 * Block G  (separate)  — legitimacy tier: High Confidence | Proceed with Caution | Suspicious
 *
 * Global score: weighted average 0–100, mapped to 1–5 and A–F.
 * Thresholds (1–5 scale): ≥4.5 pursue aggressively, ≥3.0 eligible, <2.5 skip.
 */

import fs from "node:fs/promises";
import path from "node:path";

// ── helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`Career Ops batch evaluator v2

Scores jobs across 6 dimensions + Block G legitimacy. Output includes per-dimension
A–F grades and a 1–5 global rating matching the career-ops evaluation standard.

Usage:
  node scripts/career-ops-evaluate.mjs --jobs data/app/career-ops-jobs.json \\
    --profile data/career-ops-profile.json --out data/app/career-ops-jobs.json

Options:
  --jobs <file>     Input Career Ops snapshot JSON
  --profile <file>  CV/profile JSON. Supports {role, skills, summary, experience, projects, preferences}
  --out <file>      Output JSON. Default: overwrite --jobs
  --help            Show this help
`);
}

function parseArgs(argv) {
  const args = { jobs: "", profile: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") { args.help = true; }
    else if (token === "--jobs")    { args.jobs    = argv[++i] || ""; }
    else if (token === "--profile") { args.profile = argv[++i] || ""; }
    else if (token === "--out")     { args.out     = argv[++i] || ""; }
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function tokenize(value) {
  return Array.from(new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+#.-]+/gu, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !/^(and|the|with|for|you|our|我們|以及|或|與|和|工作|職缺|相關|負責|具備|優先)$/.test(t))
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

function normalizeProfile(profile) {
  const prefs = (profile.preferences && typeof profile.preferences === "object") ? profile.preferences : {};
  const keywords = tokenize([
    profile.role,
    profile.summary,
    profile.skills,
    profile.experience,
    profile.projects,
    prefs.keywords,
    prefs.targetRoles,
  ].flat().join(" "));
  const avoid = tokenize([prefs.avoidKeywords, prefs.exclude].flat().join(" "));
  return {
    keywords,
    avoid,
    role: String(profile.role || "").trim(),
    rawSkills: [].concat(profile.skills || prefs.keywords || []).map(s => String(s).trim()).filter(Boolean),
    targetRoles: [].concat(prefs.targetRoles || []).map(String),
    preferredLocations: tokenize([].concat(prefs.locations || []).concat(prefs.remote ? ["remote"] : []).join(" ")),
    preferredCompanies: tokenize([].concat(prefs.companies || []).join(" ")),
    northStarGoals: tokenize(String(prefs.northStar || prefs.goals || prefs.targetIndustry || "")),
    salaryMin: Number(prefs.salaryMin || 0),
    remote: Boolean(prefs.remote),
  };
}

// ── dimension scorers (each returns 0–100) ────────────────────────────────────

const RISK_TERMS  = ["unpaid", "commission-only", "volunteer", "on-site only", "must be local",
                     "無薪", "純抽成", "責任制", "到府服務", "無底薪"];
const GROWTH_TERMS = ["scale", "scalable", "growth", "0-1", "startup", "founding", "ownership",
                      "lead", "platform", "data", "ai", "llm", "automation", "成長", "新創", "平台", "資料", "自動化"];
const LEGITIMACY_RED = ["apply now via whatsapp", "wire transfer", "send bank", "advance fee",
                        "buy equipment", "training fee", "deposit required", "salary upfront",
                        "whatsapp only", "telegram only"];
const LEGITIMACY_YELLOW = ["work from home guaranteed", "no experience needed", "$$$ per week",
                           "earn up to", "must pay", "no interview", "quick hire"];
const COMP_TERMS = ["salary", "compensation", "薪資", "薪水", "待遇", "年薪", "月薪", "nt\\$", "twd", "\\$", "k/month"];

function scoreCvMatch(job, profile) {
  const jdText = [job.title, job.company, job.location, job.description, job.employmentType]
    .filter(Boolean).join(" ");
  const jdTokens = new Set(tokenize(jdText));

  // Bidirectional: check each raw skill phrase against JD text (profile → JD)
  const skillHits   = (profile.rawSkills || []).filter(s => includes(jdText, s));
  const skillMissed = (profile.rawSkills || []).filter(s => !includes(jdText, s));

  // Tokenized keyword density (JD → profile keywords) for scoring boost
  const tokenHits = profile.keywords.filter(k => jdTokens.has(k));

  // found = accurate raw skill hits + extra token-based hits for display
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

function scoreCompensation(job) {
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const hasSalary = COMP_TERMS.some((t) => new RegExp(t, "i").test(text));
  const salary = job.salary || job.compensation || "";
  const hasRange = /\d/.test(String(salary));
  // No salary signal at all → N/A, excluded from weighted average
  if (!hasSalary && !hasRange) {
    return { score: null, hasSalary: false, hasRange: false, noData: true };
  }
  let score = hasSalary ? 72 : 50;
  if (hasRange) score = Math.min(100, score + 18);
  return { score, hasSalary, hasRange, noData: false };
}

function scoreCulture(job) {
  const text = `${job.title || ""} ${job.location || ""} ${job.description || ""}`;
  const growthHits = GROWTH_TERMS.filter((t) => includes(text, t));
  const remote = /(remote|work from home|wfh|遠端)/i.test(text);
  const hybrid = /(hybrid|混合)/i.test(text);
  const missionDriven = /(mission|impact|purpose|使命|影響力)/i.test(text);
  let score = 48 + growthHits.length * 7;
  if (remote || hybrid) score = Math.min(100, score + 12);
  if (missionDriven)    score = Math.min(100, score + 8);
  return { score: Math.min(100, score), growthHits, remote, hybrid };
}

function scoreRedFlags(job, profile) {
  const text = `${job.title || ""} ${job.company || ""} ${job.description || ""}`;
  const avoidHits = profile.avoid.filter((k) => includes(text, k));
  const riskHits  = RISK_TERMS.filter((t) => includes(text, t));
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

const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "ashby.io", "workable.com", "bamboohr.com",
  "smartrecruiters.com", "indeed.com", "linkedin.com", "104.com.tw", "yourator.co",
  "cakeresume.com", "myworkday.com", "taleo.net", "icims.com", "jobvite.com",
  "recruitee.com", "teamtailor.com", "workday.com", "japan-dev.com",
  "boards.greenhouse.io", "jobs.ashbyhq.com", "amazon.jobs", "careers.microsoft.com",
];

function blockG(job) {
  const text = [job.title, job.company, job.description].filter(Boolean).join(" ").toLowerCase();
  const url  = String(job.url || "").toLowerCase();

  const redHits    = LEGITIMACY_RED.filter(t => text.includes(t));
  const yellowHits = LEGITIMACY_YELLOW.filter(t => text.includes(t));
  const noUrl      = !job.url;

  // ── Structural signals ──────────────────────────────────────────────────
  const signals = [];

  // 1. Posting freshness
  const postDate = job.datePosted ? new Date(job.datePosted) : null;
  const daysOld  = postDate && !Number.isNaN(postDate.getTime())
    ? Math.floor((Date.now() - postDate.getTime()) / 86400000) : null;
  if (daysOld !== null) {
    if (daysOld > 120)      signals.push({ k: "yellow", msg: `Stale posting: ${daysOld}d old` });
    else if (daysOld > 60)  signals.push({ k: "yellow", msg: `Aging posting: ${daysOld}d old` });
    else if (daysOld <= 14) signals.push({ k: "green",  msg: `Fresh posting: ${daysOld}d old` });
  }

  // 2. URL quality — known ATS vs generic careers page
  const isKnownAts = Boolean(url && ATS_DOMAINS.some(d => url.includes(d)));
  if (isKnownAts) {
    signals.push({ k: "green", msg: "Known ATS platform URL" });
  } else if (url) {
    const urlPath = url.replace(/https?:\/\/[^/]+/, "");
    if (/^\/(careers?|jobs?)\/?(\?.*)?$/.test(urlPath)) {
      signals.push({ k: "yellow", msg: "Generic careers page — no job-specific ID in URL" });
    }
  }

  // 3. Description depth
  if (String(job.description || "").length < 200) {
    signals.push({ k: "yellow", msg: "Very short job description" });
  }

  // ── Tier decision ────────────────────────────────────────────────────────
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

const WEIGHTS = {
  cvMatch:      0.25,
  northStar:    0.20,
  compensation: 0.15,
  culture:      0.15,
  redFlags:     0.15,
  effort:       0.10,
};

function dimGrade(score) {
  if (score === null || score === undefined) return "N/A";
  if (score >= 87) return "A";
  if (score >= 74) return "B";
  if (score >= 60) return "C";
  if (score >= 44) return "D";
  return "F";
}

function globalTo15(score) {
  // map 0–100 to 1.0–5.0
  return Math.round(((score / 100) * 4 + 1) * 10) / 10;
}

function globalGrade(score) {
  if (score >= 85) return "A";
  if (score >= 72) return "B";
  if (score >= 58) return "C";
  if (score >= 42) return "D";
  return "F";
}

function recommendation(score, legitimacyTier) {
  if (legitimacyTier === "Suspicious") return "略過";
  if (score >= 80) return "值得投遞";
  if (score >= 62) return "觀望";
  return "略過";
}

// ── main evaluator ────────────────────────────────────────────────────────────

function evaluateJob(job, profile) {
  const cvMatch      = scoreCvMatch(job, profile);
  const northStar    = scoreNorthStar(job, profile);
  const compensation = scoreCompensation(job);
  const culture      = scoreCulture(job);
  const redFlags     = scoreRedFlags(job, profile);
  const effort       = scoreEffort(job);
  const legitimacy   = blockG(job);

  // Skip compensation when no salary data → redistribute its 15% proportionally
  const compW  = compensation.noData ? 0 : WEIGHTS.compensation;
  const totalW = WEIGHTS.cvMatch + WEIGHTS.northStar + compW + WEIGHTS.culture + WEIGHTS.redFlags + WEIGHTS.effort;
  const rawScore = Math.round((
    cvMatch.score             * WEIGHTS.cvMatch   +
    northStar.score           * WEIGHTS.northStar +
    (compensation.score ?? 0) * compW             +
    culture.score             * WEIGHTS.culture   +
    redFlags.score            * WEIGHTS.redFlags  +
    effort.score              * WEIGHTS.effort
  ) / totalW);
  const score   = Math.max(0, Math.min(100, rawScore));
  const rating  = globalTo15(score);  // 1.0–5.0
  const grade   = globalGrade(score);
  const rec     = recommendation(score, legitimacy.tier);

  const dimensions = {
    cvMatch:      { score: cvMatch.score,      grade: dimGrade(cvMatch.score),      label: "CV Match",                  found: cvMatch.found,      missing: cvMatch.missing },
    northStar:    { score: northStar.score,    grade: dimGrade(northStar.score),    label: "North Star Alignment" },
    compensation: { score: compensation.score, grade: dimGrade(compensation.score), label: "Compensation Competitiveness", noData: compensation.noData || false },
    culture:      { score: culture.score,      grade: dimGrade(culture.score),      label: "Culture Signals",           growthHits: culture.growthHits },
    redFlags:     { score: redFlags.score,     grade: dimGrade(redFlags.score),     label: "Red Flags",                 avoidHits: redFlags.avoidHits, riskHits: redFlags.riskHits },
    effort:       { score: effort.score,       grade: dimGrade(effort.score),       label: "Application Effort" },
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
      source: "career-ops-evaluate-v2",
      overall: {
        grade,
        score,
        rating,
        recommendation: rec,
        legitimacyTier: legitimacy.tier,
        summary: buildSummary(score, rating, dimensions, legitimacy, cvMatch),
      },
      decision_factors: buildDecisionFactors(dimensions, northStar, culture),
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

function buildDecisionFactors(dims, northStar, culture) {
  const factors = [];
  if (northStar.targetHit) factors.push("命中目標職位類型");
  else if (northStar.roleHit) factors.push("符合目標職稱關鍵字");
  if (northStar.nsHits?.length) factors.push(`職涯方向吻合訊號：${northStar.nsHits.slice(0, 4).join("、")}`);
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

  const jobsPayload = JSON.parse(await fs.readFile(args.jobs, "utf8"));
  const profile     = normalizeProfile(JSON.parse(await fs.readFile(args.profile, "utf8")));
  const jobs        = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
  const evaluated   = jobs.map((job) => job.isExpired ? job : evaluateJob(job, profile));

  const payload = {
    ...jobsPayload,
    evaluatedAt: new Date().toISOString(),
    evaluatedBy: "career-ops-evaluate-v2",
    scoringModel: {
      version: "v2",
      dimensions: Object.keys(WEIGHTS),
      weights: WEIGHTS,
      scale: "0–100 + 1.0–5.0 + A–F + Block G",
    },
    jobs: evaluated,
  };

  const out = args.out || args.jobs;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`[career-ops] evaluated ${evaluated.length} job(s) with 6D+BlockG -> ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
