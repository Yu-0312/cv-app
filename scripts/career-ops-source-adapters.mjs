import { isKnownMarketSearch } from "./lib/career-ops-market.mjs";
import { gunzipSync } from "node:zlib";

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function firstPathPart(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

function sourceName(source) {
  return cleanText(source.source || source.name || source.company);
}

function extractGreenhouseToken(source) {
  if (source.boardToken || source.board || source.slug) return cleanText(source.boardToken || source.board || source.slug);
  const url = normalizeUrl(source.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname === "boards-api.greenhouse.io") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("boards");
    return index >= 0 ? parts[index + 1] || "" : "";
  }
  if (/greenhouse\.io$/i.test(parsed.hostname)) {
    return parsed.searchParams.get("for") || firstPathPart(url);
  }
  return "";
}

function normalizeGreenhouseJob(job, source, toolkit) {
  const offices = Array.isArray(job.offices)
    ? job.offices.map((office) => office.location || office.name).filter(Boolean).join(" / ")
    : "";
  const departments = Array.isArray(job.departments)
    ? job.departments.map((department) => department.name).filter(Boolean).join(" / ")
    : "";
  const description = toolkit.stripHtml(job.content || "");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Greenhouse",
    sourceType: "adapter:greenhouse",
    title: job.title,
    company: sourceName(source),
    url: job.absolute_url,
    location: job.location?.name || offices,
    description: departments ? `${departments}\n\n${description}`.trim() : description,
    datePosted: job.updated_at,
    employmentType: job.metadata?.employment_type || ""
  });
}

function extractLeverSite(source) {
  if (source.site || source.slug || source.board) return cleanText(source.site || source.slug || source.board);
  const url = normalizeUrl(source.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (/api(\.eu)?\.lever\.co$/i.test(parsed.hostname)) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("postings");
    return index >= 0 ? parts[index + 1] || "" : "";
  }
  if (/jobs(\.eu)?\.lever\.co$/i.test(parsed.hostname)) return firstPathPart(url);
  return "";
}

function normalizeLeverJob(job, source, toolkit) {
  const categories = job.categories || {};
  const listText = Array.isArray(job.lists)
    ? job.lists.map((item) => `${item.text || ""}\n${toolkit.stripHtml(item.content || "")}`.trim()).filter(Boolean).join("\n\n")
    : "";
  const description = [
    job.openingPlain || toolkit.stripHtml(job.opening || ""),
    job.descriptionPlain || toolkit.stripHtml(job.description || ""),
    listText
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Lever",
    sourceType: "adapter:lever",
    title: job.text,
    company: sourceName(source),
    url: job.hostedUrl || job.applyUrl,
    location: categories.location || (Array.isArray(categories.allLocations) ? categories.allLocations.join(" / ") : ""),
    description,
    datePosted: job.createdAt ? new Date(job.createdAt).toISOString() : "",
    employmentType: [categories.commitment, categories.team, categories.department].filter(Boolean).join(" / ")
  });
}

function extractAshbyBoard(source) {
  if (source.boardName || source.board || source.slug) return cleanText(source.boardName || source.board || source.slug);
  const url = normalizeUrl(source.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname === "api.ashbyhq.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("job-board");
    return index >= 0 ? parts[index + 1] || "" : "";
  }
  if (/jobs\.ashbyhq\.com$/i.test(parsed.hostname)) return firstPathPart(url);
  return "";
}

function extractWorkableAccount(source) {
  if (source.account || source.subdomain || source.slug || source.board) return cleanText(source.account || source.subdomain || source.slug || source.board);
  const url = normalizeUrl(source.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname === "www.workable.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("accounts");
    return index >= 0 ? parts[index + 1] || "" : "";
  }
  if (/\.workable\.com$/i.test(parsed.hostname)) return parsed.hostname.split(".")[0] || "";
  if (/apply\.workable\.com$/i.test(parsed.hostname)) return firstPathPart(url);
  return "";
}

function normalizeWorkableJob(job, source, toolkit) {
  const location = job.location?.location_str || job.location?.city || job.location_str || "";
  const salary = job.salary
    ? [job.salary.salary_from, job.salary.salary_to, job.salary.salary_currency].filter(Boolean).join(" ")
    : "";
  const description = [
    toolkit.stripHtml(job.description || job.full_description || job.requirements || ""),
    salary ? `Salary: ${salary}` : ""
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Workable",
    sourceType: "adapter:workable",
    title: job.title || job.full_title,
    company: sourceName(source),
    url: job.url || job.shortlink || job.application_url,
    location,
    description,
    datePosted: job.created_at,
    employmentType: [job.department, job.location?.workplace_type].filter(Boolean).join(" / ")
  });
}

