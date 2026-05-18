# Career Ops vs CV Studio App Comparison

Generated: 2026-05-16T15:21:33.031Z

## Input Coverage
- Profile schema: career-ops-profile-example-v5.1
- Active profile: synthetic-active-frontend-senior
- Synthetic profile corpus: 1000
- Active profile keys: 47
- App CV fields populated after import: 13/14 (name, role, email, phone, location, website, summary, skills, highlights, experience, education, projects, awards)
- Structured Career Ops field groups present: 15 (workExperience, employmentHistory, skillExperience, skillMatrix, educationDetails, educationHistory, compensationExpectations, personalLinks, workAuthorization, languageProficiencies, proofPoints, starStories, resumeText, preferences, ats)

## Backend Career Ops Results
- Snapshot source: career-ops-parallel-pipeline
- Jobs: 552 total / 276 active / 276 expired
- Evaluated active jobs: 276
- Average score: 58
- Grade distribution: D 159, C 90, B 27
- Recommendation distribution: 略過 151, 觀望 71, 值得投遞 54

## Top Backend Matches
- 1. 77/100 B - Money Forward - Backend Engineer, Digital Bank (值得投遞)
- 2. 77/100 B - CADDi - Senior SRE, Global Product Team (值得投遞)
- 3. 76/100 B - Metanomaly - Growth Engineer (值得投遞)
- 4. 75/100 B - Geniee - JAPAN AI - Product Manager, AI SaaS (值得投遞)
- 5. 75/100 B - AI Robot Association (AIRoA) - Full Stack Engineer (值得投遞)
- 6. 75/100 B - Geniee - JAPAN AI - Research Engineer, LLM (值得投遞)
- 7. 75/100 B - Money Forward - Senior Software Engineer, Money Forward Cloud, Fukuoka (值得投遞)
- 8. 75/100 B - MODE - Software Engineer (Engineering Foundation) (值得投遞)

## Feature Differences
### Profile ingestion
- App: CV Studio imports the active Career Ops profile into 14 resume fields and flattens structured evidence into readable resume sections.
- Career Ops: Career Ops scripts read the profile JSON directly and use structured fields such as preferences, proofPoints, starStories, compensation, and work authorization.
- Difference: The app is better for editing/presentation; backend artifacts are better for structured scoring and repeatable reporting.
### Profile corpus
- App: The app uses one active profile at a time.
- Career Ops: The example file contains 1000 synthetic profiles, but default pipeline runs against the top-level active profile unless a profile-selection workflow is added.
- Difference: The 1000-profile corpus is test data; it is not automatically batch-evaluated by the current app UI.
### Job volume
- App: Career Ops tracker can now hold up to 1000 imported jobs and displays imported backend scores.
- Career Ops: The backend snapshot contains 552 total jobs / 276 active jobs, with quality gates, intelligence, and reports.
- Difference: 552 jobs can be shown in the app from this snapshot; backend remains the source of truth for full pipeline generation.
### Scoring
- App: Frontend scoring calls a browser-provided AI key and may vary by provider/model/prompt.
- Career Ops: Backend scoring is deterministic heuristic 6D + Block G unless LLM review is explicitly enabled.
- Difference: Use backend scores for stable comparisons; use app AI for human-facing explanation and tailoring.

## Result Differences
- Career Ops currently evaluates 276/276 active jobs with average score 58.
- Top backend recommendation is Money Forward - Backend Engineer, Digital Bank at 77/100.
- App import preserves backend score/grade/recommendation for display, but app-side re-evaluation would require an API key and can diverge from deterministic backend results.
- The profile has 15 structured Career Ops field groups; after app import those become resume text sections rather than separate scoring dimensions.

## Market Signals
- Top skills: growth (40), operations (31), python (30), aws (24), gcp (16), agents (15), docker (15), terraform (15), go (14), react (14), deep learning (13), typescript (13)
- Missing high-demand skills: growth (40), python (30), aws (24), gcp (16), agents (15), terraform (15), go (14), deep learning (13), java (11), machine learning (11)
- Search queries: Senior Frontend Engineer, Frontend Engineer, Product Engineer, Senior Product Engineer, Frontend Platform Engineer, Full Stack Engineer, JavaScript, TypeScript, React, Next.js, Vue, Nuxt, Svelte, Node.js, growth, python, aws, gcp
