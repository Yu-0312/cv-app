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

function buildStoryBank(profile, jobs) {
  const proofPoints = [
    ...sentences(profile.experience),
    ...sentences(profile.projects),
    ...sentences(profile.summary)
  ];
  const skills = array(profile.skills || profile.preferences?.keywords).map(String).slice(0, 12);
  const themes = topMarketThemes(jobs);
  const seeds = proofPoints.length ? proofPoints : [
    `Built work related to ${skills.slice(0, 4).join(", ") || profile.role || "the target role"}.`,
    `Improved a product, workflow, or project outcome using ${skills.slice(0, 3).join(", ") || "core skills"}.`
  ];
  const stories = seeds.slice(0, 8).map((seed, index) => {
    const theme = themes[index % Math.max(1, themes.length)] || skills[index % Math.max(1, skills.length)] || "execution under ambiguity";
    return {
      id: `story-${index + 1}`,
      theme,
      sourceProof: seed,
      applicableQuestions: [
        "Tell me about a project you are proud of.",
        "Tell me about a time you handled ambiguity.",
        `How have you applied ${theme}?`
      ],
      star: {
        situation: `Use the context from this proof point: ${seed}`,
        task: "Clarify the goal, constraints, stakeholders, and success metric before answering.",
        action: "Describe the specific decisions, tradeoffs, and work you personally owned.",
        result: "State measurable or observable impact. If no metric exists, describe adoption, quality, speed, or learning impact.",
        reflection: "Explain what you would repeat, what you would improve, and how it applies to the target role."
      },
      keywords: [...new Set([theme, ...skills])].slice(0, 8)
    };
  });
  return {
    themes,
    stories,
    gaps: [
      "Add exact metrics for each story where possible.",
      "Add one conflict or tradeoff story.",
      "Add one failure/recovery story.",
      "Add one leadership or influence story even if the role is not managerial."
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
