#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_RESEARCH = "data/app/career-ops-deep-research.json";
const DEFAULT_COMP = "data/app/career-ops-compensation.json";
const DEFAULT_STORY = "data/app/career-ops-story-bank.json";
const DEFAULT_OUT = "data/app/career-ops-deep-fit.json";
const DEFAULT_JS_OUT = "data/app/career-ops-deep-fit.js";
const DEFAULT_REPORT = "data/app/career-ops-deep-fit.md";

function printHelp() {
  console.log(`Career Ops deep fit evaluator

Produces career-ops-grade single-job fit dossiers. It works heuristically by
default and can optionally call a backend LLM when OPENAI_API_KEY or
ANTHROPIC_API_KEY is available.

Usage:
  node scripts/career-ops-deep-fit.mjs --top 10
  OPENAI_API_KEY="..." node scripts/career-ops-deep-fit.mjs --llm openai

Options:
  --jobs <file>       Jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>    Profile JSON. Default: ${DEFAULT_PROFILE}
  --research <file>   Deep research JSON. Default: ${DEFAULT_RESEARCH}
  --compensation <file> Compensation JSON. Default: ${DEFAULT_COMP}
  --story-bank <file> Story bank JSON. Default: ${DEFAULT_STORY}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --top <n>           Number of top jobs. Default: 12
  --llm <provider>    none, openai, anthropic, or auto. Default: auto
  --no-js             Skip browser JS output
  --help              Show this help
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
    top: 12,
    llm: "auto",
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
    else if (token === "--top") args.top = Math.max(1, Number.parseInt(argv[++i] || "12", 10) || 12);
    else if (token === "--llm") args.llm = String(argv[++i] || "auto").toLowerCase();
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

function rankedJobs(jobs, top) {
  return array(jobs)
    .filter((job) => !job.isExpired)
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, top);
}

function jobKey(job) {
  return String(job.jobKey || job.url || `${job.company || ""}:${job.title || ""}`).trim();
}

function findForJob(items, job) {
  const key = jobKey(job).toLowerCase();
  const company = String(job.company || "").toLowerCase();
  return array(items).find((item) =>
    String(item.jobKey || "").toLowerCase() === key ||
    (item.company && company && String(item.company).toLowerCase() === company)
  ) || null;
}

function profileKeywords(profile) {
  return [
    profile.role,
    ...array(profile.skills),
    ...array(profile.preferences?.keywords),
    ...array(profile.preferences?.targetRoles)
  ].map((item) => String(item || "").trim()).filter(Boolean);
}

function contains(text, term) {
  return String(text || "").toLowerCase().includes(String(term || "").toLowerCase());
}

function chooseStories(storyBank, job) {
  const text = `${job.title || ""} ${job.description || ""} ${array(job.intelligence?.features?.skills).join(" ")}`;
  return array(storyBank.storyBank?.stories)
    .map((story) => ({
      id: story.id,
      theme: story.theme,
      sourceProof: story.sourceProof,
      relevance: array(story.keywords).filter((keyword) => contains(text, keyword)).length
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3);
}

function heuristicDossier(job, profile, context) {
  const text = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n${job.description || ""}`;
  const keywords = profileKeywords(profile);
  const hits = keywords.filter((keyword) => contains(text, keyword)).slice(0, 14);
  const misses = keywords.filter((keyword) => !contains(text, keyword)).slice(0, 12);
  const research = findForJob(context.research.dossiers, job);
  const compensation = findForJob(context.compensation.plans, job);
  const storyHooks = chooseStories(context.storyBank, job);
  const evidenceCount = array(research?.evidence).length;
  const score = Number(job.score || 0);
  const confidence = evidenceCount >= 5 ? "high" : job.description?.length > 1000 ? "medium" : "low";
  const decision = score >= 82 ? "pursue aggressively" : score >= 70 ? "pursue selectively" : score >= 56 ? "hold / compare" : "skip unless strategic";
  return {
    jobKey: jobKey(job),
    company: job.company || "",
    title: job.title || "",
    score,
    grade: job.grade || "",
    confidence,
    decision,
    thesis: `${job.title || "This role"} at ${job.company || "the company"} is ${decision} because the snapshot score is ${score || "unscored"}, with ${hits.length} profile/role keyword hits and ${evidenceCount} external evidence item(s).`,
    evidence: {
      keywordHits: hits,
      keywordMisses: misses,
      researchSignals: array(research?.signals),
      evidenceCount,
      compensationLeverage: compensation?.leverage || ""
    },
    concerns: [
      !evidenceCount && "External company evidence is thin; run deep research with a search API.",
      misses.length > hits.length && "Profile keyword coverage is weaker than the target role language.",
      !job.description || job.description.length < 500 ? "Job description is too short for high-confidence fit." : ""
    ].filter(Boolean),
    interviewStrategy: [
      "Ask why the role is open and what success means in the first 90 days.",
      "Probe team ownership, roadmap pressure, and cross-functional interfaces.",
      ...array(research?.researchQuestions).slice(0, 3)
    ],
    cvStrategy: [
      hits.length ? `Lead with proof around: ${hits.slice(0, 6).join(", ")}.` : "Add stronger role-specific keywords before applying.",
      ...storyHooks.map((story) => `Use story ${story.id}: ${story.theme}.`)
    ],
    compensationStrategy: compensation ? {
      leverage: compensation.leverage,
      rangeQuestion: compensation.negotiationScript?.recruiterRangeQuestion || "",
      valueAnchor: compensation.negotiationScript?.valueAnchor || ""
    } : null,
    storyHooks,
    llm: null
  };
}

function pickLlm(provider) {
  if (provider === "none") return "none";
  if ((provider === "auto" || provider === "openai") && process.env.OPENAI_API_KEY) return "openai";
  if ((provider === "auto" || provider === "anthropic") && process.env.ANTHROPIC_API_KEY) return "anthropic";
  return provider === "auto" ? "none" : provider;
}

function parseJsonText(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  return JSON.parse(match ? match[1] : text);
}

async function callLlm(provider, system, prompt) {
  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }
  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 1800,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const data = await response.json();
    return data.content?.[0]?.text || "";
  }
  return "";
}

