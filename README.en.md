# CV Studio

> A PWA workspace for resumes, learning portfolios, Career Advisor analysis, and GSAT placement planning

[繁體中文版](README.md)

---

## Features

- **Google Sign-In** — Secure OAuth via Supabase; CV data is automatically tied to your account
- **28 Templates** — Academic, business, engineering, creative, GitHub-inspired print, and ATS-friendly resume styles
- **Live Preview** — Type on the left, see results on the right instantly
- **WYSIWYG Editing** — Click any field directly in the preview pane to edit (no need to switch back to the form)
- **Cloud Storage** — One-click save and load for authenticated users
- **CV Versions + Application Tracking** — Save role-specific CV versions and track company, role, status, date, link, and notes
- **Bilingual Content Mapping** — Maintain Chinese / English values for detailed resume fields, not just section headings
- **Public Share SEO / OG** — Share pages update SEO metadata and generate Open Graph preview images
- **PDF Export** — Export your CV with full template styling preserved
- **Portfolio / Learning Experience** — A dedicated tab for chapter-based portfolios, asset uploads, attachments, and PDF export
- **Career Advisor + Career Ops** — Reads the CV editor summary, analyzes job fit, recommends roles, prepares STAR interview stories, drafts cover letters, and supports batch job import, evaluation, tracking, CSV export, and tailored ATS PDFs; PDF / CV file upload is not supported
- **GSAT Placement Analysis** — Supports 115 academic year department data, University TW snapshots, and 104 placement data import flows
- **PWA Install** — Install as a desktop or mobile app with offline cache support

---

## Quick Start

### Prerequisites

