/**
 * Career Ops scoring configuration — externalized tunables.
 *
 * Everything that used to be hard-coded inside career-ops-evaluate.mjs lives here
 * so it can be tuned / A-B tested without editing engine logic, and so unit tests
 * can inject custom configs. `loadScoringConfig()` optionally deep-merges an
 * override JSON (via --config or CAREER_OPS_SCORING_CONFIG) on top of these defaults.
 *
 * NOTE: pure data + a couple of pure helpers. No file I/O at import time, so the
 * scorers that import DEFAULT_SCORING_CONFIG stay synchronous and testable.
 */

import fs from "node:fs/promises";

// ── dimension weights (must cover the 8 named dimensions) ─────────────────────
// Dimensions that report `noData` (compensation, fieldMatch, experience) are
// dropped from the weighted average and their weight is redistributed
// proportionally across the remaining dimensions — see evaluateJob().
export const DEFAULT_WEIGHTS = {
  cvMatch:      0.20, // profile keyword / skills match
  experience:   0.15, // work-history relevance + promotion trajectory (NEW)
  northStar:    0.15, // role / career-direction alignment
  compensation: 0.12, // salary competitiveness signals
  redFlags:     0.12, // risk / concern signals (inverted: 100 = clean)
  fieldMatch:   0.10, // field-of-study ↔ role-domain alignment (NEW)
  culture:      0.10, // growth / culture / work-mode signals
  effort:       0.06, // application feasibility (has URL, quality JD)
};

// ── keyword lexicons ──────────────────────────────────────────────────────────
export const RISK_TERMS = [
  "unpaid", "commission-only", "volunteer", "on-site only", "must be local",
  "無薪", "純抽成", "責任制", "到府服務", "無底薪",
];

export const GROWTH_TERMS = [
  "scale", "scalable", "growth", "0-1", "startup", "founding", "ownership",
  "lead", "platform", "data", "ai", "llm", "automation",
  "成長", "新創", "平台", "資料", "自動化",
];

export const LEGITIMACY_RED = [
  "apply now via whatsapp", "wire transfer", "send bank", "advance fee",
  "buy equipment", "training fee", "deposit required", "salary upfront",
  "whatsapp only", "telegram only",
];

export const LEGITIMACY_YELLOW = [
  "work from home guaranteed", "no experience needed", "$$$ per week",
  "earn up to", "must pay", "no interview", "quick hire",
];

export const COMP_TERMS = [
  "salary", "compensation", "薪資", "薪水", "待遇", "年薪", "月薪",
  "nt\\$", "twd", "\\$", "k/month",
];

export const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "ashby.io", "workable.com", "bamboohr.com",
  "smartrecruiters.com", "indeed.com", "linkedin.com", "104.com.tw", "yourator.co",
  "cakeresume.com", "myworkday.com", "taleo.net", "icims.com", "jobvite.com",
  "recruitee.com", "teamtailor.com", "workday.com", "japan-dev.com",
  "boards.greenhouse.io", "jobs.ashbyhq.com", "amazon.jobs", "careers.microsoft.com",
];

// ── stopwords (A3: expanded CJK coverage) ────────────────────────────────────
// Previously only 12 CJK terms were filtered; noise like 公司/職務/團隊/我們
// leaked into keyword overlap and inflated cvMatch on Chinese JDs.
export const STOPWORDS = [
  // English
  "and", "the", "with", "for", "you", "our", "are", "this", "that", "will",
  "your", "who", "job", "role", "team", "work", "have", "has",
  // Chinese (Traditional + common Simplified)
  "以及", "或", "與", "和", "工作", "職缺", "相關", "負責", "具備", "優先",
  "公司", "職務", "團隊", "我們", "你們", "他們", "以上", "熟悉", "了解", "以及",
  "能力", "經驗", "需求", "包括", "或是", "以及", "等等", "一起", "這個", "那個",
  "職位", "應徵", "歡迎", "加入", "提供", "本職", "此外", "並且", "透過", "使用",
];

