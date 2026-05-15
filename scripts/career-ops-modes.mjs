#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IN = "data/career-ops-modes.json";
const DEFAULT_OUT = "data/app/career-ops-modes.json";
const DEFAULT_JS_OUT = "data/app/career-ops-modes.js";
const DEFAULT_REPORT = "data/app/career-ops-modes-report.md";

function printHelp() {
  console.log(`Career Ops modes registry

Turns the Career Ops command registry into browser and report artifacts. This is
the light command layer for scan, deep fit, compensation, apply, learn, and
doctor workflows.

Usage:
  node scripts/career-ops-modes.mjs

Options:
  --in <file>         Registry JSON. Default: ${DEFAULT_IN}
  --out <file>        JSON output. Default: ${DEFAULT_OUT}
  --js-out <file>     Browser JS output. Default: ${DEFAULT_JS_OUT}
  --report-out <file> Markdown report. Default: ${DEFAULT_REPORT}
  --no-js             Skip browser JS output
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    in: DEFAULT_IN,
    out: DEFAULT_OUT,
    jsOut: DEFAULT_JS_OUT,
    reportOut: DEFAULT_REPORT,
    writeJs: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--in") args.in = argv[++i] || DEFAULT_IN;
    else if (token === "--out") args.out = argv[++i] || DEFAULT_OUT;
    else if (token === "--js-out") args.jsOut = argv[++i] || DEFAULT_JS_OUT;
    else if (token === "--report-out") args.reportOut = argv[++i] || DEFAULT_REPORT;
    else if (token === "--no-js") args.writeJs = false;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function writeJson(filePath, data) {
  await writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function renderReport(payload) {
  const commands = Array.isArray(payload.commands) ? payload.commands : [];
  const guardrails = Array.isArray(payload.guardrails) ? payload.guardrails : [];
  return `# Career Ops Modes

- Generated: ${payload.generatedAt}
- Registry: ${payload.name || "Career Ops Modes"}
- Commands: ${commands.length}
- Guardrails: ${guardrails.length}

## Commands

${commands.map((item) => [
    `### ${item.command}`,
    `- Script: \`${item.script}\``,
    `- Purpose: ${item.purpose}`,
    `- Outputs: ${Array.isArray(item.outputs) && item.outputs.length ? item.outputs.map((output) => `\`${output}\``).join(", ") : "-"}`
  ].join("\n")).join("\n\n") || "- None"}

## Guardrails

${guardrails.map((item) => `- ${item}`).join("\n") || "- None"}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const registry = await readJson(args.in);
  const payload = {
    ...registry,
    source: "career-ops-modes",
    generatedAt: new Date().toISOString()
  };
  await writeJson(args.out, payload);
  if (args.writeJs) await writeText(args.jsOut, `window.CV_CAREER_OPS_MODES = ${JSON.stringify(payload, null, 2)};\n`);
  await writeText(args.reportOut, renderReport(payload));
  console.log(`[career-ops] modes commands=${Array.isArray(payload.commands) ? payload.commands.length : 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
