#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DEFAULT_MANIFEST = "tooling/data/career-ops-profiles/manifest.json";
const DEFAULT_PROFILE = "tooling/data/career-ops-profile.example.json";
const DEFAULT_ROWS = 100000;
const DEFAULT_SHARD_SIZE = 500;
const DETAIL_SCHEMA_VERSION = "career-ops-profile-detail-v2";

const SENIORITY_BANDS = [
  { key: "intern", label: "Intern", titlePrefix: "Intern", minYears: 0.1, maxYears: 0.8, skillTarget: 10, workCount: 1, compBaseTwd: 32000, threshold: 0.04 },
  { key: "entry", label: "Entry", titlePrefix: "Associate", minYears: 0.5, maxYears: 1.8, skillTarget: 14, workCount: 1, compBaseTwd: 48000, threshold: 0.14 },
  { key: "junior", label: "Junior", titlePrefix: "Junior", minYears: 1.5, maxYears: 3.2, skillTarget: 20, workCount: 2, compBaseTwd: 72000, threshold: 0.30 },
  { key: "mid", label: "Mid-level", titlePrefix: "", minYears: 3.0, maxYears: 6.0, skillTarget: 30, workCount: 3, compBaseTwd: 112000, threshold: 0.54 },
  { key: "senior", label: "Senior", titlePrefix: "Senior", minYears: 6.0, maxYears: 10.5, skillTarget: 42, workCount: 3, compBaseTwd: 165000, threshold: 0.76 },
  { key: "lead", label: "Lead", titlePrefix: "Lead", minYears: 8.0, maxYears: 13.5, skillTarget: 48, workCount: 4, compBaseTwd: 205000, threshold: 0.88 },
  { key: "staff", label: "Staff", titlePrefix: "Staff", minYears: 10.0, maxYears: 16.0, skillTarget: 54, workCount: 4, compBaseTwd: 245000, threshold: 0.95 },
  { key: "principal", label: "Principal", titlePrefix: "Principal", minYears: 12.0, maxYears: 19.0, skillTarget: 60, workCount: 4, compBaseTwd: 295000, threshold: 0.985 },
  { key: "director", label: "Director", titlePrefix: "Director", minYears: 14.0, maxYears: 22.0, skillTarget: 56, workCount: 4, compBaseTwd: 330000, threshold: 1 }
];

const QUALITY_TIERS = [
  { key: "low-signal", label: "Low Signal", minScore: 18, maxScore: 35, detailLevel: "sparse", evidenceStrength: "weak", metricScale: 0.45, biasBase: -24, threshold: 0.08 },
  { key: "developing", label: "Developing", minScore: 36, maxScore: 54, detailLevel: "basic", evidenceStrength: "partial", metricScale: 0.65, biasBase: -12, threshold: 0.25 },
  { key: "solid", label: "Solid", minScore: 55, maxScore: 73, detailLevel: "standard", evidenceStrength: "consistent", metricScale: 0.9, biasBase: -2, threshold: 0.57 },
  { key: "advanced", label: "Advanced", minScore: 74, maxScore: 88, detailLevel: "detailed", evidenceStrength: "strong", metricScale: 1.15, biasBase: 10, threshold: 0.79 },
  { key: "elite", label: "Elite", minScore: 89, maxScore: 98, detailLevel: "executive", evidenceStrength: "exceptional", metricScale: 1.45, biasBase: 20, threshold: 0.93 },
  { key: "overconfident", label: "Overconfident", minScore: 42, maxScore: 68, detailLevel: "noisy", evidenceStrength: "mixed", metricScale: 0.8, biasBase: 26, threshold: 1 }
];

const EXTRA_SKILLS_BY_ROLE = [
  { pattern: /frontend|front-end|ui engineer|product engineer/i, skills: ["React Server Components", "Web Performance Budgets", "Design QA", "Interaction Design", "Feature Flag Rollouts", "Frontend Observability", "Micro-frontends"] },
  { pattern: /backend|platform|api/i, skills: ["Distributed Systems", "API Governance", "Queue Design", "Service Decomposition", "Incident Review", "Capacity Planning", "Data Modeling"] },
  { pattern: /full stack|full-stack/i, skills: ["End-to-end Product Delivery", "API Contracts", "Database Design", "Frontend Architecture", "Deployment Automation", "Product Instrumentation"] },
  { pattern: /data scientist|data analyst|data engineer|machine learning|ai engineer/i, skills: ["Experiment Design", "Feature Engineering", "Model Evaluation", "Data Quality", "Causal Analysis", "Pipeline Monitoring", "MLOps"] },
  { pattern: /product manager|product operations/i, skills: ["Roadmapping", "Discovery Synthesis", "Prioritization", "Metric Trees", "Launch Planning", "Stakeholder Alignment", "Pricing Research"] },
  { pattern: /designer|ux|product design/i, skills: ["Design Strategy", "Usability Testing", "Information Architecture", "Prototype Validation", "Design Critique", "Accessibility Review"] },
  { pattern: /security/i, skills: ["Threat Modeling", "Security Review", "Vulnerability Management", "IAM", "Detection Engineering", "Risk Assessment"] },
  { pattern: /customer success|solutions engineer/i, skills: ["Enterprise Discovery", "Customer Health Modeling", "Renewal Planning", "Technical Enablement", "Escalation Management", "ROI Narratives"] },
  { pattern: /marketing|growth/i, skills: ["Lifecycle Campaigns", "Growth Loops", "Conversion Research", "Attribution", "Landing Page Testing", "Audience Segmentation"] }
];

const COMMON_DETAIL_SKILLS = [
  "Problem Framing",
  "Execution Planning",
  "Cross-functional Communication",
  "Risk Management",
  "Stakeholder Updates",
  "Documentation",
  "KPI Design",
  "Retrospectives",
  "Remote Collaboration"
];

const COMPANY_STEMS = ["Northstar", "Orbit", "Beacon", "Brightpath", "Granite", "Quartz", "Helios", "Nova", "Summit", "Atlas", "Meridian", "Vector"];
const COMPANY_DOMAINS = ["Analytics", "Systems", "Works", "Product", "Commerce", "Health", "Learning", "Automation", "Platform", "Finance", "Logistics", "Labs"];
const INDUSTRIES = ["B2B SaaS", "fintech", "healthtech", "edtech", "developer tools", "enterprise analytics", "consumer subscription product", "AI workflow tooling"];
const LOCATIONS = ["Taipei", "Remote", "Tokyo", "Singapore", "Melbourne", "Vancouver", "Berlin", "Hong Kong"];
const PROJECT_THEMES = ["workflow automation", "self-serve analytics", "customer onboarding", "pricing experiment", "platform reliability", "data quality", "accessibility upgrade", "AI-assisted review"];
const GAP_LIBRARY = ["needs more quantified outcomes", "limited enterprise-scale ownership", "portfolio evidence is thin", "recent role scope is narrow", "needs clearer leadership examples", "domain depth is still emerging"];

