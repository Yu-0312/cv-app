#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "tooling/data/app/career-ops-jobs.json";
const DEFAULT_PROFILE = "tooling/data/career-ops-profile.example.json";
const DEFAULT_OUT = "tooling/data/app/career-ops-application-kit.json";
const DEFAULT_JS_OUT = "tooling/data/app/career-ops-application-kit.js";
const DEFAULT_REPORT = "tooling/data/app/career-ops-application-kit.md";

function printHelp() {
  console.log(`Career Ops application kit

Generates application, outreach, follow-up, interview, and negotiation playbooks
from the ranked Career Ops job snapshot.

Usage:
  node scripts/career-ops-application-kit.mjs --jobs data/app/career-ops-jobs.json --profile data/career-ops-profile.json

Options:
  --jobs <file>       Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --profile <file>    Profile JSON. Default: ${DEFAULT_PROFILE}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --top <n>           Number of jobs to include. Default: 12
  --no-js             Skip JS output
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
    top: 12,
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
    else if (token === "--top") args.top = Math.max(1, Number.parseInt(argv[++i] || "12", 10) || 12);
    else if (token === "--no-js") args.writeJs = false;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function array(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function profileName(profile) {
  return String(profile.name || profile.fullName || profile.displayName || "Candidate").trim();
}

function profileRole(profile) {
  return String(profile.role || profile.targetRole || array(profile.preferences?.targetRoles)[0] || "the role").trim();
}

function profileSkills(profile) {
  return array(profile.skills || profile.preferences?.keywords)
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

function rankJobs(jobs) {
  return jobs
    .filter((job) => !job.isExpired)
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function subjectLine(job) {
  return `${job.title || "Role"} application - ${job.company || "Career Team"}`;
}

// ── ATS Keyword Injection (16-step pipeline inspired by career-ops pdf.md) ────
function buildAtsInjection(job, profile) {
  const found   = array(job.evaluation?.ats_keywords?.found || job.intelligence?.features?.profileSkillHits);
  const missing = array(job.evaluation?.ats_keywords?.missing || job.intelligence?.features?.missingProfileSkills);
  const skills  = profileSkills(profile);

  // Step 1: Extract top JD keywords (from found + extras in JD)
  const jdText = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const jdKeywords = Array.from(new Set([
    ...found,
    ...skills.filter((s) => jdText.includes(s.toLowerCase())),
  ])).slice(0, 20);

  // Step 2: Separate hard skills vs soft skills
  const SOFT_TERMS = ["communication", "leadership", "collaboration", "problem solving", "adaptable", "proactive", "detail-oriented", "analytical"];
  const hardKeywords = jdKeywords.filter((k) => !SOFT_TERMS.some((s) => k.toLowerCase().includes(s)));
  const softKeywords = jdKeywords.filter((k) => SOFT_TERMS.some((s) => k.toLowerCase().includes(s)));

  // Step 3: Detect role archetype — title-first (high precision), then career-ops 6 archetypes
  const titleText = (job.title || "").toLowerCase();
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const archetype =
    // Title-first: job title is the strongest archetype signal
    /(product manager|product lead|product owner|program manager|technical pm)/i.test(titleText) ? "Technical AI PM" :
    /(solutions? architect|platform architect|integration architect)/i.test(titleText) ? "AI Solutions Architect" :
    /(full.?stack)/i.test(titleText) ? "Full Stack Engineer" :
    /(backend|back.end|server.?side engineer)/i.test(titleText) ? "Backend Engineer" :
    /(frontend|front.end|ui engineer)/i.test(titleText) ? "Frontend Engineer" :
    // Content-based career-ops archetypes
    /(observabilit|evals?\b|llmops|mlops|model serv|llm infra|pipeline.*monitor|inference pipeline)/i.test(text) ? "AI Platform / LLMOps" :
    /(multi.?agent|agentic|agent framework|hitl|human.?in.?the.?loop)/i.test(text) ? "Agentic / Automation" :
    /(prd\b|product discovery|product owner|product architect)/i.test(text) ? "Technical AI PM" :
    /(enterprise integrat|integration architect|system.?architecture design)/i.test(text) ? "AI Solutions Architect" :
    /(forward.?deploy|client.?facing|field (engineer|team)|solution engineer)/i.test(text) ? "AI Forward Deployed" :
    /(ai transformation|change management.*ai|ai.*enablement|ai champion)/i.test(text) ? "AI Transformation" :
    // General tech fallbacks
    /(frontend|react|vue|angular|ui engineer)/i.test(text) ? "Frontend Engineer" :
    /(backend|api|node\.?js|python\b|go\b|java\b|server.?side)/i.test(text) ? "Backend Engineer" :
    /(full.?stack|全端)/i.test(text) ? "Full Stack Engineer" :
    /(data scientist|deep learning|machine learning|llm\b|ai engineer)/i.test(text) ? "AI/Data Engineer" :
    /(ux\b|designer|figma|design system)/i.test(text) ? "UX Designer" :
    /(marketing|growth hacking|seo\b|行銷)/i.test(text) ? "Marketing" :
    String(job.intelligence?.features?.roleFamily || "General Engineer");

  // Step 4: Build summary rewrite direction
  const summaryRewriteHints = [
    hardKeywords.length ? `在 Professional Summary 中自然帶入：${hardKeywords.slice(0, 5).join("、")}` : null,
    `使用職位語言：「${archetype}」方向的動詞和術語`,
    missing.length ? `【你已有但此 JD 未要求】可視情況選擇性提及：${missing.slice(0, 5).join("、")}` : null,
  ].filter(Boolean);

  // Step 5: ATS formatting rules
  const atsRules = [
    "單欄排版，避免 sidebar 雙欄（ATS parser 容易亂序）",
    "使用標準 header：Professional Summary, Work Experience, Skills, Education",
    "不使用巢狀表格或文字框",
    "確保 PDF 文字可被選取（不可光柵化輸出）",
    "UTF-8 編碼，移除 em dash / smart quote / zero-width space",
    "關鍵技能在 Skills section 明確列出，不要只藏在 bullet 裡",
  ];

  // Step 6: Ethicality guardrails
  const guardrails = [
    "NEVER add skills the candidate lacks",
    "Only reformulate real experience with exact JD vocabulary",
    `Example: if candidate has 'API development', it can become '${hardKeywords[0] || "REST API design"}'`,
  ];

  return {
    jdKeywords: jdKeywords.slice(0, 15),
    hardKeywords: hardKeywords.slice(0, 10),
    softKeywords,
    missingKeywords: missing.slice(0, 8),
    archetype,
    summaryRewriteHints,
    atsRules,
    guardrails,
    keywordCoveragePercent: jdKeywords.length
      ? Math.round((hardKeywords.length / Math.min(jdKeywords.length, 15)) * 100)
      : 0,
  };
}

function buildPlaybook(job, profile) {
  const name = profileName(profile);
  const role = profileRole(profile);
  const skills = profileSkills(profile);
  const found = array(job.evaluation?.ats_keywords?.found || job.intelligence?.features?.profileSkillHits).slice(0, 8);
  const missing = array(job.evaluation?.ats_keywords?.missing || job.intelligence?.features?.missingProfileSkills).slice(0, 6);
  const keywordPack = [...new Set([...found, ...skills])].slice(0, 12);
  const company = job.company || "the company";
  const title = job.title || role;
  const score = job.score === undefined || job.score === "" ? "unscored" : `${job.score}/${job.grade || ""}`;
  const atsInjection = buildAtsInjection(job, profile);
  const blockG = job.blockG || job.dimensions?.legitimacy || null;

  return {
    jobKey: job.jobKey || job.url || `${company}:${title}`,
    title,
    company,
    score,
    rating: job.rating || null,
    blockG: blockG ? { tier: blockG.tier, confidence: blockG.confidence } : null,
    priority: Number(job.score || 0) >= 80 ? "P0" : Number(job.score || 0) >= 70 ? "P1" : "P2",
    atsInjection,
    applyChecklist: [
      "Open the source URL and confirm the role is still active.",
      blockG?.tier === "Suspicious" ? "⚠ Block G: Suspicious — verify legitimacy on company official site before applying." : null,
      blockG?.tier === "Proceed with Caution" ? "⚠ Block G: Proceed with Caution — double-check recruiter identity." : null,
      "Generate or refresh the tailored ATS PDF from this job.",
      atsInjection.hardKeywords.length ? `Mirror these JD keywords honestly in your CV: ${atsInjection.hardKeywords.slice(0, 8).join(", ")}` : "Add only keywords already supported by the CV.",
      missing.length ? `Do not overclaim missing areas: ${missing.join(", ")}` : "No major missing keyword cluster detected.",
      "Log status, recruiter/contact, and next follow-up date in the tracker.",
    ].filter(Boolean),
    outreachEmail: {
      subject: subjectLine(job),
      body: [
        `Hi ${company} team,`,
        "",
        `I am ${name}, and I am interested in the ${title} role. My background is focused on ${role}${skills.length ? ` with hands-on work in ${skills.slice(0, 5).join(", ")}` : ""}.`,
        "",
        found.length
          ? `The role stood out because it maps closely to my experience with ${found.slice(0, 5).join(", ")}.`
          : "The role stood out because the scope appears aligned with my current career direction.",
        "",
        "I would appreciate the chance to share how my experience can support the team. Thank you for your time.",
        "",
        `Best,\n${name}`
      ].join("\n")
    },
    followUp: {
      timing: "3-5 business days after applying or the last recruiter interaction.",
      body: [
        `Hi ${company} team,`,
        "",
        `I wanted to follow up on my application for the ${title} role. I remain interested and would be glad to provide any additional context about my background.`,
        "",
        "Thank you again for your time.",
        "",
        `Best,\n${name}`
      ].join("\n")
    },
    interviewPrep: [
      `Prepare a 60-second story for why ${company} and why ${title}.`,
      found.length ? `Prepare evidence for: ${found.slice(0, 6).join(", ")}.` : "Prepare evidence for the strongest CV skills relevant to the JD.",
      "Prepare one STAR story about execution under ambiguity.",
      "Prepare one STAR story about collaboration and tradeoff decisions.",
      "Prepare questions about team priorities, success metrics, and hiring timeline."
    ],
    negotiationPrep: [
      "Wait for a clear offer before anchoring compensation.",
      "Ask for total compensation breakdown, work mode, title, level, review cycle, and start date.",
      "Negotiate around the whole package: base, bonus, equity, signing bonus, relocation, remote setup, learning budget, and review timing.",
      "Use competing priorities and role fit, not personal need, as the negotiation frame."
    ]
  };
}

function renderMarkdown(payload) {
  const lines = [
    "# Career Ops Application Kit",
    "",
    `Generated: ${payload.generatedAt}`,
    `Jobs: ${payload.playbooks.length}`,
    "",
    "## Pipeline",
    "- Apply: confirm active posting, generate tailored ATS PDF, submit, log status.",
    "- Outreach: recruiter or hiring manager email with role-specific evidence.",
    "- Follow-up: 3-5 business days after applying or recruiter touch.",
    "- Interview: map JD keywords to STAR stories and questions.",
    "- Negotiation: total-comp package and role-level calibration after offer.",
    ""
  ];
  for (const playbook of payload.playbooks) {
    lines.push(
      `## ${playbook.company} - ${playbook.title}`,
      "",
      `- Priority: ${playbook.priority}`,
      `- Score: ${playbook.score}`,
      `- Subject: ${playbook.outreachEmail.subject}`,
      "",
      `- Block G: ${playbook.blockG?.tier || "High Confidence"}`,
      playbook.rating ? `- Rating: ${playbook.rating.toFixed(1)}/5.0` : "",
      "",
      "### ATS Keyword Injection",
      `- Archetype: ${playbook.atsInjection?.archetype || "-"}`,
      `- Coverage: ${playbook.atsInjection?.keywordCoveragePercent || 0}%`,
      `- JD Keywords: ${(playbook.atsInjection?.hardKeywords || []).slice(0, 8).join(", ") || "-"}`,
      ...(playbook.atsInjection?.summaryRewriteHints || []).map((h) => `- ${h}`),
      `- Missing (do NOT fabricate): ${(playbook.atsInjection?.missingKeywords || []).join(", ") || "none"}`,
      "",
      "### Apply Checklist",
      ...playbook.applyChecklist.map((item) => `- ${item}`),
      "",
      "### Outreach Email",
      "```text",
      playbook.outreachEmail.body,
      "```",
      "",
      "### Follow-up",
      `Timing: ${playbook.followUp.timing}`,
      "```text",
      playbook.followUp.body,
      "```",
      "",
      "### Interview Prep",
      ...playbook.interviewPrep.map((item) => `- ${item}`),
      "",
      "### Negotiation Prep",
      ...playbook.negotiationPrep.map((item) => `- ${item}`),
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
  const jobs = rankJobs(Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : []).slice(0, args.top);
  const payload = {
    source: "career-ops-application-kit",
    generatedAt: new Date().toISOString(),
    profileRole: profileRole(profile),
    playbooks: jobs.map((job) => buildPlaybook(job, profile))
  };
  await writeJson(args.out, payload);
  if (args.writeJs) {
    await writeText(args.jsOut, `window.CV_CAREER_OPS_APPLICATION_KIT = ${JSON.stringify(payload, null, 2)};\n`);
  }
  await writeText(args.reportOut, renderMarkdown(payload));
  console.log(`[career-ops] application kit ${payload.playbooks.length} job(s) -> ${args.reportOut}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
