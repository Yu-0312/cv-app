/**
 * Career Ops target-similarity — pure, dependency-free.
 *
 * Given a user-supplied *target* (a company and/or a job title, optionally a
 * location / remote preference), score how similar each job posting is to that
 * target, so the app can surface "跑相似的" instead of scoring all 90k+ jobs.
 *
 * Composite of four sub-signals, each weighted; any sub-signal the target does
 * not specify (e.g. no company given) is dropped and its weight redistributed
 * across the specified ones — mirroring the engine's noData redistribution.
 *
 *   company   0.30  — normalised company-name match
 *   title     0.38  — role-family match + title token overlap
 *   domain    0.17  — field-of-study / role-domain overlap
 *   location  0.15  — city / remote match
 *
 * NOTE: kept self-contained (no imports) on purpose so the identical logic can
 * be mirrored inline in the single-file browser app without a bundler. Keep the
 * two copies in sync; the Node copy is the source of truth and is unit-tested.
 */

export const DEFAULT_SIMILARITY_WEIGHTS = {
  company: 0.30,
  title: 0.38,
  domain: 0.17,
  location: 0.15,
};

// ── lightweight role-family classifier (self-contained) ──────────────────────
const ROLE_FAMILY_PATTERNS = [
  { fam: "Frontend",   re: /(front.?end|前端|react|vue|angular|ui engineer)/i },
  { fam: "Backend",    re: /(back.?end|後端|server|golang|\bjava\b|node\.?js|api engineer|php|ruby|rails|django)/i },
  { fam: "FullStack",  re: /(full.?stack|全端|全棧)/i },
  { fam: "AI/Data",    re: /(machine learning|ml engineer|data scien|deep learning|人工智慧|演算法|ai engineer|llm|nlp)/i },
  { fam: "Data",       re: /(data analyst|data engineer|analytics|資料工程|數據分析|\bbi\b|etl)/i },
  { fam: "Product",    re: /(product manager|產品經理|product owner|\bpm\b|專案經理)/i },
  { fam: "Design",     re: /(designer|設計師|\bux\b|ui\/ux|視覺|graphic|motion)/i },
  { fam: "Marketing",  re: /(marketing|行銷|growth marketer|\bseo\b|社群|content)/i },
  { fam: "Sales",      re: /(sales|業務|銷售|account executive|\bbd\b|銷售)/i },
  { fam: "Hardware",   re: /(hardware|硬體|ic design|電路|firmware|韌體|embedded|嵌入式|類比|數位電路)/i },
  { fam: "DevOps",     re: /(devops|sre|site reliability|infrastructure|平台工程|maintainer|kubernetes)/i },
  { fam: "Mobile",     re: /(\bios\b|android|mobile engineer|swift|kotlin|flutter|react native|行動)/i },
  { fam: "QA",         re: /(\bqa\b|quality assurance|test engineer|測試|sdet)/i },
  { fam: "Operations", re: /(operations|營運|ops engineer|supply chain|客服|customer success)/i },
];

const DOMAIN_KEYWORDS = {
  software:   ["software", "engineer", "developer", "程式", "軟體", "工程師", "react", "backend", "frontend", "full stack", "api"],
  data:       ["data", "ml", "machine learning", "analytics", "statistics", "資料", "數據", "演算法", "ai", "人工智慧"],
  hardware:   ["hardware", "firmware", "embedded", "ic", "circuit", "硬體", "韌體", "電路", "半導體", "電機"],
  design:     ["design", "ux", "ui", "設計", "視覺", "graphic"],
  business:   ["product", "marketing", "sales", "business", "operations", "產品", "行銷", "業務", "營運", "商務"],
  mobile:     ["ios", "android", "mobile", "flutter", "行動", "app"],
};

export function inferRoleFamilyLite(text) {
  const src = String(text || "");
  for (const p of ROLE_FAMILY_PATTERNS) if (p.re.test(src)) return p.fam;
  return "General";
}

function inferDomains(text) {
  const src = String(text || "").toLowerCase();
  const out = new Set();
  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    if (kws.some((kw) => src.includes(kw))) out.add(domain);
  }
  return out;
}