function extractSmartRecruitersCompany(source) {
  if (source.companyIdentifier || source.slug || source.board) return cleanText(source.companyIdentifier || source.slug || source.board);
  const url = normalizeUrl(source.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (parsed.hostname === "api.smartrecruiters.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("companies");
    return index >= 0 ? parts[index + 1] || "" : "";
  }
  if (/jobs\.smartrecruiters\.com$/i.test(parsed.hostname)) return firstPathPart(url);
  return "";
}

function normalizeSmartRecruitersJob(job, source, toolkit) {
  const location = job.location
    ? [job.location.city, job.location.region, job.location.country].filter(Boolean).join(", ")
    : "";
  return toolkit.normalizeJob({
    source: sourceName(source) || "SmartRecruiters",
    sourceType: "adapter:smartrecruiters",
    title: job.name || job.title,
    company: sourceName(source) || job.company?.name || "",
    url: job.ref || job.applyUrl || job.url,
    location,
    description: toolkit.stripHtml(job.jobAd?.sections?.jobDescription?.text || job.description || job.shortDescription || ""),
    datePosted: job.releasedDate || job.createdOn,
    employmentType: [job.typeOfEmployment?.label, job.department?.label, job.location?.remote ? "Remote" : ""].filter(Boolean).join(" / ")
  });
}

function extractBambooSubdomain(source) {
  if (source.subdomain || source.slug || source.board) return cleanText(source.subdomain || source.slug || source.board);
  const url = normalizeUrl(source.url);
  if (!url) return "";
  const parsed = new URL(url);
  if (/\.bamboohr\.com$/i.test(parsed.hostname)) return parsed.hostname.split(".")[0] || "";
  return "";
}

function extractWorkdayInfo(source) {
  const url = normalizeUrl(source.url || source.apiUrl);
  const tenant = cleanText(source.tenant || source.workdayTenant);
  const site = cleanText(source.site || source.board || source.slug || source.workdaySite);
  if (!url) return tenant && site ? { host: "", tenant, site } : null;
  const parsed = new URL(url);
  const host = parsed.hostname;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const firstNonLocale = parts.find((part) => !/^[a-z]{2}-[A-Z]{2}$/.test(part)) || "";
  const inferredTenant = tenant || host.split(".")[0] || "";
  const inferredSite = site || firstNonLocale;
  if (!inferredTenant || !inferredSite) return null;
  if (!/(myworkdayjobs\.com|myworkdaysite\.com)$/i.test(host) && source.adapter !== "workday" && source.type !== "workday") return null;
  return { host, tenant: inferredTenant, site: inferredSite };
}

async function fetchWorkdayJson(url, timeoutMs, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": "CV-Studio-Career-Ops/1.0 (+https://github.com/)",
        ...(init.headers || {})
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isWorkdayLocationSearch(text) {
  return isKnownMarketSearch(cleanText(text));
}

function matchesWorkdaySearch(job, source) {
  const searchText = cleanText(source.searchText);
  if (!searchText || !isWorkdayLocationSearch(searchText)) return true;
  return [
    job.title,
    job.location,
    job.description
  ].join("\n").toLowerCase().includes(searchText.toLowerCase());
}

function normalizeBambooJob(job, source, toolkit) {
  return toolkit.normalizeJob({
    source: sourceName(source) || "BambooHR",
    sourceType: "adapter:bamboohr",
    title: job.jobOpeningName || job.title || job.name,
    company: sourceName(source),
    url: job.jobOpeningUrl || job.url || job.applyUrl,
    location: job.location?.name || job.location || "",
    description: toolkit.stripHtml(job.description || job.jobOpeningDescription || ""),
    datePosted: job.datePosted || job.postedDate || "",
    employmentType: [job.employmentStatus, job.department?.label || job.department].filter(Boolean).join(" / ")
  });
}

function normalizeWorkdayJob(job, source, toolkit, baseUrl = "") {
  const info = job.jobPostingInfo || job;
  const description = [
    toolkit.stripHtml(info.jobDescription || info.description || ""),
    toolkit.stripHtml(info.qualifications || ""),
    toolkit.stripHtml(info.responsibilities || ""),
    info.timeType ? `Time type: ${info.timeType}` : "",
    info.jobReqId ? `Job requisition id: ${info.jobReqId}` : ""
  ].filter(Boolean).join("\n\n");
  const externalPath = info.externalPath || job.externalPath || "";
  const url = normalizeUrl(info.externalUrl || job.externalUrl || (externalPath && baseUrl ? `${baseUrl}${externalPath}` : ""));
  return toolkit.normalizeJob({
    source: sourceName(source) || "Workday",
    sourceType: "adapter:workday",
    title: info.title || job.title,
    company: sourceName(source),
    url,
    location: info.location || info.locationText || info.locationsText || job.locationsText || "",
    description,
    datePosted: info.startDate || info.postedOn || job.postedOn || "",
    employmentType: [info.timeType, info.jobFamilyGroup, info.jobFamily].filter(Boolean).join(" / ")
  });
}

function extractOracleInfo(source) {
  const url = normalizeUrl(source.url || source.apiUrl);
  const siteNumber = cleanText(source.siteNumber || source.site || source.board || source.slug || source.oracleSiteNumber);
  const language = cleanText(source.language || source.lang || "en");
  if (!url) return null;
  const parsed = new URL(url);
  const host = parsed.hostname;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const siteIndex = parts.indexOf("sites");
  const inferredSite = siteNumber || (siteIndex >= 0 ? parts[siteIndex + 1] || "" : "");
  if (!/(oraclecloud\.com|oraclecloudapps\.com)$/i.test(host) && source.adapter !== "oracle" && source.type !== "oracle") return null;
  if (!inferredSite && !source.apiUrl) return null;
  return { host, siteNumber: inferredSite, language };
}

function normalizeOracleJob(job, source, toolkit, baseUrl = "", siteNumber = "", language = "en") {
  const id = job.Id || job.id || job.RequisitionId || job.requisitionId || job.SearchId || job.searchId || job.JobId || job.jobId || "";
  const title = job.Title || job.title || job.RequisitionTitle || job.requisitionTitle || job.ExternalTitle || job.externalTitle || job.Name || job.name || "";
  const locationParts = [
    job.PrimaryLocation,
    job.primaryLocation,
    job.Location,
    job.location,
    job.WorkLocation,
    job.workLocation,
    Array.isArray(job.SecondaryLocations) ? job.SecondaryLocations.map((item) => item?.Name || item?.name || item).join(" / ") : "",
    Array.isArray(job.secondaryLocations) ? job.secondaryLocations.map((item) => item?.Name || item?.name || item).join(" / ") : ""
  ].filter(Boolean);
  const description = [
    toolkit.stripHtml(job.Description || job.description || job.ShortDescription || job.shortDescription || ""),
    toolkit.stripHtml(job.Qualifications || job.qualifications || ""),
    toolkit.stripHtml(job.Responsibilities || job.responsibilities || ""),
    job.JobFamily ? `Job family: ${job.JobFamily}` : "",
    job.jobFamily ? `Job family: ${job.jobFamily}` : "",
    job.RequisitionNumber ? `Requisition number: ${job.RequisitionNumber}` : "",
    job.requisitionNumber ? `Requisition number: ${job.requisitionNumber}` : ""
  ].filter(Boolean).join("\n\n");
  const url = normalizeUrl(
    job.ExternalApplyUrl ||
    job.externalApplyUrl ||
    job.Url ||
    job.url ||
    (id && baseUrl && siteNumber ? `${baseUrl}/hcmUI/CandidateExperience/${encodeURIComponent(language)}/sites/${encodeURIComponent(siteNumber)}/job/${encodeURIComponent(id)}` : "")
  );
  return toolkit.normalizeJob({
    source: sourceName(source) || "Oracle Recruiting",
    sourceType: "adapter:oracle",
    title,
    company: sourceName(source),
    url,
    location: [...new Set(locationParts.map((item) => cleanText(item)).filter(Boolean))].join(" / "),
    description,
    datePosted: job.PostedDate || job.postedDate || job.CreationDate || job.creationDate || "",
    employmentType: [job.JobSchedule, job.jobSchedule, job.JobType, job.jobType, job.Category, job.category].filter(Boolean).join(" / ")
  });
}

function hostMatches(url, pattern) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  return pattern.test(new URL(normalized).hostname);
}

function isSuccessFactorsUrl(url) {
  return hostMatches(url, /(successfactors\.com|jobs2web\.com)$/i);
}

function isTaleoUrl(url) {
  return hostMatches(url, /taleo\.net$/i);
}

function htmlJobsFromPage(html, source, toolkit, pageUrl, sourceType) {
  const jsonLdJobs = typeof toolkit.extractJsonLdJobs === "function"
    ? toolkit.extractJsonLdJobs(html).map((node) => toolkit.normalizeJobFromJsonLd(node, pageUrl, sourceName(source) || source.source || source.name))
    : [];
  if (jsonLdJobs.length) return jsonLdJobs;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) || [])[1] || "";
  return [toolkit.normalizeJob({
    source: sourceName(source) || source.source || source.name || "",
    sourceType,
    title: toolkit.stripHtml(title),
    company: sourceName(source),
    url: pageUrl,
    description: toolkit.stripHtml(description)
  })];
}

async function scrapeHtmlCareerAdapter(source, options, toolkit, adapterId, detailUrlPattern) {
  if (!toolkit.fetchText) throw new Error(`${adapterId} adapter needs fetchText in toolkit.`);
  const max = Math.max(1, Number(source.maxDiscovered ?? options.maxDiscovered ?? 40));
  const html = await toolkit.fetchText(source.url, options.timeoutMs);
  const pageJobs = htmlJobsFromPage(html, source, toolkit, source.url, `adapter:${adapterId}`);
  const isDetailPage = detailUrlPattern.test(source.url);
  if (isDetailPage && pageJobs.some((job) => job.title && job.title !== "未命名職缺")) return pageJobs;

  const links = typeof toolkit.discoverJobLinks === "function"
    ? toolkit.discoverJobLinks(html, source.url, max)
    : [];
  const detailLinks = links
    .filter((link) => detailUrlPattern.test(link.url))
    .slice(0, max);
  if (!detailLinks.length) return pageJobs.filter((job) => job.title && job.title !== "未命名職缺");

  const jobs = [];
  for (const link of detailLinks) {
    try {
      if (typeof toolkit.scrapeJobPage === "function") {
        jobs.push(...await toolkit.scrapeJobPage({ ...source, url: link.url, type: "job", source: sourceName(source) }, options, `adapter:${adapterId}`));
      } else {
        const detailHtml = await toolkit.fetchText(link.url, options.timeoutMs);
        jobs.push(...htmlJobsFromPage(detailHtml, source, toolkit, link.url, `adapter:${adapterId}`));
      }
    } catch {}
  }
  return jobs;
}

