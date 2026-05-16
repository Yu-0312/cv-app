#!/usr/bin/env node

/**
 * career-ops-saas-worker
 *
 * Long-running Node.js server that processes Career Ops analysis jobs
 * queued by the `career-ops-run-analysis` Supabase Edge Function.
 *
 * Architecture:
 *   1. Poll `career_ops_analyses` for status='queued' every --poll-interval ms
 *   2. For each queued job: load user profile from DB, run intelligence +
 *      deep-fit stages against the shared job snapshot, write results back
 *   3. Update progress via DB so the Edge Function poll endpoint reflects it
 *   4. Listen on pg_notify channel 'career_ops_analysis_queued' for instant
 *      wake-up (falls back to polling if notify not available)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/career-ops-saas-worker.mjs
 *
 * Options:
 *   --poll-interval <ms>   DB poll interval. Default: 10000 (10s)
 *   --concurrency <n>      Max parallel analyses. Default: 2
 *   --jobs-file <path>     Shared job snapshot. Default: data/app/career-ops-jobs.json
 *   --help
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const DEFAULT_JOBS_FILE = "data/app/career-ops-jobs.json";
const DEFAULT_POLL_MS   = 10_000;
const DEFAULT_CONCURRENCY = 2;

// ── helpers ──────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`Career Ops SaaS analysis worker

Polls Supabase for queued analyses and runs the intelligence + deep-fit
pipeline stages in-process. Writes results back to career_ops_analyses.

Environment variables required:
  SUPABASE_URL               Your project URL
  SUPABASE_SERVICE_ROLE_KEY  Service role key (bypasses RLS)

No model API key is required here. User-owned keys are used only in the
browser to extract the resume profile before the analysis is queued.

Options:
  --poll-interval <ms>   Default: ${DEFAULT_POLL_MS}
  --concurrency <n>      Default: ${DEFAULT_CONCURRENCY}
  --jobs-file <path>     Default: ${DEFAULT_JOBS_FILE}
  --help
`);
}

function parseArgs(argv) {
  const args = {
    pollInterval: DEFAULT_POLL_MS,
    concurrency: DEFAULT_CONCURRENCY,
    jobsFile: DEFAULT_JOBS_FILE
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--help" || t === "-h") { args.help = true; }
    else if (t === "--poll-interval") args.pollInterval = Number(argv[++i]) || DEFAULT_POLL_MS;
    else if (t === "--concurrency")   args.concurrency  = Number(argv[++i]) || DEFAULT_CONCURRENCY;
    else if (t === "--jobs-file")     args.jobsFile     = argv[++i] || DEFAULT_JOBS_FILE;
    else throw new Error(`Unknown arg: ${t}`);
  }
  return args;
}

function array(v) { return Array.isArray(v) ? v : v ? [v] : []; }

function log(level, msg, extra = "") {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${level}] ${msg}${extra ? " " + extra : ""}`);
}

// ── Supabase client (minimal fetch-based, no SDK needed) ─────────────────

function makeSupabaseClient(url, serviceKey) {
  const headers = {
    "apikey": serviceKey,
    "authorization": `Bearer ${serviceKey}`,
    "content-type": "application/json",
    "prefer": "return=representation"
  };

  async function query(table, params = {}) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const res = await fetch(`${url}/rest/v1/${table}${qs ? "?" + qs : ""}`, { headers });
    if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function update(table, id, data) {
    const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Supabase PATCH ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function select(table, filters = {}, select = "*") {
    const params = { select, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, `eq.${v}`])) };
    return query(table, params);
  }

  return { query, update, select };
}

// ── Intelligence scoring (inline, extracted from career-ops-intelligence.mjs) ──

const SKILL_TERMS = [
  "javascript", "typescript", "react", "vue", "angular", "next.js", "node.js",
  "python", "java", "go", "sql", "postgres", "aws", "docker", "kubernetes",
  "graphql", "rest", "api", "html", "css", "tailwind", "figma", "accessibility",
  "analytics", "llm", "rag", "agents", "machine learning", "product management",
  "crm", "seo", "growth", "operations", "tableau", "power bi"
];

function scoreJobAgainstProfile(job, profile) {
  const skills = array(profile?.skills).map(s => String(s).toLowerCase());
  const targetRoles = array(profile?.preferences?.targetRoles).map(r => String(r).toLowerCase());
  const keywords = [...skills, ...array(profile?.preferences?.keywords).map(k => String(k).toLowerCase())];
  const text = `${job.title || ""} ${job.description || ""} ${job.company || ""}`.toLowerCase();

  // Skill coverage
  const skillHits = skills.filter(s => text.includes(s));
  const skillCoverage = skills.length ? Math.round((skillHits.length / skills.length) * 100) : 50;

  // Role fit
  const titleLow = String(job.title || "").toLowerCase();
  const roleFit = targetRoles.length
    ? targetRoles.some(r => titleLow.includes(r) || r.split(" ").filter(Boolean).some(w => titleLow.includes(w)))
      ? Math.min(100, 65 + skillCoverage * 0.3)
      : Math.max(10, skillCoverage * 0.6)
    : 50;

  // JD skills the profile doesn't cover
  const jdSkills = SKILL_TERMS.filter(t => text.includes(t));
  const jdSkillsMissingFromProfile = jdSkills.filter(t => !keywords.includes(t)).slice(0, 12);

  // Profile skills not in JD
  const profileSkillsNotInJd = skills.filter(s => !text.includes(s)).slice(0, 8);

  // ATS keyword check
  const atsKeywords = jdSkills.slice(0, 20);
  const atsMissing = atsKeywords.filter(k => !keywords.includes(k)).slice(0, 10);
  const atsFound = atsKeywords.filter(k => keywords.includes(k)).slice(0, 10);

  const score = Math.round((skillCoverage * 0.5 + roleFit * 0.5));

  return {
    score,
    dimensions: { roleFit: Math.round(roleFit), skillCoverage },
    features: { skills: jdSkills, jdSkillsMissingFromProfile, profileSkillsNotInJd },
    ats_keywords: { found: atsFound, missing: atsMissing }
  };
}

// ── Deep-fit dossier builder (heuristic only, no LLM for worker) ──────────

function buildDossier(job, profile) {
  const text = `${job.title || ""} ${job.company || ""} ${job.description || ""}`.toLowerCase();
  const skills = array(profile?.skills).map(s => String(s).toLowerCase());
  const hits = skills.filter(s => text.includes(s)).slice(0, 14);
  const intel = scoreJobAgainstProfile(job, profile);
  const misses = intel.features.jdSkillsMissingFromProfile.slice(0, 12);
  const score = job.score || intel.score;
  const decision = score >= 82 ? "pursue aggressively"
    : score >= 70 ? "pursue selectively"
    : score >= 56 ? "hold / compare"
    : "skip unless strategic";

  return {
    jobKey: String(job.jobKey || job.url || `${job.company}:${job.title}`).trim(),
    company: job.company || "",
    title: job.title || "",
    url: job.url || "",
    score,
    grade: job.grade || "",
    confidence: hits.length >= 6 ? "high" : hits.length >= 3 ? "medium" : "low",
    decision,
    thesis: `${job.title} at ${job.company} is ${decision} (score ${score}, ${hits.length} keyword hits, ${misses.length} gaps).`,
    evidence: {
      keywordHits: hits,
      keywordMisses: misses,
      researchSignals: [],
      compensationLeverage: ""
    },
    concerns: [
      !job.description || job.description.length < 300 ? "Short job description — low confidence." : ""
    ].filter(Boolean),
    cvStrategy: hits.length
      ? [`Lead with proof around: ${hits.slice(0, 5).join(", ")}.`]
      : ["Add role-specific keywords before applying."],
    interviewStrategy: ["Ask why the role is open and what success looks like in 90 days."],
    storyHooks: [],
    llm: null,
    layer: "A"
  };
}

// ── Three-layer classification ──────────────────────────────────────────

function classifyJobs(jobs, profile) {
  const targetRoles = array(profile?.preferences?.targetRoles).map(r => String(r).toLowerCase());

  const scored = jobs
    .filter(j => !j.isExpired)
    .map(j => {
      const intel = scoreJobAgainstProfile(j, profile);
      return { ...j, _roleFit: intel.dimensions.roleFit, _score: j.score || intel.score, _intel: intel };
    })
    .sort((a, b) => b._score - a._score);

  const layerAJobs = scored.filter(j => !targetRoles.length || j._roleFit >= 68).slice(0, 25);
  const layerAKeys = new Set(layerAJobs.map(j => j.jobKey || j.url));

  const layerBJobs = scored
    .filter(j => !layerAKeys.has(j.jobKey || j.url) && j._roleFit >= 40 && j._roleFit < 68)
    .slice(0, 40);
  const layerBKeys = new Set(layerBJobs.map(j => j.jobKey || j.url));

  const layerCJobs = scored
    .filter(j => !layerAKeys.has(j.jobKey || j.url) && !layerBKeys.has(j.jobKey || j.url))
    .slice(0, 30);

  const layerA = layerAJobs.map(j => buildDossier(j, profile));
  const layerB = layerBJobs.map(j => ({
    jobKey: j.jobKey || "",
    company: j.company || "",
    title: j.title || "",
    url: j.url || "",
    score: j._score,
    grade: j.grade || "",
    roleFit: j._roleFit,
    location: j.location || "",
    keywordHits: j._intel.features ? array(profile?.skills).filter(s => String(j.description || "").toLowerCase().includes(s)).slice(0, 8) : [],
    keywordMisses: j._intel.features.jdSkillsMissingFromProfile.slice(0, 6),
    decision: j._score >= 70 ? "pursue selectively" : j._score >= 55 ? "hold / compare" : "skip unless strategic",
    layer: "B"
  }));
  const layerC = layerCJobs.map(j => ({
    jobKey: j.jobKey || "",
    company: j.company || "",
    title: j.title || "",
    url: j.url || "",
    score: j._score,
    grade: j.grade || "",
    roleFit: j._roleFit,
    location: j.location || "",
    topGap: j._intel.features.jdSkillsMissingFromProfile[0] || "",
    mainGaps: j._intel.features.jdSkillsMissingFromProfile.slice(0, 4),
    layer: "C"
  }));

  return { layerA, layerB, layerC };
}

// ── Progress stages ─────────────────────────────────────────────────────

const STAGES = [
  { stage: "loading_profile",   progress: 5,  label: "載入 profile" },
  { stage: "loading_jobs",      progress: 15, label: "載入職缺資料庫" },
  { stage: "scoring",           progress: 40, label: "智能評分中" },
  { stage: "deep_fit",          progress: 70, label: "建立深度 dossier" },
  { stage: "writing_results",   progress: 90, label: "寫入結果" },
  { stage: "completed",         progress: 100, label: "完成" }
];

// ── Main analysis runner ─────────────────────────────────────────────────

async function runAnalysis(db, analysis, jobsFile) {
  const id = analysis.id;
  const userId = analysis.user_id;
  const profileId = analysis.profile_id;

  async function setStage(stage, progress, extra = {}) {
    log("INFO", `[${id.slice(0, 8)}] ${stage} (${progress}%)`);
    await db.update("career_ops_analyses", id, { stage, progress, status: progress < 100 ? "running" : "completed", started_at: new Date().toISOString(), ...extra });
  }

  try {
    await setStage("loading_profile", 5);

    // Load user profile from DB
    const profiles = await db.select("career_ops_user_profiles", { id: profileId });
    const profile = profiles?.[0]?.profile_json || {};
    if (!profile.role && !profile.skills?.length) {
      throw new Error("Profile is empty or not found");
    }

    await setStage("loading_jobs", 15);

    // Load shared job snapshot
    let jobsPayload;
    try {
      jobsPayload = JSON.parse(await fs.readFile(jobsFile, "utf8"));
    } catch {
      throw new Error(`Cannot read job snapshot: ${jobsFile}`);
    }
    const jobs = array(jobsPayload.jobs);
    if (!jobs.length) throw new Error("Job snapshot is empty");
    log("INFO", `[${id.slice(0, 8)}] Loaded ${jobs.length} jobs`);

    await setStage("scoring", 40);

    // Score and classify jobs
    const { layerA, layerB, layerC } = classifyJobs(jobs, profile);

    await setStage("deep_fit", 70);

    const summary = {
      totalResults: layerA.length + layerB.length + layerC.length,
      layerA: layerA.length,
      layerB: layerB.length,
      layerC: layerC.length,
      analyzedJobCount: jobs.length,
      generatedAt: new Date().toISOString()
    };

    await setStage("writing_results", 90);

    // Write results back
    await db.update("career_ops_analyses", id, {
      status: "completed",
      stage: "completed",
      progress: 100,
      summary_json: summary,
      layer_a_json: layerA,
      layer_b_json: layerB,
      layer_c_json: layerC,
      completed_at: new Date().toISOString()
    });

    log("INFO", `[${id.slice(0, 8)}] Done — ${summary.totalResults} results (A:${layerA.length} B:${layerB.length} C:${layerC.length})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", `[${id.slice(0, 8)}] Failed: ${msg}`);
    await db.update("career_ops_analyses", id, {
      status: "failed",
      stage: "error",
      error: msg
    }).catch(() => {});
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────

async function pollAndProcess(db, args, inFlight) {
  if (inFlight.size >= args.concurrency) return;

  let rows;
  try {
    rows = await db.query("career_ops_analyses", {
      select: "id,user_id,profile_id",
      status: "eq.queued",
      order: "queued_at.asc",
      limit: String(args.concurrency - inFlight.size)
    });
  } catch (err) {
    log("WARN", "Poll failed:", err.message);
    return;
  }

  for (const row of array(rows)) {
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    // Mark as running immediately to prevent double-pickup
    await db.update("career_ops_analyses", row.id, { status: "running", started_at: new Date().toISOString() }).catch(() => {});
    runAnalysis(db, row, args.jobsFile)
      .finally(() => inFlight.delete(row.id));
  }
}

// ── Entry point ──────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exitCode = 1;
    return;
  }

  if (!fsSync.existsSync(args.jobsFile)) {
    console.error(`Error: Jobs file not found: ${args.jobsFile}`);
    console.error("Run 'npm run career-ops:pipeline' first to generate it.");
    process.exitCode = 1;
    return;
  }

  const db = makeSupabaseClient(supabaseUrl, serviceKey);
  const inFlight = new Set();

  log("INFO", `Worker started — poll=${args.pollInterval}ms concurrency=${args.concurrency} jobs=${args.jobsFile}`);

  // Initial poll
  await pollAndProcess(db, args, inFlight);

  // Recurring poll
  setInterval(() => pollAndProcess(db, args, inFlight), args.pollInterval);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      log("INFO", `${sig} received — shutting down (${inFlight.size} in-flight)`);
      process.exit(0);
    });
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