async function addLlmReview(dossier, job, profile, context, provider) {
  if (provider === "none") return dossier;
  const system = `You are a Career Ops senior evaluator. Produce a strict JSON review for one job. Do not invent facts. If evidence is missing, say so.`;
  const prompt = JSON.stringify({
    profile,
    job,
    heuristicDossier: dossier,
    research: findForJob(context.research.dossiers, job),
    compensation: findForJob(context.compensation.plans, job)
  }).slice(0, 18000);
  try {
    const text = await callLlm(provider, system, prompt);
    const parsed = parseJsonText(text);
    return {
      ...dossier,
      llm: {
        provider,
        review: parsed
      }
    };
  } catch (error) {
    return {
      ...dossier,
      llm: {
        provider,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function renderReport(payload) {
  const lines = [
    "# Career Ops Deep Fit Report",
    "",
    `Generated: ${payload.generatedAt}`,
    `LLM provider: ${payload.llmProvider}`,
    `Dossiers: ${payload.dossiers.length}`,
    ""
  ];
  for (const dossier of payload.dossiers) {
    lines.push(
      `## ${dossier.company || "Unknown"} - ${dossier.title}`,
      "",
      `- Score: ${dossier.score || "-"}`,
      `- Grade: ${dossier.grade || "-"}`,
      `- Confidence: ${dossier.confidence}`,
      `- Decision: ${dossier.decision}`,
      `- Thesis: ${dossier.thesis}`,
      "",
      "### Evidence",
      `- Keyword hits: ${dossier.evidence.keywordHits.join(", ") || "-"}`,
      `- Keyword misses: ${dossier.evidence.keywordMisses.join(", ") || "-"}`,
      `- Research signals: ${dossier.evidence.researchSignals.join(", ") || "-"}`,
      `- Compensation leverage: ${dossier.evidence.compensationLeverage || "-"}`,
      "",
      "### Concerns",
      ...(dossier.concerns.length ? dossier.concerns.map((item) => `- ${item}`) : ["- None flagged"]),
      "",
      "### Interview Strategy",
      ...dossier.interviewStrategy.map((item) => `- ${item}`),
      "",
      "### CV Strategy",
      ...dossier.cvStrategy.map((item) => `- ${item}`),
      ""
    );
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
  const profile = await readJsonIfExists(args.profile);
  const context = {
    research: await readJsonIfExists(args.research),
    compensation: await readJsonIfExists(args.compensation),
    storyBank: await readJsonIfExists(args.storyBank)
  };
  const provider = pickLlm(args.llm);
  const dossiers = [];
  for (const job of rankedJobs(jobsPayload.jobs, args.top)) {
    const base = heuristicDossier(job, profile, context);
    dossiers.push(await addLlmReview(base, job, profile, context, provider));
  }
  const payload = {
    source: "career-ops-deep-fit",
    generatedAt: new Date().toISOString(),
    llmProvider: provider,
    dossiers
  };
  await writeJson(args.out, payload);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_DEEP_FIT = ${JSON.stringify(payload, null, 2)};\n`);
  await writeText(args.reportOut, renderReport(payload));
  console.log(`[career-ops] deep fit ${dossiers.length} dossier(s), llm=${provider}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
