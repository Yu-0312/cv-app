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

// Learning priority tiers based on market demand count
const LEARNING_TIERS = [
  { minCount: 10, priority: "P0", label: "高優先", reason: "市場需求極高，補充後可顯著提升評分" },
  { minCount: 5, priority: "P1", label: "中優先", reason: "市場常見，補充後能擴大適配職缺範圍" },
  { minCount: 2, priority: "P2", label: "選擇性", reason: "特定領域需求，依目標職缺決定是否補充" },
  { minCount: 0, priority: "P3", label: "低優先", reason: "出現頻率較低，可放在長期學習清單" }
];

function buildLearningPlan(jobs, profileSkills) {
  const skillCounts = new Map();
  for (const job of array(jobs).filter((j) => !j.isExpired).slice(0, 100)) {
    const missing = array(job.intelligence?.features?.jdSkillsMissingFromProfile || job.evaluation?.ats_keywords?.missing);
    for (const skill of missing) {
      const key = String(skill).toLowerCase().trim();
      if (!key || key.length < 2) continue;
      skillCounts.set(key, (skillCounts.get(key) || 0) + 1);
    }
  }
  const profileSet = new Set(profileSkills.map((s) => String(s).toLowerCase()));
  const candidates = Array.from(skillCounts.entries())
    .filter(([skill]) => !profileSet.has(skill))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  return candidates.map(([skill, count]) => {
    const tier = LEARNING_TIERS.find((t) => count >= t.minCount) || LEARNING_TIERS[LEARNING_TIERS.length - 1];
    return {
      skill,
      marketCount: count,
      priority: tier.priority,
      priorityLabel: tier.label,
      reason: tier.reason,
      suggestion: `在簡歷或 profile 中加入 ${skill} 的實際使用案例，並在 projects 欄位補充相關實作。`
    };
  });
}

// Theme-specific STAR guidance so each story prompt is actionable, not generic.
const THEME_STAR_GUIDE = {
  "frontend product execution": {
    situation: (seed) => `You were tasked with a frontend product challenge. Proof point: "${seed}" — set the scene: what product, what team size, and what was broken or missing?`,
    task: "What was the specific outcome you were accountable for? Include the success metric (e.g. performance score, user adoption rate, release date).",
    action: "Walk through the key technical decisions: component architecture, state management tradeoffs, accessibility choices, or API contract design.",
    result: "Quantify the impact: load time delta, user adoption %, code reduction %, or stakeholder feedback. If no number, describe the quality or velocity improvement."
  },
  "data-heavy product decisions": {
    situation: (seed) => `You were working with a data-intensive product. Proof point: "${seed}" — describe the data volume, the user workflow, and what was difficult to render or interpret.`,
    task: "What decision did you own? (chart type, data model, aggregation strategy, caching layer, etc.)",
    action: "Explain how you chose between options, what you built or prototyped, and how you validated your approach with data or users.",
    result: "State the outcome: query latency, dashboard load time, user comprehension improvement, or reduction in support requests."
  },
  "systems and API collaboration": {
    situation: (seed) => `You collaborated across system boundaries. Proof point: "${seed}" — name the systems, teams, and integration surface area.`,
    task: "What was your specific responsibility: API contract design, data schema alignment, error handling, or auth flow?",
    action: "Describe how you coordinated: async reviews, shared type contracts, versioning strategy, or escalation path when specs changed.",
    result: "State the outcome: integration delivered on time, breaking changes avoided, latency reduced, or cross-team dependency resolved."
  },
  "accessibility and quality": {
    situation: (seed) => `You led or contributed to an accessibility or quality initiative. Proof point: "${seed}" — what was the starting state and who was affected?`,
    task: "What standard or target were you working toward (WCAG level, test coverage %, zero-defect milestone)?",
    action: "Describe the audit process, tooling (axe, Lighthouse, screen reader testing), and how you prioritized fixes across components.",
    result: "State the outcome: WCAG compliance level achieved, user complaints reduced, or CI gate added to prevent regressions."
  },
  "performance and scale": {
    situation: (seed) => `You tackled a performance or scalability challenge. Proof point: "${seed}" — what was the scale (users, requests/sec, data size) and what was breaking?`,
    task: "What was the target metric: p95 latency, Lighthouse score, bundle size, or TTFB?",
    action: "Describe your profiling approach, the root cause you found, and the specific optimization (code splitting, caching, virtualization, CDN config, etc.).",
    result: "Before/after numbers. If no metric was tracked, explain how you set up measurement and what the next step was."
  },
  "cross-functional influence": {
    situation: (seed) => `You influenced a decision across teams or functions. Proof point: "${seed}" — who were the stakeholders and what was the disagreement or ambiguity?`,
    task: "What outcome were you trying to drive, and why did it require cross-functional alignment rather than a unilateral call?",
    action: "Describe how you built your case: data, prototypes, async docs, 1:1s, or demos. What resistance did you encounter?",
    result: "State the decision that was made, who it impacted, and whether the outcome matched your recommendation."
  },
  "AI/data product adoption": {
    situation: (seed) => `You worked on an AI or data-driven product feature. Proof point: "${seed}" — describe the model/pipeline involved and the user-facing surface.`,
    task: "What was your role: prompt design, evaluation framework, UI for model outputs, or feedback loop instrumentation?",
    action: "Explain what you built, how you evaluated quality (accuracy, latency, hallucination rate), and what tradeoffs you made.",
    result: "Describe adoption (% of users using the feature), quality improvement, or how you reduced user confusion around AI outputs."
  }
};

function themeStarGuide(theme, seed) {
  const guide = THEME_STAR_GUIDE[theme];
  if (!guide) {
    return {
      situation: `Use this proof point to open the story: "${seed}"`,
      task: "Clarify the goal, constraints, stakeholders, and success metric before answering.",
      action: "Describe the specific decisions, tradeoffs, and work you personally owned.",
      result: "State measurable or observable impact. If no metric exists, describe adoption, quality, speed, or learning impact.",
      reflection: "Explain what you would repeat, what you would improve, and how it applies to the target role."
    };
  }
  return {
    situation: typeof guide.situation === "function" ? guide.situation(seed) : guide.situation,
    task: guide.task,
    action: guide.action,
    result: guide.result,
    reflection: "Explain what you would repeat, what you would improve, and how this story maps to the target role's core challenges."
  };
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
      star: themeStarGuide(theme, seed),
      keywords: [...new Set([theme, ...skills])].slice(0, 8)
    };
  });
  const learningPlan = buildLearningPlan(jobs, skills);
  return {
    themes,
    stories,
    learningPlan,
    gaps: [
      "Add exact metrics for each story where possible.",
      "Add one conflict or tradeoff story.",
      "Add one failure/recovery story.",
      "Add one leadership or influence story even if the role is not managerial."
    ]
  };
}

function renderMarkdown(payload) {
  const learningPlan = payload.storyBank.learningPlan || [];
  const lines = [
    "# Career Ops Story Bank",
    "",
    `Generated: ${payload.generatedAt}`,
    `Stories: ${payload.storyBank.stories.length}`,
    "",
    "## Market Themes",
    ...payload.storyBank.themes.map((item) => `- ${item}`),
    "",
    "## Learning Plan (Missing High-Demand Skills)",
    learningPlan.length
      ? learningPlan.slice(0, 10).map((item) => `- [${item.priority}] ${item.skill} (市場出現 ${item.marketCount} 次) — ${item.priorityLabel}：${item.suggestion}`).join("\n")
      : "- No significant skill gaps detected.",
    "",
    "## Story Gaps",
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
