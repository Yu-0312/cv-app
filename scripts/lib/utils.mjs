import fs from "node:fs/promises";
import path from "node:path";

export function createArgParser(argv) {
  const args = Array.from(argv);
  function getFlag(name, fallback = null) {
    const index = args.indexOf(name);
    if (index === -1 || index === args.length - 1) return fallback;
    return args[index + 1];
  }
  function hasFlag(name) {
    return args.includes(name);
  }
  function getNumberFlag(name, fallback = null) {
    const value = getFlag(name, null);
    if (value === null) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} 必須是數字`);
    return parsed;
  }
  return { args, getFlag, hasFlag, getNumberFlag };
}

export async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(url, options = {}, { timeout = 30_000, maxRetries = 3, label = "請求" } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = 2 ** (attempt - 1) * 2000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      lastError = err.name === "AbortError"
        ? new Error(`${label}逾時（${timeout / 1000}s）：${url}`)
        : err;
      continue;
    }
    clearTimeout(timer);
    if (response.status >= 500 && attempt < maxRetries) {
      lastError = new Error(`${label}失敗：${response.status} ${response.statusText}`);
      console.error(`[重試 ${attempt + 1}/${maxRetries}] ${response.status} ${response.statusText}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`${label}失敗：${response.status} ${response.statusText}`);
    }
    return response;
  }
  throw lastError;
}
