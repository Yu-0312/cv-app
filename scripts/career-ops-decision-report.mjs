#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_RESEARCH = "data/app/career-ops-deep-research.json";
const DEFAULT_COMPENSATION = "data/app/career-ops-compensation.json";
const DEFAULT_STORY_BANK = "data/app/career-ops-story-bank.json";
const DEFAULT_APPLICATION_KIT = "data/app/career-ops-application-kit.json";
const DEFAULT_DEEP_FIT = "data/app/career-ops-deep-fit.json";
const DEFAULT_OUT = "data/app/career-ops-decision-report.json";
const DEFAULT_JS_OUT = "data/app/career-ops-decision-report.js";
const DEFAULT_REPORT = "data/app/career-ops-decision-report.md";

function printHelp() {
  console.log(`Career Ops decision report

Builds career-ops-style A-F single-job dossiers from the normalized snapshot,
deep fit, research, application kit, compensation, and story bank artifacts.

Usage:
  node scripts/career-ops-decision-report.mjs --top 12

Options:
  --jobs <file>             Jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>          Profile JSON. Default: ${DEFAULT_PROFILE}
  --research <file>         Deep research JSON. Default: ${DEFAULT_RESEARCH}
  --compensation <file>     Compensation JSON. Default: ${DEFAULT_COMPENSATION}
  --story-bank <file>       Story bank JSON. Default: ${DEFAULT_STORY_BANK}
  --application-kit <file>  Application kit JSON. Default: ${DEFAULT_APPLICATION_KIT}
  --deep-fit <file>         Deep fit JSON. Default: ${DEFAULT_DEEP_FIT}
  --out <file>              JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>           Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file>       Markdown output. Default: ${DEFAULT_REPORT}
  --top <n>                 Number of jobs to include. Default: 12
  --no-js                   Skip browser JS output
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: DEFAULT_PROFILE,
    research: DEFAULT_RESEARCH,
    compensation: DEFAULT_COMPENSATION,
    storyBank: DEFAULT_STORY_BANK,
    applicationKit: DEFAULT_APPLICATION_KIT,
    deepFit: DEFAULT_DEEP_FIT,
    out: DEFAULT_OUT,
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    top: 12,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--research") args.research = argv[++i] || DEFAULT_RESEARCH;
    else if (token === "--compensation") args.compensation = argv[++i] || DEFAULT_COMPENSATION;
    else if (token === "--story-bank") args.storyBank = argv[++i] || DEFAULT_STORY_BANK;
    else if (token === "--application-kit") args.applicationKit = argv[++i] || DEFAULT_APPLICATION_KIT;
    else if (token === "--deep-fit") args.deepFit = argv[++i] || DEFAULT_DEEP_FIT;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--top") args.top = Math.max(1, Number.parseInt(argv[++i] || "12", 10) || 12);
    else if (token === "--no-js") args.writeJs = false;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function text(value) {
  return String(value || "").trim();
}

function compact(items) {
  return array(items).map(text).filter(Boolean);
}

function jobKey(job) {
  return text(job.jobKey || job.url || `${job.company || ""}:${job.title || ""}`);
}

function sameJob(item, job) {
  const itemKey = text(item?.jobKey || item?.url).toLowerCase();
  const key = jobKey(job).toLowerCase();
  const itemTitle = text(item?.title).toLowerCase();
  const itemCompany = text(item?.company).toLowerCase();
  const title = text(job.title).toLowerCase();
  const company = text(job.company).toLowerCase();
  return (itemKey && itemKey === key) || (itemTitle && itemCompany && itemTitle === title && itemCompany === company);
}

function findForJob(items, job) {
  return array(items).find((item) => sameJob(item, job)) || null;
}

function rankedJobs(payload, top) {
  return array(payload.jobs)
    .filter((job) => !job.isExpired)
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, top);
}

function profileName(profile) {
  return text(profile.name || profile.fullName || profile.displayName || "Candidate");
}

function profileRole(profile) {
  return text(profile.role || profile.targetRole || array(profile.preferences?.targetRoles)[0] || "target role");
}

function profileSignals(profile) {
  return compact([
    profileRole(profile),
    ...array(profile.skills),
    ...array(profile.preferences?.keywords),
    ...array(profile.preferences?.targetRoles)
  ]).slice(0, 16);
}

function dedupByLower(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Skills from profile that actually appear in this job's JD (profile ∩ JD).
// Deliberately excludes features.skills (all JD skills) to prevent overlap with missingKeywords.
function jobKeywords(job) {
  return dedupByLower(compact([
    ...array(job.evaluation?.ats_keywords?.found),
    ...array(job.intelligence?.features?.profileSkillHits),
    ...array(job.keywords)
  ])).slice(0, 18);
}

// All skills the JD mentions — used for ATS mirroring in section E, not for match display.
function allJdKeywords(job) {
  return dedupByLower(compact([
    ...array(job.intelligence?.features?.profileSkillHits),
    ...array(job.intelligence?.features?.skills),
    ...array(job.evaluation?.ats_keywords?.found),
    ...array(job.intelligence?.features?.jdSkillsMissingFromProfile)
  ])).slice(0, 20);
}

function missingKeywords(job) {
  return dedupByLower(compact([
    ...array(job.evaluation?.ats_keywords?.missing),
    ...array(job.intelligence?.features?.jdSkillsMissingFromProfile)
  ])).slice(0, 12);
}

function decisionFor(job, dossier) {
  const score = Number(job.score || dossier?.score || 0);
  if (score >= 82) return "apply-now";
  if (score >= 70) return "apply-selectively";
  if (score >= 58) return "watchlist";
  return "skip";
}

function priorityFor(decision) {
  if (decision === "apply-now") return "P0";
  if (decision === "apply-selectively") return "P1";
  if (decision === "watchlist") return "P2";
  return "P3";
}

function nextStatus(decision) {
  if (decision === "apply-now") return "ready_to_tailor";
  if (decision === "apply-selectively") return "research_then_tailor";
  if (decision === "watchlist") return "monitor";
  return "skip_or_archive";
}

function inferLevel(job, compensation) {
  const title = text(job.title).toLowerCase();
  const raw = text(compensation?.level || compensation?.inferredLevel || job.seniority).toLowerCase();
  if (/\b(intern|internship|實習|實習生)\b/i.test(title)) return "intern";
  if (/\b(staff|principal|director|head|vp|vice president)\b/i.test(title)) return "senior-leadership";
  if (/\b(senior|sr\.?|lead|manager|architect)\b/i.test(title)) return "senior";
  if (raw && raw !== "intern") return raw;
  return "mid";
}

function chooseStories(storyBank, job) {
  const haystack = `${job.title || ""}\n${job.description || ""}\n${jobKeywords(job).join("\n")}`.toLowerCase();
  return array(storyBank.storyBank?.stories || storyBank.stories)
    .map((story) => {
      const hits = array(story.keywords).filter((keyword) => haystack.includes(text(keyword).toLowerCase()));
      return {
        id: story.id || story.theme || "story",
        theme: story.theme || story.title || "",
        sourceProof: story.sourceProof || story.proof || "",
        hits
      };
    })
    .sort((a, b) => b.hits.length - a.hits.length)
    .slice(0, 3);
}

function buildDossier(job, profile, context) {
  const deepFit = findForJob(context.deepFit.dossiers || context.deepFit.jobs, job);
  const research = findForJob(context.research.dossiers || context.research.jobs, job);
  const compensation = findForJob(context.compensation.plans || context.compensation.jobs, job);
  const playbook = findForJob(context.applicationKit.playbooks, job);
  const stories = chooseStories(context.storyBank, job);
  const decision = decisionFor(job, deepFit);
  const keywords = jobKeywords(job);
  const missing = missingKeywords(job);
  const atsKeywords = allJdKeywords(job);
  const evidenceCount = array(research?.evidence).length || Number(deepFit?.evidence?.evidenceCount || 0);
  const sourceQuality = job.sourceQuality?.score || job.qualityScore || "";
  const title = text(job.title || deepFit?.title);
  const company = text(job.company || deepFit?.company);

  return {
    jobKey: jobKey(job),
    title,
    company,
    url: job.url || "",
    score: Number(job.score || 0),
    grade: job.grade || "",
    priority: priorityFor(decision),
    decision,
    trackerNextStatus: nextStatus(decision),
    confidence: evidenceCount >= 5 ? "high" : job.description && job.description.length >= 900 ? "medium" : "needs-more-evidence",
    sections: {
      A_roleSummary: {
        summary: `${company || "This company"} is hiring ${title || "this role"}. Current snapshot score is ${job.score || "unscored"}${job.grade ? ` (${job.grade})` : ""}.`,
        source: job.source || "",
        location: job.location || "",
        sourceType: job.sourceType || "",
        sourceQuality
      },
      B_cvMatch: {
        thesis: deepFit?.thesis || `${profileName(profile)} targets ${profileRole(profile)} roles; this role matches ${keywords.length} detected job/profile keyword(s).`,
        matchedKeywords: keywords,
        missingKeywords: missing,
        honestGapFrame: missing.length
          ? `The JD requires ${missing.slice(0, 5).join(", ")} which are not yet in your profile. Build adjacent proof or add a learning plan for these gaps.`
          : "No skill gaps detected — your profile covers the JD's key requirements."
      },
      C_levelStrategy: {
        inferredLevel: inferLevel(job, compensation),
        positioning: deepFit?.decision || decision,
        interviewAngles: compact([
          ...(deepFit?.interviewStrategy || []),
          ...(playbook?.interviewPrep || [])
        ]).slice(0, 8)
      },
      D_compensation: {
        leverage: compensation?.leverage || deepFit?.evidence?.compensationLeverage || "unknown",
        structure: compensation?.structure || null,
        rangeQuestion: compensation?.negotiationScript?.recruiterRangeQuestion || deepFit?.compensationStrategy?.rangeQuestion || "",
        valueAnchor: compensation?.negotiationScript?.valueAnchor || deepFit?.compensationStrategy?.valueAnchor || "",
        counterScript: compensation?.negotiationScript?.counter || ""
      },
      E_cvAndPdfPlan: {
        atsKeywordsToMirror: atsKeywords.slice(0, 14),
        bulletsToStrengthen: compact([
          deepFit?.cvStrategy?.[0],
          playbook?.applyChecklist?.find((item) => /keyword|Mirror/i.test(item)),
          "Generate a tailored ATS PDF only after confirming the posting is still active.",
          "Keep claims tied to real CV evidence and project outcomes."
        ]),
        coverLetterHook: playbook?.outreachEmail?.body || ""
      },
      F_interviewPrep: {
        starStories: stories,
        questions: compact([
          ...(deepFit?.interviewStrategy || []),
          ...(research?.researchQuestions || []),
          "What would make the first 90 days successful?",
          "Which systems, metrics, or stakeholders create the most risk for this role?"
        ]).slice(0, 10)
      }
    }
  };
}

function renderMarkdown(payload) {
  const lines = [
    "# Career Ops Decision Report",
    "",
    `Generated: ${payload.generatedAt}`,
    `Candidate: ${payload.candidate}`,
    `Target role: ${payload.targetRole}`,
    `Jobs: ${payload.dossiers.length}`,
    "",
    "## Summary",
    ...payload.dossiers.map((item) => `- ${item.priority} ${item.company} - ${item.title}: ${item.score}/${item.grade || ""} (${item.decision}, ${item.confidence})`),
    ""
  ];
  for (const item of payload.dossiers) {
    lines.push(
      `## ${item.priority} ${item.company} - ${item.title}`,
      "",
      `- Score: ${item.score}/${item.grade || ""}`,
      `- Decision: ${item.decision}`,
      `- Tracker next status: ${item.trackerNextStatus}`,
      `- Confidence: ${item.confidence}`,
      item.url ? `- URL: ${item.url}` : "",
      "",
      "### A. Role Summary",
      `- ${item.sections.A_roleSummary.summary}`,
      `- Source: ${item.sections.A_roleSummary.source || "unknown"} (${item.sections.A_roleSummary.sourceType || "unknown"})`,
      `- Location: ${item.sections.A_roleSummary.location || "unknown"}`,
      item.sections.A_roleSummary.sourceQuality ? `- Source quality: ${item.sections.A_roleSummary.sourceQuality}` : "",
      "",
      "### B. CV Match",
      `- Thesis: ${item.sections.B_cvMatch.thesis}`,
      `- Matched keywords: ${item.sections.B_cvMatch.matchedKeywords.slice(0, 10).join(", ") || "none"}`,
      `- Missing keywords: ${item.sections.B_cvMatch.missingKeywords.slice(0, 8).join(", ") || "none detected"}`,
      `- Gap frame: ${item.sections.B_cvMatch.honestGapFrame}`,
      "",
      "### C. Level Strategy",
      `- Inferred level: ${item.sections.C_levelStrategy.inferredLevel}`,
      `- Positioning: ${item.sections.C_levelStrategy.positioning}`,
      ...item.sections.C_levelStrategy.interviewAngles.slice(0, 5).map((angle) => `- ${angle}`),
      "",
      "### D. Compensation",
      `- Leverage: ${item.sections.D_compensation.leverage}`,
      item.sections.D_compensation.rangeQuestion ? `- Range question: ${item.sections.D_compensation.rangeQuestion}` : "- Range question: Ask recruiter for approved range before naming a number.",
      item.sections.D_compensation.valueAnchor ? `- Value anchor: ${item.sections.D_compensation.valueAnchor}` : "",
      item.sections.D_compensation.counterScript ? `- Counter script: ${item.sections.D_compensation.counterScript}` : "",
      "",
      "### E. CV / ATS PDF Plan",
      `- ATS keywords: ${item.sections.E_cvAndPdfPlan.atsKeywordsToMirror.join(", ") || "none"}`,
      ...item.sections.E_cvAndPdfPlan.bulletsToStrengthen.map((bullet) => `- ${bullet}`),
      "",
      "### F. Interview Prep",
      ...item.sections.F_interviewPrep.starStories.map((story) => `- Story ${story.id}: ${story.theme || "untitled"}${story.hits.length ? ` (${story.hits.join(", ")})` : ""}`),
      ...item.sections.F_interviewPrep.questions.slice(0, 6).map((question) => `- ${question}`),
      ""
    );
  }
  return `${lines.filter((line) => line !== "").join("\n")}\n`;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeText(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const [jobsPayload, profile, research, compensation, storyBank, applicationKit, deepFit] = await Promise.all([
    readJsonIfExists(args.jobs),
    readJsonIfExists(args.profile),
    readJsonIfExists(args.research),
    readJsonIfExists(args.compensation),
    readJsonIfExists(args.storyBank),
    readJsonIfExists(args.applicationKit),
    readJsonIfExists(args.deepFit)
  ]);
  const context = { research, compensation, storyBank, applicationKit, deepFit };
  const jobs = rankedJobs(jobsPayload, args.top);
  const payload = {
    source: "career-ops-decision-report",
    generatedAt: new Date().toISOString(),
    candidate: profileName(profile),
    targetRole: profileRole(profile),
    profileSignals: profileSignals(profile),
    dossiers: jobs.map((job) => buildDossier(job, profile, context))
  };

  await writeJson(args.out, payload);
  if (args.writeJs) {
    await writeText(args.jsOut, `window.CV_CAREER_OPS_DECISION_REPORT = ${JSON.stringify(payload, null, 2)};\n`);
  }
  await writeText(args.reportOut, renderMarkdown(payload));
  console.log(`[career-ops] decision report ${payload.dossiers.length} dossier(s) -> ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
