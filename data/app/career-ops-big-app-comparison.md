# Career Ops vs 職業分析 App：1000 筆大數據比對

Generated: 2026-05-18T07:39:16.702Z

## Coverage
- Profiles: 1000
- Jobs snapshot: 6536 total / 6232 active
- App import: 1000 jobs；app local engine eligible active jobs: 880
- Backend Career Ops active jobs: 6232
- Pairwise compared rows: 880000
- Backend-only active rows: 5352000

## Result Differences
- Backend all-active average score: 62.14
- Common eligible backend average: 69.71
- Common eligible app average: 69.71
- Average delta (app - backend): 0
- Average absolute delta: 0
- Median absolute delta: 0
- P95 absolute delta: 0
- Score exact match: 99.88%
- Within 3 points: 100%；within 5 points: 100%
- Grade match: 99.99%
- Recommendation match: 99.96%
- Block G match: 100%

## Backend Distribution
- Grades: B 1271402, C 2302665, D 2657933
- Recommendations: 值得投遞 1675430, 強烈投遞 30475, 略過 1933941, 觀望 2592154

## App Distribution
- Grades: B 400968, C 444203, D 34829
- Recommendations: 值得投遞 514493, 強烈投遞 4575, 略過 25629, 觀望 335303

## Biggest Score Divergences
- 1. Δ +1（app 80 / backend 79）- Synthetic Candidate 00006 -> Sentry Ashby / Senior Product Designer, Design Systems
- 2. Δ +1（app 80 / backend 79）- Synthetic Candidate 00007 -> Sentry Ashby / Senior Product Designer, Design Systems
- 3. Δ +1（app 80 / backend 79）- Synthetic Candidate 00112 -> Sentry Ashby / Senior Product Designer, Design Systems
- 4. Δ +1（app 80 / backend 79）- Synthetic Candidate 00113 -> Sentry Ashby / Senior Product Designer, Design Systems
- 5. Δ +1（app 80 / backend 79）- Synthetic Candidate 00114 -> Sentry Ashby / Senior Product Designer, Design Systems
- 6. Δ +1（app 80 / backend 79）- Synthetic Candidate 00302 -> Sentry Ashby / Senior Product Designer, Design Systems
- 7. Δ +1（app 80 / backend 79）- Synthetic Candidate 00306 -> Sentry Ashby / Senior Product Designer, Design Systems
- 8. Δ +1（app 80 / backend 79）- Synthetic Candidate 00312 -> Sentry Ashby / Senior Product Designer, Design Systems
- 9. Δ +1（app 80 / backend 79）- Synthetic Candidate 00412 -> Sentry Ashby / Senior Product Designer, Design Systems
- 10. Δ +1（app 80 / backend 79）- Synthetic Candidate 00413 -> Sentry Ashby / Senior Product Designer, Design Systems

## Jobs With Largest Average Delta
- 1. Δ +0.67 avg - Gogolook / AI Product Intern (B2C & User Growth) - ScamAdviser（app 70.75, backend 70.08, diff rec 319/1000）
- 2. Δ +0.21 avg - Databricks Greenhouse / Engineering Manager - UI Platform（app 75.97, backend 75.76, diff rec 0/1000）
- 3. Δ +0.18 avg - Sentry Ashby / Senior Product Designer, Design Systems（app 75.68, backend 75.5, diff rec 17/1000）
- 4. Δ +0.03 avg - Airbnb Greenhouse / Senior Software Engineer, BizTech(AI Products)（app 71.05, backend 71.03, diff rec 0/1000）
- 5. Δ +0 avg - Ramp Ashby / Design Engineer（app 79.23, backend 79.23, diff rec 0/1000）
- 6. Δ +0 avg - Supabase Ashby / Design Engineer（app 77.99, backend 77.99, diff rec 0/1000）
- 7. Δ +0 avg - ElevenLabs Ashby / Safety Engineer（app 77.89, backend 77.89, diff rec 0/1000）
- 8. Δ +0 avg - Ramp Ashby / Enterprise Channel Sales Consultant, Juno（app 77.83, backend 77.83, diff rec 0/1000）
- 9. Δ +0 avg - Databricks Greenhouse / Senior Software Engineer - Fullstack（app 77.73, backend 77.73, diff rec 0/1000）
- 10. Δ +0 avg - Databricks Greenhouse / Senior Software Engineer - AI Platform (NYC)（app 77.59, backend 77.59, diff rec 0/1000）