// ── grade / rating thresholds ────────────────────────────────────────────────
export const THRESHOLDS = {
  dimGrade:    { A: 87, B: 74, C: 60, D: 44 },
  globalGrade: { A: 85, B: 72, C: 58, D: 42 },
  recommend:   { pursue: 80, watch: 62 }, // ≥pursue "值得投遞", ≥watch "觀望", else "略過"
};

// ── field-of-study ↔ role-domain mapping (科系匹配度) ─────────────────────────
// A candidate's major maps to one or more domains; a job maps to domains via
// title/description signals. Overlap → high fieldMatch. This is intentionally
// coarse (JDs rarely state a required major) and CJK-aware for TW resumes.
export const FIELD_DOMAINS = {
  software:   ["computer science", "computer engineering", "software", "資訊工程", "資工", "資訊科學",
               "軟體", "電機資訊", "資管", "資訊管理", "information engineering", "cs"],
  hardware:   ["electrical engineering", "electronics", "電機", "電子", "電機工程", "半導體", "semiconductor",
               "communication engineering", "通訊", "光電", "microelectronics"],
  data:       ["statistics", "data science", "統計", "資料科學", "數據", "應用數學", "mathematics", "數學",
               "machine learning", "人工智慧", "artificial intelligence"],
  mechanical: ["mechanical", "機械", "機械工程", "自動化", "mechatronics", "機電"],
  design:     ["design", "設計", "工業設計", "視覺傳達", "ux", "ui", "hci", "人機互動", "數位媒體"],
  business:   ["business", "management", "企管", "商管", "工管", "工業工程", "財金", "finance", "會計",
               "accounting", "行銷", "marketing", "經濟", "economics", "mba"],
  bioMedical: ["biology", "生物", "醫學", "medical", "生醫", "生物醫學", "chemistry", "化學", "化工",
               "chemical engineering", "生技", "biotech", "pharmacy", "藥學"],
  civil:      ["civil", "土木", "建築", "architecture", "環境工程", "environmental"],
  humanities: ["literature", "文學", "外文", "語言", "linguistics", "歷史", "history", "哲學", "社會",
               "sociology", "心理", "psychology", "教育", "education", "傳播", "journalism", "新聞"],
};

// Which domains a job's role-family implies (for scoring overlap with candidate)
export const ROLE_FAMILY_DOMAINS = {
  "Frontend":       ["software", "design"],
  "Backend":        ["software", "data"],
  "Full Stack":     ["software"],
  "AI/Data":        ["data", "software"],
  "Product":        ["business", "software", "design"],
  "Design":         ["design"],
  "Marketing":      ["business", "humanities"],
  "Sales":          ["business"],
  "Operations":     ["business"],
  "Hardware":       ["hardware", "mechanical"],
  "Data/Analytics": ["data"],
};

// ── seniority ladder (工作經驗 / 晉升偵測) ────────────────────────────────────
// Numeric rank for detecting promotion trajectory and role-fit.
export const SENIORITY_RANK = {
  Intern: 1, Junior: 2, Mid: 3, "Senior": 4, "Senior+": 4, Lead: 5,
  Staff: 5, Principal: 5, Manager: 5, "Manager+": 5, Director: 6, VP: 7, Executive: 8,
};

