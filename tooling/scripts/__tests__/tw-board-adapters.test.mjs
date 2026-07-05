// Mock-based tests for the Taiwan job-board adapters (104 / yourator / yes123 / 518).
// No network: fetch is stubbed. Verifies match(), pagination, dedupe, and field mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SOURCE_ADAPTERS } from "../career-ops-source-adapters.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

const toolkit = {
  stripHtml: (v) => String(v || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  normalizeJob: (job) => ({ ...job }),
  fetchText: async () => "",
  fetchJson: async () => ({}),
  scrapeJobPage: async () => []
};
const options = { timeoutMs: 5000, maxDiscovered: undefined };
const byId = Object.fromEntries(SOURCE_ADAPTERS.map((a) => [a.id, a]));

const originalFetch = globalThis.fetch;
const stubFetch = (handler) => { globalThis.fetch = handler; };
const restoreFetch = () => { globalThis.fetch = originalFetch; };

test("104 match by adapter + host", () => {
  assert.equal(byId["104"].match({ adapter: "104" }), true);
  assert.equal(byId["104"].match({ url: "https://www.104.com.tw/jobs/search/list" }), true);
  assert.equal(byId["104"].match({ url: "https://www.yourator.co/jobs" }), false);
});

test("yourator match by adapter + host", () => {
  assert.equal(byId["yourator"].match({ adapter: "yourator" }), true);
  assert.equal(byId["yourator"].match({ url: "https://www.yourator.co/api/v4/jobs" }), true);
});

test("yes123 match by adapter + host", () => {
  assert.equal(byId["yes123"].match({ adapter: "yes123" }), true);
  assert.equal(byId["yes123"].match({ url: "https://www.yes123.com.tw/wk_index/joblist.asp" }), true);
});

test("518 match by adapter + host", () => {
  assert.equal(byId["518"].match({ adapter: "518" }), true);
  assert.equal(byId["518"].match({ url: "https://www.518.com.tw/job-index.html" }), true);
});

test("104 scrape maps fields, paginates, dedupes, and sends Referer", async () => {
  let sawReferer = false;
  stubFetch(async (url, init) => {
    if (init?.headers?.referer) sawReferer = true;
    const page = Number(new URL(url).searchParams.get("page"));
    const list = page === 1
      ? [{ jobNo: "111", jobName: "前端工程師", custName: "台積電", jobAddrNoDesc: "新竹市",
            description: "<p>負責前端</p>", salaryDesc: "月薪5萬", link: { job: "//www.104.com.tw/job/abc?jobsource=x" }, appearDate: "20260701" },
         { jobNo: "111", jobName: "重複", custName: "X", link: { job: "//www.104.com.tw/job/abc" } }]
      : [];
    return { ok: true, status: 200, json: async () => ({ data: { list, totalPage: 1, totalCount: 1 } }) };
  });
  try {
    const jobs = await byId["104"].scrape({ adapter: "104", keyword: "" }, options, toolkit);
    assert.equal(sawReferer, true, "104 must send a Referer header");
    assert.equal(jobs.length, 1, "dedupe by jobNo");
    const j = jobs[0];
    assert.equal(j.title, "前端工程師");
    assert.equal(j.company, "台積電");
    assert.equal(j.location, "新竹市");
    assert.equal(j.sourceType, "adapter:104");
    assert.equal(j.url, "https://www.104.com.tw/job/abc", "protocol-relative link resolved + query stripped");
    assert.ok(j.description.includes("月薪5萬"));
  } finally { restoreFetch(); }
});

test("yourator scrape maps v4 payload shape", async () => {
  stubFetch(async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    const jobs = page === 1
      ? [{ id: 900, name: "後端工程師", company: { name: "Appier", path: "appier" },
           area_options: [{ name: "台北市" }], path: "/companies/appier/jobs/900",
           description: "<p>Go/Node</p>", salary: "1.2M+", skills: [{ name: "Go" }] }]
      : [];
    return { ok: true, status: 200, json: async () => ({ payload: { jobs }, total_page: 1 }) };
  });
  try {
    const jobs = await byId["yourator"].scrape({ adapter: "yourator" }, options, toolkit);
    assert.equal(jobs.length, 1);
    const j = jobs[0];
    assert.equal(j.title, "後端工程師");
    assert.equal(j.company, "Appier");
    assert.equal(j.location, "台北市");
    assert.equal(j.url, "https://www.yourator.co/companies/appier/jobs/900");
    assert.equal(j.sourceType, "adapter:yourator");
    assert.ok(j.description.includes("Go"));
  } finally { restoreFetch(); }
});

test("yourator scrape tolerates alt v2 shape", async () => {
  stubFetch(async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    const jobs = page === 1 ? [{ id: 5, title: "Data Engineer", company_name: "Gogolook", locations: ["台北"], url: "/jobs/5" }] : [];
    return { ok: true, status: 200, json: async () => ({ jobs, meta: { total_pages: 1 } }) };
  });
  try {
    const jobs = await byId["yourator"].scrape({ adapter: "yourator" }, options, toolkit);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].company, "Gogolook");
    assert.equal(jobs[0].url, "https://www.yourator.co/jobs/5");
  } finally { restoreFetch(); }
});

test("104 hard failure rejects so the worker can isolate it", async () => {
  stubFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));
  try {
    await assert.rejects(() => byId["104"].scrape({ adapter: "104" }, options, toolkit));
  } finally { restoreFetch(); }
});

test("flex seeds reference real adapter ids and capture all titles", () => {
  const flex = JSON.parse(readFileSync(path.join(root, "tooling/data/career-ops-source-flex.json"), "utf8"));
  const seeds = flex.sourceSeeds || [];
  const ids = new Set(SOURCE_ADAPTERS.map((a) => a.id));
  for (const w of ["104", "yourator", "yes123", "518"]) {
    const seed = seeds.find((s) => s.adapter === w);
    assert.ok(seed, `seed for ${w} exists`);
    assert.ok(ids.has(seed.adapter), `adapter ${w} is implemented`);
    assert.equal(seed.market, "tw");
    assert.deepEqual(seed.titleFilter.positive, [], `${w} seed captures all titles`);
  }
  // All four enabled: ingestion captures as much as possible; filtering happens downstream
  // when the user uploads a CV + keywords. Per-source try/catch in the worker isolates failures.
  for (const w of ["104", "yourator", "yes123", "518"]) {
    assert.notEqual(seeds.find((s) => s.adapter === w).enabled, false, `${w} seed is enabled`);
  }
  // No low volume caps — seeds request as much as the source will return.
  for (const w of ["104", "yourator", "yes123", "518"]) {
    assert.ok(seeds.find((s) => s.adapter === w).maxDiscovered >= 100000, `${w} seed has no low cap`);
  }
});
