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
    ]
  ];

  for (const [filePath, content] of fallbackAssets) {
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
