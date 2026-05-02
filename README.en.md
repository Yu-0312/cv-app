# CV Studio

> A PWA-based CV editor — build in seconds, preview in real time, save to the cloud

[繁體中文版](README.md)

---

## Features

- **Google Sign-In** — Secure OAuth via Supabase; CV data is automatically tied to your account
- **9 Templates** — Academic Warm, Slate, Mono, Serif Ivory, Forest, Rose, Midnight, Sand, Plum
- **Live Preview** — Type on the left, see results on the right instantly
- **WYSIWYG Editing** — Click any field directly in the preview pane to edit (no need to switch back to the form)
- **Cloud Storage** — One-click save and load for authenticated users
- **PDF Export** — Export your CV with full template styling preserved
- **Portfolio / Learning Experience** — A dedicated tab for chapter-based portfolios with PDF export
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
- Switch between 9 color templates using the buttons at the top
- After signing in, click **Save My CV** to store your data in the cloud
- Click **Download PDF** to export the current template as a PDF
- If your browser supports it, click **Install App** to install as a native-like app

### Draft Mode (Not Signed In)

Visitors who are not signed in can freely browse and edit a local draft, but **cannot save to the cloud**. Saving requires signing in.

### WYSIWYG Inline Editing

When signed in, click any field directly in the CV preview or Portfolio page to edit it. Changes sync instantly — no need to switch back to the left-side form.

### Portfolio / Learning Experience

Switch to the **Portfolio** tab at the top to build a chapter-based portfolio and export it as a PDF.

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

## Roadmap / Ideas

- Additional template color schemes or custom theme support
- Supabase Storage integration for avatar and attachment uploads
- Multi-page CV or bilingual (Chinese/English) toggle
- Public shareable CV URL or online portfolio showcase