function printHelp() {
  console.log(`Generate or expand the Career Ops synthetic resume corpus.

Usage:
  node scripts/generate-career-ops-profiles.mjs --rows 100000

Options:
  --manifest <file>              Sharded corpus manifest. Default: ${DEFAULT_MANIFEST}
  --rows <n>                     Target total records. Default: ${DEFAULT_ROWS}
  --shard-size <n>               Records per shard. Default: existing manifest or ${DEFAULT_SHARD_SIZE}
  --generated-at <yyyy-mm-dd>    Metadata date. Default: today's date
  --profile-metadata <file>      Profile example metadata JSON. Default: ${DEFAULT_PROFILE}
  --no-profile-metadata          Do not update the profile example metadata file
  --force                        Rewrite generated shards even if they already exist
  --help                         Show this help

The script preserves existing source shards and appends deterministic synthetic
variants into later shards. It never introduces real personal identifiers; all
contacts remain on reserved example/test domains.
`);
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    rows: DEFAULT_ROWS,
    shardSize: 0,
    generatedAt: new Date().toISOString().slice(0, 10),
    profileMetadata: DEFAULT_PROFILE,
    syncProfileMetadata: true,
    force: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--manifest") args.manifest = argv[++i] || DEFAULT_MANIFEST;
    else if (token === "--rows") args.rows = Number(argv[++i] || DEFAULT_ROWS);
    else if (token === "--shard-size") args.shardSize = Number(argv[++i] || DEFAULT_SHARD_SIZE);
    else if (token === "--generated-at") args.generatedAt = argv[++i] || args.generatedAt;
    else if (token === "--profile-metadata") args.profileMetadata = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--no-profile-metadata") args.syncProfileMetadata = false;
    else if (token === "--force") args.force = true;
    else throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function writeJson(filePath, payload, options = {}) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const content = options.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  await fsp.writeFile(filePath, `${content}\n`);
}

function padProfile(index) {
  return String(index).padStart(5, "0");
}

function syntheticId(index) {
  return `synthetic-resume-${padProfile(index)}`;
}

function syntheticName(index) {
  return `Synthetic Candidate ${padProfile(index)}`;
}

function batchLabel(index) {
  return String(Math.ceil(index / 1000)).padStart(2, "0");
}

function phoneFor(index) {
  const middle = String(Math.floor((index - 1) / 1000) % 1000).padStart(3, "0");
  const last = String((index * 37) % 1000).padStart(3, "0");
  return `+886 900 ${middle} ${last} (synthetic)`;
}

function walk(value, mapper) {
  if (Array.isArray(value)) return value.map((item) => walk(item, mapper));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child, mapper)]));
  }
  if (typeof value === "string") return mapper(value);
  return value;
}

