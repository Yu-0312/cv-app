#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_JOBS = "data/app/career-ops-jobs.json";
const DEFAULT_OUT = "data/app/career-ops-apply-agent-report.json";
const DEFAULT_REPORT = "data/app/career-ops-apply-agent-report.md";

function printHelp() {
  console.log(`Career Ops apply agent

Human-in-the-loop browser form inspector. It opens selected application URLs,
extracts visible fields/buttons, maps likely CV fields, and stops before submit.
It never submits applications.

Usage:
  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/career-ops-apply-agent.mjs --job-key <key>
  node scripts/career-ops-apply-agent.mjs --dry-run

Options:
  --jobs <file>       Career Ops jobs snapshot. Default: ${DEFAULT_JOBS}
  --job-key <key>     Process one job key
  --url <url>         Process one direct URL
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --limit <n>         Max jobs to inspect. Default: 3
  --timeout <ms>      Navigation timeout. Default: 25000
  --dry-run           Produce plans without launching a browser
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: DEFAULT_JOBS,
    jobKey: "",
    url: "",
    out: DEFAULT_OUT,
    reportOut: DEFAULT_REPORT,
    limit: 3,
    timeout: 25000,
    dryRun: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--jobs") args.jobs = argv[++i] || DEFAULT_JOBS;
    else if (token === "--job-key") args.jobKey = argv[++i] || "";
    else if (token === "--url") args.url = argv[++i] || "";
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--limit") args.limit = Math.max(1, Number.parseInt(argv[++i] || "3", 10) || 3);
    else if (token === "--timeout") args.timeout = Math.max(5000, Number.parseInt(argv[++i] || "25000", 10) || 25000);
    else if (token === "--dry-run") args.dryRun = true;
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

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function selectedJobs(payload, args) {
  if (args.url) return [{ title: "Direct URL", company: "", url: normalizeUrl(args.url), jobKey: args.url }];
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const active = jobs.filter((job) => !job.isExpired && job.url);
  if (args.jobKey) {
    return active.filter((job) => String(job.jobKey || job.url) === args.jobKey || String(job.url) === args.jobKey).slice(0, 1);
  }
  const selected = active.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, args.limit);
  if (selected.length || !args.dryRun) return selected;
  return [{
    title: "Sample Application",
    company: "Career Ops",
    url: "https://example.com/jobs/sample-application",
    jobKey: "dry-run:sample-application"
  }];
}

function fieldMapping(label) {
  const text = String(label || "").toLowerCase();
  if (/first|given|名/.test(text)) return "profile.firstName";
  if (/last|family|姓/.test(text)) return "profile.lastName";
  if (/name|姓名/.test(text)) return "profile.name";
  if (/email|mail|信箱/.test(text)) return "profile.email";
  if (/phone|mobile|電話|手機/.test(text)) return "profile.phone";
  if (/resume|cv|履歷/.test(text)) return "tailoredPdf";
  if (/cover|letter|求職信/.test(text)) return "coverLetter";
  if (/linkedin/.test(text)) return "profile.linkedin";
  if (/portfolio|website|github|作品/.test(text)) return "profile.website";
  if (/salary|compensation|薪資|待遇/.test(text)) return "compensation.range";
  if (/work authorization|visa|身份|簽證/.test(text)) return "manual.workAuthorization";
  return "manual.review";
}

function stableSelector(field) {
  if (field.id) return `#${field.id.replace(/(["\\])/g, "\\$1")}`;
  if (field.name) return `${field.tag || "input"}[name="${String(field.name).replace(/(["\\])/g, "\\$1")}"]`;
  if (field.label) return `${field.tag || "input"} /* label: ${field.label} */`;
  return field.tag || "input";
}

function fillActionForMapping(mapping) {
  if (mapping === "tailoredPdf") return "upload-user-approved-tailored-pdf";
  if (mapping === "coverLetter") return "paste-user-approved-cover-letter";
  if (mapping.startsWith("manual.")) return "ask-user";
  if (mapping === "compensation.range") return "ask-user-after-range-calibration";
  return "fill-from-profile-after-user-review";
}

async function launchBrowser() {
  const executablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || "";
  if (!executablePath) {
    throw new Error("Set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH, or run with --dry-run.");
  }
  const puppeteer = await import("puppeteer-core");
  return puppeteer.default.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

async function inspectJob(browser, job, args) {
  const url = normalizeUrl(job.url);
  if (!url) throw new Error("Job has no valid URL.");
  if (args.dryRun) {
    const dryFields = [
      { tag: "input", type: "text", name: "name", id: "", label: "Full name", required: true },
      { tag: "input", type: "email", name: "email", id: "", label: "Email", required: true },
      { tag: "input", type: "file", name: "resume", id: "", label: "Resume / CV", required: true },
      { tag: "textarea", type: "", name: "cover_letter", id: "", label: "Cover letter", required: false },
      { tag: "input", type: "text", name: "salary_expectation", id: "", label: "Salary expectation", required: false }
    ].map((field) => {
      const suggestedMapping = fieldMapping(`${field.label} ${field.name} ${field.id}`);
      return {
        ...field,
        selector: stableSelector(field),
        suggestedMapping,
        fillAction: fillActionForMapping(suggestedMapping)
      };
    });
    return {
      jobKey: job.jobKey || url,
      company: job.company || "",
      title: job.title || "",
      url,
      mode: "dry-run",
      fields: dryFields,
      fillPlan: dryFields.map((field) => ({
        selector: field.selector,
        mapping: field.suggestedMapping,
        action: field.fillAction,
        requiresUserReview: true
      })),
      buttons: [],
      guardrails: guardrails()
    };
  }
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(args.timeout);
  await page.goto(url, { waitUntil: "networkidle2", timeout: args.timeout });
  const fields = await page.$$eval("input, textarea, select", (nodes) => nodes.map((node) => {
    const id = node.getAttribute("id") || "";
    const name = node.getAttribute("name") || "";
    const placeholder = node.getAttribute("placeholder") || "";
    const aria = node.getAttribute("aria-label") || "";
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || "" : "";
    return {
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute("type") || "",
      name,
      id,
      label: (label || aria || placeholder || name || id || "").trim(),
      required: node.hasAttribute("required")
    };
  }));
  const buttons = await page.$$eval("button, input[type='submit'], a", (nodes) => nodes
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute("type") || "",
      text: (node.textContent || node.getAttribute("value") || "").trim().replace(/\s+/g, " "),
      href: node.getAttribute("href") || ""
    }))
    .filter((item) => /submit|apply|next|continue|送出|申請|下一步/i.test(`${item.type} ${item.text} ${item.href}`))
    .slice(0, 20));
  await page.close();
  const mappedFields = fields.map((field) => {
    const suggestedMapping = fieldMapping(`${field.label} ${field.name} ${field.id}`);
    return {
      ...field,
      selector: stableSelector(field),
      suggestedMapping,
      fillAction: fillActionForMapping(suggestedMapping)
    };
  });
  return {
    jobKey: job.jobKey || url,
    company: job.company || "",
    title: job.title || "",
    url,
    mode: "inspect-only",
    fields: mappedFields,
    fillPlan: mappedFields.map((field) => ({
      selector: field.selector,
      mapping: field.suggestedMapping,
      action: field.fillAction,
      requiresUserReview: true
    })),
    buttons,
    guardrails: guardrails()
  };
}