// NOTE: `\b` word boundaries do not work around CJK characters (they are treated
// as non-word chars), so ASCII terms use \b for false-positive protection
// (e.g. "international" must not match "intern") while CJK terms match as plain
// substrings. Keep the two groups separate in each pattern.
export const SENIORITY_PATTERNS = [
  { level: "VP",       rank: 7, re: /\b(?:vp|vice.?president)\b|副總|執行副總/i },
  { level: "Director", rank: 6, re: /\b(?:director|head of)\b|總監|處長/i },
  { level: "Manager",  rank: 5, re: /\b(?:manager|team lead)\b|經理|部門主管|技術主管|負責人/i },
  { level: "Principal",rank: 5, re: /\b(?:principal|staff engineer|architect)\b|首席|技術長|架構師/i },
  { level: "Lead",     rank: 5, re: /\b(?:lead|leader)\b|組長|領導|資深主管/i },
  { level: "Senior",   rank: 4, re: /\b(?:senior|sr\.?)\b|資深|高級/i },
  { level: "Mid",      rank: 3, re: /\b(?:mid|intermediate)\b|中階|中級/i },
  { level: "Junior",   rank: 2, re: /\b(?:junior|jr\.?|entry.?level|associate)\b|新鮮人|初階|助理/i },
  { level: "Intern",   rank: 1, re: /\b(?:intern|internship)\b|實習|工讀/i },
];

// Experience-scoring tunables
export const EXPERIENCE_CONFIG = {
  stagnationYears: 6,       // ≥ this many years total …
  stagnationPenalty: 22,    // … with zero promotion → subtract this
  promotionBonusPerStep: 10,// each seniority increase across roles → add this (capped)
  promotionBonusCap: 30,
  roleFitBonus: 22,         // candidate seniority matches job seniority band
  underLevelPenalty: 14,    // candidate clearly below job level
  overQualifiedPenalty: 8,  // candidate well above job level
  base: 55,
};

// ── deep-merge helper for overrides ──────────────────────────────────────────
function isObject(v) { return v && typeof v === "object" && !Array.isArray(v); }

export function deepMerge(base, override) {
  if (!isObject(override)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

export const DEFAULT_SCORING_CONFIG = {
  weights: DEFAULT_WEIGHTS,
  riskTerms: RISK_TERMS,
  growthTerms: GROWTH_TERMS,
  legitimacyRed: LEGITIMACY_RED,
  legitimacyYellow: LEGITIMACY_YELLOW,
  compTerms: COMP_TERMS,
  atsDomains: ATS_DOMAINS,
  stopwords: STOPWORDS,
  thresholds: THRESHOLDS,
  fieldDomains: FIELD_DOMAINS,
  roleFamilyDomains: ROLE_FAMILY_DOMAINS,
  seniorityRank: SENIORITY_RANK,
  seniorityPatterns: SENIORITY_PATTERNS, // note: RegExp not JSON-serialisable; overrides use `seniorityPatternsRaw`
  experience: EXPERIENCE_CONFIG,
};

/**
 * Load config with optional JSON override deep-merged on top of defaults.
 * Override may come from an explicit path or CAREER_OPS_SCORING_CONFIG env var.
 * Regex-based seniorityPatterns can be overridden via `seniorityPatternsRaw`:
 *   [{ level, rank, pattern, flags }]  → compiled to RegExp here.
 */
export async function loadScoringConfig(overridePath) {
  const target = overridePath || process.env.CAREER_OPS_SCORING_CONFIG || "";
  if (!target) return DEFAULT_SCORING_CONFIG;
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    console.error(`[career-ops] scoring config override not applied (${target}): ${error.message}`);
    return DEFAULT_SCORING_CONFIG;
  }
  if (Array.isArray(raw.seniorityPatternsRaw)) {
    raw.seniorityPatterns = raw.seniorityPatternsRaw.map((p) => ({
      level: p.level, rank: p.rank, re: new RegExp(p.pattern, p.flags || "i"),
    }));
    delete raw.seniorityPatternsRaw;
  }
  return deepMerge(DEFAULT_SCORING_CONFIG, raw);
}

/** Infer a seniority {level, rank} from free text (title preferred over description). */
export function inferSeniority(text, patterns = SENIORITY_PATTERNS) {
  const src = String(text || "");
  for (const p of patterns) {
    if (p.re.test(src)) return { level: p.level, rank: p.rank };
  }
  return { level: "Unknown", rank: 0 };
}