// ── normalisation + token helpers ────────────────────────────────────────────
const COMPANY_SUFFIXES = /\b(inc|inc\.|llc|ltd|ltd\.|co|co\.|corp|corporation|company|limited|gmbh|group|holdings|technologies|technology|tech|labs|studio)\b/gi;
const COMPANY_CJK_SUFFIX = /(股份有限公司|有限公司|股份|集團|公司|科技|資訊|網路|國際|企業)/g;

function normCompany(v) {
  return String(v || "")
    .toLowerCase()
    .replace(COMPANY_CJK_SUFFIX, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(v) {
  return new Set(
    String(v || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+#]+/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// ── sub-signals (each returns 0..1) ──────────────────────────────────────────
function companySim(seedCompany, jobCompany) {
  const a = normCompany(seedCompany);
  const b = normCompany(jobCompany);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  return jaccard(new Set(a.split(" ")), new Set(b.split(" ")));
}

function titleSim(seedTitle, jobTitle, jobText) {
  const st = String(seedTitle || "");
  if (!st) return 0;
  const seedFam = inferRoleFamilyLite(st);
  const jobFam = inferRoleFamilyLite(`${jobTitle || ""} ${jobText || ""}`);
  let famScore = 0;
  if (seedFam !== "General" && seedFam === jobFam) famScore = 0.6;
  else if (seedFam === jobFam) famScore = 0.25; // both General
  const tokScore = jaccard(tokens(st), tokens(jobTitle)) * 0.4;
  return Math.min(1, famScore + tokScore);
}

function domainSim(seedText, jobText) {
  const a = inferDomains(seedText);
  const b = inferDomains(jobText);
  if (!a.size || !b.size) return 0;
  return jaccard(a, b);
}

function locationSim(seed, job) {
  const seedLoc = String(seed.location || "").toLowerCase().trim();
  const wantRemote = Boolean(seed.remote);
  if (!seedLoc && !wantRemote) return null; // not specified → drop
  const jobLoc = `${job.location || ""} ${job.description || ""}`.toLowerCase();
  const jobRemote = /(remote|work from home|wfh|遠端|遠距|在家)/.test(jobLoc);
  let score = 0;
  if (wantRemote && jobRemote) score = Math.max(score, 1);
  if (seedLoc) {
    if (jobLoc.includes(seedLoc)) score = Math.max(score, 1);
    else score = Math.max(score, jaccard(tokens(seedLoc), tokens(job.location)));
  }
  return score;
}

/**
 * Similarity of one job to the target seed.
 * @returns {{score:number, parts:object, roleFamily:string}}
 */
export function targetSimilarity(seed, job, weights = DEFAULT_SIMILARITY_WEIGHTS) {
  const seedTitle = seed.title || seed.role || "";
  const seedText = `${seedTitle} ${seed.description || ""}`;
  const jobText = `${job.title || ""} ${job.description || ""}`;

  const parts = {};
  const active = [];
  const add = (key, val, w) => { if (val !== null && val !== undefined) { parts[key] = val; active.push({ val, w }); } };

  add("company", seed.company ? companySim(seed.company, job.company) : null, weights.company);
  add("title", seedTitle ? titleSim(seedTitle, job.title, jobText) : null, weights.title);
  add("domain", seedTitle || seed.description ? domainSim(seedText, jobText) : null, weights.domain);
  add("location", locationSim(seed, job), weights.location);

  const totalW = active.reduce((s, p) => s + p.w, 0) || 1;
  const score = active.reduce((s, p) => s + p.val * p.w, 0) / totalW;
  return { score: Math.round(score * 1000) / 1000, parts, roleFamily: inferRoleFamilyLite(jobText) };
}

/**
 * Rank jobs by similarity to the seed. Returns the top `limit` above `threshold`,
 * each annotated with `similarity` (0..1) and `similarityParts`.
 */
export function rankBySimilarity(seed, jobs, opts = {}) {
  const { limit = 50, threshold = 0.12, weights = DEFAULT_SIMILARITY_WEIGHTS } = opts;
  const scored = [];
  for (const job of jobs || []) {
    const sim = targetSimilarity(seed, job, weights);
    if (sim.score >= threshold) {
      scored.push({ ...job, similarity: sim.score, similarityParts: sim.parts });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return typeof limit === "number" && limit > 0 ? scored.slice(0, limit) : scored;
}