function normalizeAshbyJob(job, source, toolkit) {
  const secondaryLocations = Array.isArray(job.secondaryLocations)
    ? job.secondaryLocations.map((item) => item.location).filter(Boolean).join(" / ")
    : "";
  const compensation = job.compensation?.compensationTierSummary || job.compensation?.scrapeableCompensationSalarySummary || "";
  const description = [
    job.descriptionPlain || toolkit.stripHtml(job.descriptionHtml || ""),
    compensation ? `Compensation: ${compensation}` : ""
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Ashby",
    sourceType: "adapter:ashby",
    title: job.title,
    company: sourceName(source),
    url: job.jobUrl || job.applyUrl,
    location: [job.location, secondaryLocations].filter(Boolean).join(" / "),
    description,
    datePosted: job.publishedAt,
    employmentType: [job.employmentType, job.workplaceType, job.department || job.team].filter(Boolean).join(" / ")
  });
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => cleanText(header)) || [];
  return rows
    .filter((values) => values.some((value) => cleanText(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, cleanText(values[index])])));
}

function addSearchParams(url, params) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") parsed.searchParams.set(key, String(value));
  }
  return parsed.href;
}

function sourceMax(source, options, fallback, cap = Number.MAX_SAFE_INTEGER) {
  return Math.min(cap, Math.max(1, Number(source.maxDiscovered ?? options.maxDiscovered ?? fallback) || fallback));
}

function decodeUrlAttribute(value) {
  return cleanText(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function uniqueDetailLinks(html, baseUrl, pattern) {
  const seen = new Set();
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(decodeUrlAttribute(match[1]), baseUrl);
      url.hash = "";
      const href = url.href;
      if (!pattern.test(url.pathname) && !pattern.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      links.push(href);
    } catch {}
  }
  return links;
}

async function scrapeDetailLinks(links, source, options, toolkit, adapterId) {
  const jobs = [];
  for (const url of links) {
    try {
      if (typeof toolkit.scrapeJobPage === "function") {
        jobs.push(...await toolkit.scrapeJobPage({ ...source, url, type: "job", source: sourceName(source) }, options, `adapter:${adapterId}`));
      } else {
        const html = await toolkit.fetchText(url, options.timeoutMs);
        jobs.push(...htmlJobsFromPage(html, source, toolkit, url, `adapter:${adapterId}`));
      }
    } catch {}
  }
  return jobs;
}

function normalizeTaiwanJobsRow(row, source, toolkit) {
  const salary = [
    row.SALARYCD,
    row.NT_L && row.NT_U ? `${row.NT_L}-${row.NT_U}` : row.NT_L || row.NT_U
  ].filter(Boolean).join(" ");
  const description = [
    row.JOB_DETAIL,
    row.CJOB_NAME1 || row.CJOB_NAME2 ? `Category: ${[row.CJOB_NAME1, row.CJOB_NAME2].filter(Boolean).join(" / ")}` : "",
    row.JOB_PERSON ? `Openings: ${row.JOB_PERSON}` : "",
    row.EXPERIENCE ? `Experience: ${row.EXPERIENCE}` : "",
    row.WKTIME ? `Schedule: ${row.WKTIME}` : "",
    salary ? `Salary: ${salary}` : "",
    row.EDGRDESC ? `Education: ${row.EDGRDESC}` : ""
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "TaiwanJobs",
    sourceType: "adapter:taiwanjobs",
    title: row.OCCU_DESC,
    company: row.COMPNAME,
    url: row.URL_QUERY,
    location: row.CITYNAME,
    description,
    datePosted: row.TRANDATE,
    validThrough: row.STOP_DATE,
    employmentType: row.WK_TYPE
  });
}

function normalizeTencentJob(job, source, toolkit) {
  const description = [
    toolkit.stripHtml(job.Responsibility || job.responsibility || ""),
    toolkit.stripHtml(job.Requirement || job.requirement || ""),
    job.BGName ? `BG: ${job.BGName}` : "",
    job.ProductName ? `Product: ${job.ProductName}` : "",
    job.CategoryName ? `Category: ${job.CategoryName}` : "",
    job.RequireWorkYearsName ? `Experience: ${job.RequireWorkYearsName}` : ""
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Tencent Careers",
    sourceType: "adapter:tencent",
    title: job.RecruitPostName || job.PostName,
    company: sourceName(source) || "Tencent",
    url: job.PostURL || (job.PostId ? `https://careers.tencent.com/jobdesc.html?postId=${encodeURIComponent(job.PostId)}` : ""),
    location: [job.CountryName, job.LocationName].filter(Boolean).join(" / "),
    description,
    datePosted: job.LastUpdateTime,
    employmentType: [job.CategoryName, job.BGName, job.ProductName].filter(Boolean).join(" / ")
  });
}

function normalizeMyCareersFutureJob(job, source, toolkit) {
  const company = job.hiringCompany?.name || job.postedCompany?.name || "";
  const address = job.address || {};
  const districts = Array.isArray(address.districts)
    ? address.districts.map((item) => item.location || item.region).filter(Boolean).join(" / ")
    : "";
  const country = address.overseasCountry || (districts ? "Singapore" : "");
  const location = [
    address.building,
    address.street,
    districts,
    country
  ].filter(Boolean).join(", ");
  const description = [
    toolkit.stripHtml(job.description || ""),
    Array.isArray(job.skills) && job.skills.length ? `Skills: ${job.skills.map((item) => item.skill).filter(Boolean).join(", ")}` : "",
    Array.isArray(job.categories) && job.categories.length ? `Categories: ${job.categories.map((item) => item.category).filter(Boolean).join(", ")}` : "",
    job.numberOfVacancies ? `Vacancies: ${job.numberOfVacancies}` : "",
    job.minimumYearsExperience !== undefined && job.minimumYearsExperience !== null ? `Minimum experience: ${job.minimumYearsExperience} years` : ""
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "MyCareersFuture",
    sourceType: "adapter:mycareersfuture",
    title: job.title,
    company,
    url: job.uuid ? `https://www.mycareersfuture.gov.sg/job/${encodeURIComponent(job.uuid)}` : "",
    location,
    description,
    datePosted: job.metadata?.newPostingDate || job.metadata?.originalPostingDate || job.metadata?.createdAt,
    validThrough: job.metadata?.expiryDate,
    employmentType: Array.isArray(job.employmentTypes) ? job.employmentTypes.map((item) => item.employmentType).filter(Boolean).join(" / ") : ""
  });
}

function compactPlainDescription(value, toolkit, maxLength = 6000) {
  return toolkit.stripHtml(value || "").replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

function normalizeRemoteOkJob(job, source, toolkit) {
  const salary = [job.salary_min, job.salary_max].filter((item) => item !== undefined && item !== null && item !== "").join("-");
  const description = [
    compactPlainDescription(job.description, toolkit),
    Array.isArray(job.tags) && job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
    salary ? `Salary: ${salary}` : "",
    "Source attribution: Remote OK"
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Remote OK",
    sourceType: "adapter:remoteok",
    title: job.position,
    company: job.company,
    url: job.url || job.apply_url,
    location: job.location || "Remote / Global",
    description,
    datePosted: job.date,
    employmentType: Array.isArray(job.tags) ? job.tags.slice(0, 8).join(" / ") : "Remote"
  });
}

function normalizeRemotiveJob(job, source, toolkit) {
  const description = [
    compactPlainDescription(job.description, toolkit),
    Array.isArray(job.tags) && job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
    job.category ? `Category: ${job.category}` : "",
    job.salary ? `Salary: ${job.salary}` : "",
    "Source attribution: Remotive"
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Remotive",
    sourceType: "adapter:remotive",
    title: job.title,
    company: job.company_name,
    url: job.url,
    location: job.candidate_required_location || "Remote / Global",
    description,
    datePosted: job.publication_date,
    employmentType: [job.job_type, job.category].filter(Boolean).join(" / ")
  });
}

