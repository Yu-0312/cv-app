#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_OUT = "data/app/career-ops-story-bank.json";
const DEFAULT_JS_OUT = "data/app/career-ops-story-bank.js";
const DEFAULT_REPORT = "data/app/career-ops-story-bank.md";

function printHelp() {
  console.log(`Career Ops story bank

Builds a reusable STAR+Reflection story bank from profile proof points and the
current job market snapshot.

Usage:
  node scripts/career-ops-story-bank.mjs --profile data/career-ops-profile.json

Options:
  --jobs <file>       Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>    Profile JSON. Default: ${DEFAULT_PROFILE}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --no-js             Skip browser JS output
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: DEFAULT_PROFILE,
    out: DEFAULT_OUT,
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
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

function unique(items) {
  const seen = new Set();
  const output = [];
  for (const item of array(items).flat()) {
    const value = String(item || "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function sentences(value) {
  return String(value || "")
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12)
    .slice(0, 18);
}

function topMarketThemes(jobs) {
  const themes = new Set();
  for (const job of array(jobs).slice(0, 40)) {
    const text = `${job.title || ""} ${job.description || ""} ${array(job.intelligence?.features?.skills).join(" ")}`.toLowerCase();
    if (/frontend|react|vue|前端/.test(text)) themes.add("frontend product execution");
    if (/dashboard|analytics|data|資料|數據/.test(text)) themes.add("data-heavy product decisions");
    if (/api|backend|system|platform|架構/.test(text)) themes.add("systems and API collaboration");
    if (/accessibility|a11y|無障礙/.test(text)) themes.add("accessibility and quality");
    if (/performance|scale|scalable|效能/.test(text)) themes.add("performance and scale");
    if (/stakeholder|cross-functional|協作|溝通/.test(text)) themes.add("cross-functional influence");
    if (/ai|llm|machine learning|人工智慧/.test(text)) themes.add("AI/data product adoption");
  }
  return [...themes].slice(0, 10);
}

function storyQuestions(theme) {
  return [
    "Tell me about a project you are proud of.",
    "Tell me about a time you handled ambiguity.",
    `How have you applied ${theme}?`
  ];
}

function storyHasConcreteContent(story) {
  const star = story?.star || {};
  const joined = [star.situation, star.task, star.action, star.result, star.reflection].join(" ");
  if (/Use the context from this proof point|Clarify the goal|Describe the specific decisions|State measurable/i.test(joined)) {
    return false;
  }
  return [star.situation, star.task, star.action, star.result].every((item) => String(item || "").trim().length >= 20);
}

function dedupeStories(stories) {
  const seen = new Set();
  const output = [];
  for (const story of stories) {
    const key = [
      story.theme,
      story.sourceProof,
      story.star?.situation,
      story.star?.result
    ].map((item) => String(item || "").toLowerCase().replace(/\s+/g, " ").trim()).join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({ ...story, id: `story-${output.length + 1}` });
  }
  return output;
}

function normalizeExplicitStory(item, index, skills, themes) {
  const theme = String(item.theme || themes[index % Math.max(1, themes.length)] || skills[index % Math.max(1, skills.length)] || "execution under ambiguity");
  const star = item.star && typeof item.star === "object" ? item.star : item;
  const title = String(item.title || item.sourceProof || theme);
  const result = String(star.result || item.result || "").trim();
  const sourceProof = String(item.sourceProof || (result ? `${title}: ${result}` : title)).trim();
  const normalized = {
    id: String(item.id || `story-${index + 1}`),
    theme,
    sourceProof,
    applicableQuestions: array(item.applicableQuestions).length ? array(item.applicableQuestions).map(String) : storyQuestions(theme),
    star: {
      situation: String(star.situation || item.situation || "").trim(),
      task: String(star.task || item.task || "").trim(),
      action: String(star.action || item.action || "").trim(),
      result,
      reflection: String(star.reflection || item.reflection || `This story is strongest when positioned around ${theme} with the metrics and tradeoffs made explicit.`).trim()
    },
    metrics: unique(item.metrics || star.metrics || []),
    keywords: unique([theme, item.keywords, skills]).slice(0, 12)
  };
  return storyHasConcreteContent(normalized) ? normalized : null;
}

function proofPointToStory(item, index, skills, themes) {
  const theme = String(item.theme || themes[index % Math.max(1, themes.length)] || skills[index % Math.max(1, skills.length)] || "execution under ambiguity");
  const title = String(item.title || item.name || `Proof point ${index + 1}`);
  const metrics = unique(item.metrics || []);
  const result = String(item.result || item.impact || (metrics.length ? `Delivered measurable impact: ${metrics.join(", ")}.` : "")).trim();
  const story = {
    id: `story-${index + 1}`,
    theme,
    sourceProof: result ? `${title}: ${result}` : title,
    applicableQuestions: array(item.applicableQuestions).length ? array(item.applicableQuestions).map(String) : storyQuestions(theme),
    star: {
      situation: String(item.situation || `The team needed to improve ${title} while keeping existing product work stable.`).trim(),
      task: String(item.task || `Own the plan for ${title}, define the success metric, and align stakeholders on delivery tradeoffs.`).trim(),
      action: String(item.action || `Used ${skills.slice(0, 6).join(", ") || "role-relevant skills"} to break the work into measurable increments, ship the highest-value changes first, and review outcomes with the team.`).trim(),
      result,
      reflection: String(item.reflection || `This story demonstrates ${theme}, measurable ownership, and the ability to turn project context into an interview-ready example.`).trim()
    },
    metrics,
    keywords: unique([theme, item.keywords, skills]).slice(0, 12)
  };
  return storyHasConcreteContent(story) ? story : null;
}

function sentenceToStory(seed, index, skills, themes) {
  const theme = themes[index % Math.max(1, themes.length)] || skills[index % Math.max(1, skills.length)] || "execution under ambiguity";
  return {
    id: `story-${index + 1}`,
    theme,
    sourceProof: seed,
    applicableQuestions: storyQuestions(theme),
    star: {
      situation: `A role-relevant project required progress on ${theme} with imperfect information and multiple stakeholders.`,
      task: `Turn the project context into a clear plan, choose the success signal, and keep execution tied to the target role.`,
      action: `Applied ${skills.slice(0, 6).join(", ") || "core role skills"} to clarify scope, sequence the work, and communicate tradeoffs during delivery.`,
      result: `Produced a reusable proof point from the profile: ${seed}`,
      reflection: `Replace this fallback with a richer proof point when real private user data is available.`
    },
    metrics: [],
    keywords: unique([theme, skills]).slice(0, 12)
  };
}

function buildStoryBank(profile, jobs) {
  const skills = unique(array(profile.skills || profile.preferences?.keywords)).slice(0, 24);
  const themes = topMarketThemes(jobs);
  const explicitStorySource = array(profile.starStories).length ? profile.starStories : profile.stories;
  const proofPointSource = array(profile.proofPoints).length ? profile.proofPoints : profile.projectHighlights;
  const explicitStories = array(explicitStorySource)
    .map((item, index) => normalizeExplicitStory(item, index, skills, themes))
    .filter(Boolean);
  const proofPointStories = array(proofPointSource)
    .map((item, index) => proofPointToStory(item, explicitStories.length + index, skills, themes))
    .filter(Boolean);
  const fallbackProofPoints = [
    ...sentences(profile.experience),
    ...sentences(profile.projects),
    ...sentences(profile.summary),
    ...sentences(profile.description)
  ];
  const seeds = fallbackProofPoints.length ? fallbackProofPoints : [
    `Built work related to ${skills.slice(0, 4).join(", ") || profile.role || "the target role"}.`,
    `Improved a product, workflow, or project outcome using ${skills.slice(0, 3).join(", ") || "core skills"}.`
  ];
  let stories = dedupeStories([...explicitStories, ...proofPointStories]);
  if (stories.length < 8) {
    const sentenceStories = seeds
      .map((seed, index) => sentenceToStory(seed, stories.length + index, skills, themes));
    stories = dedupeStories([...stories, ...sentenceStories]);
  }
  stories = stories.slice(0, 12);
  const metricBacked = stories.filter((story) => array(story.metrics).length || /\d/.test(story.star?.result || "")).length;
  return {
    themes,
    stories,
    gaps: [
      metricBacked === stories.length
        ? "All generated stories include numeric or metric-backed results; keep them updated when replacing synthetic data with private user data."
        : "Add exact metrics to any fallback story before using it in an interview.",
      "Tailor the opening sentence of each story to the target company and job description.",
      "Keep one conflict/tradeoff story, one failure/recovery story, and one leadership/influence story ready."
    ]
  };
}

function renderMarkdown(payload) {
  const lines = [
    "# Career Ops Story Bank",
    "",
    `Generated: ${payload.generatedAt}`,
    `Stories: ${payload.storyBank.stories.length}`,
    "",
    "## Market Themes",
    ...payload.storyBank.themes.map((item) => `- ${item}`),
    "",
    "## Gaps",
    ...payload.storyBank.gaps.map((item) => `- ${item}`),
    ""
  ];
  for (const story of payload.storyBank.stories) {
    lines.push(
      `## ${story.id}: ${story.theme}`,
      "",
      `Source proof: ${story.sourceProof}`,
      "",
      "### Questions",
      ...story.applicableQuestions.map((item) => `- ${item}`),
      "",
      "### STAR+Reflection",
      `- S: ${story.star.situation}`,
      `- T: ${story.star.task}`,
      `- A: ${story.star.action}`,
      `- R: ${story.star.result}`,
      `- Reflection: ${story.star.reflection}`,
      "",
      story.metrics?.length ? `Metrics: ${story.metrics.join("; ")}` : "",
      story.metrics?.length ? "" : "",
      `Keywords: ${story.keywords.join(", ")}`,
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
  const profile = await readJsonIfExists(args.profile);
  const jobsPayload = await readJsonIfExists(args.jobs);
  const payload = {
    source: "career-ops-story-bank",
    generatedAt: new Date().toISOString(),
    storyBank: buildStoryBank(profile, jobsPayload.jobs || [])
  };
  await writeJson(args.out, payload);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_STORY_BANK = ${JSON.stringify(payload, null, 2)};\n`);
  await writeText(args.reportOut, renderMarkdown(payload));
  console.log(`[career-ops] story bank ${payload.storyBank.stories.length} story seed(s) -> ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
