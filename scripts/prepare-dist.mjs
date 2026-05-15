#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyFileIfExists(from, to) {
  try {
    await fs.copyFile(from, to);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirRecursive(from, to) {
  await ensureDir(to);
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(src, dest);
    } else {
      await fs.copyFile(src, dest);
    }
  }
}

async function writeFallback(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

async function requireFile(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`缺少必要檔案：${label}（${path.relative(root, filePath)}）`);
  }
}

async function main() {
  await fs.rm(distDir, { recursive: true, force: true });
  await ensureDir(distDir);

  const requiredFiles = [
    ["index.html", "index.html"],
    ["manifest.json", "manifest.json"],
    ["sw.js", "sw.js"],
    ["icon.svg", "icon.svg"],
    ["og-image.svg", "og-image.svg"],
    ["university-data.js", "university-data.js"]
  ];

  for (const [relativePath, label] of requiredFiles) {
    await requireFile(path.join(root, relativePath), label);
    await fs.copyFile(path.join(root, relativePath), path.join(distDir, relativePath));
  }

  await fs.copyFile(path.join(root, "index.html"), path.join(distDir, "404.html"));
  await fs.writeFile(path.join(distDir, ".nojekyll"), "", "utf8");

  const configTarget = path.join(distDir, "config.js");
  const copiedConfig = await copyFileIfExists(path.join(root, "config.js"), configTarget);
  if (!copiedConfig) {
    await writeFallback(
      configTarget,
      "window.CV_STUDIO_CONFIG = window.CV_STUDIO_CONFIG || {};\n"
    );
  }

  const appSourceDir = path.join(root, "data", "app");
  const appTargetDir = path.join(distDir, "data", "app");
  try {
    await copyDirRecursive(appSourceDir, appTargetDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const fallbackAssets = [
    [
      path.join(appTargetDir, "gsat-external-data.js"),
      "window.CV_GSAT_EXTERNAL_DEPTS = window.CV_GSAT_EXTERNAL_DEPTS || [];\n"
    ],
    [
      path.join(appTargetDir, "university-tw-app-data.js"),
      "window.CV_UNIVERSITY_TW_DATA = window.CV_UNIVERSITY_TW_DATA || { source: 'fallback', universities: {} };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-jobs.js"),
      "window.CV_CAREER_OPS_JOBS = window.CV_CAREER_OPS_JOBS || { source: 'fallback', extractedAt: '', sourceCount: 0, jobCount: 0, jobs: [], errors: [] };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-application-kit.js"),
      "window.CV_CAREER_OPS_APPLICATION_KIT = window.CV_CAREER_OPS_APPLICATION_KIT || { source: 'fallback', generatedAt: '', playbooks: [] };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-deep-research.js"),
      "window.CV_CAREER_OPS_DEEP_RESEARCH = window.CV_CAREER_OPS_DEEP_RESEARCH || { source: 'fallback', generatedAt: '', dossiers: [], evidence: [], queries: [] };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-deep-fit.js"),
      "window.CV_CAREER_OPS_DEEP_FIT = window.CV_CAREER_OPS_DEEP_FIT || { source: 'fallback', generatedAt: '', dossiers: [] };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-compensation.js"),
      "window.CV_CAREER_OPS_COMPENSATION = window.CV_CAREER_OPS_COMPENSATION || { source: 'fallback', generatedAt: '', plans: [] };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-story-bank.js"),
      "window.CV_CAREER_OPS_STORY_BANK = window.CV_CAREER_OPS_STORY_BANK || { source: 'fallback', generatedAt: '', storyBank: { themes: [], stories: [], gaps: [] } };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-parallel-report.js"),
      "window.CV_CAREER_OPS_PARALLEL = window.CV_CAREER_OPS_PARALLEL || { source: 'fallback', generatedAt: '', concurrency: 0, results: [], errors: [] };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-learning.js"),
      "window.CV_CAREER_OPS_LEARNING = window.CV_CAREER_OPS_LEARNING || { source: 'fallback', generatedAt: '', learning: { preferredSkills: [], avoidSignals: [], nextStrategy: [] } };\n"
    ],
    [
      path.join(appTargetDir, "career-ops-modes.js"),
      "window.CV_CAREER_OPS_MODES = window.CV_CAREER_OPS_MODES || { source: 'fallback', generatedAt: '', commands: [], guardrails: [] };\n"
    ]
  ];

  for (const [filePath, content] of fallbackAssets) {
    const exists = await fileExists(filePath);
    if (!exists) {
      await writeFallback(filePath, content);
    }
  }

  const fallbackReports = [
    [
      path.join(appTargetDir, "career-ops-source-strategy-report.md"),
      "# Career Ops Source Strategy Report\n\n- Sources: 0\n- Search queries: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-search-report.md"),
      "# Career Ops Search Adapter Report\n\n- Search query signals: 0\n- Discovered search sources: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-source-flex-report.md"),
      "# Career Ops Source Flex Report\n\n- Flex candidates: 0\n- Search queries: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-source-quality-report.md"),
      "# Career Ops Source Quality\n\n- Input active jobs: 0\n- Kept active jobs: 0\n- Filtered active jobs: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-source-health-report.md"),
      "# Career Ops Source Health\n\n- Sources: 0\n- Active jobs: 0\n- Scrape errors: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-application-kit.md"),
      "# Career Ops Application Kit\n\n- Jobs: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-deep-research.md"),
      "# Career Ops Deep Research\n\n- Dossiers: 0\n- Evidence items: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-deep-fit.md"),
      "# Career Ops Deep Fit Report\n\n- Dossiers: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-compensation.md"),
      "# Career Ops Compensation Planner\n\n- Plans: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-story-bank.md"),
      "# Career Ops Story Bank\n\n- Stories: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-parallel-report.md"),
      "# Career Ops Parallel Worker Report\n\n- Jobs processed: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-learning-report.md"),
      "# Career Ops Learning Report\n\n- Active jobs: 0\n- Positive signals: 0\n"
    ],
    [
      path.join(appTargetDir, "career-ops-modes-report.md"),
      "# Career Ops Modes\n\n- Commands: 0\n- Guardrails: 0\n"
    ]
  ];

  for (const [filePath, content] of fallbackReports) {
    const exists = await fileExists(filePath);
    if (!exists) {
      await writeFallback(filePath, content);
    }
  }

  const producedFiles = [];
  async function walk(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        producedFiles.push(path.relative(root, fullPath));
      }
    }
  }

  await walk(distDir);
  producedFiles.sort().forEach((file) => console.log(file));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
