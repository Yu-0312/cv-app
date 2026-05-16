#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_RESEARCH = "data/app/career-ops-deep-research.json";
const DEFAULT_OUT = "data/app/career-ops-compensation.json";
const DEFAULT_JS_OUT = "data/app/career-ops-compensation.js";
const DEFAULT_REPORT = "data/app/career-ops-compensation.md";

// Market salary benchmarks sourced from TokyoDev, Japan-Dev, NodeFlair, PayScale (2024-2025 data).
// Values are annual figures: JPY for Japan, NTD for Taiwan, USD for Global/Remote.
// Ranges: [floor, midpoint, ceiling] per level.
const SALARY_BENCHMARKS = {
  jp: {
    currency: "JPY",
    unit: "annual",
    source: "TokyoDev / Japan-Dev 2024-2025",
    levels: {
      intern:       { min: 2_500_000, mid: 3_500_000, max: 4_500_000 },
      junior:       { min: 5_000_000, mid: 6_000_000, max: 7_000_000 },
      mid:          { min: 6_000_000, mid: 8_000_000, max: 10_000_000 },
      senior:       { min: 8_000_000, mid: 11_000_000, max: 15_000_000 },
      "senior-plus":{ min: 10_000_000, mid: 14_000_000, max: 20_000_000 }
    },
    note: "Tokyo-based international tech companies skew higher (+30-50%). Japanese-headquartered companies average ¥8.5M for mid-level."
  },
  tw: {
    currency: "NTD",
    unit: "monthly",
    source: "NodeFlair / PayScale TW 2024-2025",
    levels: {
      intern:       { min: 28_000, mid: 32_000, max: 38_000 },
      junior:       { min: 40_000, mid: 48_000, max: 58_000 },
      mid:          { min: 55_000, mid: 70_000, max: 90_000 },
      senior:       { min: 80_000, mid: 100_000, max: 130_000 },
      "senior-plus":{ min: 110_000, mid: 140_000, max: 180_000 }
    },
    note: "Taipei market. Annual bonus (1-3 months) is common; multiply monthly by 13-14 for total annual estimate."
  },
  global: {
    currency: "USD",
    unit: "annual",
    source: "Arc.dev / Ruby on Remote 2024-2026",
    levels: {
      intern:       { min: 30_000, mid: 40_000, max: 55_000 },
      junior:       { min: 50_000, mid: 65_000, max: 80_000 },
      mid:          { min: 70_000, mid: 90_000, max: 115_000 },
      senior:       { min: 100_000, mid: 125_000, max: 155_000 },
      "senior-plus":{ min: 130_000, mid: 160_000, max: 210_000 }
    },
    note: "Remote/global rates. Taiwan-based remote developers average ~$54K USD; Japan-based ~$68-115K USD depending on stack."
  }
};

function formatSalaryBenchmark(market, level) {
  const marketData = SALARY_BENCHMARKS[market];
  if (!marketData) return null;
  const levelData = marketData.levels[level] || marketData.levels.mid;
  const fmt = (n) => n.toLocaleString("en-US");
  return {
    currency: marketData.currency,
    unit: marketData.unit,
    range: `${marketData.currency} ${fmt(levelData.min)} – ${fmt(levelData.max)}`,
    midpoint: `${marketData.currency} ${fmt(levelData.mid)}`,
    floor: levelData.min,
    ceiling: levelData.max,
    source: marketData.source,
    note: marketData.note
  };
}

