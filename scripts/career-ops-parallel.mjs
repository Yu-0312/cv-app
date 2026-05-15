#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_RESEARCH = "data/app/career-ops-deep-research.json";
const DEFAULT_COMP = "data/app/career-ops-compensation.json";
const DEFAULT_STORY = "data/app/career-ops-story-bank.json";
const DEFAULT_OUT = "data/app/career-ops-parallel-report.json";
const DEFAULT_JS_OUT = "data/app/career-ops-parallel-report.js";
const DEFAULT_REPORT = "data/app/career-ops-parallel-report.md";

function printHelp() {
  console.log(`Career Ops parallel worker runner

Runs job-level Career Ops workers with bounded concurrency and failure isolation.
Each job receives independent evaluation, research, application, compensation,
story, and apply-agent planning outputs, then the results are merged.

Usage:
  node scripts/career-ops-parallel.mjs --concurrency 6

Options:
  --jobs <file>          Jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>       Profile JSON. Default: ${DEFAULT_PROFILE}
  --research <file>      Deep research JSON. Default: ${DEFAULT_RESEARCH}
  --compensation <file>  Compensation JSON. Default: ${DEFAULT_COMP}
  --story-bank <file>    Story bank JSON. Default: ${DEFAULT_STORY}
  --out <file>           JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>        Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file>    Markdown report. Default: ${DEFAULT_REPORT}
  --concurrency <n>      Parallel job workers. Default: 4
  --top <n>              Max active jobs to process. Default: 50
  --no-js                Skip browser JS output
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: DEFAULT_PROFILE,
    research: DEFAULT_RESEARCH,
    compensation: DEFAULT_COMP,
    storyBank: DEFAULT_STORY,
    out: DEFAULT_OUT,
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    concurrency: 4,
    top: 50,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--research") args.research = argv[++i] || DEFAULT_RESEARCH;
    else if (token === "--compensation") args.compensation = argv[++i] || DEFAULT_COMP;
    else if (token === "--story-bank") args.storyBank = argv[++i] || DEFAULT_STORY;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--concurrency") args.concurrency = Math.max(1, Number.parseInt(argv[++i] || "4", 10) || 4);
    else if (token === "--top") args.top = Math.max(1, Number.parseInt(argv[++i] || "50", 10) || 50);
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

function jobKey(job) {
  return String(job.jobKey || job.url || `${job.company || ""}:${job.title || ""}`).trim();
}

function rankedJobs(jobs, top) {
  return array(jobs)
    .filter((job) => !job.isExpired)
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, top);
}

function findByJob(collection, job, keys = ["jobKey"]) {
  const key = jobKey(job).toLowerCase();
  const company = String(job.company || "").toLowerCase();
  return array(collection).find((item) => {
    if (keys.some((field) => String(item?.[field] || "").toLowerCase() === key)) return true;
    return item?.company && company && String(item.company).toLowerCase() === company;
  }) || null;
}

function chooseStories(storyPayload, job) {
  const stories = array(storyPayload.storyBank?.stories);
  const text = `${job.title || ""} ${job.description || ""} ${array(job.intelligence?.features?.skills).join(" ")}`.toLowerCase();
  return stories
    .map((story) => ({
      ...story,
      relevance: array(story.keywords).filter((keyword) => text.includes(String(keyword).toLowerCase())).length
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3);
}

function priority(job) {
  const score = Number(job.score || 0);
  if (score >= 85) return "P0";
  if (score >= 72) return "P1";
  if (score >= 58) return "P2";
  return "P3";
}

function applyAgentPlan(job) {
  return {
    mode: "human-in-the-loop",
    url: job.url || "",
    steps: [
      "Open the application URL in a controlled browser session.",
      "Extract visible form fields and required uploads.",
      "Map CV profile fields to the form without submitting.",
      "Prepare tailored PDF and outreach text.",
      "Stop before final submit and ask the user to review."
    ],
    guardrails: [
      "Never submit without explicit user confirmation.",
      "Never fabricate work authorization, salary history, degree, or experience.",
      "Never store API keys or credentials in job metadata.",
      "Record only application status and user-approved notes."
    ]
  };
}

async function processJob(job, context) {
  const startedAt = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const research = findByJob(context.research.dossiers, job);
  const compensation = findByJob(context.compensation.plans, job);
  const stories = chooseStories(context.storyBank, job);
  const foundKeywords = array(job.evaluation?.ats_keywords?.found || job.intelligence?.features?.profileSkillHits).slice(0, 10);
  return {
    jobKey: jobKey(job),
    company: job.company || "",
    title: job.title || "",
    score: job.score ?? "",
    grade: job.grade || "",
    priority: priority(job),
    startedAt,
    completedAt: new Date().toISOString(),
    workers: {
      evaluation: {
        recommendation: job.recommendation || job.status || "",
        keywords: foundKeywords,
        nextActions: array(job.evaluation?.next_actions).slice(0, 5)
      },
      research: {
        signals: array(research?.signals),
        evidenceCount: array(research?.evidence).length,
        questions: array(research?.researchQuestions).slice(0, 4)
      },
      application: {
        checklist: [
          "Confirm posting is active.",
          "Generate tailored ATS PDF.",
          "Prepare outreach and follow-up.",
          "Log status and next follow-up."
        ]
      },
      compensation: compensation || null,
      stories,
      applyAgent: applyAgentPlan(job)
    }
  };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  const errors = [];
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = await worker(items[current], current);
      } catch (error) {
        errors.push({
          index: current,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return { results: results.filter(Boolean), errors };
}

function renderMarkdown(payload) {
  const lines = [
    "# Career Ops Parallel Worker Report",
    "",
    `Generated: ${payload.generatedAt}`,
    `Concurrency: ${payload.concurrency}`,
    `Jobs processed: ${payload.results.length}`,
    `Errors: ${payload.errors.length}`,
    "",
    "## Worker Design",
    "- Job-level queue with bounded concurrency.",
    "- Failure isolation per job.",
    "- Independent worker outputs: evaluation, research, application, compensation, story bank, apply-agent plan.",
    "- Human-in-the-loop guardrails for apply automation.",
    ""
  ];
  for (const result of payload.results) {
    lines.push(
      `## ${result.priority} ${result.company || "Unknown"} - ${result.title}`,
      "",
      `- Score: ${result.score || "-"}`,
      `- Grade: ${result.grade || "-"}`,
      `- Research evidence: ${result.workers.research.evidenceCount}`,
      `- Keywords: ${result.workers.evaluation.keywords.join(", ") || "-"}`,
      `- Compensation leverage: ${result.workers.compensation?.leverage || "-"}`,
      `- Story hooks: ${result.workers.stories.map((story) => story.theme).join(", ") || "-"}`,
      "",
      "### Apply Agent Guardrails",
      ...result.workers.applyAgent.guardrails.map((item) => `- ${item}`),
      ""
    );
  }
  if (payload.errors.length) {
    lines.push("## Errors", "", ...payload.errors.map((error) => `- ${error.index}: ${error.message}`), "");
  }
  return `${lines.join("\n")}\n`;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const jobsPayload = await readJsonIfExists(args.jobs);
  const context = {
    profile: await readJsonIfExists(args.profile),
    research: await readJsonIfExists(args.research),
    compensation: await readJsonIfExists(args.compensation),
    storyBank: await readJsonIfExists(args.storyBank)
  };
  const jobs = rankedJobs(jobsPayload.jobs, args.top);
  const { results, errors } = await runPool(jobs, args.concurrency, (job) => processJob(job, context));
  const payload = {
    source: "career-ops-parallel",
    generatedAt: new Date().toISOString(),
    concurrency: args.concurrency,
    jobCount: jobs.length,
    results,
    errors
  };
  await writeJson(args.out, payload);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_PARALLEL = ${JSON.stringify(payload, null, 2)};\n`);
  await writeText(args.reportOut, renderMarkdown(payload));
  console.log(`[career-ops] parallel processed ${results.length}/${jobs.length} job(s) with concurrency ${args.concurrency}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
