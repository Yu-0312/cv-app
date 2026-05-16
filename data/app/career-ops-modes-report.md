# Career Ops Modes

- Generated: 2026-05-16T23:18:56.105Z
- Registry: CV Studio Career Ops Modes
- Commands: 9
- Guardrails: 4

## Commands

### /career-ops scan
- Script: `npm run career-ops:parallel-pipeline`
- Purpose: Build sources, scan in parallel, normalize jobs, and refresh all reports.
- Outputs: `data/app/career-ops-jobs.json`, `data/app/career-ops-parallel-report.md`

### /career-ops source-flex
- Script: `npm run career-ops:source-flex`
- Purpose: Expand source coverage with role aliases, ATS domains, job boards, and career path patterns.
- Outputs: `data/career-ops-sources.json`, `data/app/career-ops-source-flex-report.md`

### /career-ops quality
- Script: `npm run career-ops:quality`
- Purpose: Filter or annotate low-quality scraped jobs before scoring and LLM-heavy stages.
- Outputs: `data/app/career-ops-jobs.json`, `data/app/career-ops-source-quality-report.md`

### /career-ops deep
- Script: `npm run career-ops:deep-research && npm run career-ops:deep-fit`
- Purpose: Create company/job dossiers and single-job fit dossiers.
- Outputs: `data/app/career-ops-deep-research.md`, `data/app/career-ops-deep-fit.md`

### /career-ops comp
- Script: `npm run career-ops:compensation`
- Purpose: Create compensation structures and negotiation scripts.
- Outputs: `data/app/career-ops-compensation.md`

### /career-ops stories
- Script: `npm run career-ops:story-bank`
- Purpose: Create and refresh STAR+Reflection story bank seeds.
- Outputs: `data/app/career-ops-story-bank.md`

### /career-ops apply
- Script: `npm run career-ops:apply-agent:dry-run`
- Purpose: Create a human-in-the-loop application form inspection and fill plan.
- Outputs: `data/app/career-ops-apply-agent-report.md`

### /career-ops learn
- Script: `npm run career-ops:learn`
- Purpose: Learn preferences from scores, statuses, feedback, and source metadata.
- Outputs: `data/app/career-ops-learning-report.md`

### /career-ops doctor
- Script: `npm run career-ops:doctor`
- Purpose: Validate required files, schemas, secrets, and optional browser dependencies.
- Outputs: -

## Guardrails

- Never submit an application without explicit user confirmation.
- Never invent compensation numbers; require evidence or ask recruiter range questions.
- Never claim company research facts without source evidence.
- Never rewrite the CV with experience the user did not provide.
