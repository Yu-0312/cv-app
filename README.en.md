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
- **Career Advisor** — Reads the CV editor summary, analyzes job fit, recommends roles, prepares STAR interview stories, and drafts cover letters; PDF / CV file upload is not supported
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

### Draft Mode (Not Signed In)

Visitors who are not signed in can freely browse and edit a local draft, but **cannot save to the cloud**. Saving requires signing in.

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

This feature uses `career-ops`-style evaluation ideas such as A-F scoring, ATS keywords, and STAR stories, but it is not a full port of GitHub's `santifer/career-ops` CLI, batch job pipeline, tracker, or custom ATS PDF generation flow.

API keys stay in the current browser tab's `sessionStorage` and are not written to Supabase.

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