function uniqueArray(items) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    const key = String(item || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hash01(index, salt = 0) {
  let value = (Math.imul(index + 0x9e3779b9 + salt * 1013, 0x85ebca6b) >>> 0);
  value ^= value >>> 16;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 13;
  return (value >>> 0) / 4294967295;
}

function pickThreshold(index, salt, options) {
  const value = hash01(index, salt);
  return options.find((option) => value <= option.threshold) || options.at(-1);
}

function pick(items, index, salt = 0) {
  return items[Math.floor(hash01(index, salt) * items.length) % items.length];
}

function between(index, salt, min, max, decimals = 0) {
  return round(min + (max - min) * hash01(index, salt), decimals);
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function stripSeniority(role) {
  return String(role || "Product Operator")
    .replace(/^(intern|trainee|associate|junior|mid-level|senior|lead|staff|principal|director[, ]+|director of|head of)\s+/i, "")
    .replace(/\s+intern$/i, "")
    .replace(/\s+/g, " ")
    .trim() || "Product Operator";
}

function titleFor(baseRole, seniority) {
  if (seniority.key === "intern") return `${baseRole} Intern`;
  if (seniority.key === "mid") return baseRole;
  if (seniority.key === "director") return `Director, ${baseRole}`;
  return `${seniority.titlePrefix} ${baseRole}`.trim();
}

function previousSeniority(current, stepsBack) {
  const index = Math.max(0, SENIORITY_BANDS.findIndex((item) => item.key === current.key) - stepsBack);
  return SENIORITY_BANDS[index] || SENIORITY_BANDS[0];
}

function extraSkillsForRole(baseRole) {
  const matched = EXTRA_SKILLS_BY_ROLE.find((entry) => entry.pattern.test(baseRole));
  return matched ? matched.skills : ["Business Analysis", "Workflow Mapping", "Process Improvement", "Quality Review", "Decision Support"];
}

function personaForIndex(index) {
  const seniority = pickThreshold(index, 7, SENIORITY_BANDS);
  const quality = pickThreshold(index, 19, QUALITY_TIERS);
  const years = between(index, 31, seniority.minYears, seniority.maxYears, 1);
  const qualityScore = between(index, 43, quality.minScore, quality.maxScore, 0);
  const rawBias = (hash01(index, 59) - 0.5) * 34;
  const scoreBias = Math.round(clamp(rawBias + quality.biasBase, -35, 35));
  const varianceMagnitude = Math.abs(scoreBias);
  const varianceBand = varianceMagnitude >= 24
    ? (scoreBias > 0 ? "high-positive" : "high-negative")
    : varianceMagnitude >= 12
      ? (scoreBias > 0 ? "positive" : "negative")
      : "moderate";
  const detailDensity = clamp(Math.round(qualityScore + years * 2 + (quality.key === "overconfident" ? -16 : 0)), 12, 100);
  const atsReadiness = clamp(Math.round(qualityScore + scoreBias * 0.35 + between(index, 61, -8, 8, 0)), 15, 99);
  const evidenceScore = clamp(Math.round(qualityScore * quality.metricScale + between(index, 67, -10, 10, 0)), 10, 99);

  return {
    seniority,
    quality,
    years,
    qualityScore,
    scoreBias,
    varianceBand,
    varianceMagnitude,
    detailDensity,
    atsReadiness,
    evidenceScore,
    salaryBiasPercent: Math.round(clamp(scoreBias * 1.4 + between(index, 71, -12, 18, 0), -45, 65)),
    keywordNoise: round(clamp((100 - atsReadiness) / 100 + hash01(index, 73) * 0.25, 0.02, 0.95), 2),
    interviewReadiness: clamp(Math.round((qualityScore + evidenceScore) / 2 + between(index, 79, -9, 9, 0)), 8, 99)
  };
}

function metricValue(index, salt, persona, min, max) {
  return Math.max(1, Math.round(between(index, salt, min, max, 0) * persona.quality.metricScale));
}

function companyName(index, offset) {
  return `${pick(COMPANY_STEMS, index, 101 + offset)} ${pick(COMPANY_DOMAINS, index, 131 + offset)} Example Batch ${batchLabel(index)}`;
}

function locationFor(index, offset) {
  return pick(LOCATIONS, index, 151 + offset);
}

function startEndDates(index, persona, offset, workCount) {
  const latestYear = 2026 - offset * Math.max(1, Math.ceil(persona.years / Math.max(1, workCount)));
  const duration = Math.max(1, Math.ceil(persona.years / Math.max(1, workCount) + hash01(index, 167 + offset) * 1.5));
  const startYear = Math.max(2004, latestYear - duration);
  const startMonth = String((Math.floor(hash01(index, 181 + offset) * 12) % 12) + 1).padStart(2, "0");
  const endMonth = String((Math.floor(hash01(index, 191 + offset) * 12) % 12) + 1).padStart(2, "0");
  return {
    startDate: `${startYear}-${startMonth}`,
    endDate: offset === 0 ? "Present" : `${latestYear}-${endMonth}`,
    durationMonths: offset === 0 ? (2026 - startYear) * 12 : Math.max(6, duration * 12),
    startYear,
    endYear: offset === 0 ? null : latestYear
  };
}

function buildHighlights(index, offset, persona, baseRole, skills) {
  const project = pick(PROJECT_THEMES, index, 211 + offset);
  const actionVerb = persona.quality.key === "low-signal"
    ? "Supported"
    : persona.seniority.key === "intern" || persona.seniority.key === "entry"
      ? "Assisted with"
      : persona.seniority.key === "principal" || persona.seniority.key === "director"
        ? "Set strategy for"
        : "Owned";
  const firstMetric = metricValue(index, 223 + offset, persona, 6, 42);
  const secondMetric = metricValue(index, 229 + offset, persona, 4, 30);
  const users = Math.round(between(index, 233 + offset, 80, 22000, 0) * Math.max(0.35, persona.quality.metricScale));
  const stakeholderCount = metricValue(index, 239 + offset, persona, 3, 72);
  const highlightCount = persona.quality.key === "low-signal" ? 2 : persona.quality.key === "developing" ? 3 : 4;
  const lines = [
    `${actionVerb} ${project} using ${skills.slice(0, 4).join(", ")}, improving the primary workflow metric by ${firstMetric}% for roughly ${users.toLocaleString("en-US")} users or workflow participants.`,
    `Built measurement and rollout notes across ${skills.slice(2, 6).join(", ")}, reducing rework or support load by ${secondMetric}% and giving ${stakeholderCount} stakeholders clearer status visibility.`,
    `Documented constraints, edge cases, launch risks, and follow-up experiments so future teams could reuse the operating pattern.`,
    `Coached peers through review sessions, acceptance criteria, and post-launch readouts while keeping scope aligned to business impact.`
  ];
  if (persona.quality.key === "low-signal") {
    lines[1] = `Contributed to delivery notes and QA checks; impact evidence remains partial and should be validated in interviews.`;
  }
  return lines.slice(0, highlightCount);
}

function buildWorkExperience(index, persona, baseRole, skills) {
  const count = persona.seniority.workCount;
  return Array.from({ length: count }, (_, offset) => {
    const seniority = previousSeniority(persona.seniority, offset);
    const dates = startEndDates(index, persona, offset, count);
    const position = titleFor(baseRole, seniority);
    const highlights = buildHighlights(index, offset, persona, baseRole, skills);
    const teamSize = Math.max(1, metricValue(index, 251 + offset, persona, 2, 28));
    const systemCount = Math.max(1, metricValue(index, 257 + offset, persona, 1, 12));
    return {
      company: companyName(index, offset),
      position,
      employmentType: offset === count - 1 && persona.seniority.key === "intern" ? "Internship" : "Full-time",
      location: locationFor(index, offset),
      startDate: dates.startDate,
      endDate: dates.endDate,
      industry: pick(INDUSTRIES, index, 263 + offset),
      summary: `${position} focused on ${pick(PROJECT_THEMES, index, 269 + offset)} with ${persona.quality.label.toLowerCase()} evidence quality and ${persona.seniority.label.toLowerCase()} scope.`,
      highlights,
      technologies: skills.slice(offset * 3, offset * 3 + 7),
      metrics: highlights.filter((line) => /%|users|stakeholders/i.test(line)).slice(0, 3),
      scopeDetails: {
        teamSize,
        systemsOrWorkflowsOwned: systemCount,
        decisionScope: persona.seniority.key === "principal" || persona.seniority.key === "director" ? "multi-team strategy" : persona.seniority.key === "intern" || persona.seniority.key === "entry" ? "task-level delivery" : "feature or workstream ownership",
        ambiguityLevel: persona.quality.key === "low-signal" ? "low to medium" : persona.seniority.key === "staff" || persona.seniority.key === "principal" || persona.seniority.key === "director" ? "high" : "medium"
      },
      qualitySignals: {
        evidenceStrength: persona.quality.evidenceStrength,
        quantifiedImpact: persona.evidenceScore,
        reviewConfidence: persona.atsReadiness,
        notes: persona.quality.key === "overconfident" ? "Strong claims with mixed supporting evidence; useful for calibration tests." : "Synthetic evidence created for parser and scorer testing."
      },
      achievements: highlights,
      startYear: dates.startYear,
      endYear: dates.endYear,
      durationMonths: dates.durationMonths,
      durationYears: round(dates.durationMonths / 12, 1)
    };
  });
}

function buildProjects(index, persona, baseRole, skills) {
  const count = persona.quality.key === "low-signal" ? 2 : persona.quality.key === "elite" ? 4 : 3;
  return Array.from({ length: count }, (_, offset) => {
    const name = pick(PROJECT_THEMES, index, 307 + offset);
    const metric = metricValue(index, 313 + offset, persona, 5, 38);
    const rework = metricValue(index, 317 + offset, persona, 3, 24);
    return {
      name,
      role: titleFor(baseRole, persona.seniority),
      description: `${name} case study for a ${persona.seniority.label.toLowerCase()} ${baseRole} profile, with ${persona.quality.detailLevel} resume detail and ${persona.quality.evidenceStrength} evidence.`,
      highlights: [
        `Improved a target metric by ${metric}% while reducing follow-up support or rework by ${rework}%.`,
        `Captured constraints, alternatives, launch criteria, owner map, and post-launch measurement notes.`,
        persona.quality.key === "low-signal" ? "Evidence is intentionally incomplete to test low-confidence scoring paths." : "Includes enough context for ATS parsing, interview prep, and dossier generation."
      ],
      metrics: [`${metric}% target metric improvement`, `${rework}% support or rework reduction`, `${6 + offset * 2}-week delivery window`],
      keywords: skills.slice(offset * 4, offset * 4 + 9),
      url: `https://portfolio.example.test/case-study/${padProfile(index)}-${offset + 1}`,
      detailSignals: {
        complexity: persona.seniority.key === "intern" || persona.seniority.key === "entry" ? "low" : persona.seniority.key === "staff" || persona.seniority.key === "principal" || persona.seniority.key === "director" ? "very high" : "medium",
        evidenceStatus: persona.quality.evidenceStrength,
        reviewerConfidence: persona.evidenceScore
      }
    };
  });
}

function buildProofPoints(index, persona, baseRole, skills, projects) {
  const count = persona.quality.key === "low-signal" ? 2 : persona.quality.key === "developing" ? 3 : 4;
  return projects.slice(0, count).map((project, offset) => {
    const metric = metricValue(index, 337 + offset, persona, 5, 45);
    const rework = metricValue(index, 347 + offset, persona, 3, 30);
    return {
      id: `proof-${offset + 1}`,
      title: project.name,
      theme: `${baseRole} ${persona.seniority.label.toLowerCase()} execution`,
      situation: `${companyName(index, offset)} needed to improve ${project.name} while balancing roadmap pressure, stakeholder expectations, and measurable user impact.`,
      task: `Own the ${persona.seniority.key === "intern" || persona.seniority.key === "entry" ? "assigned delivery slice" : "plan, tradeoffs, delivery rhythm, and success metrics"} for the initiative.`,
      action: `Used ${skills.slice(offset * 3, offset * 3 + 6).join(", ")} to break the work into milestones, surface risks, instrument metrics, and communicate progress.`,
      result: `Improved the target outcome by ${metric}%, reduced rework or support load by ${rework}%, and produced a reusable artifact for future work.`,
      metrics: [`${metric}% target outcome improvement`, `${rework}% rework/support reduction`, `${persona.evidenceScore}/100 evidence score`],
      keywords: skills.slice(0, 14),
      applicableQuestions: ["Tell me about a project you are proud of.", "Tell me about a time you handled ambiguity.", "How did you measure success?"],
      confidence: persona.quality.evidenceStrength
    };
  });
}

function buildStarStories(proofPoints, persona) {
  return proofPoints.flatMap((proof, index) => {
    const story = {
      id: `story-${index + 1}`,
      theme: proof.theme,
      sourceProof: `${proof.title}: ${proof.result}`,
      applicableQuestions: proof.applicableQuestions,
      star: {
        situation: proof.situation,
        task: proof.task,
        action: proof.action,
        result: proof.result,
        reflection: `Use this story to test ${persona.quality.label.toLowerCase()} evidence, ${persona.varianceBand} scoring bias, and ${persona.seniority.label.toLowerCase()} scope.`
      },
      metrics: proof.metrics,
      keywords: proof.keywords,
      confidence: proof.confidence
    };
    if (persona.quality.key === "elite" || persona.quality.key === "advanced") {
      return [story, { ...story, id: `story-${index + 1}-deep-dive`, theme: `${proof.theme} deep dive`, deepDivePrompts: ["What tradeoff did you reject?", "Which metric could be misleading?", "What would you do with twice the scope?"] }];
    }
    return [story];
  });
}

function buildSkillExperience(index, persona, skills, workExperience) {
  const maxItems = persona.quality.key === "low-signal" ? 14 : persona.quality.key === "elite" ? 42 : 28;
  return skills.slice(0, maxItems).map((skill, offset) => {
    const years = round(clamp(persona.years - offset * 0.18 + between(index, 359 + offset, -0.7, 0.7, 1), 0.1, persona.years), 1);
    const proficiency = years >= 7 && persona.qualityScore >= 70 ? "Expert" : years >= 4 ? "Advanced" : years >= 1.5 ? "Intermediate" : "Beginner";
    return {
      skill,
      category: /communication|planning|risk|documentation|stakeholder|kpi|retrospective/i.test(skill) ? "product-business" : "technical",
      proficiency,
      yearsOfExperience: years,
      lastUsed: "2026",
      firstUsed: String(Math.max(2004, 2026 - Math.ceil(years))),
      evidence: workExperience.slice(0, 2).map((item) => `${item.position} at ${item.company}`),
      contexts: uniqueArray(workExperience.map((item) => item.industry).concat([persona.seniority.label, persona.quality.label]))
    };
  });
}

function buildCompensation(index, persona) {
  const multiplier = clamp(1 + persona.salaryBiasPercent / 100, 0.55, 1.85);
  const targetMonthly = Math.round(persona.seniority.compBaseTwd * multiplier / 1000) * 1000;
  const minMonthly = Math.round(targetMonthly * 0.84 / 1000) * 1000;
  const maxMonthly = Math.round(targetMonthly * 1.24 / 1000) * 1000;
  const japanTarget = Math.round(targetMonthly * 12 * 2.15 / 100000) * 100000;
  const remoteTarget = Math.round(targetMonthly * 12 / 31 / 1000) * 1000;
  return {
    preferredCurrency: "TWD",
    negotiable: persona.quality.key !== "overconfident",
    taiwan: {
      currency: "TWD",
      minMonthly,
      targetMonthly,
      maxMonthly,
      minAnnual: minMonthly * 13,
      targetAnnual: targetMonthly * 13,
      maxAnnual: maxMonthly * 13,
      acceptableWorkModes: persona.seniority.key === "intern" || persona.seniority.key === "entry" ? ["hybrid", "onsite Taipei"] : ["remote", "hybrid", "onsite Taipei"]
    },
    japan: {
      currency: "JPY",
      minAnnual: Math.round(japanTarget * 0.86 / 100000) * 100000,
      targetAnnual: japanTarget,
      maxAnnual: Math.round(japanTarget * 1.22 / 100000) * 100000,
      tokyoAdjustment: persona.seniority.key === "principal" || persona.seniority.key === "director" ? "+12% for mostly-onsite Tokyo leadership roles" : "+8% for mostly-onsite Tokyo roles",
      acceptableWorkModes: persona.seniority.key === "intern" || persona.seniority.key === "entry" ? ["relocation with support"] : ["remote Japan", "hybrid Tokyo", "relocation with support"]
    },
    remote: {
      currency: "USD",
      minAnnual: Math.round(remoteTarget * 0.86 / 1000) * 1000,
      targetAnnual: remoteTarget,
      maxAnnual: Math.round(remoteTarget * 1.24 / 1000) * 1000,
      acceptableRegions: ["APAC remote", "global contractor", "US/EU async-friendly"]
    },
    equityPreference: persona.seniority.key === "intern" || persona.seniority.key === "entry" ? "cash preferred; equity is a learning bonus" : "meaningful equity acceptable if cash floor is met",
    notes: `Synthetic compensation anchor with ${persona.salaryBiasPercent}% salary-bias setting. Numbers are not market advice.`
  };
}

function buildLanguageLevels(index, persona) {
  const englishScore = clamp(Math.round(70 + persona.qualityScore * 0.35 + between(index, 389, -10, 10, 0)), 55, 118);
  const englishLevel = englishScore >= 100 ? "Professional working proficiency" : englishScore >= 86 ? "Upper-intermediate to advanced" : "Intermediate";
  const japaneseRoll = hash01(index, 397);
  const japanese = japaneseRoll > 0.78 || (persona.seniority.key === "principal" && japaneseRoll > 0.55)
    ? { level: "Business Japanese", cefr: "C1", businessUsable: true, tests: [{ name: "JLPT", level: japaneseRoll > 0.9 ? "N1" : "N2", takenYear: 2024 }] }
    : japaneseRoll > 0.48
      ? { level: "Basic conversational", cefr: "A2", businessUsable: false, tests: [] }
      : { level: "No formal Japanese proficiency claimed", cefr: "N/A", businessUsable: false, tests: [], note: "Included explicitly so Japan-role filters can distinguish unknown/missing from not-qualified." };
  return [
    { language: "Mandarin Chinese", nativeName: "zh", level: "Native or bilingual", cefr: "C2", businessUsable: true, tests: [] },
    { language: "English", level: englishLevel, cefr: englishScore >= 100 ? "C1" : englishScore >= 86 ? "B2" : "B1", businessUsable: englishScore >= 86, tests: [{ name: "TOEFL iBT", score: englishScore, takenYear: 2024 }] },
    { language: "Japanese", nativeName: "ja", ...japanese }
  ];
}

function buildResumeText(profile, persona) {
  const work = (profile.workExperience || []).map((item) => [
    `${item.position}, ${item.company} (${item.startDate} - ${item.endDate})`,
    ...(item.highlights || []).map((line) => `- ${line}`)
  ].join("\n")).join("\n\n");
  const projects = (profile.portfolioProjects || []).map((item) => `- ${item.name}: ${(item.highlights || []).join(" ")}`).join("\n");
  const gaps = (profile.gapAnalysis?.priorityGaps || []).join("; ");
  return `${profile.displayName} - ${profile.headline}
${profile.basics?.email || ""} | ${profile.personalLinks?.portfolio || ""}

SUMMARY
${profile.summary}

CALIBRATION SIGNALS
Seniority: ${persona.seniority.label}; quality tier: ${persona.quality.label}; score bias: ${persona.scoreBias}; variance band: ${persona.varianceBand}; ATS readiness: ${persona.atsReadiness}/100; evidence score: ${persona.evidenceScore}/100.

SKILLS
${(profile.skills || []).join(", ")}

EXPERIENCE
${work}

PROJECTS
${projects}

GAPS / RISKS
${gaps || "No major synthetic gap flagged."}

COMPENSATION EXPECTATIONS
Taiwan TWD ${profile.compensationExpectations?.taiwan?.minMonthly}-${profile.compensationExpectations?.taiwan?.maxMonthly}/month; Remote USD ${profile.compensationExpectations?.remote?.minAnnual}-${profile.compensationExpectations?.remote?.maxAnnual}/year.`;
}

function applyDetailedPersona(profile, targetIndex) {
  const persona = personaForIndex(targetIndex);
  const baseRole = stripSeniority(profile.targetRole || profile.role || profile.basics?.label);
  const targetRole = titleFor(baseRole, persona.seniority);
  const roleSkills = extraSkillsForRole(baseRole);
  const skills = uniqueArray([
    roleSkills,
    profile.skills || [],
    Object.values(profile.skillGroups && typeof profile.skillGroups === "object" ? profile.skillGroups : {}).flat(),
    COMMON_DETAIL_SKILLS
  ].flat()).slice(0, persona.seniority.skillTarget + (persona.quality.key === "elite" ? 8 : persona.quality.key === "low-signal" ? -3 : 0));
  const workExperience = buildWorkExperience(targetIndex, persona, baseRole, skills);
  const projects = buildProjects(targetIndex, persona, baseRole, skills);
  const proofPoints = buildProofPoints(targetIndex, persona, baseRole, skills, projects);
  const starStories = buildStarStories(proofPoints, persona);
  const skillExperience = buildSkillExperience(targetIndex, persona, skills, workExperience);
  const compensation = buildCompensation(targetIndex, persona);
  const languages = buildLanguageLevels(targetIndex, persona);
  const gaps = persona.quality.key === "elite"
    ? ["avoid over-indexing on leadership roles when hands-on coding is required"]
    : persona.quality.key === "overconfident"
      ? ["claims may exceed evidence", "salary expectation may be above demonstrated scope", "requires careful interview calibration"]
      : uniqueArray([pick(GAP_LIBRARY, targetIndex, 409), pick(GAP_LIBRARY, targetIndex, 419)]).slice(0, persona.quality.key === "low-signal" ? 3 : 2);

  profile.role = baseRole;
  profile.targetRole = targetRole;
  profile.seniority = persona.seniority.label;
  profile.headline = `${persona.seniority.label} ${baseRole} | ${skills.slice(0, 7).join(", ")} | ${persona.quality.label} synthetic profile`;
  profile.summary = `${persona.seniority.label} ${baseRole.toLowerCase()} with ${persona.years}+ years of synthetic experience and ${persona.quality.label.toLowerCase()} evidence quality. Profile is intentionally calibrated with ${persona.varianceBand} score variance (${persona.scoreBias >= 0 ? "+" : ""}${persona.scoreBias}) so matching, ranking, ATS parsing, compensation, and interview-prep workflows see both strong and weak candidates. Recent work spans ${projects.slice(0, 2).map((item) => item.name).join(" and ")} with ${persona.evidenceScore}/100 evidence strength, ${persona.atsReadiness}/100 ATS readiness, and explicit gaps for calibration.`;
  profile.professionalSummary = profile.summary;
  profile.description = `Detailed synthetic resume profile for ${targetRole}. It includes granular seniority, quality, bias, variance, compensation, skill-depth, work-scope, project-evidence, STAR-story, and gap-analysis fields. No real person is represented.`;
  profile.skills = skills;
  profile.skillGroups = {
    technical: skills.filter((skill) => !/communication|planning|risk|documentation|stakeholder|kpi|retrospective|collaboration/i.test(skill)).slice(0, Math.ceil(skills.length * 0.55)),
    product: skills.filter((skill) => /communication|planning|risk|documentation|stakeholder|kpi|retrospective|collaboration|design|experiment|research/i.test(skill)).slice(0, 16),
    domain: uniqueArray(roleSkills.concat(projects.map((item) => item.name))).slice(0, 16)
  };
  profile.workExperience = workExperience;
  profile.employmentHistory = workExperience;
  profile.careerTimeline = workExperience.map((item) => ({
    company: item.company,
    title: item.position,
    startDate: item.startDate,
    endDate: item.endDate,
    scope: item.scopeDetails,
    evidenceStrength: item.qualitySignals.evidenceStrength
  }));
  profile.totalYearsOfExperience = persona.years;
  profile.projects = projects.map((item) => `${item.name} - ${(item.highlights || []).join(" ")}`).join(" | ");
  profile.portfolioProjects = projects;
  profile.projectHighlights = projects.map((item) => ({
    name: item.name,
    impact: item.highlights[0],
    metrics: item.metrics,
    evidenceStatus: item.detailSignals.evidenceStatus
  }));
  profile.proofPoints = proofPoints;
  profile.starStories = starStories;
  profile.skillExperience = skillExperience;
  profile.skillMatrix = skillExperience;
  profile.compensationExpectations = compensation;
  profile.salaryExpectations = compensation;
  profile.languageProficiencies = languages;
  profile.languageLevels = languages;
  profile.languages = languages.map((item) => item.language);
  profile.certifications = (profile.certifications || []).slice(0, persona.quality.key === "low-signal" ? 1 : 4);
  profile.preferences = {
    ...(profile.preferences && typeof profile.preferences === "object" ? profile.preferences : {}),
    targetRoles: uniqueArray([targetRole, `${baseRole} Lead`, `${baseRole} Specialist`]).slice(0, 5),
    keywords: uniqueArray([skills, baseRole, targetRole, persona.seniority.label, persona.quality.label, persona.varianceBand].flat()).slice(0, 64),
    locations: uniqueArray(["Taipei", "Remote", locationFor(targetIndex, 0)]),
    avoidKeywords: persona.quality.key === "low-signal" ? ["unpaid", "commission-only", "senior-only mandate", "requires 8+ years"] : ["commission-only", "unpaid", "training fee", "deposit required"],
    salaryMin: compensation.taiwan.minMonthly,
    northStar: persona.seniority.key === "principal" || persona.seniority.key === "director" ? "Lead high-leverage teams with measurable product and operating impact." : "Grow through clear ownership, evidence-backed delivery, and calibrated role fit.",
    remote: persona.seniority.key !== "intern" && persona.seniority.key !== "entry"
  };
  profile.ats = {
    ...(profile.ats && typeof profile.ats === "object" ? profile.ats : {}),
    keywordDensity: persona.quality.key === "low-signal" ? "low" : persona.quality.key === "elite" ? "very high" : "medium",
    primaryKeywords: uniqueArray([skills, targetRole, baseRole, persona.seniority.label].flat()).slice(0, 72),
    roleKeywords: profile.preferences.targetRoles,
    evidenceLevel: `${proofPoints.length} proof points, ${starStories.length} STAR stories, ${workExperience.length} roles, ${projects.length} portfolio projects`,
    hasQuantifiedStories: persona.quality.key !== "low-signal",
    atsReady: persona.atsReadiness >= 64,
    parserFriendlySections: ["basics", "professionalSummary", "skills", "workExperience", "portfolioProjects", "educationHistory", "certifications", "employmentHistory", "skillExperience", "educationDetails", "compensationExpectations", "personalLinks", "workAuthorization", "languageProficiencies", "candidateSignal", "biasCalibration", "gapAnalysis"],
    score: persona.atsReadiness
  };
  profile.candidateSignal = {
    detailSchemaVersion: DETAIL_SCHEMA_VERSION,
    seniorityBand: persona.seniority.key,
    seniorityLabel: persona.seniority.label,
    qualityTier: persona.quality.key,
    qualityLabel: persona.quality.label,
    qualityScore: persona.qualityScore,
    detailLevel: persona.quality.detailLevel,
    detailDensity: persona.detailDensity,
    atsReadiness: persona.atsReadiness,
    evidenceScore: persona.evidenceScore,
    interviewReadiness: persona.interviewReadiness,
    expectedScreeningOutcome: persona.atsReadiness >= 82 ? "likely pass" : persona.atsReadiness >= 62 ? "mixed" : "likely screen-out",
    generatedFor: ["ranking variance", "ATS parser testing", "seniority calibration", "compensation outlier checks"]
  };
  profile.biasCalibration = {
    scoreBias: persona.scoreBias,
    varianceBand: persona.varianceBand,
    varianceMagnitude: persona.varianceMagnitude,
    salaryBiasPercent: persona.salaryBiasPercent,
    keywordNoise: persona.keywordNoise,
    evidenceStrength: persona.quality.evidenceStrength,
    explanation: "Synthetic calibration values intentionally widen the spread between high-signal and low-signal candidates."
  };
  profile.gapAnalysis = {
    priorityGaps: gaps,
    riskFlags: persona.quality.key === "overconfident" ? ["overstated scope risk", "salary expectation outlier"] : persona.quality.key === "low-signal" ? ["low evidence density", "thin metrics"] : [],
    coachingFocus: persona.seniority.key === "intern" || persona.seniority.key === "entry" ? ["project framing", "basic metric storytelling", "portfolio specificity"] : ["scope clarity", "tradeoff storytelling", "leadership evidence"],
    validationQuestions: ["Which metric did you personally move?", "What was your exact ownership boundary?", "What evidence would a reference confirm?"]
  };
  profile.workAuthorization = {
    ...(profile.workAuthorization && typeof profile.workAuthorization === "object" ? profile.workAuthorization : {}),
    currentResidency: "Taipei",
    taiwan: { authorized: true, status: "Authorized to work in Taiwan", sponsorshipRequired: false },
    japan: {
      interested: persona.seniority.key !== "intern",
      canWorkInJapan: languages.find((item) => item.language === "Japanese")?.businessUsable || persona.seniority.key === "principal",
      visaStatus: persona.seniority.key === "intern" ? "Not targeting Japan relocation in this synthetic scenario" : "Potential Engineer/Specialist visa path in synthetic scenario",
      sponsorshipRequired: persona.seniority.key !== "principal" && persona.seniority.key !== "director",
      willingToRelocateTokyo: persona.seniority.key !== "intern",
      remoteJapanOnly: persona.seniority.key === "entry",
      earliestStartAfterOfferDays: persona.seniority.key === "intern" ? 14 : persona.seniority.key === "director" ? 90 : 45
    },
    remote: { canWorkRemote: persona.seniority.key !== "intern", preferredTimeZones: ["UTC+8", "UTC+9", "UTC+10"], contractorFriendly: true, employerOfRecordRequired: persona.seniority.key === "entry" },
    noticePeriodDays: persona.seniority.key === "intern" ? 14 : persona.seniority.key === "director" ? 90 : 45,
    travelAvailability: persona.seniority.key === "director" ? "up to 25%" : "up to 10%"
  };
  profile.visaAndMobility = profile.workAuthorization;
  profile.resumeText = buildResumeText(profile, persona);
  profile.experience = workExperience.map((item) => `${item.position} at ${item.company}: ${(item.highlights || []).join(" ")}`).join(" ");

  if (profile.basics && typeof profile.basics === "object") profile.basics.label = targetRole;
  if (profile.contact && typeof profile.contact === "object") profile.contact.label = targetRole;

  return profile;
}

function createStats() {
  return {
    qualityTierCounts: {},
    seniorityCounts: {},
    varianceBandCounts: {},
    detailLevelCounts: {},
    minYearsOfExperience: Infinity,
    maxYearsOfExperience: 0,
    minScoreBias: Infinity,
    maxScoreBias: -Infinity,
    highSignalRecords: 0,
    lowSignalRecords: 0
  };
}

function recordStats(stats, persona) {
  increment(stats.qualityTierCounts, persona.quality.label);
  increment(stats.seniorityCounts, persona.seniority.label);
  increment(stats.varianceBandCounts, persona.varianceBand);
  increment(stats.detailLevelCounts, persona.quality.detailLevel);
  stats.minYearsOfExperience = Math.min(stats.minYearsOfExperience, persona.years);
  stats.maxYearsOfExperience = Math.max(stats.maxYearsOfExperience, persona.years);
  stats.minScoreBias = Math.min(stats.minScoreBias, persona.scoreBias);
  stats.maxScoreBias = Math.max(stats.maxScoreBias, persona.scoreBias);
  if (persona.quality.key === "elite" || persona.seniority.key === "principal" || persona.seniority.key === "director") stats.highSignalRecords += 1;
  if (persona.quality.key === "low-signal" || persona.seniority.key === "intern" || persona.seniority.key === "entry") stats.lowSignalRecords += 1;
}

function transformProfile(sourceProfile, sourceIndex, targetIndex, shardIndex, sourceRecordCount) {
  const oldPadded = padProfile(sourceIndex);
  const newPadded = padProfile(targetIndex);
  const oldId = sourceProfile.id || syntheticId(sourceIndex);
  const newId = syntheticId(targetIndex);
  const oldName = sourceProfile.displayName || sourceProfile.basics?.name || syntheticName(sourceIndex);
  const newName = syntheticName(targetIndex);
  const newBatch = batchLabel(targetIndex);

  const transformed = walk(sourceProfile, (value) => value
    .replaceAll(oldId, newId)
    .replaceAll(`synthetic-resume-${oldPadded}`, newId)
    .replaceAll(oldName, newName)
    .replaceAll(`Synthetic Candidate ${oldPadded}`, newName)
    .replaceAll(`/case-study/${oldPadded}-`, `/case-study/${newPadded}-`)
    .replace(/\bBatch \d{2,3}\b/g, `Batch ${newBatch}`));

  transformed.id = newId;
  transformed.displayName = newName;
  transformed.synthetic = true;
  transformed.source = "generated-anonymous-sharded-resume-corpus";

  const email = `${newId}@example.test`;
  const phone = phoneFor(targetIndex);
  const website = `https://portfolio.example.test/${newId}`;
  const links = {
    linkedin: `https://linkedin.example.test/in/${newId}`,
    github: `https://github.example.test/${newId}`,
    portfolio: website,
    caseStudies: [1, 2, 3].map((item) => `https://portfolio.example.test/case-study/${newPadded}-${item}`),
    resumePdf: `${website}/resume.pdf`,
    publicSignalNote: "Reserved example/test links for synthetic data only; useful for testing external-signal fields without real profiles."
  };

  if (transformed.basics && typeof transformed.basics === "object") {
    transformed.basics.name = newName;
    transformed.basics.email = email;
    transformed.basics.phone = phone;
    transformed.basics.website = website;
    transformed.basics.profiles = [
      { network: "LinkedIn", username: newId, url: links.linkedin },
      { network: "GitHub", username: newId, url: links.github },
      { network: "Portfolio", username: newId, url: links.portfolio }
    ];
  }

  if (transformed.contact && typeof transformed.contact === "object") {
    transformed.contact.name = newName;
    transformed.contact.email = email;
    transformed.contact.phone = phone;
    transformed.contact.website = website;
    transformed.contact.profiles = [
      { network: "LinkedIn", username: newId, url: links.linkedin },
      { network: "GitHub", username: newId, url: links.github },
      { network: "Portfolio", username: newId, url: links.portfolio }
    ];
  }

  transformed.personalLinks = { ...links };
  transformed.links = { ...links };

  const roleSignal = [
    transformed.role,
    transformed.targetRole,
    transformed.seniority,
    Math.ceil(targetIndex / sourceRecordCount) > 1 ? `Expansion ${Math.ceil(targetIndex / sourceRecordCount)}` : ""
  ].filter(Boolean);

  if (transformed.preferences && typeof transformed.preferences === "object") {
    transformed.preferences.keywords = uniqueArray([
      ...(Array.isArray(transformed.preferences.keywords) ? transformed.preferences.keywords : []),
      ...roleSignal
    ]);
  }

  if (transformed.ats && typeof transformed.ats === "object") {
    transformed.ats.primaryKeywords = uniqueArray([
      ...(Array.isArray(transformed.ats.primaryKeywords) ? transformed.ats.primaryKeywords : []),
      ...roleSignal
    ]);
  }

  transformed.datasetVariant = {
    ...(transformed.datasetVariant && typeof transformed.datasetVariant === "object" ? transformed.datasetVariant : {}),
    globalIndex: targetIndex,
    baseProfileId: sourceProfile.datasetVariant?.baseProfileId || oldId,
    sourceProfileId: oldId,
    sourceGlobalIndex: sourceIndex,
    expansionRound: Math.ceil(targetIndex / 1000),
    corpusExpansionRound: Math.ceil(targetIndex / sourceRecordCount),
    shardHint: shardIndex
  };

  return applyDetailedPersona(transformed, targetIndex);
}

function scaleCounts(value, fromTotal, toTotal, pathKeys = []) {
  if (typeof value === "number") {
    if (pathKeys.includes("compensation")) return value;
    return Math.round((value / fromTotal) * toTotal);
  }
  if (Array.isArray(value)) return value.map((item) => scaleCounts(item, fromTotal, toTotal, pathKeys));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scaleCounts(child, fromTotal, toTotal, [...pathKeys, key])]));
  }
  return value;
}

