#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROFILE = "data/career-ops-profile.example.json";
const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-app-comparison.json";
const DEFAULT_REPORT = "data/app/career-ops-app-comparison.md";
const APP_CV_FIELDS = ["name", "role", "email", "phone", "location", "website", "avatar", "summary", "skills", "highlights", "experience", "education", "projects", "awards"];
const APP_TRACKER_LIMIT = 1000;

function printHelp() {
  console.log(`Career Ops app comparison

Compares the Career Ops profile + backend artifacts with what the CV Studio app
can ingest and display.

Usage:
  node scripts/career-ops-app-compare.mjs

Options:
  --profile <file>    Career Ops profile JSON. Default: ${DEFAULT_PROFILE}
  --jobs <file>       Career Ops jobs snapshot JSON. Default: ${DEFAULT_JOBS}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --report-out <file> Markdown output. Default: ${DEFAULT_REPORT}
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    profile: DEFAULT_PROFILE,
    jobs: DEFAULT_JOBS,
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--profile") args.profile = argv[++i] || DEFAULT_PROFILE;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function unique(items) {
  const seen = new Set();
  const output = [];
  for (const item of array(items).flat(Infinity)) {
    const value = text(item);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function locationText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return [value.city, value.region, value.country, value.countryCode].map(text).filter(Boolean).join(", ");
}

function activeProfile(payload) {
  if (payload?.activeProfileId && Array.isArray(payload.profiles) && !payload.role && !payload.summary) {
    return payload.profiles.find((item) => item?.id === payload.activeProfileId) || payload;
  }
  return payload;
}

function dateRange(item = {}) {
  return [item.startDate || item.start || item.from, item.endDate || item.end || item.to].map(text).filter(Boolean).join(" - ");
}

function formatWork(profile) {
  const source = array(profile.workExperience).length ? profile.workExperience : array(profile.employmentHistory).length ? profile.employmentHistory : profile.careerTimeline;
  const formatted = array(source).map((item) => {
    if (!item || typeof item !== "object") return text(item);
    const header = [item.position || item.title || item.role, item.company || item.organization, dateRange(item)].map(text).filter(Boolean).join(" | ");
    const highlights = array(item.highlights || item.bullets || item.responsibilities).map((line) => `- ${text(line)}`).filter((line) => line.length > 2).join("\n");
    return [header, item.summary, highlights].map(text).filter(Boolean).join("\n");
  }).filter(Boolean);
  return formatted.join("\n\n") || text(profile.experience || profile.resumeText);
}

function formatSkills(profile) {
  const grouped = Object.values(profile.skillGroups && typeof profile.skillGroups === "object" ? profile.skillGroups : {}).flat();
  const skillYears = array(profile.skillExperience || profile.skillMatrix).map((item) => {
    if (!item || typeof item !== "object") return item;
    const years = item.years || item.yearsOfExperience || item.experienceYears;
    return [item.skill || item.name, years ? `${years}y` : "", item.level || item.proficiency].map(text).filter(Boolean).join(" ");
  });
  return unique([profile.skills, grouped, skillYears]).join(", ");
}

function formatHighlights(profile) {
  const proofPoints = array(profile.proofPoints).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.title || item.name, item.result || item.impact, array(item.metrics).join(", ")].map(text).filter(Boolean).join(": ");
  });
  const stories = array(profile.starStories).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.theme || item.title, item.star?.result || item.result].map(text).filter(Boolean).join(": ");
  });
  return unique([profile.headline, profile.highlights, proofPoints, stories]).join("\n");
}

function formatEducation(profile) {
  const source = array(profile.educationDetails).length ? profile.educationDetails : array(profile.educationHistory).length ? profile.educationHistory : profile.education;
  return array(source).map((item) => {
    if (!item || typeof item !== "object") return text(item);
    return [
      [item.institution || item.school || item.university, item.area || item.field, item.studyType || item.degree].map(text).filter(Boolean).join(" | "),
      dateRange(item) || text(item.graduationYear),
      item.summary || item.description
    ].map(text).filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

function formatProjects(profile) {
  const source = array(profile.portfolioProjects).length ? profile.portfolioProjects : array(profile.projects).length ? profile.projects : profile.projectHighlights;
  return array(source).map((item) => {
    if (!item || typeof item !== "object") return text(item);
    const header = [item.name || item.title, item.role, item.url].map(text).filter(Boolean).join(" | ");
    const highlights = array(item.highlights || item.bullets || item.outcomes).map((line) => `- ${text(line)}`).filter((line) => line.length > 2).join("\n");
    return [header, item.summary || item.description, highlights].map(text).filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

function formatAwards(profile) {
  const languages = array(profile.languageProficiencies || profile.languages).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.language || item.name, item.level || item.proficiency, item.test || item.evidence].map(text).filter(Boolean).join(" | ");
  });
  const certifications = array(profile.certifications).map((item) => {
    if (!item || typeof item !== "object") return item;
    return [item.name || item.title, item.issuer, item.date || item.year].map(text).filter(Boolean).join(" | ");
  });
  return unique([profile.awards, certifications, languages]).join("\n");
}

function appCvProjection(profilePayload) {
  const profile = activeProfile(profilePayload);
  const contact = profile.contact && typeof profile.contact === "object" ? profile.contact : {};
  const basics = profile.basics && typeof profile.basics === "object" ? profile.basics : {};
  const links = unique([
    profile.website,
    contact.website,
    basics.website,
    array(contact.profiles || basics.profiles).map((item) => item?.url || item?.username),
    array(profile.personalLinks).map((item) => item?.url || item?.href || item?.value)
  ]);
  return {
    name: profile.name || profile.fullName || profile.displayName || contact.name || basics.name,
    role: profile.targetRole || profile.role || profile.seniority || contact.label || basics.label,
    email: profile.email || contact.email || basics.email,
    phone: profile.phone || contact.phone || basics.phone,
    location: locationText(profile.location || contact.location || basics.location),
    website: links[0] || "",
    avatar: profile.avatar || "",
    summary: profile.professionalSummary || profile.summary || profile.description || profile.headline,
    skills: formatSkills(profile),
    highlights: formatHighlights(profile),
    experience: formatWork(profile),
    education: formatEducation(profile) || text(profile.education),
    projects: formatProjects(profile) || text(profile.projects),
    awards: formatAwards(profile)
  };
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item) || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sortedCounts(counts) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function averageScore(jobs) {
  const scored = jobs.filter((job) => job.score !== undefined && job.score !== "");
  if (!scored.length) return 0;
  return Math.round(scored.reduce((sum, job) => sum + Number(job.score || 0), 0) / scored.length);
}

function summarizeProfile(profilePayload) {
  const profile = activeProfile(profilePayload);
  const projection = appCvProjection(profilePayload);
  const profileDataset = profilePayload.profileDataset && typeof profilePayload.profileDataset === "object"
    ? profilePayload.profileDataset
    : {};
  const embeddedProfileCount = Array.isArray(profilePayload.profiles) ? profilePayload.profiles.length : 0;
  const shardedProfileCount = Number(profileDataset.totalRecords || profilePayload.datasetMetadata?.recordCount || 0);
  const populatedCvFields = APP_CV_FIELDS.filter((field) => text(projection[field]));
  const structuredFields = [
    "workExperience", "employmentHistory", "skillExperience", "skillMatrix",
    "educationDetails", "educationHistory", "compensationExpectations",
    "personalLinks", "workAuthorization", "languageProficiencies",
    "proofPoints", "starStories", "resumeText", "preferences", "ats"
  ].filter((field) => profile[field] !== undefined);
  return {
    schemaVersion: profilePayload.schemaVersion || "",
    activeProfileId: profilePayload.activeProfileId || profile.id || profile.fullName || profile.name || profile.role || "",
    profileCorpusCount: embeddedProfileCount || shardedProfileCount,
    profileDatasetManifest: profileDataset.manifest || "",
    profileShardCount: Number(profileDataset.shardCount || 0),
    topLevelKeyCount: Object.keys(profilePayload).filter((key) => key !== "profiles").length,
    activeProfileKeyCount: Object.keys(profile).length,
    populatedCvFields,
    appProjectionLengths: Object.fromEntries(APP_CV_FIELDS.map((field) => [field, text(projection[field]).length])),
    structuredFields,
    skillsCount: array(profile.skills).length,
    proofPointCount: array(profile.proofPoints).length,
    starStoryCount: array(profile.starStories).length
  };
}

function summarizeJobs(payload) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const active = jobs.filter((job) => !job.isExpired);
  const evaluated = active.filter((job) => job.score !== undefined && job.score !== "");
  const top = active.slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 12)
    .map((job) => ({
      score: job.score,
      grade: job.grade,
      recommendation: job.recommendation,
      company: job.company || "",
      title: job.title || "",
      blockG: job.blockG?.tier || job.evaluation?.overall?.legitimacyTier || "",
      cvMatch: job.dimensions?.cvMatch?.score ?? job.intelligence?.dimensions?.cvMatch?.score ?? "",
      northStar: job.dimensions?.northStar?.score ?? job.intelligence?.dimensions?.northStar?.score ?? ""
    }));
  const insights = payload.marketInsights || {};
  return {
    source: payload.source || "",
    jobs: jobs.length,
    activeJobs: active.length,
    expiredJobs: jobs.length - active.length,
    evaluatedJobs: evaluated.length,
    averageScore: averageScore(evaluated),
    gradeDistribution: sortedCounts(countBy(evaluated, (job) => job.grade || "ungraded")),
    recommendationDistribution: sortedCounts(countBy(evaluated, (job) => job.recommendation || "none")),
    blockGDistribution: sortedCounts(countBy(active, (job) => job.blockG?.tier || job.evaluation?.overall?.legitimacyTier || "Unknown")),
    topJobs: top,
    marketInsights: {
      topSkills: array(insights.topSkills).slice(0, 12),
      missingHighDemand: array(insights.missingHighDemand).slice(0, 10),
      searchQueries: array(insights.searchQueries).slice(0, 18),
      roleFamilies: array(insights.roleFamilies).slice(0, 10),
      integrity: insights.integrity || {}
    }
  };
}

function buildComparison(profileSummary, jobSummary) {
  const appImportCount = Math.min(APP_TRACKER_LIMIT, jobSummary.jobs);
  return {
    generatedAt: new Date().toISOString(),
    featureDifferences: [
      {
        area: "Profile ingestion",
        app: "CV Studio imports the active Career Ops profile into 14 resume fields and flattens structured evidence into readable resume sections.",
        careerOps: "Career Ops scripts read the profile JSON directly and use structured fields such as preferences, proofPoints, starStories, compensation, and work authorization.",
        implication: "The app is better for editing/presentation; backend artifacts are better for structured scoring and repeatable reporting."
      },
      {
        area: "Profile corpus",
        app: "The app uses one active profile at a time.",
        careerOps: profileSummary.profileCorpusCount
          ? `The profile file contains ${profileSummary.profileCorpusCount} profiles, and the pipeline runs against the selected active profile.`
          : "This real profile is a single-profile file, so the pipeline runs directly against the top-level resume fields.",
        implication: profileSummary.profileCorpusCount
          ? "Profile corpus support is useful for test coverage or persona switching; the current app UI still works on one imported profile at a time."
          : "There is no profile corpus gap for this input; the main difference is whether structured fields stay separate or become resume text."
      },
      {
        area: "Job volume",
        app: `Career Ops tracker can now hold up to ${APP_TRACKER_LIMIT} imported jobs and displays imported backend scores.`,
        careerOps: `The backend snapshot contains ${jobSummary.jobs} total jobs / ${jobSummary.activeJobs} active jobs, with quality gates, intelligence, and reports.`,
        implication: `${appImportCount} jobs can be shown in the app from this snapshot; backend remains the source of truth for full pipeline generation.`
      },
      {
        area: "Scoring",
        app: "The app now has a browser-local 6D + Block G analysis engine for tracker jobs, plus optional AI evaluation when an API key is provided.",
        careerOps: "Backend scoring is deterministic heuristic 6D + Block G unless LLM review is explicitly enabled.",
        implication: "Use backend scores for repeatable pipeline reports; use the app engine for interactive web scoring and quick re-scoring without terminal work."
      }
    ],
    resultDifferences: [
      `Career Ops currently evaluates ${jobSummary.evaluatedJobs}/${jobSummary.activeJobs} active jobs with average score ${jobSummary.averageScore}.`,
      `Top backend recommendation is ${jobSummary.topJobs[0]?.company || "n/a"} - ${jobSummary.topJobs[0]?.title || "n/a"} at ${jobSummary.topJobs[0]?.score ?? "n/a"}/100.`,
      `App import preserves backend score/grade/recommendation for display, and the browser-local engine can re-score jobs interactively; scores can still diverge because the frontend and backend engines are separate implementations.`,
      `The profile has ${profileSummary.structuredFields.length} structured Career Ops field groups; after app import those become resume text sections rather than separate scoring dimensions.`
    ]
  };
}

function renderMarkdown(payload) {
  const { profile, careerOps, comparison } = payload;
  const lines = [
    "# Career Ops vs CV Studio App Comparison",
    "",
    `Generated: ${payload.generatedAt}`,
    "",
    "## Input Coverage",
    `- Profile schema: ${profile.schemaVersion || "unknown"}`,
    `- Active profile: ${profile.activeProfileId || "unknown"}`,
    `- Profile corpus size: ${profile.profileCorpusCount || 1}`,
    `- Active profile keys: ${profile.activeProfileKeyCount}`,
    `- App CV fields populated after import: ${profile.populatedCvFields.length}/${APP_CV_FIELDS.length} (${profile.populatedCvFields.join(", ")})`,
    `- Structured Career Ops field groups present: ${profile.structuredFields.length} (${profile.structuredFields.join(", ")})`,
    "",
    "## Backend Career Ops Results",
    `- Snapshot source: ${careerOps.source || "unknown"}`,
    `- Jobs: ${careerOps.jobs} total / ${careerOps.activeJobs} active / ${careerOps.expiredJobs} expired`,
    `- Evaluated active jobs: ${careerOps.evaluatedJobs}`,
    `- Average score: ${careerOps.averageScore}`,
    `- Grade distribution: ${careerOps.gradeDistribution.map((item) => `${item.name} ${item.count}`).join(", ")}`,
    `- Recommendation distribution: ${careerOps.recommendationDistribution.map((item) => `${item.name} ${item.count}`).join(", ")}`,
    "",
    "## Top Backend Matches",
    ...careerOps.topJobs.slice(0, 8).map((job, index) => `- ${index + 1}. ${job.score}/100 ${job.grade || ""} - ${job.company} - ${job.title} (${job.recommendation || "n/a"})`),
    "",
    "## Feature Differences",
    ...comparison.featureDifferences.flatMap((item) => [
      `### ${item.area}`,
      `- App: ${item.app}`,
      `- Career Ops: ${item.careerOps}`,
      `- Difference: ${item.implication}`
    ]),
    "",
    "## Result Differences",
    ...comparison.resultDifferences.map((item) => `- ${item}`),
    "",
    "## Market Signals",
    `- Top skills: ${careerOps.marketInsights.topSkills.map((item) => `${item.name} (${item.count})`).join(", ")}`,
    `- Missing high-demand skills: ${careerOps.marketInsights.missingHighDemand.map((item) => `${item.name} (${item.count})`).join(", ")}`,
    `- Search queries: ${careerOps.marketInsights.searchQueries.join(", ")}`,
    ""
  ];
  return `${lines.join("\n")}\n`;
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
  const profilePayload = await readJson(args.profile);
  const jobsPayload = await readJson(args.jobs);
  const profile = summarizeProfile(profilePayload);
  const careerOps = summarizeJobs(jobsPayload);
  const comparison = buildComparison(profile, careerOps);
  const payload = {
    generatedAt: comparison.generatedAt,
    profile,
    careerOps,
    app: {
      cvFields: APP_CV_FIELDS,
      trackerLimit: APP_TRACKER_LIMIT,
      importedJobsFromSnapshot: Math.min(APP_TRACKER_LIMIT, careerOps.jobs),
      frontendLocalEngine: true,
      frontendAiRequiresApiKey: false,
      optionalAiEvaluationRequiresApiKey: true
    },
    comparison
  };
  await writeJson(args.out, payload);
  await writeText(args.reportOut, renderMarkdown(payload));
  console.log(`[career-ops] app comparison -> ${args.out}`);
  console.log(`[career-ops] wrote ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