function guardrails() {
  return [
    "Never click final submit.",
    "Never fabricate legal, education, work authorization, salary, or employment history answers.",
    "Never store account passwords or one-time codes.",
    "Stop for user review before any externally visible action.",
    "Prefer tailored PDF and user-approved cover letter only."
  ];
}

function renderReport(payload) {
  const lines = [
    "# Career Ops Apply Agent Report",
    "",
    `Generated: ${payload.generatedAt}`,
    `Inspections: ${payload.inspections.length}`,
    `Errors: ${payload.errors.length}`,
    "",
    "This report is inspect-only. It never submits applications.",
    ""
  ];
  for (const item of payload.inspections) {
    lines.push(
      `## ${item.company || "Unknown"} - ${item.title || "Application"}`,
      "",
      `URL: ${item.url}`,
      `Mode: ${item.mode}`,
      "",
      "### Fields",
      ...(item.fields.length ? item.fields.map((field) => `- ${field.label || field.name || field.id || field.tag} -> ${field.suggestedMapping} via ${field.fillAction}${field.required ? " (required)" : ""}`) : ["- No fields inspected."]),
      "",
      "### Fill Plan",
      ...(item.fillPlan?.length ? item.fillPlan.map((step) => `- ${step.selector}: ${step.action} (${step.mapping})`) : ["- No fill plan generated."]),
      "",
      "### Apply Controls",
      ...(item.buttons.length ? item.buttons.map((button) => `- ${button.text || button.type || button.href}`) : ["- No apply/submit controls detected."]),
      "",
      "### Guardrails",
      ...item.guardrails.map((line) => `- ${line}`),
      ""
    );
  }
  if (payload.errors.length) {
    lines.push("## Errors", "", ...payload.errors.map((error) => `- ${error.url || error.jobKey}: ${error.message}`), "");
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
  const payload = await readJsonIfExists(args.jobs);
  const jobs = selectedJobs(payload, args);
  let browser = null;
  const inspections = [];
  const errors = [];
  try {
    if (!args.dryRun) browser = await launchBrowser();
    for (const job of jobs) {
      try {
        inspections.push(await inspectJob(browser, job, args));
      } catch (error) {
        errors.push({
          jobKey: job.jobKey || job.url,
          url: job.url,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } finally {
    if (browser) await browser.close();
  }
  const result = {
    source: "career-ops-apply-agent",
    generatedAt: new Date().toISOString(),
    inspections,
    errors
  };
  await writeJson(args.out, result);
  await writeText(args.reportOut, renderReport(result));
  console.log(`[career-ops] apply agent inspected ${inspections.length} application page(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
