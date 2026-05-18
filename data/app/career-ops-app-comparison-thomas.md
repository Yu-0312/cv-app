# Career Ops vs CV Studio App Comparison

Generated: 2026-05-16T16:03:43.524Z

## Input Coverage
- Profile schema: unknown
- Active profile: Thomas Davis
- Profile corpus size: 1
- Active profile keys: 11
- App CV fields populated after import: 8/14 (name, role, location, summary, skills, experience, education, projects)
- Structured Career Ops field groups present: 1 (preferences)

## Backend Career Ops Results
- Snapshot source: career-ops-parallel-pipeline
- Jobs: 552 total / 276 active / 276 expired
- Evaluated active jobs: 276
- Average score: 58
- Grade distribution: D 162, C 87, B 27
- Recommendation distribution: 略過 154, 觀望 89, 值得投遞 33

## Top Backend Matches
- 1. 78/100 B - CADDi - Senior SRE, Global Product Team (值得投遞)
- 2. 78/100 B - Geniee - JAPAN AI - Product Manager, AI SaaS (值得投遞)
- 3. 78/100 B - Geniee - JAPAN AI - Research Engineer, LLM (值得投遞)
- 4. 76/100 B - AI Robot Association (AIRoA) - Full Stack Engineer (值得投遞)
- 5. 76/100 B - Money Forward - Senior Software Engineer, Money Forward Cloud, Fukuoka (值得投遞)
- 6. 76/100 B - MODE - Software Engineer (Engineering Foundation) (值得投遞)
- 7. 76/100 B - Money Forward - AI Engineer, ERP Cross-Functional Engineering Department, Tokyo (值得投遞)
- 8. 75/100 B - Money Forward - Backend Engineer, Digital Bank (值得投遞)

## Feature Differences
### Profile ingestion
- App: CV Studio imports the active Career Ops profile into 14 resume fields and flattens structured evidence into readable resume sections.
- Career Ops: Career Ops scripts read the profile JSON directly and use structured fields such as preferences, proofPoints, starStories, compensation, and work authorization.
- Difference: The app is better for editing/presentation; backend artifacts are better for structured scoring and repeatable reporting.
### Profile corpus
- App: The app uses one active profile at a time.
- Career Ops: This real profile is a single-profile file, so the pipeline runs directly against the top-level resume fields.
- Difference: There is no profile corpus gap for this input; the main difference is whether structured fields stay separate or become resume text.
### Job volume
- App: Career Ops tracker can now hold up to 1000 imported jobs and displays imported backend scores.
- Career Ops: The backend snapshot contains 552 total jobs / 276 active jobs, with quality gates, intelligence, and reports.
- Difference: 552 jobs can be shown in the app from this snapshot; backend remains the source of truth for full pipeline generation.
### Scoring
- App: The app now has a browser-local 6D + Block G analysis engine for tracker jobs, plus optional AI evaluation when an API key is provided.
- Career Ops: Backend scoring is deterministic heuristic 6D + Block G unless LLM review is explicitly enabled.
- Difference: Use backend scores for repeatable pipeline reports; use the app engine for interactive web scoring and quick re-scoring without terminal work.

## Result Differences
- Career Ops currently evaluates 276/276 active jobs with average score 58.
- Top backend recommendation is CADDi - Senior SRE, Global Product Team at 78/100.
- App import preserves backend score/grade/recommendation for display, and the browser-local engine can re-score jobs interactively; scores can still diverge because the frontend and backend engines are separate implementations.
- The profile has 1 structured Career Ops field groups; after app import those become resume text sections rather than separate scoring dimensions.

## Market Signals
- Top skills: growth (40), operations (31), python (30), aws (24), gcp (16), agents (15), docker (15), terraform (15), go (14), react (14), deep learning (13), typescript (13)
- Missing high-demand skills: growth (40), operations (31), terraform (15), deep learning (13), analytics (11), api (11), java (11), machine learning (11)
- Search queries: Product Engineer, Senior Product Engineer, Staff Engineer, Full Stack Engineer, AI Engineer, TypeScript, JavaScript, React, Next.js, Node.js, Go, Python, PostgreSQL, growth, operations, terraform, deep learning, analytics