function shardMeta({ manifest, index, count, byteSize }) {
  const file = `career-ops-profiles-${String(index).padStart(4, "0")}.json`;
  const directory = manifest.directory || path.dirname(manifest.path || DEFAULT_MANIFEST);
  const recordStart = (index - 1) * manifest.shardSize + 1;
  const recordEnd = recordStart + count - 1;
  return {
    index,
    file,
    path: path.posix.join(directory.replaceAll(path.sep, "/"), file),
    count,
    firstProfileId: syntheticId(recordStart),
    lastProfileId: syntheticId(recordEnd),
    byteSize
  };
}

async function statSize(filePath) {
  return (await fsp.stat(filePath)).size;
}

async function expandCorpus(args) {
  if (!Number.isInteger(args.rows) || args.rows <= 0) throw new Error("--rows must be a positive integer.");

  const manifestPath = args.manifest;
  const manifest = await readJson(manifestPath);
  manifest.path = manifestPath;
  manifest.shardSize = args.shardSize || manifest.shardSize || DEFAULT_SHARD_SIZE;

  if (!Number.isInteger(manifest.shardSize) || manifest.shardSize <= 0) {
    throw new Error("--shard-size must be a positive integer.");
  }

  const directory = manifest.directory || path.dirname(manifestPath);
  const sourceTotal = Number(manifest.totalRecords || 0);
  const sourceShards = Array.isArray(manifest.shards) ? manifest.shards : [];
  if (!sourceTotal || !sourceShards.length) throw new Error("Manifest must contain existing source shards.");
  if (args.rows < sourceTotal) {
    throw new Error(`Refusing to shrink corpus from ${sourceTotal} to ${args.rows}.`);
  }

  const shardCount = Math.ceil(args.rows / manifest.shardSize);
  const sourceShardCount = sourceShards.length;
  const newShardEntries = [];
  const rewriteForDetail = manifest.detailSchemaVersion !== DETAIL_SCHEMA_VERSION;
  const stats = createStats();
  let totalBytes = 0;

  await fsp.mkdir(directory, { recursive: true });

  for (let shardIndex = 1; shardIndex <= shardCount; shardIndex += 1) {
    const file = `career-ops-profiles-${String(shardIndex).padStart(4, "0")}.json`;
    const outPath = path.join(directory, file);
    const recordStart = (shardIndex - 1) * manifest.shardSize + 1;
    const recordEnd = Math.min(shardIndex * manifest.shardSize, args.rows);
    const count = recordEnd - recordStart + 1;
    const existingSourceShard = shardIndex <= sourceShardCount ? sourceShards[shardIndex - 1] : null;

    for (let offset = 0; offset < count; offset += 1) {
      recordStats(stats, personaForIndex(recordStart + offset));
    }

    if (existingSourceShard && fs.existsSync(outPath) && !args.force && !rewriteForDetail) {
      const byteSize = await statSize(outPath);
      totalBytes += byteSize;
      newShardEntries.push(shardMeta({ manifest, index: shardIndex, count, byteSize }));
      continue;
    }

    if (fs.existsSync(outPath) && !args.force && !rewriteForDetail) {
      const byteSize = await statSize(outPath);
      totalBytes += byteSize;
      newShardEntries.push(shardMeta({ manifest, index: shardIndex, count, byteSize }));
      continue;
    }

    const sourceShard = sourceShards[(shardIndex - 1) % sourceShardCount];
    const sourcePath = sourceShard.path || path.join(directory, sourceShard.file);
    const sourcePayload = await readJson(sourcePath);
    const sourceProfiles = Array.isArray(sourcePayload.profiles) ? sourcePayload.profiles : sourcePayload;
    if (!Array.isArray(sourceProfiles) || !sourceProfiles.length) {
      throw new Error(`Source shard has no profiles: ${sourcePath}`);
    }

    const profiles = [];
    for (let offset = 0; offset < count; offset += 1) {
      const targetIndex = recordStart + offset;
      const sourceProfile = sourceProfiles[offset % sourceProfiles.length];
      const sourceIndex = ((targetIndex - 1) % sourceTotal) + 1;
      profiles.push(transformProfile(sourceProfile, sourceIndex, targetIndex, shardIndex, sourceTotal));
    }

    const payload = {
      schemaVersion: "career-ops-profile-shard-v1",
      source: "career-ops-profile-sharded-synthetic-corpus",
      generatedAt: args.generatedAt,
      shardIndex,
      shardSize: manifest.shardSize,
      recordStart,
      recordEnd,
      count,
      firstProfileId: syntheticId(recordStart),
      lastProfileId: syntheticId(recordEnd),
      dataPolicy: "Synthetic resume-quality profiles only. No real person is represented; all personal links use reserved example/test domains.",
      profiles
    };

    await writeJson(outPath, payload);
    const byteSize = await statSize(outPath);
    totalBytes += byteSize;
    newShardEntries.push(shardMeta({ manifest, index: shardIndex, count, byteSize }));

    if (shardIndex % 10 === 0 || shardIndex === shardCount) {
      console.log(`Generated shard ${shardIndex}/${shardCount} (${recordStart}-${recordEnd})`);
    }
  }

  const updatedManifest = {
    ...manifest,
    schemaVersion: manifest.schemaVersion || "career-ops-profile-sharded-manifest-v1",
    detailSchemaVersion: DETAIL_SCHEMA_VERSION,
    generatedAt: args.generatedAt,
    totalRecords: args.rows,
    shardSize: manifest.shardSize,
    shardCount,
    totalBytes,
    directory,
    dataPolicy: manifest.dataPolicy || "Synthetic resume-quality profile corpus split into shards. No scraped resumes, no real personal identifiers, and no production contact data.",
    detailPolicy: "Synthetic profile detail v2 adds wider seniority, quality, score-bias, compensation-bias, evidence-density, risk, and gap distributions so ranking and ATS workflows see high-signal and low-signal resumes.",
    fieldCoverage: {
      ...scaleCounts(manifest.fieldCoverage || {}, sourceTotal, args.rows),
      candidateSignal: args.rows,
      biasCalibration: args.rows,
      gapAnalysis: args.rows,
      scopeDetails: args.rows,
      qualitySignals: args.rows
    },
    distributions: {
      ...scaleCounts(manifest.distributions || {}, sourceTotal, args.rows),
      seniorityCounts: stats.seniorityCounts,
      qualityTierCounts: stats.qualityTierCounts,
      varianceBandCounts: stats.varianceBandCounts,
      detailLevelCounts: stats.detailLevelCounts,
      experienceYears: {
        min: round(stats.minYearsOfExperience, 1),
        max: round(stats.maxYearsOfExperience, 1)
      },
      scoreBias: {
        min: stats.minScoreBias,
        max: stats.maxScoreBias
      },
      highSignalRecords: stats.highSignalRecords,
      lowSignalRecords: stats.lowSignalRecords
    },
    shards: newShardEntries
  };
  delete updatedManifest.path;

  await writeJson(manifestPath, updatedManifest, { pretty: true });

  if (args.syncProfileMetadata) {
    await syncProfileMetadata(args.profileMetadata, updatedManifest, args);
  }

  console.log(`Career Ops profile corpus now has ${args.rows.toLocaleString("en-US")} records in ${shardCount} shards.`);
}