| Tool | Purpose |
|------|---------|
| [Supabase](https://supabase.com) account | Database and OAuth backend |
| Google Cloud project | Create OAuth Client ID |
| GitHub account (optional) | Free deployment via GitHub Pages |

### 1. Set Up Supabase

1. Create a new project on Supabase
2. In **SQL Editor**, paste and run [`supabase-schema.sql`](supabase-schema.sql)
3. Go to **Authentication > Providers** and enable Google
4. In [Google Cloud Console](https://console.cloud.google.com), create an OAuth Client and paste the Client ID / Secret back into Supabase
5. Under **Authentication > URL Configuration**, add your site URL and redirect URL

### 2. Configure Locally

Copy the config template and fill in your Supabase credentials:

```bash
cp config.example.js config.js
```

Edit `config.js`:

```js
window.CV_STUDIO_CONFIG = {
  supabaseUrl: "https://your-project.supabase.co",
  supabaseAnonKey: "your-anon-key",
  siteUrl: "",          // Leave empty to auto-detect current URL
  defaultTemplate: "n-tech"
};
```

> `config.js` is listed in `.gitignore` and will never be committed.

Alternatively, open the app and manually fill in the **Supabase Settings** panel on the left sidebar, then click **Apply Settings**.

### 3. Build & Deploy (GitHub Pages)

```bash
npm run build
# Outputs to dist/ — includes index.html, manifest.json, sw.js, icon.svg, config.js, 404.html, .nojekyll
```

Deployment steps:

1. Push the project to a GitHub repository
2. Go to **Settings > Pages**, set Source to **GitHub Actions**
3. Make sure `.github/workflows/deploy.yml` is included in your push
4. Every subsequent push to `main` triggers an automatic re-deployment

> If your Pages URL is `https://your-username.github.io/your-repo/`, remember to update the allowed URLs in both Supabase and Google Cloud OAuth settings.

---

## Usage

### CV Editor

- Fill in your CV details in the left panel; the right panel updates in real time
- Switch between 28 resume templates using the buttons at the top
- After signing in, click **Save My CV** to store your data in the cloud
- Use **CV Versions / Application Records** to save tailored versions and track each application
- Use **Bilingual Content Mapping** to maintain field-level Chinese / English content
- Click **Download PDF** to export the current template as a PDF
- If your browser supports it, click **Install App** to install as a native-like app

### Placeholder Mode (Not Signed In)

Visitors who are not signed in see placeholders only. Personal CV, portfolio, version, and application data are retained only after signing in.

### WYSIWYG Inline Editing

When signed in, click any field directly in the CV preview or Portfolio page to edit it. Changes sync instantly — no need to switch back to the left-side form.

### Portfolio / Learning Experience

Switch to the **Portfolio** tab at the top to build a chapter-based portfolio and export it as a PDF. The asset library can upload images, PDFs, documents, and URL assets; signed-in uploads go to the public `cv-images` Supabase Storage bucket, while signed-out users can keep small image assets locally.

### Public Share Pages

Signed-in users can publish public CV share pages. Publishing updates SEO / Open Graph / Twitter Card metadata and attempts to upload a generated 1200×630 preview image to Storage. If Storage is unavailable, the page falls back to `og-image.svg`.

### Career Advisor

The Career tab reads the summary, skills, experience, education, and projects already entered in the CV editor, then combines them with a pasted job description to produce:

- Job-fit analysis
- Recommended roles
- STAR interview stories
- Cover letter drafts
- Career Ops batch tracker for pasted JDs / URL lists, with scoring, sorting, status tracking, and CSV export
- Tailored ATS PDF and cover-letter draft generation for a selected job

This feature uses `career-ops`-style evaluation ideas such as A-F scoring, ATS keywords, STAR stories, and application prioritization. It now includes a lightweight batch tracker, company careers-page discovery, and tailored PDF flow, but does not yet include login-based portal scanners or scheduled cross-platform workers.

API keys stay in the current browser tab's `sessionStorage`. Model calls send the key only to the AI provider selected by the user; the key is never written to Supabase, Railway, GitHub Actions, or any app-owned database. The resume upload / 50-100 job matching flow is BYOK too: the frontend uses the user's own key to extract the resume profile, then reads `data/app/career-ops-jobs.js` and runs the three-layer heuristic match in the browser. Signed-in users only write completed results to Supabase for sharing, so no app-owned `ANTHROPIC_API_KEY` or Railway worker is required for hosted user analysis.

#### Career Ops Mapping

| Career Ops capability | Implementation in this project | Boundary |
|---|---|---|
| Automation | `.github/workflows/career-ops.yml` can build daily snapshots or run manually; if `data/career-ops-source-strategy.json` exists, it builds sources first | Requires a source strategy or `data/career-ops-sources.json` in the repo |
| Large-scale job collection | `scripts/career-ops-build-sources.mjs` + `scripts/career-ops-worker.mjs` + `scripts/career-ops-source-adapters.mjs`, with source strategy support, Greenhouse / Lever / Ashby / Workable / SmartRecruiters / BambooHR / Workday / Oracle / SuccessFactors / Taleo adapters, company careers-page discovery, and direct job-page extraction | Login-only portals should continue as adapters |
| Job normalization and lifecycle | `data/app/career-ops-jobs.json` / `.js` snapshots with unified fields plus `jobKey`, `isNew`, `isExpired`, `firstSeenAt`, and `lastSeenAt` | The frontend reads only normalized snapshots |
| High-volume screening and ranking | Career Ops panel bulk import, batch AI evaluation, score / grade / status ranking, CSV export; resume-upload 50-100 job matching runs locally in the frontend; `scripts/career-ops-evaluate.mjs` supports backend heuristic scoring; `scripts/career-ops-intelligence.mjs` adds dedupe signals, feature extraction, multidimensional scoring, clustering, and market insights | Frontend AI evaluation requires a user-provided API key; backend intelligence can run offline |
| 10-dimension rubric | `data/career-ops-rubric.example.json` defines profile match, ATS coverage, role fit, seniority, location, source quality, freshness, compensation, growth, application effort, and risk subtraction | Copy and tune weights for different users or markets |
| Search adapter | `scripts/career-ops-search-adapter.mjs` converts exported search-result JSON / HTML / URL lists into worker sources while preserving search query strategy signals | Does not scrape Google/Bing directly; use a compliant search API or curated export |
| Flexible source expansion | `scripts/career-ops-source-flex.mjs` expands sources and queries from markets, role aliases, ATS domains, job boards, and company career path patterns | Generated candidates still need validation by adapters/scanners |
| Source quality gate | `scripts/career-ops-source-quality.mjs` filters job-board landing pages, thin descriptions, missing company/title records, and non-target-market noise before scoring | Defaults to filtering active jobs below 45; use `--annotate-only` to mark without removing |
| Rendered careers discovery | `scripts/career-ops-rendered-discover.mjs` can use a local Chrome executable to render JavaScript-heavy careers pages and emit supplemental sources | Requires `CHROME_PATH` or `PUPPETEER_EXECUTABLE_PATH` |
| Agent-style pipeline | `scripts/career-ops-pipeline.mjs` runs source-strategy / search / scanner / evaluation / intelligence / application / compensation / story-bank / parallel stages as explicit backend agent steps | Pipeline stages are grouped by data dependency; job-level work is handled by the parallel worker |
| Parallel job workers | `scripts/career-ops-parallel.mjs` uses a bounded-concurrency queue to produce evaluation, research, application, compensation, story, and apply-agent plans per job; `scripts/career-ops-parallel-pipeline.mjs` parallelizes source scanning first, then runs research / kit / compensation / story / learning / deep-fit in dependency-safe stages | Default concurrency is 4; tune with `--concurrency` |
| Deep company/job research | `scripts/career-ops-deep-research.mjs` combines ranked jobs, sources, public job pages, and optional search APIs into company/job dossiers; the frontend also has an AI deep-research action per job | The browser AI key powers reasoning only; real web search requires Brave/Bing/SerpAPI keys or imported search results |
| Single-job deep fit | `scripts/career-ops-deep-fit.mjs` combines profile, JD, research, compensation, and story bank into career-ops-grade fit dossiers; the hosted user flow uses a BYOK profile plus frontend-local heuristics for Layer A/B/C results | It does not spend app-owned model tokens; without an LLM key, it stays evidence-based and avoids invention |
| ATS keywords and resume gaps | Single-job and batch prompts produce keywords, gaps, priority, and summaries | The app must not invent experience that is not in the CV |
| STAR story bank | `scripts/career-ops-story-bank.mjs` turns profile proof points and market themes into a STAR+Reflection story bank | The user should fill in real metrics and outcomes |
| Preference learning | `scripts/career-ops-learning.mjs` learns preferred skills, companies, sources, and avoid signals from scores, statuses, feedback, and source metadata | Needs ongoing like/dislike feedback and application status updates |
| Command / mode layer | `data/career-ops-modes.json` + `scripts/career-ops-modes.mjs` define `/career-ops scan`, `deep`, `comp`, `apply`, `learn`, and `doctor` style modes and emit frontend-readable artifacts | This is a local command registry, not a chatbot slash-command runtime |
| Tailored application assets | Generate tailored ATS PDFs and cover-letter drafts for selected jobs; `scripts/career-ops-application-kit.mjs` creates apply checklists, outreach, follow-up, interview, and negotiation playbooks for top jobs | The user remains the final reviewer and applicant |
| Compensation and negotiation | `scripts/career-ops-compensation.mjs` creates base / bonus / equity / benefits / non-cash-lever structures, recruiter range questions, value anchors, and counter scripts | It does not invent compensation numbers; missing evidence becomes research or recruiter questions |
| Apply agent | `scripts/career-ops-apply-agent.mjs` can inspect application forms in Chrome, infer field mappings, and stop before submit | Human-in-the-loop only; never auto-submit |
| Application CRM and sync | Local Career Ops tracker stores status, score, notes, contact, follow-up, feedback, and tailored packs; signed-in users sync to the `cv_career_ops_jobs` Supabase table | Requires the latest `supabase-schema.sql` |
| Personalized search and calibration | The Career Ops panel builds search terms from the CV, scores, and like/dislike feedback; it also surfaces source strategy, search, and application-kit report summaries | Currently a local strategy signal; model weighting can be added later |

#### Career Ops Worker

To build a backend job snapshot, the recommended path is to maintain a source strategy first. This mirrors the upstream `career-ops` `portals.yml` idea: keep markets, tracked companies, ATS boards, search expansion queries, role keywords, and exclusion terms in a backend strategy file instead of the frontend.

The default hosted flow does not need Railway: the frontend reads the generated job snapshot, uses the user's own AI key to parse the resume, and completes the three-layer match in the browser. `scripts/career-ops-saas-worker.mjs` / `railway.json` are kept only for advanced deployments that want a backend queue or always-on worker.

```bash
cp data/career-ops-source-strategy.example.json data/career-ops-source-strategy.json
npm run career-ops:sources:build
```

`data/career-ops-source-strategy.example.json` includes a starter strategy. The active strategy currently covers large enterprises in Taiwan, China, Japan, Korea, and Singapore, plus sample Greenhouse / Lever / Ashby boards, a direct-source example, and search expansion queries. The builder writes:

- `data/career-ops-sources.json`
- `data/app/career-ops-source-strategy-report.md`

If you prefer to manage worker sources manually, create `data/career-ops-sources.json` from `data/career-ops-sources.example.json` and add company careers / recruiting pages or direct public job-page URLs:

```json
{
  "sources": [
    {
      "name": "Greenhouse board",
      "adapter": "greenhouse",
      "url": "https://boards.greenhouse.io/example"
    },
    {
      "name": "Lever board",
      "adapter": "lever",
      "url": "https://jobs.lever.co/example",
      "maxDiscovered": 100
    },
    {
      "name": "Ashby board",
      "adapter": "ashby",
      "url": "https://jobs.ashbyhq.com/example"
    },
    {
      "name": "Workable board",
      "adapter": "workable",
      "url": "https://apply.workable.com/example"
    },
    {
      "name": "SmartRecruiters board",
      "adapter": "smartrecruiters",
      "url": "https://jobs.smartrecruiters.com/example"
    },
    {
      "name": "BambooHR board",
      "adapter": "bamboohr",
      "url": "https://example.bamboohr.com/careers"
    },
    {
      "name": "Company careers page",
      "type": "company",
      "url": "https://example.com/careers",
      "maxDiscovered": 25
    },
    {
      "name": "Direct job page",
      "type": "job",
      "url": "https://example.com/jobs/frontend-engineer"
    }
  ]
}
```

Then run:

```bash
npm run career-ops:scrape
```

The worker writes:

- `data/app/career-ops-jobs.json`
- `data/app/career-ops-jobs.js`

The Career Ops panel can import that snapshot with **Import Backend Job Snapshot**. Greenhouse, Lever, Ashby, Workable, SmartRecruiters, BambooHR, Workday, Oracle, SuccessFactors, and Taleo use source adapters in `scripts/career-ops-source-adapters.mjs` and fetch public jobs APIs or public job pages, keeping platform rules out of the frontend. If `adapter` is omitted, the worker can still auto-detect common platform URLs. `type: "company"` expands likely job links from a generic company recruiting page. `type: "job"` treats the URL as a single job page and skips discovery. `titleFilter`, `market`, `industry`, and `tags` from the source strategy are preserved in the snapshot, so irrelevant roles can be filtered backend-side while source context stays available for analysis. The worker currently extracts public API / `JobPosting` JSON-LD / meta data; login-only portals, paginated search results, and more platform-specific APIs should continue as explicit adapters so credentials, rate limits, and platform terms stay out of the frontend.

To run backend batch scoring, copy `data/career-ops-profile.example.json` to `data/career-ops-profile.json`, then run:

```bash
npm run career-ops:evaluate -- --profile data/career-ops-profile.json
```

To turn the snapshot into a high-volume comparison dataset, run:

```bash
npm run career-ops:intelligence -- --profile data/career-ops-profile.json
```

This enriches jobs with an `intelligence` field and writes `data/app/career-ops-intelligence-report.md`, including multidimensional scores, top market skills, profile gaps, role clusters, work-mode distribution, source breakdown, duplicate groups, and suggested search-expansion keywords. This is the layer that makes company/ATS adapters part of a larger Career Ops-style scan → batch evaluate → tracker/dashboard pipeline.

To add search-result ingestion, optional rendered discovery, and application playbooks:

```bash
npm run career-ops:search -- --results data/raw/search-results.html
npm run career-ops:source-flex
npm run career-ops:quality
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run career-ops:rendered
npm run career-ops:deep-research
npm run career-ops:deep-fit
npm run career-ops:decision-report
npm run career-ops:compensation
npm run career-ops:story-bank
npm run career-ops:learn
npm run career-ops:modes
npm run career-ops:parallel -- --concurrency 6
npm run career-ops:application-kit -- --profile data/career-ops-profile.json
```

`career-ops:search` turns curated search exports into crawlable sources; `career-ops:rendered` is an optional browser-rendered pass for JavaScript-heavy company careers pages; `career-ops:deep-research` writes `data/app/career-ops-deep-research.json`, `.js`, and `.md`, and can use `BRAVE_SEARCH_API_KEY`, `BING_SEARCH_API_KEY`, or `SERPAPI_API_KEY` for real search evidence; `career-ops:decision-report` merges deep fit, research, application kit, compensation, and story bank artifacts into A-F single-job decision dossiers; `career-ops:application-kit` writes apply / outreach / follow-up / interview / negotiation playbooks.

For the full bounded-concurrency backend, run:

```bash
npm run career-ops:parallel-pipeline -- --concurrency 6
```

The frontend API key is intentionally kept in `sessionStorage` and can power AI reasoning for selected jobs, but it is not a real web-search credential. Keep search API keys in backend scripts or GitHub Actions secrets:

```bash
BRAVE_SEARCH_API_KEY="..." npm run career-ops:deep-research
BING_SEARCH_API_KEY="..." npm run career-ops:deep-research -- --search-provider bing
SERPAPI_API_KEY="..." npm run career-ops:deep-research -- --search-provider serpapi
```

---

## Template Field Format

The Experience, Education, Projects, and Awards sections use the following pipe-separated format:

```
Title | Subtitle | Date | Description
```

Separate multiple entries with a blank line, for example:

```
Product Design Intern | Acme Corp | 2024 - Present | Managed back-office workflows and design specs.

Frontend Freelancer | Self-employed | 2023 - 2024 | Built brand websites and event landing pages.
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript, single HTML file (zero framework dependencies) |
| Authentication | Supabase Auth + Google OAuth 2.0 |
| Database | Supabase PostgreSQL (CV content stored as JSONB) |
| Access Control | Row-Level Security (RLS) — users can only read/write their own data |
| PDF Export | html2pdf.js (loaded from CDN with fallback) |
| PWA | Service Worker caching for offline support |
| Deployment | GitHub Actions → GitHub Pages |

---

## Project Structure

```
CV-App/
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions auto-deployment workflow
├── index.html               # Main application file (UI, styles, and logic all-in-one)
├── sw.js                    # Service Worker for PWA offline caching
├── manifest.json            # PWA install configuration
├── icon.svg                 # App icon
├── supabase-schema.sql      # Database schema and RLS policies
├── config.js                # Local Supabase config (not committed)
├── config.example.js        # Config template
└── package.json             # npm config and build script
```

---

## Google Sign-In Implementation

This project does **not** use the deprecated `google-signin2` / `gapi.auth2` frontend libraries. Instead, it uses Supabase Auth's `signInWithOAuth({ provider: "google" })` for a standard OAuth redirect flow:

- The frontend only redirects the user to the Google sign-in page
- After sign-in, Supabase automatically returns the session to your site
- Database access is controlled by the Supabase session + RLS, ensuring each user can only access their own CV data

**FedCM compatibility**: Since this project does not depend on the legacy Google Sign-In frontend library, there is no need to add a `use_fedcm` flag, and compatibility risk is minimal.

---

## Pre-Launch Checklist

- [ ] Site is served over `http://localhost` or a proper `https://` URL (not `file://`)
- [ ] Supabase `Site URL` and `Redirect URLs` include the actual callback URL
- [ ] Google Cloud OAuth's Authorized redirect URIs / origins match Supabase's requirements
- [ ] End-to-end test in Chrome: Sign in → redirect back → refresh (session persists) → sign out

---

## Completed Roadmap

- **Supabase Storage avatar upload**: signed-in users can upload an avatar to the `cv-images` bucket and apply the public URL to the CV.
- **Public CV share page**: signed-in users can publish, copy, and unpublish a public CV snapshot; visitors can open it with `?share=slug`.
- **Attachment uploads and portfolio asset management**: Portfolio assets can include images, PDFs, documents, URL assets, and cloud attachments; images can be applied to the cover or sections.
- **SEO / Open Graph preview images for share pages**: public share pages update SEO / OG / Twitter Card metadata and generate preview images during publishing.
- **Multiple CV versions and application tracking**: the tools panel can save role-specific versions and record company, role, status, date, link, and notes.
- **Granular bilingual content mapping**: Chinese / English mappings are supported for profile, summary, skills, highlights, experience, projects, education, and awards fields.
- **PDF page mode**: export supports automatic pagination or a one-page preference.
- **Bilingual resume headings**: CV headings can follow the UI language or be fixed to Chinese / English.
- **Automated GSAT data refresh**: GitHub Actions now refresh University TW and 104 GSAT data weekly.