function normalizeArbeitnowJob(job, source, toolkit) {
  const description = [
    compactPlainDescription(job.description, toolkit),
    Array.isArray(job.tags) && job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
    Array.isArray(job.job_types) && job.job_types.length ? `Job types: ${job.job_types.join(", ")}` : "",
    job.remote ? "Remote-friendly listing" : ""
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Arbeitnow",
    sourceType: "adapter:arbeitnow",
    title: job.title,
    company: job.company_name,
    url: job.url,
    location: [job.location, job.remote ? "Remote" : ""].filter(Boolean).join(" / ") || "Global",
    description,
    datePosted: job.created_at ? new Date(Number(job.created_at) * 1000).toISOString() : "",
    employmentType: Array.isArray(job.job_types) ? job.job_types.join(" / ") : ""
  });
}

function normalizeTheMuseJob(job, source, toolkit) {
  const locations = Array.isArray(job.locations) ? job.locations.map((item) => item.name).filter(Boolean).join(" / ") : "";
  const categories = Array.isArray(job.categories) ? job.categories.map((item) => item.name).filter(Boolean).join(", ") : "";
  const levels = Array.isArray(job.levels) ? job.levels.map((item) => item.name).filter(Boolean).join(", ") : "";
  const description = [
    compactPlainDescription(job.contents, toolkit, 5000),
    categories ? `Categories: ${categories}` : "",
    levels ? `Levels: ${levels}` : "",
    "Source attribution: The Muse public jobs API"
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "The Muse",
    sourceType: "adapter:themuse",
    title: job.name,
    company: job.company?.name,
    url: job.refs?.landing_page,
    location: locations || "Global",
    description,
    datePosted: job.publication_date,
    employmentType: [job.type, categories, levels].filter(Boolean).join(" / ")
  });
}

function normalizeMeetJobsJob(job, source, toolkit) {
  const address = job.address || {};
  const place = address.place || {};
  const salary = job.salary
    ? [job.salary.currency, job.salary.minimum, job.salary.maximum, job.salary.paid_period].filter(Boolean).join(" ")
    : "";
  const skills = Array.isArray(job.required_skills) ? job.required_skills.map((item) => item.name || item).filter(Boolean).join(", ") : "";
  const slug = cleanText(job.slug);
  const description = [
    compactPlainDescription(job.description, toolkit),
    skills ? `Required skills: ${skills}` : "",
    salary ? `Salary: ${salary}` : "",
    job.plan_name ? `Plan: ${job.plan_name}` : "",
    "Source attribution: Meet.jobs public API"
  ].filter(Boolean).join("\n\n");
  return toolkit.normalizeJob({
    source: sourceName(source) || "Meet.jobs",
    sourceType: "adapter:meetjobs",
    title: job.title,
    company: job.employer?.name || job.external_employer_name,
    url: job.url || (job.id ? `https://meet.jobs/zh-TW/jobs/${encodeURIComponent(job.id)}${slug ? `-${encodeURIComponent(slug)}` : ""}` : ""),
    location: [place.country || address.handwriting_country, place.city || address.handwriting_city, address.handwriting_street].filter(Boolean).join(", ") || "Global",
    description,
    datePosted: job.published_at || job.updated_at,
    validThrough: job.deadline_at || "",
    employmentType: [job.work_type, job.contract_type].filter(Boolean).join(" / ")
  });
}

function normalizeJrecInDetail(html, source, toolkit, pageUrl, fallbackTitle = "") {
  const text = toolkit.stripHtml(html);
  const lines = text.split("\n").map((line) => cleanText(line)).filter(Boolean);
  const id = (pageUrl.match(/[?&]id=([^&]+)/i) || [])[1] || "";
  const idIndex = id ? lines.findIndex((line) => line === id) : -1;
  const title = idIndex > 0 ? lines[idIndex - 1] : fallbackTitle;
  const datePosted = (text.match(/更新日\s*:?\s*([0-9０-９]{4}年[0-9０-９]{1,2}月[0-9０-９]{1,2}日)/) || [])[1] || "";
  const validThrough = (text.match(/募集終了日\s*:?\s*([0-9０-９]{4}年[0-9０-９]{1,2}月[0-9０-９]{1,2}日)/) || [])[1] || "";
  const locationIndex = lines.findIndex((line) => line === "勤務地 :");
  const location = locationIndex >= 0 ? lines[locationIndex + 1] || "" : "";
  const company = idIndex >= 0
    ? lines.slice(idIndex + 1, idIndex + 8).find((line) => !/^https?:\/\//i.test(line) && !/^(国立大学|公立大学|私立大学|研究開発法人|民間企業|その他機関)$/.test(line)) || ""
    : "";
  const contentStart = lines.findIndex((line) => line === "業務内容");
  const description = (contentStart >= 0 ? lines.slice(contentStart, contentStart + 140) : lines.slice(0, 180)).join("\n");
  const jobKindIndex = lines.findIndex((line) => line === "職種");
  const employmentType = jobKindIndex >= 0 ? lines.slice(jobKindIndex + 1, jobKindIndex + 8).join(" / ") : "";
  return toolkit.normalizeJob({
    source: sourceName(source) || "JREC-IN",
    sourceType: "adapter:jrecin",
    title,
    company,
    url: pageUrl,
    location,
    description,
    datePosted,
    validThrough,
    employmentType
  });
}

function pagedUrl(source, page) {
  const url = normalizeUrl(source.url);
  const parsed = new URL(url);
  parsed.searchParams.set("page", String(page));
  return parsed.href;
}

function attributeValue(tag, name) {
  const escaped = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag || "").match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, "i"));
  return decodeXmlText(match?.[1] || "");
}