// Infer candidate's own seniority level from profile text — used to calibrate compensation strategy.
function inferCandidateLevel(profile) {
  const text = [
    String(profile.role || ""),
    String(profile.summary || ""),
    String(profile.experience || "")
  ].join(" ").toLowerCase();
  // Explicit seniority signals in profile
  if (/\b(staff|principal|director|head of|vp)\b/i.test(text)) return "senior-plus";
  if (/\b(senior|sr\.?|lead|architect)\b/i.test(text)) return "senior";
  if (/\b(junior|entry.?level|associate|新鮮人|初階)\b/i.test(text)) return "junior";
  if (/\b(intern|internship|實習)\b/i.test(text)) return "intern";
  // Infer from years of experience mentioned
  const yearsMatch = text.match(/(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i);
  if (yearsMatch) {
    const years = Number.parseInt(yearsMatch[1], 10);
    if (years >= 8) return "senior-plus";
    if (years >= 5) return "senior";
    if (years >= 2) return "mid";
    return "junior";
  }
  return "mid";
}

function printHelp() {
  console.log(`Career Ops compensation planner

Builds compensation structures and negotiation scripts for ranked jobs. This does
not invent salary numbers; it creates ranges only when compensation evidence is
present, otherwise it produces evidence questions and negotiation anchors.

Usage:
  node scripts/career-ops-compensation.mjs --jobs data/app/career-ops-jobs.json

Options:
  --jobs <file>       Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>    Profile JSON. Default: ${DEFAULT_PROFILE}
  --research <file>   Deep research JSON. Default: ${DEFAULT_RESEARCH}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --top <n>           Number of jobs to include. Default: 20
  --no-js             Skip browser JS output
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    profile: DEFAULT_PROFILE,
    research: DEFAULT_RESEARCH,
    out: DEFAULT_OUT,
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    top: 20,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--research") args.research = argv[++i] || DEFAULT_RESEARCH;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--top") args.top = Math.max(1, Number.parseInt(argv[++i] || "20", 10) || 20);
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

function rankJobs(jobs, top) {
  return array(jobs)
    .filter((job) => !job.isExpired)
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, top);
}

function inferMarket(job) {
  const text = `${job.sourceMarket || ""} ${job.location || ""} ${job.description || ""}`.toLowerCase();
  if (/\bcn\b|china|beijing|shanghai|shenzhen|hangzhou|中國|北京|上海|深圳|杭州/.test(text)) return "cn";
  if (/\btw\b|taiwan|taipei|hsinchu|taichung|kaohsiung|台灣|臺灣|台北|臺北|新竹/.test(text)) return "tw";
  if (/remote|global|us|united states|singapore/.test(text)) return "global";
  return "unknown";
}

function inferLevel(job) {
  // Infer the seniority level of the JOB (not the candidate) for compensation calibration.
  // Use only job.title and job.description — do not mix in profile.role, which causes
  // the candidate's own title to contaminate job-level detection.
  const title = String(job.title || "").toLowerCase();
  const desc = String(job.description || "").toLowerCase();
  // Check title first to avoid substring false matches (e.g. "international" → "intern")
  if (/\b(intern|internship|實習生?)\b/i.test(title)) return "intern";
  if (/\b(principal|staff|lead|architect|head of|director|資深主管|總監)\b/i.test(title)) return "senior-plus";
  if (/\b(senior|sr\.?|資深)\b/i.test(title)) return "senior";
  if (/\b(junior|entry.?level|associate|新鮮人|初階)\b/i.test(title)) return "junior";
  // Fall back to description with word boundaries
  if (/\b(internship|實習生?)\b/i.test(desc)) return "intern";
  if (/\b(principal|staff|architect|head of|director|資深主管|總監)\b/i.test(desc)) return "senior-plus";
  if (/\b(senior|sr\.?|資深)\b/i.test(desc)) return "senior";
  if (/\b(junior|entry.?level|associate|新鮮人|初階)\b/i.test(desc)) return "junior";
  return "mid";
}

function detectCompEvidence(job, dossier) {
  const text = [
    job.description,
    ...array(dossier?.evidence).map((item) => `${item.title || ""} ${item.snippet || ""}`)
  ].join("\n");
  const salaryLike = text.match(/(?:NT\$|TWD|RMB|CNY|USD|\$)\s?[\d,.]+(?:\s?[-~–]\s?(?:NT\$|TWD|RMB|CNY|USD|\$)?\s?[\d,.]+)?(?:\s?\/\s?(?:month|year|yr|月|年))?/gi) || [];
  const benefitSignals = [
    /bonus|獎金|年終/i.test(text) && "bonus",
    /equity|stock|rsu|options|股票|股權/i.test(text) && "equity",
    /remote|hybrid|遠端|混合/i.test(text) && "work-mode flexibility",
    /relocation|搬遷|簽約金|signing/i.test(text) && "signing / relocation",
    /learning|training|教育訓練|學習/i.test(text) && "learning budget"
  ].filter(Boolean);
  return {
    salaryMentions: [...new Set(salaryLike)].slice(0, 6),
    benefitSignals: [...new Set(benefitSignals)]
  };
}

function findDossier(job, research) {
  return array(research.dossiers).find((item) =>
    String(item.jobKey || "") === String(job.jobKey || "") ||
    (item.company && job.company && String(item.company).toLowerCase() === String(job.company).toLowerCase())
  ) || null;
}

function buildCompPlan(job, profile, research) {
  const dossier = findDossier(job, research);
  const evidence = detectCompEvidence(job, dossier);
  const market = inferMarket(job);
  const level = inferLevel(job);
  const candidateLevel = inferCandidateLevel(profile);
  const benchmark = formatSalaryBenchmark(market === "unknown" ? "global" : market, candidateLevel);
  const score = Number(job.score || 0);
  const leverage = score >= 85 ? "high" : score >= 72 ? "medium" : "low";
  const hasSalaryEvidence = evidence.salaryMentions.length > 0;
  const targetFrame = hasSalaryEvidence
    ? "Use posted compensation as the floor for scope calibration; anchor near the upper third only after confirming level and scope."
    : benchmark
      ? `Market benchmark for ${candidateLevel} in ${market === "unknown" ? "global/remote" : market.toUpperCase()} is ${benchmark.range} (${benchmark.unit}). Do not name a number first — ask for the approved range, then anchor near the midpoint or above.`
      : "Do not name a number first. Ask for the approved range, level, and total compensation structure before anchoring.";

  return {
    jobKey: job.jobKey || job.url || `${job.company}:${job.title}`,
    company: job.company || "",
    title: job.title || "",
    market,
    inferredLevel: level,
    candidateLevel,
    leverage,
    evidence,
    marketBenchmark: benchmark,
    structure: {
      baseSalary: hasSalaryEvidence
        ? evidence.salaryMentions
        : benchmark
          ? [`Market range for ${candidateLevel} (${market === "unknown" ? "global" : market.toUpperCase()}): ${benchmark.range} ${benchmark.unit}. Source: ${benchmark.source}.`]
          : ["Need verified market data or recruiter range before setting a numeric anchor."],
      bonus: evidence.benefitSignals.includes("bonus") ? "Ask whether bonus is guaranteed, target, or discretionary." : "Ask whether there is annual bonus, performance bonus, or sign-on bonus.",
      equity: evidence.benefitSignals.includes("equity") ? "Clarify grant size, vesting schedule, refreshers, and strike/RSU terms." : "Ask whether equity, RSU, options, or profit-sharing exists.",
      benefits: [
        "Health / insurance coverage",
        "Paid leave and holidays",
        "Learning budget or certification support",
        "Remote/hybrid setup, commute, or relocation support",
        "Review cycle and promotion timeline"
      ],
      nonCashLevers: [
        "Title / level calibration",
        "Start date flexibility",
        "Remote days",
        "Equipment budget",
        "First review at 3 or 6 months",
        "Conference / learning budget"
      ]
    },
    negotiationScript: {
      recruiterRangeQuestion: `Before I anchor on a number, could you share the approved range and level for the ${job.title || "role"} package, including base, bonus, equity, and review cycle?`,
      valueAnchor: `Based on the scope of ${job.title || "this role"} and my fit around ${array(job.evaluation?.ats_keywords?.found || job.intelligence?.features?.profileSkillHits).slice(0, 4).join(", ") || "the core requirements"}, I would like to calibrate toward the stronger end of the range if the team sees the level match.${benchmark ? ` My research indicates the ${market === "unknown" ? "market" : market.toUpperCase()} midpoint for this level is around ${benchmark.midpoint} (${benchmark.unit}).` : ""}`,
      counterOffer: "Thank you for the offer. I am excited about the role. Given the scope, expected impact, and market calibration, is there flexibility to improve the total package through base, sign-on, equity, or an earlier compensation review?",
      pauseLine: "I appreciate the details. I would like to review the full package and come back with a thoughtful response.",
      closeLine: "If we can align on the package and review timeline, I would feel confident moving forward."
    },
    redLines: [
      "Do not disclose current compensation unless legally appropriate and strategically useful.",
      "Do not accept verbal-only compensation details; ask for written package components.",
      "Do not negotiate before confirming level, scope, work mode, and review cycle.",
      "Do not trade base salary away without valuing the replacement benefit."
    ],
    nextActions: [
      hasSalaryEvidence ? "Verify whether posted compensation is base-only or total compensation." : "Collect market compensation evidence before naming a number.",
      "Ask recruiter for approved range and level.",
      "Map the job scope to proof points in the tailored CV.",
      "Prepare one counter package with base, bonus/equity, and non-cash levers."
    ],
    targetFrame
  };
}

function renderMarkdown(payload) {
  const lines = [
    "# Career Ops Compensation Planner",
    "",
    `Generated: ${payload.generatedAt}`,
    `Plans: ${payload.plans.length}`,
    "",
    "## Operating Rule",
    "Do not invent salary numbers. Use verified ranges, recruiter-provided ranges, or clearly marked market evidence before anchoring.",
    ""
  ];
  for (const plan of payload.plans) {
    lines.push(
      `## ${plan.company || "Unknown"} - ${plan.title}`,
      "",
      `- Market: ${plan.market}`,
      `- Job level (inferred): ${plan.inferredLevel}`,
      `- Candidate level (from profile): ${plan.candidateLevel}`,
      `- Leverage: ${plan.leverage}`,
      ...(plan.marketBenchmark ? [
        `- Market benchmark (${plan.candidateLevel}): ${plan.marketBenchmark.range} ${plan.marketBenchmark.unit}`,
        `- Benchmark midpoint: ${plan.marketBenchmark.midpoint}`,
        `- Benchmark source: ${plan.marketBenchmark.source}`,
        `- Note: ${plan.marketBenchmark.note}`
      ] : []),
      `- Target frame: ${plan.targetFrame}`,
      "",
      "### Evidence",
      ...(plan.evidence.salaryMentions.length ? plan.evidence.salaryMentions.map((item) => `- Salary mention: ${item}`) : ["- No verified salary mention found."]),
      ...(plan.evidence.benefitSignals.length ? plan.evidence.benefitSignals.map((item) => `- Benefit signal: ${item}`) : []),
      "",
      "### Structure",
      `- Base: ${array(plan.structure.baseSalary).join("; ")}`,
      `- Bonus: ${plan.structure.bonus}`,
      `- Equity: ${plan.structure.equity}`,
      ...plan.structure.benefits.map((item) => `- Benefit: ${item}`),
      "",
      "### Scripts",
      `- Range question: ${plan.negotiationScript.recruiterRangeQuestion}`,
      `- Value anchor: ${plan.negotiationScript.valueAnchor}`,
      `- Counter: ${plan.negotiationScript.counterOffer}`,
      `- Pause: ${plan.negotiationScript.pauseLine}`,
      `- Close: ${plan.negotiationScript.closeLine}`,
      "",
      "### Next Actions",
      ...plan.nextActions.map((item) => `- ${item}`),
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
  const research = await readJsonIfExists(args.research);
  const jobs = rankJobs(jobsPayload.jobs, args.top);
  const payload = {
    source: "career-ops-compensation",
    generatedAt: new Date().toISOString(),
    plans: jobs.map((job) => buildCompPlan(job, profile, research))
  };
  await writeJson(args.out, payload);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_COMPENSATION = ${JSON.stringify(payload, null, 2)};\n`);
  await writeText(args.reportOut, renderMarkdown(payload));
  console.log(`[career-ops] compensation ${payload.plans.length} plan(s) -> ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