async function syncProfileMetadata(filePath, manifest, args) {
  if (!fs.existsSync(filePath)) return;
  const profile = await readJson(filePath);

  profile.datasetMetadata = {
    ...(profile.datasetMetadata && typeof profile.datasetMetadata === "object" ? profile.datasetMetadata : {}),
    recordCount: manifest.totalRecords,
    requestedRecordCount: manifest.totalRecords,
    generatedAt: args.generatedAt,
    detailSchemaVersion: manifest.detailSchemaVersion,
    detailPolicy: manifest.detailPolicy,
    profileArrayNote: `Full ${manifest.totalRecords.toLocaleString("en-US")}-profile corpus moved to data/career-ops-profiles/*.json shards. This example file keeps only the active profile plus profileDataset metadata for compatibility with existing single-profile pipelines.`,
    shardCount: manifest.shardCount,
    shardSize: manifest.shardSize,
    storageMode: "sharded"
  };

  profile.profileDataset = {
    ...(profile.profileDataset && typeof profile.profileDataset === "object" ? profile.profileDataset : {}),
    format: "sharded-json",
    manifest: args.manifest,
    directory: manifest.directory,
    totalRecords: manifest.totalRecords,
    shardSize: manifest.shardSize,
    shardCount: manifest.shardCount,
    totalBytes: manifest.totalBytes,
    shards: manifest.shards.map((shard) => ({
      index: shard.index,
      path: shard.path,
      count: shard.count,
      firstProfileId: shard.firstProfileId,
      lastProfileId: shard.lastProfileId,
      byteSize: shard.byteSize
    }))
  };

  await writeJson(filePath, profile, { pretty: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  await expandCorpus(args);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