function yearMonthDayFromTaiwanListDate(value) {
  const match = String(value || "").match(/([0-9]{1,2})\s*\/\s*([0-9]{1,2})/);
  if (!match) return "";
  const now = new Date();
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!month || !day) return "";
  return `${now.getFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function fetch1111Html(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,*/*;q=0.8",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 CV-Studio-Career-Ops/1.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPublicApiJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "accept-language": "en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 CV-Studio-Career-Ops/1.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function extract1111Cards(html, pageUrl, source, toolkit) {
  const text = String(html || "");
  const starts = [...text.matchAll(/<div\b[^>]*class=["'][^"']*\bjob-card\b[^"']*["'][^>]*\bdata-purpose=["'](\d+)["'][^>]*>/gi)]
    .map((match) => ({ index: match.index || 0, id: match[1] }));
  const jobs = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1]?.index || text.indexOf("<!--]-->", start.index + 1);
    const segment = text.slice(start.index, end > start.index ? end : start.index + 16000);
    const jobAnchor = segment.match(/<a\b[^>]*href=["']([^"']*\/job\/\d+[^"']*)["'][^>]*>/i);
    const parsedJobUrl = new URL(jobAnchor?.[1] ? decodeUrlAttribute(jobAnchor[1]) : `/job/${start.id}`, pageUrl);
    parsedJobUrl.search = "";
    const jobUrl = normalizeUrl(parsedJobUrl.href);
    if (!jobUrl) continue;
    const title = attributeValue(jobAnchor?.[0] || "", "title") || toolkit.stripHtml(jobAnchor?.[0] || "");
    const companyAnchor = segment.match(/<a\b[^>]*href=["'][^"']*\/corp\/[^"']*["'][^>]*>/i);
    const company = attributeValue(companyAnchor?.[0] || "", "title") || "";
    const conditions = [...segment.matchAll(/<(?:a|h4)\b[^>]*class=["'][^"']*job-card-condition__text[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|h4)>/gi)]
      .map((match) => toolkit.stripHtml(match[1]).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const paragraphs = [...segment.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => toolkit.stripHtml(match[1]).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const summary = toolkit.stripHtml((segment.match(/<div\b[^>]*class=["'][^"']*job-summary[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "");
    const location = conditions.find((item) => /(?:台北|新北|基隆|桃園|新竹|苗栗|台中|彰化|南投|雲林|嘉義|台南|高雄|屏東|宜蘭|花蓮|台東|澎湖|金門|連江|台灣)/.test(item)) || "台灣";
    const descriptionParts = [
      paragraphs[0] || "",
      conditions.length ? `條件：${conditions.join(" / ")}` : "",
      summary ? `更新與應徵摘要：${summary}` : "",
      `此職缺由 1111 人力銀行公開搜尋頁匯入，保留原始職缺 URL 供後續查看、去重與排序。`
    ].filter(Boolean);
    jobs.push(toolkit.normalizeJob({
      source: sourceName(source) || "1111",
      sourceType: "adapter:1111",
      title,
      company,
      url: jobUrl,
      location,
      description: descriptionParts.join("\n\n"),
      datePosted: yearMonthDayFromTaiwanListDate(summary || segment),
      employmentType: conditions.slice(1).join(" / ")
    }));
  }
  return jobs;
}

function decodeXmlText(value) {
  return cleanText(value)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function parseSitemapEntries(xml) {
  const text = String(xml || "");
  const blocks = [...text.matchAll(/<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  if (!blocks.length) {
    return [...text.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
      .map((match) => ({ loc: decodeXmlText(match[1]), lastmod: "" }))
      .filter((entry) => entry.loc);
  }
  return blocks
    .map((match) => {
      const body = match[2] || "";
      return {
        loc: decodeXmlText((body.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1] || ""),
        lastmod: decodeXmlText((body.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1] || ""),
        kind: match[1].toLowerCase()
      };
    })
    .filter((entry) => entry.loc);
}

function compileOptionalRegex(pattern) {
  const text = cleanText(pattern);
  if (!text) return null;
  try {
    return new RegExp(text, "i");
  } catch {
    return null;
  }
}

function defaultSitemapJobPattern(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return /(\/job|jobinfo-|JobSearchDetail|\/search\/NJB|\/zhaopin\/)/i;
  const host = new URL(normalized).hostname.toLowerCase();
  if (host.includes("tenshoku.mynavi.jp")) return /\/jobinfo-\d+/i;
  if (host.includes("doda.jp")) return /\/DodaFront\/View\/JobSearchDetail\//i;
  if (host.includes("jac-recruitment.jp")) return /\/search\/NJB\d+\/?$/i;
  if (host.includes("zhaopin.com")) return /\/zhaopin\/[a-f0-9]{12,}\//i;
  if (host.includes("yolo-japan.com")) return /\/recruit\/job\//i;
  return /(\/job|\/jobs|jobinfo-|JobSearchDetail|\/search\/NJB|\/zhaopin\/)/i;
}

function looksLikeSitemapUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  const parsed = new URL(normalized);
  return /\.(xml|xml\.gz)$/i.test(parsed.pathname) || /sitemap/i.test(parsed.pathname);
}

function canonicalSitemapJobUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";
  const parsed = new URL(normalized);
  parsed.hash = "";
  if (/doda\.jp$/i.test(parsed.hostname)) {
    const match = parsed.pathname.match(/^(\/DodaFront\/View\/JobSearchDetail\/j_jid__\d+\/)/i);
    if (match) {
      parsed.pathname = match[1];
      parsed.search = "";
    }
  }
  return parsed.href;
}

async function fetchSitemapText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/xml,text/xml,application/x-gzip,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7,ja;q=0.6",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CV-Studio-Career-Ops/1.0"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let buffer = Buffer.from(await response.arrayBuffer());
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer);
    return buffer.toString("utf8").replace(/^\uFEFF/, "");
  } finally {
    clearTimeout(timer);
  }
}

async function collectSitemapJobEntries(source, options) {
  const max = sourceMax(source, options, 5000, 100000);
  const maxSitemapFiles = Math.max(1, Number(source.maxSitemapFiles ?? 30) || 30);
  const jobPattern = compileOptionalRegex(source.jobUrlPattern) || defaultSitemapJobPattern(source.url);
  const sitemapFilePattern = compileOptionalRegex(source.sitemapFilePattern);
  const queue = [normalizeUrl(source.url)].filter(Boolean);
  const seenSitemaps = new Set();
  const seenJobs = new Set();
  const jobs = [];

  while (queue.length && seenSitemaps.size < maxSitemapFiles && jobs.length < max) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const xml = await fetchSitemapText(sitemapUrl, options.timeoutMs);
    const entries = parseSitemapEntries(xml);
    for (const entry of entries) {
      const loc = normalizeUrl(entry.loc);
      if (!loc) continue;
      if (entry.kind === "sitemap" || looksLikeSitemapUrl(loc)) {
        if ((!sitemapFilePattern || sitemapFilePattern.test(loc)) && !seenSitemaps.has(loc)) queue.push(loc);
        continue;
      }
      if (!jobPattern.test(loc)) continue;
      const url = canonicalSitemapJobUrl(loc);
      if (!url || seenJobs.has(url)) continue;
      seenJobs.add(url);
      jobs.push({ ...entry, loc: url });
      if (jobs.length >= max) break;
    }
  }

  return jobs;
}

function sitemapTitleFromUrl(url, source) {
  const parsed = new URL(url);
  const text = decodeURIComponent(parsed.pathname);
  const sourceLabel = sourceName(source) || parsed.hostname;
  const dodaId = (text.match(/j_jid__(\d+)/i) || [])[1] || "";
  if (dodaId) return `${sourceLabel} opening ${dodaId}`;
  const mynaviId = (text.match(/jobinfo-(\d+)/i) || [])[1] || "";
  if (mynaviId) return `${sourceLabel} opening ${mynaviId}`;
  const jacId = (text.match(/\/search\/([^/]+)\/?$/i) || [])[1] || "";
  if (jacId) return `${sourceLabel} opening ${jacId}`;
  const zhaopinId = (text.match(/\/zhaopin\/([^/]+)\/?$/i) || [])[1] || "";
  if (zhaopinId) return `${sourceLabel} opening ${zhaopinId.slice(0, 12)}`;
  const slug = text.split("/").filter(Boolean).pop() || parsed.hostname;
  return `${sourceLabel} opening ${slug.replace(/[-_]+/g, " ").slice(0, 80)}`;
}

function defaultMarketLocation(market) {
  return ({
    tw: "Taiwan",
    cn: "China",
    sg: "Singapore",
    jp: "Japan",
    us: "United States",
    ca: "Canada",
    uk: "United Kingdom"
  })[String(market || "").toLowerCase()] || String(market || "Global").toUpperCase();
}

function normalizeSitemapJob(entry, source, toolkit) {
  const marketLocation = defaultMarketLocation(source.market);
  const label = sourceName(source) || "Public sitemap";
  const description = [
    `Public sitemap job-detail record from ${label}.`,
    `This URL-level posting was imported from an XML sitemap to broaden market coverage for ${marketLocation}.`,
    "It preserves the canonical live posting URL for downstream ranking, dedupe, and follow-up detail scraping while remaining transparent that company and full job-description fields may need enrichment from the source page.",
    entry.lastmod ? `Sitemap last modified: ${entry.lastmod}.` : ""
  ].filter(Boolean).join(" ");
  return toolkit.normalizeJob({
    source: label,
    sourceType: "adapter:sitemap",
    title: sitemapTitleFromUrl(entry.loc, source),
    company: label,
    url: entry.loc,
    location: marketLocation,
    description,
    datePosted: entry.lastmod,
    employmentType: "Public sitemap listing"
  });
}

export const SOURCE_ADAPTERS = [
  {
    id: "sitemap",
    match(source) {
      return source.adapter === "sitemap" || /sitemap/i.test(source.url || "");
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 5000, 100000);
      const detailLimit = Math.min(max, Math.max(0, Number(source.detailLimit ?? 0) || 0));
      const entries = await collectSitemapJobEntries(source, options);
      if (!detailLimit) return entries.slice(0, max).map((entry) => normalizeSitemapJob(entry, source, toolkit));
      const jobs = [];
      for (const entry of entries.slice(0, max)) {
        if (jobs.length < detailLimit) {
          try {
            const scraped = await toolkit.scrapeJobPage({ ...source, url: entry.loc, type: "job", source: sourceName(source) }, options, "adapter:sitemap-detail");
            if (scraped.length) {
              jobs.push(...scraped);
              continue;
            }
          } catch {}
        }
        jobs.push(normalizeSitemapJob(entry, source, toolkit));
      }
      return jobs;
    }
  },
  {
    id: "taiwanjobs",
    match(source) {
      return source.adapter === "taiwanjobs" || hostMatches(source.url || source.apiUrl, /(^|\.)taiwanjobs\.gov\.tw$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 1000, 1000);
      const apiUrl = addSearchParams(source.apiUrl || source.url || "https://free.taiwanjobs.gov.tw/WebService_Taipei/Webservice.ashx", {
        count: max,
        T: "CSV"
      });
      const csv = await toolkit.fetchText(apiUrl, options.timeoutMs);
      return parseCsvRows(csv).slice(0, max).map((row) => normalizeTaiwanJobsRow(row, source, toolkit));
    }
  },
  {
    id: "tencent",
    match(source) {
      return source.adapter === "tencent" || hostMatches(source.url || source.apiUrl, /(^|\.)careers\.tencent\.com$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 1200, 3000);
      const pageSize = Math.min(100, max);
      const rows = [];
      const apiUrl = source.apiUrl || "https://careers.tencent.com/tencentcareer/api/post/Query";
      const query = cleanText(source.searchText || source.keyword);
      for (let pageIndex = 1; rows.length < max; pageIndex += 1) {
        const url = addSearchParams(apiUrl, {
          timestamp: Date.now(),
          keyword: query,
          pageIndex,
          pageSize,
          language: source.language || "zh-cn",
          area: source.area || "cn"
        });
        const payload = await toolkit.fetchJson(url, options.timeoutMs);
        const posts = Array.isArray(payload?.Data?.Posts) ? payload.Data.Posts : [];
        rows.push(...posts);
        const total = Number(payload?.Data?.Count || 0);
        if (!posts.length || posts.length < pageSize || (total && rows.length >= total)) break;
      }
      return rows.slice(0, max).map((job) => normalizeTencentJob(job, source, toolkit));
    }
  },
  {
    id: "mycareersfuture",
    match(source) {
      return source.adapter === "mycareersfuture" || hostMatches(source.url || source.apiUrl, /(^|\.)mycareersfuture\.gov\.sg$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 200, 1000);
      const limit = Math.min(50, max);
      const rows = [];
      const baseUrl = source.apiUrl || "https://api.mycareersfuture.gov.sg/v2/jobs";
      const search = cleanText(source.searchText || source.keyword || (source.url ? new URL(source.url).searchParams.get("search") : ""));
      for (let page = 0; rows.length < max; page += 1) {
        const url = addSearchParams(baseUrl, { limit, page, search });
        const payload = await toolkit.fetchJson(url, options.timeoutMs);
        const results = Array.isArray(payload?.results) ? payload.results : [];
        rows.push(...results);
        const total = Number(payload?.total || 0);
        if (!results.length || results.length < limit || (total && rows.length >= total)) break;
      }
      return rows.slice(0, max).map((job) => normalizeMyCareersFutureJob(job, source, toolkit));
    }
  },
  {
    id: "remoteok",
    match(source) {
      return source.adapter === "remoteok" || hostMatches(source.url || source.apiUrl, /(^|\.)remoteok\.com$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 1000, 5000);
      const payload = await toolkit.fetchJson(source.apiUrl || source.url || "https://remoteok.com/api", options.timeoutMs);
      const rows = Array.isArray(payload) ? payload.filter((job) => job?.position && job?.url) : [];
      return rows.slice(0, max).map((job) => normalizeRemoteOkJob(job, source, toolkit));
    }
  },
  {
    id: "remotive",
    match(source) {
      return source.adapter === "remotive" || hostMatches(source.url || source.apiUrl, /(^|\.)remotive\.com$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 1000, 5000);
      const payload = await toolkit.fetchJson(source.apiUrl || source.url || "https://remotive.com/api/remote-jobs", options.timeoutMs);
      const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
      return rows.slice(0, max).map((job) => normalizeRemotiveJob(job, source, toolkit));
    }
  },
  {
    id: "arbeitnow",
    match(source) {
      return source.adapter === "arbeitnow" || hostMatches(source.url || source.apiUrl, /(^|\.)arbeitnow\.com$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 2000, 10000);
      let url = source.apiUrl || source.url || "https://www.arbeitnow.com/api/job-board-api";
      const first = new URL(url);
      first.searchParams.set("limit", String(Math.min(100, max)));
      url = first.href;
      const rows = [];
      const seenPages = new Set();
      while (url && rows.length < max && !seenPages.has(url)) {
        seenPages.add(url);
        let payload;
        try {
          payload = await fetchPublicApiJson(url, options.timeoutMs);
        } catch (error) {
          if (rows.length) break;
          throw error;
        }
        const pageRows = Array.isArray(payload?.data) ? payload.data : [];
        rows.push(...pageRows);
        url = payload?.links?.next || "";
        if (!pageRows.length) break;
      }
      return rows.slice(0, max).map((job) => normalizeArbeitnowJob(job, source, toolkit));
    }
  },
  {
    id: "themuse",
    match(source) {
      return source.adapter === "themuse" || hostMatches(source.url || source.apiUrl, /(^|\.)themuse\.com$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 12000, 50000);
      const rows = [];
      const baseUrl = source.apiUrl || source.url || "https://www.themuse.com/api/public/jobs?page=1";
      for (let page = 1; rows.length < max; page += 1) {
        const parsed = new URL(baseUrl);
        parsed.searchParams.set("page", String(page));
        let payload;
        try {
          payload = await fetchPublicApiJson(parsed.href, options.timeoutMs);
        } catch (error) {
          if (rows.length) break;
          throw error;
        }
        const pageRows = Array.isArray(payload?.results) ? payload.results : [];
        rows.push(...pageRows);
        if (!pageRows.length || page >= Number(payload?.page_count || page)) break;
      }
      return rows.slice(0, max).map((job) => normalizeTheMuseJob(job, source, toolkit));
    }
  },
  {
    id: "meetjobs",
    match(source) {
      return source.adapter === "meetjobs" || hostMatches(source.url || source.apiUrl, /(^|\.)meet\.jobs$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 100, 1000);
      const rows = [];
      const baseUrl = source.apiUrl || source.url || "https://api.meet.jobs/api/v1/jobs";
      for (let page = 1; rows.length < max; page += 1) {
        const parsed = new URL(baseUrl);
        parsed.searchParams.set("page", String(page));
        const payload = await toolkit.fetchJson(parsed.href, options.timeoutMs);
        const pageRows = Array.isArray(payload?.collection) ? payload.collection : [];
        rows.push(...pageRows);
        const totalPages = Number(payload?.paginator?.total_pages || page);
        if (!pageRows.length || page >= totalPages) break;
      }
      return rows.slice(0, max).map((job) => normalizeMeetJobsJob(job, source, toolkit));
    }
  },
  {
    id: "japan-dev",
    match(source) {
      return source.adapter === "japan-dev" || hostMatches(source.url, /(^|\.)japan-dev\.com$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 120, 400);
      const html = await toolkit.fetchText(source.url, options.timeoutMs);
      const links = uniqueDetailLinks(html, source.url, /\/jobs\/[^/?#]+\/[^/?#]+/i).slice(0, max);
      return scrapeDetailLinks(links, source, options, toolkit, "japan-dev");
    }
  },
  {
    id: "jrecin",
    match(source) {
      return source.adapter === "jrecin" || hostMatches(source.url, /(^|\.)jrecin\.jst\.go\.jp$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 320, 1000);
      const links = [];
      const titles = new Map();
      const seen = new Set();
      for (let page = 1; links.length < max; page += 1) {
        const url = addSearchParams(source.url || "https://jrecin.jst.go.jp/seek/SeekJorSearch?fn=0", {
          page,
          dispcount: 50
        });
        const html = await toolkit.fetchText(url, options.timeoutMs);
        const pageLinks = uniqueDetailLinks(html, url, /\/seek\/SeekJorDetail/i);
        if (!pageLinks.length) break;
        for (const match of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*SeekJorDetail[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
          try {
            const detailUrl = new URL(decodeUrlAttribute(match[1]), url).href;
            titles.set(detailUrl, toolkit.stripHtml(match[2]).replace(/\s+/g, " ").trim());
          } catch {}
        }
        let added = 0;
        for (const link of pageLinks) {
          if (seen.has(link)) continue;
          seen.add(link);
          links.push(link);
          added += 1;
          if (links.length >= max) break;
        }
        if (added === 0) break;
      }
      const jobs = [];
      for (const link of links.slice(0, max)) {
        try {
          const html = await toolkit.fetchText(link, options.timeoutMs);
          jobs.push(normalizeJrecInDetail(html, source, toolkit, link, titles.get(link) || ""));
        } catch {}
      }
      return jobs;
    }
  },
  {
    id: "daijob",
    match(source) {
      return source.adapter === "daijob" || hostMatches(source.url, /(^|\.)daijob\.com$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 500, 800);
      const links = [];
      const seen = new Set();
      const pageCount = Math.ceil(max / 20) + 2;
      for (let page = 1; page <= pageCount && links.length < max; page += 1) {
        const url = pagedUrl(source, page);
        const html = await toolkit.fetchText(url, options.timeoutMs);
        const pageLinks = uniqueDetailLinks(html, url, /\/jobs\/detail\/\d+/i);
        let added = 0;
        for (const link of pageLinks) {
          if (seen.has(link)) continue;
          seen.add(link);
          links.push(link);
          added += 1;
          if (links.length >= max) break;
        }
        if (!pageLinks.length || added === 0) break;
      }
      return scrapeDetailLinks(links.slice(0, max), source, options, toolkit, "daijob");
    }
  },
  {
    id: "boss-zhipin",
    match(source) {
      return source.adapter === "boss-zhipin" || hostMatches(source.url, /(^|\.)zhipin\.com$/i);
    },
    async scrape(source, options, toolkit) {
      return scrapeHtmlCareerAdapter(source, options, toolkit, "boss-zhipin", /(\/job_detail\/|\/gongsi\/job\/)/i);
    }
  },
  {
    id: "58",
    match(source) {
      return source.adapter === "58" || hostMatches(source.url, /(^|\.)58\.com$/i);
    },
    async scrape(source, options, toolkit) {
      return scrapeHtmlCareerAdapter(source, options, toolkit, "58", /(\/zhaopin\/|\/job\/|\.shtml)/i);
    }
  },
  {
    id: "1111",
    match(source) {
      return source.adapter === "1111" || hostMatches(source.url, /(^|\.)1111\.com\.tw$/i);
    },
    async scrape(source, options, toolkit) {
      const max = sourceMax(source, options, 800, 10000);
      const seen = new Set();
      const jobs = [];
      const baseUrl = normalizeUrl(source.url || "https://www.1111.com.tw/search/job?page=1");
      const keyword = cleanText(source.keyword || "");
      if (!baseUrl) throw new Error("1111 source needs a public search URL.");
      const startPage = Number(new URL(baseUrl).searchParams.get("page") || 1) || 1;
      const pageCap = startPage + Math.ceil(max / 10) + 8;
      for (let page = startPage; page < pageCap && jobs.length < max; page += 1) {
        const parsed = new URL(baseUrl);
        parsed.searchParams.set("page", String(page));
        if (keyword) parsed.searchParams.set("ks", keyword);
        const pageUrl = parsed.href;
        const html = await fetch1111Html(pageUrl, options.timeoutMs);
        const pageJobs = extract1111Cards(html, pageUrl, source, toolkit);
        if (!pageJobs.length) break;
        let added = 0;
        for (const job of pageJobs) {
          const key = normalizeUrl(job.url).toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          jobs.push(job);
          added += 1;
          if (jobs.length >= max) break;
        }
        if (added === 0) break;
      }
      return jobs;
    }
  },
  {
    id: "greenhouse",
    match(source) {
      if (source.adapter === "greenhouse" || source.type === "greenhouse") return true;
      return Boolean(extractGreenhouseToken(source));
    },
    async scrape(source, options, toolkit) {
      const token = extractGreenhouseToken(source);
      if (!token && !source.apiUrl) throw new Error("Greenhouse source needs a board token or board URL.");
      const apiUrl = source.apiUrl || `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
      const payload = await toolkit.fetchJson(apiUrl, options.timeoutMs);
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      return jobs.map((job) => normalizeGreenhouseJob(job, source, toolkit));
    }
  },
  {
    id: "lever",
    match(source) {
      if (source.adapter === "lever" || source.type === "lever") return true;
      return Boolean(extractLeverSite(source));
    },
    async scrape(source, options, toolkit) {
      const site = extractLeverSite(source);
      if (!site && !source.apiUrl) throw new Error("Lever source needs a site name or jobs URL.");
      const max = Math.max(1, Number(source.maxDiscovered ?? options.maxDiscovered ?? 100));
      const parsed = source.url ? new URL(source.url) : null;
      const apiHost = source.region === "eu" || parsed?.hostname.includes(".eu.") ? "https://api.eu.lever.co" : "https://api.lever.co";
      const apiUrl = source.apiUrl || `${apiHost}/v0/postings/${encodeURIComponent(site)}?mode=json&limit=${max}`;
      const payload = await toolkit.fetchJson(apiUrl, options.timeoutMs);
      const jobs = Array.isArray(payload) ? payload : [];
      return jobs.map((job) => normalizeLeverJob(job, source, toolkit));
    }
  },
  {
    id: "ashby",
    match(source) {
      if (source.adapter === "ashby" || source.type === "ashby") return true;
      return Boolean(extractAshbyBoard(source));
    },
    async scrape(source, options, toolkit) {
      const board = extractAshbyBoard(source);
      if (!board && !source.apiUrl) throw new Error("Ashby source needs a board name or jobs URL.");
      const apiUrl = source.apiUrl || `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
      const payload = await toolkit.fetchJson(apiUrl, options.timeoutMs);
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      return jobs.map((job) => normalizeAshbyJob(job, source, toolkit));
    }
  },
  {
    id: "workable",
    match(source) {
      if (source.adapter === "workable" || source.type === "workable") return true;
      return Boolean(extractWorkableAccount(source));
    },
    async scrape(source, options, toolkit) {
      const account = extractWorkableAccount(source);
      if (!account && !source.apiUrl) throw new Error("Workable source needs an account subdomain or API URL.");
      const apiUrl = source.apiUrl || `https://www.workable.com/api/accounts/${encodeURIComponent(account)}?details=true`;
      const payload = await toolkit.fetchJson(apiUrl, options.timeoutMs);
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : Array.isArray(payload) ? payload : [];
      return jobs.map((job) => normalizeWorkableJob(job, source, toolkit));
    }
  },
  {
    id: "smartrecruiters",
    match(source) {
      if (source.adapter === "smartrecruiters" || source.type === "smartrecruiters") return true;
      return Boolean(extractSmartRecruitersCompany(source));
    },
    async scrape(source, options, toolkit) {
      const company = extractSmartRecruitersCompany(source);
      if (!company && !source.apiUrl) throw new Error("SmartRecruiters source needs a company identifier or API URL.");
      const max = Math.min(100, Math.max(1, Number(source.maxDiscovered ?? options.maxDiscovered ?? 100)));
      const apiUrl = source.apiUrl || `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?destination=PUBLIC&limit=${max}`;
      const payload = await toolkit.fetchJson(apiUrl, options.timeoutMs);
      const jobs = Array.isArray(payload.content) ? payload.content : Array.isArray(payload) ? payload : [];
      return jobs.map((job) => normalizeSmartRecruitersJob(job, source, toolkit));
    }
  },
  {
    id: "workday",
    match(source) {
      if (source.adapter === "workday" || source.type === "workday") return true;
      return Boolean(extractWorkdayInfo(source));
    },
    async scrape(source, options, toolkit) {
      const info = extractWorkdayInfo(source);
      if (!info) throw new Error("Workday source needs a myworkdayjobs/myworkdaysite URL or tenant/site.");
      const host = info.host || new URL(source.url).hostname;
      const baseUrl = `https://${host}`;
      const max = Math.min(100, Math.max(1, Number(source.maxDiscovered ?? options.maxDiscovered ?? 50)));
      const apiBase = `https://${host}/wday/cxs/${encodeURIComponent(info.tenant)}/${encodeURIComponent(info.site)}`;
      const rows = [];
      for (let offset = 0; offset < max; offset += 20) {
        const payload = await fetchWorkdayJson(`${apiBase}/jobs`, options.timeoutMs, {
          method: "POST",
          body: JSON.stringify({
            appliedFacets: source.appliedFacets && typeof source.appliedFacets === "object" ? source.appliedFacets : {},
            limit: Math.min(20, max - offset),
            offset,
            searchText: source.searchText || ""
          })
        });
        const pageRows = Array.isArray(payload.jobPostings) ? payload.jobPostings : Array.isArray(payload.jobs) ? payload.jobs : [];
        rows.push(...pageRows);
        if (!pageRows.length || pageRows.length < 20) break;
      }
      const detailLimit = Math.min(rows.length, max, Math.max(0, Number(source.detailLimit ?? 20) || 20));
      const jobs = [];
      for (const row of rows.slice(0, detailLimit)) {
        const externalPath = row.externalPath || "";
        if (!externalPath) {
          jobs.push(normalizeWorkdayJob(row, source, toolkit, baseUrl));
          continue;
        }
        try {
          const detail = await fetchWorkdayJson(`${apiBase}${externalPath}`, options.timeoutMs, { method: "GET" });
          jobs.push(normalizeWorkdayJob(detail, source, toolkit, baseUrl));
        } catch {
          jobs.push(normalizeWorkdayJob(row, source, toolkit, baseUrl));
        }
      }
      for (const row of rows.slice(detailLimit, max)) {
        jobs.push(normalizeWorkdayJob(row, source, toolkit, baseUrl));
      }
      return jobs.filter((job) => matchesWorkdaySearch(job, source));
    }
  },
  {
    id: "oracle",
    match(source) {
      if (source.adapter === "oracle" || source.type === "oracle") return true;
      return Boolean(extractOracleInfo(source));
    },
    async scrape(source, options, toolkit) {
      const info = extractOracleInfo(source);
      if (!info && !source.apiUrl) throw new Error("Oracle source needs an oraclecloud Candidate Experience URL plus siteNumber.");
      const baseUrl = info?.host ? `https://${info.host}` : new URL(source.apiUrl).origin;
      const siteNumber = info?.siteNumber || cleanText(source.siteNumber || source.site || source.board || source.slug);
      const max = Math.min(100, Math.max(1, Number(source.maxDiscovered ?? options.maxDiscovered ?? 50)));
      const query = cleanText(source.searchText || source.keyword || "");
      const apiUrl = source.apiUrl || `${baseUrl}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
      const params = new URLSearchParams({
        onlyData: "true",
        limit: String(max),
        offset: "0",
        expand: "requisitionList.secondaryLocations"
      });
      if (siteNumber) params.set("finder", `findReqs;siteNumber=${siteNumber}${query ? `,keyword=${query}` : ""}`);
      const payload = await toolkit.fetchJson(`${apiUrl}?${params.toString()}`, options.timeoutMs);
      const rawItems = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.requisitionList) ? payload.requisitionList : Array.isArray(payload) ? payload : [];
      const jobs = rawItems.flatMap((item) => {
        if (Array.isArray(item.requisitionList)) return item.requisitionList;
        if (Array.isArray(item.items)) return item.items;
        return [item];
      });
      return jobs.map((job) => normalizeOracleJob(job, source, toolkit, baseUrl, siteNumber, info?.language || "en"));
    }
  },
  {
    id: "successfactors",
    match(source) {
      if (source.adapter === "successfactors" || source.type === "successfactors") return true;
      return isSuccessFactorsUrl(source.url);
    },
    async scrape(source, options, toolkit) {
      if (!normalizeUrl(source.url) && !source.apiUrl) throw new Error("SuccessFactors source needs a public careers URL or API URL.");
      return scrapeHtmlCareerAdapter(source, options, toolkit, "successfactors", /(\/job\/|\/jobs\/|jobId=|jobid=|jobReqId=|jobreqid=|job-detail|jobdetail|\/careersection\/)/i);
    }
  },
  {
    id: "taleo",
    match(source) {
      if (source.adapter === "taleo" || source.type === "taleo") return true;
      return isTaleoUrl(source.url);
    },
    async scrape(source, options, toolkit) {
      if (!isTaleoUrl(source.url)) throw new Error("Taleo source needs a taleo.net careersection URL.");
      return scrapeHtmlCareerAdapter(source, options, toolkit, "taleo", /(jobdetail\.ftl|\/jobdetail\/|jobId=|job=)/i);
    }
  },
  {
    id: "bamboohr",
    match(source) {
      if (source.adapter === "bamboohr" || source.type === "bamboohr") return true;
      return Boolean(extractBambooSubdomain(source));
    },
    async scrape(source, options, toolkit) {
      const subdomain = extractBambooSubdomain(source);
      if (!subdomain && !source.apiUrl) throw new Error("BambooHR source needs a subdomain or API URL.");
      const apiUrl = source.apiUrl || `https://${encodeURIComponent(subdomain)}.bamboohr.com/careers/list`;
      const payload = await toolkit.fetchJson(apiUrl, options.timeoutMs);
      const jobs = Array.isArray(payload.result) ? payload.result : Array.isArray(payload.jobs) ? payload.jobs : Array.isArray(payload) ? payload : [];
      return jobs.map((job) => normalizeBambooJob(job, source, toolkit));
    }
  }
];

export function resolveSourceAdapter(source) {
  if ((source.type === "job" || source.type === "job-page") && !source.adapter) return null;
  const requested = cleanText(source.adapter || "").toLowerCase();
  if (requested) return SOURCE_ADAPTERS.find((adapter) => adapter.id === requested) || null;
  return SOURCE_ADAPTERS.find((adapter) => adapter.match(source)) || null;
}