## Profiles With Largest Average Delta
- 1. Δ +0 avg - Synthetic Candidate 00001 (Senior Frontend Engineer)（app 70.93, backend 70.93）
- 2. Δ +0 avg - Synthetic Candidate 00002 (Senior Frontend Engineer)（app 67.88, backend 67.88）
- 3. Δ +0 avg - Synthetic Candidate 00003 (Senior Frontend Engineer)（app 69.5, backend 69.49）
- 4. Δ +0 avg - Synthetic Candidate 00004 (Senior Frontend Engineer)（app 71.2, backend 71.2）
- 5. Δ +0 avg - Synthetic Candidate 00005 (Senior Frontend Engineer)（app 70.27, backend 70.27）
- 6. Δ +0 avg - Synthetic Candidate 00006 (Senior Frontend Engineer)（app 69.64, backend 69.64）
- 7. Δ +0 avg - Synthetic Candidate 00007 (Senior Frontend Engineer)（app 68.37, backend 68.37）
- 8. Δ +0 avg - Synthetic Candidate 00008 (Senior Frontend Engineer)（app 71.73, backend 71.73）
- 9. Δ +0 avg - Synthetic Candidate 00009 (Senior Frontend Engineer)（app 70.95, backend 70.95）
- 10. Δ +0 avg - Synthetic Candidate 00010 (Senior Frontend Engineer)（app 70.37, backend 70.37）

## Dimension Average Delta
- cvMatch: +0
- northStar: +0
- compensation: +0
- culture: +0.01
- redFlags: +0
- effort: +0

## Functional Differences
### 資料吞吐量
- App: 職業分析 app 的 tracker 上限是 1000 筆 jobs；此 snapshot 會匯入 1000 筆，其中 1000 筆 active。
- Career Ops: Career Ops 後端可直接跑 profile corpus x job snapshot；本次跑 1000 profiles x 6232 active jobs。
- Difference: app 適合互動式追蹤與人工檢視；career-ops 適合批次、可重跑、可稽核的大量比對。
### 可評分 coverage
- App: 本機 app 引擎只評分描述足夠的 active jobs，本次 880/1000 筆可重算。
- Career Ops: 後端 deterministic scorer 本次評估 6232 筆 active jobs。
- Difference: 5352 筆 active jobs 在後端有分數，但 app 本機引擎因 JD 太短或只有 URL 而不重算。
### Profile 結構
- App: app 匯入 Career Ops profile 時會保留原始結構化 profile；本機引擎優先使用 preferences、skillExperience、proofPoints、starStories，再以 14 個 CV 欄位 fallback。
- Career Ops: 後端保留 structured profile 欄位，例如 preferences、proofPoints、starStories、skillExperience、work authorization、compensation anchors。
- Difference: 結構化 profile 的評分已高度還原後端；純手填 CV 欄位仍會是較輕量的 projection 模式。
### Scoring engine
- App: browser-local 6D + Block G，支援互動式重算、localStorage/cloud tracker、客製 PDF 和 optional AI 評估。
- Career Ops: CLI pipeline 產生 jobs、quality gate、intelligence、deep research、compensation、story bank、parallel report、decision report 等 artifacts。
- Difference: app 是前台操作面，career-ops 是資料管線與報告層；兩者分數接近時可互補，分歧時通常來自資料結構與 coverage。
### Block G
- App: app 額外把泛用 careers/jobs 首頁 URL 視為 caution signal。
- Career Ops: 後端 Block G 使用 ATS domain、日期、描述長度、紅黃旗關鍵字等 deterministic checks。
- Difference: 泛用公司職涯頁在 app 可能比後端更保守。
