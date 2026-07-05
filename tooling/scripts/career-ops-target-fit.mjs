#!/usr/bin/env node

/**
 * Career Ops target-fit — seed-driven scoring.
 *
 * Instead of scoring the entire 90k+ job pool, the user supplies a *target*
 * (a company and/or a job title, optionally a location / remote preference).
 * This script:
 *   1. ranks every non-expired job by similarity to that target
 *      (lib/career-ops-target-match.mjs — weighted company/title/domain/location),
 *   2. keeps the top-N most similar jobs,
 *   3. runs the full 11-dimension deterministic evaluator on ONLY that subset,
 *   4. emits a ranked list annotated with both `similarity` and the fit score.
 *
 * This is deliberately cheaper than full-coverage scoring and matches the
 * "先填目標，再跑相似的" flow used in the browser app.
 *
 * Usage:
 *   node scripts/career-ops-target-fit.mjs --jobs data/app/career-ops-jobs.json \
 *     --profile data/career-ops-profile.json --company "Acme" --title "Frontend Engineer" \
 *     --out data/app/career-ops-target-fit.json
 *
 * Target may be given inline (--company/--title/--location/--remote) and/or via
 * a JSON file (--target file.json with {company,title,location,remote,description}).
 * Inline flags override file fields.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadScoringConfig } from "./lib/career-ops-scoring-config.mjs";
import { normalizeProfile, evaluateJob } from "./career-ops-evaluate.mjs";
import { rankBySimilarity, DEFAULT_SIMILARITY_WEIGHTS } from "./lib/career-ops-target-match.mjs";

export const SCHEMA_VERSION = "career-ops/target-fit-1.0";

function printHelp() {
  console.log(`Career Ops target-fit — seed-driven similarity + scoring

Ranks jobs by similarity to a user-supplied target, then scores only the most
similar subset with the full 11-dimension evaluator.

Usage:
  node scripts/career-ops-target-fit.mjs --jobs <file> --profile <file> \\
    [--target <file>] [--company <name>] [--title <role>] \\
    [--location <city>] [--remote] [--limit 50] [--threshold 0.12] \\
    [--out <file>]

Options:
  --jobs <file>       Input Career Ops snapshot JSON ({jobs:[...]})
  --profile <file>    CV/profile JSON (same shape as career-ops-evaluate)
  --target <file>     Optional JSON target seed {company,title,location,remote,description}
  --company <name>    Target company (overrides --target)
  --title <role>      Target job title (overrides --target)
  --location <city>   Target location (overrides --target)
  --remote            Prefer remote roles
  --config <file>     Optional scoring-config override JSON
  --limit <n>         Max jobs to score after similarity filter (default 50)
  --threshold <0..1>  Min similarity to keep (default 0.12)
  --out <file>        Output JSON. Default: stdout summary only
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    jobs: "", profile: "", target: "", config: "", out: "",
    company: "", title: "", location: "", remote: false,
    limit: 50, threshold: 0.12,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--help" || t === "-h") args.help = true;
    else if (t === "--jobs") args.jobs = argv[++i] || "";
    else if (t === "--profile") args.profile = argv[++i] || "";
    else if (t === "--target") args.target = argv[++i] || "";
    else if (t === "--config") args.config = argv[++i] || "";
    else if (t === "--out") args.out = argv[++i] || "";
    else if (t === "--company") args.company = argv[++i] || "";
    else if (t === "--title") args.title = argv[++i] || "";
    else if (t === "--location") args.location = argv[++i] || "";
    else if (t === "--remote") args.remote = true;
    else if (t === "--limit") args.limit = Number(argv[++i]) || 50;
    else if (t === "--threshold") args.threshold = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${t}`);
  }
  return args;
}

/** Build the target seed from a file (optional) overlaid with inline flags. */
export function buildSeed(args, fileSeed = {}) {
  const seed = { ...fileSeed };
  if (args.company) seed.company = args.company;
  if (args.title) seed.title = args.title;
  if (args.location) seed.location = args.location;
  if (args.remote) seed.remote = true;
  return seed;
}

/**
 * Core: rank jobs by similarity to the seed, then score the top subset.
 * Pure (no I/O) so it can be unit-tested and mirrored client-side.
 * @returns {{seed, matched:number, scored:Array}}
 */
export function targetFit(seed, jobs, profile, config, opts = {}) {
  const { limit = 50, threshold = 0.12, weights = DEFAULT_SIMILARITY_WEIGHTS } = opts;
  const pool = (jobs || []).filter((j) => !j.isExpired);
  const similar = rankBySimilarity(seed, pool, { limit, threshold, weights });
  const scored = similar.map((job) => {
    const evaluated = evaluateJob(job, profile, config);
    return {
      ...evaluated,
      similarity: job.similarity,
      similarityParts: job.similarityParts,
    };
  });
  // sort by fit score desc, similarity as tiebreak
  scored.sort((a, b) => {
    const sa = a.score ?? a.evaluation?.score ?? 0;
    const sb = b.score ?? b.evaluation?.score ?? 0;
    if (sb !== sa) return sb - sa;
    return (b.similarity ?? 0) - (a.similarity ?? 0);
  });
  return { seed, matched: similar.length, scored };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (!args.jobs || !args.profile) throw new Error("Use --jobs <file> and --profile <file>.");

  const config = await loadScoringConfig(args.config);
  const jobsPayload = JSON.parse(await fs.readFile(args.jobs, "utf8"));
  const profile = normalizeProfile(JSON.parse(await fs.readFile(args.profile, "utf8")), config);
  const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];

  let fileSeed = {};
  if (args.target) fileSeed = JSON.parse(await fs.readFile(args.target, "utf8"));
  const seed = buildSeed(args, fileSeed);
  if (!seed.company && !seed.title) {
    throw new Error("Provide a target: --company and/or --title (or --target <file>).");
  }

  const { matched, scored } = targetFit(seed, jobs, profile, config, {
    limit: args.limit,
    threshold: args.threshold,
  });

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy: "career-ops-target-fit-1.0",
    target: seed,
    similarity: { weights: DEFAULT_SIMILARITY_WEIGHTS, threshold: args.threshold, limit: args.limit },
    matched,
    jobs: scored,
  };

  if (args.out) {
    await fs.mkdir(path.dirname(args.out), { recursive: true });
    await fs.writeFile(args.out, `${JSON.stringify(payload)}\n`, "utf8");
    console.log(`[career-ops] target-fit: ${matched} similar job(s) scored -> ${args.out}`);
  } else {
    const top = scored.slice(0, 10).map((j, i) => {
      const s = j.score ?? j.evaluation?.score ?? 0;
      return `  ${String(i + 1).padStart(2)}. [sim ${(j.similarity ?? 0).toFixed(2)} | fit ${Math.round(s)}] ${j.company || "?"} — ${j.title || "?"}`;
    }).join("\n");
    console.log(`[career-ops] target-fit for ${JSON.stringify(seed)}\n${matched} similar job(s); top:\n${top}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
