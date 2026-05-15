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
  return /^(taiwan|china|japan|korea|singapore|taipei|hsinchu|taichung|tainan|kaohsiung|shanghai|beijing|shenzhen|hangzhou|seoul|tokyo)$/i
    .test(cleanText(text));
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

export const SOURCE_ADAPTERS = [
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
