# 100k Resume Scoring: CV App vs GitHub career-ops

Generated: 2026-05-19T03:22:28.991Z

## Execution
- Profiles scored: 100000
- Snapshot jobs: 93093
- Snapshot app-eligible jobs: 92430
- App tracker limit: 1000
- App imported jobs: 1000
- App eligible jobs compared: 998
- Pairwise scoring rows: 99800000
- Upstream repo: santifer/career-ops @ 5d1f3a38c9c4
- Upstream portal template: 96/111 enabled tracked companies, 39/45 enabled search queries

## Result Differences
- App average score: 70.84/100 (3.83/5)
- GitHub career-ops rubric-compatible average: 67.23/100 (3.69/5)
- Average delta (app - GitHub rubric): 3.61 points / 0.14 rating
- Average absolute delta: 3.61 points / 0.14 rating
- Max absolute rating delta: 0.3
- Rating exact match: 2.98%
- Within 0.1 rating: 52.72%
- Within 0.3 rating: 100%
- Within 0.5 rating: 100%
- Grade match: 57.25%
- Action match: 42.3%
- Block G match: 100%

## App Distribution
- Grades: A 1547, B 43290362, C 56507982, D 109
- Recommendations: 值得投遞 57197303, 強烈投遞 1013060, 觀望 41589637

## GitHub career-ops Distribution
- Grades: A 1, B 16981493, C 66467533, D 16350973
- Recommendations: apply-immediately 1, recommend-against 16350973, selective-only 66467533, worth-applying 16981493

## Largest Rating Divergences
- 1. Δ +0.3 - synthetic-resume-00001 -> Mistral AI Ashby / Social Media Specialist - Writing & Video (US) (app 3.6, GitHub 3.3)
- 2. Δ +0.3 - synthetic-resume-00001 -> DoorDash / Manager, Executive Social Strategy & Operations Lead (app 3.6, GitHub 3.3)
- 3. Δ +0.3 - synthetic-resume-00001 -> Coinbase / Payments Risk Analyst II (app 3.6, GitHub 3.3)
- 4. Δ +0.3 - synthetic-resume-00002 -> Mistral AI Ashby / Social Media Specialist - Writing & Video (US) (app 3.6, GitHub 3.3)
- 5. Δ +0.3 - synthetic-resume-00002 -> DoorDash / Manager, Executive Social Strategy & Operations Lead (app 3.6, GitHub 3.3)
- 6. Δ +0.3 - synthetic-resume-00004 -> Mistral AI Ashby / Social Media Specialist - Writing & Video (US) (app 3.6, GitHub 3.3)
- 7. Δ +0.3 - synthetic-resume-00004 -> Headway / Senior Partner Success Associate, Care Partnerships (app 3.6, GitHub 3.3)
- 8. Δ +0.3 - synthetic-resume-00005 -> Replit Ashby / Premium Support Engineering Manager (London) (app 3.6, GitHub 3.3)
- 9. Δ +0.3 - synthetic-resume-00005 -> Replit Ashby / Premium Support Engineering Manager (Singapore) (app 3.6, GitHub 3.3)
- 10. Δ +0.3 - synthetic-resume-00006 -> Mistral AI Ashby / Social Media Specialist - Writing & Video (US) (app 3.6, GitHub 3.3)

## Jobs With Largest Average Delta
- 1. Δ +5.34 - Kohler / Sales Executive, Western MA (rows 100000, action diff 94009)
- 2. Δ +5.34 - Kohler / Sales Executive, Western MA (rows 100000, action diff 94009)
- 3. Δ +5.15 - GE Vernova / Lead Project Engineering Manager (rows 100000, action diff 96225)
- 4. Δ +5.06 - DoorDash / Manager, Executive Social Strategy & Operations Lead (rows 100000, action diff 79632)
- 5. Δ +4.99 - Ramp Ashby / Sales Development Representative (rows 100000, action diff 82603)
- 6. Δ +4.96 - Headway / Senior Partner Success Associate, Care Partnerships (rows 100000, action diff 76893)
- 7. Δ +4.95 - ElevenLabs Ashby / Transcription / Subtitling Specialist (Freelance) (rows 100000, action diff 92013)
- 8. Δ +4.95 - ElevenLabs Ashby / Dubbing Specialist (Freelance) (rows 100000, action diff 92013)
- 9. Δ +4.95 - ElevenLabs Ashby / Audiobook Specialists (Freelance) (rows 100000, action diff 91902)
- 10. Δ +4.94 - GE Vernova / Generator Project Engineering Manager (rows 100000, action diff 97252)

## Roles With Largest Average Delta
- 1. Δ +4.58 - Associate Strategic Finance Analyst (373 profiles, rows 372254)
- 2. Δ +4.52 - Associate Mobile Engineer (340 profiles, rows 339320)
- 3. Δ +4.51 - Associate Cloud Architect (372 profiles, rows 371256)
- 4. Δ +4.5 - Associate Instructional Design Lead (387 profiles, rows 386226)
- 5. Δ +4.47 - Associate Developer Documentation Lead (391 profiles, rows 390218)
- 6. Δ +4.47 - Associate QA Automation Engineer (384 profiles, rows 383232)
- 7. Δ +4.46 - Junior Strategic Finance Analyst (537 profiles, rows 535926)
- 8. Δ +4.45 - Junior Mobile Engineer (572 profiles, rows 570856)
- 9. Δ +4.43 - Associate People Operations Manager (361 profiles, rows 360278)
- 10. Δ +4.43 - Mobile Engineer Intern (150 profiles, rows 149700)

## Functional Differences
### 資料模型
- App: CV App 已可保留 Career Ops 結構化 profile，並用前台 tracker 對匯入 jobs 做互動式評分。
- GitHub career-ops: 原版 GitHub career-ops 以單一 `cv.md`、`profile.yml`、`portals.yml` 和本機 tracker 為中心，沒有內建 10 萬份 resume corpus。
- Difference: 本次 10 萬筆是用本地批量 scorer 跑完整 corpus；原版若逐筆用 agent A-G 報告跑，會變成 10 萬次以上的 LLM 工作流。
### 職缺 coverage
- App: App tracker 上限是 1000 jobs；本次共同比較 998 筆 app-eligible jobs。
- GitHub career-ops: 上游模板目前約 96/111 enabled companies + 39/45 enabled search queries，但 repo 不附即時 jobs snapshot。
- Difference: 結果比較使用同一批 app jobs 以排除資料來源差；功能比較則列出上游 scan/pipeline 能力。
### 評分方式
- App: Browser-local deterministic 100 分制，含 CV match、north star、compensation、culture、red flags、effort，並轉成投遞建議。
- GitHub career-ops: 公開 rubric 是 1-5 分制 A-G agent report：A-F 評估加 Block G legitimacy，理想流程會讀 CV 行號、做 WebSearch compensation/company research、生成 PDF 與 tracker。
- Difference: 本次使用 GitHub rubric-compatible deterministic scorer 批量近似；它不能取代原版逐職缺 LLM 報告，但可做 10 萬筆統計比較。
### 輸出
- App: 適合前台操作、排序、狀態追蹤、CSV export、客製 ATS PDF。
- GitHub career-ops: 適合 slash-command/agent workflow、Markdown report、PDF、TSV tracker、batch workers、Go TUI dashboard。
- Difference: App 更像產品化 UI；GitHub career-ops 更像本地 agent 作業系統。

## Notes
- Original GitHub career-ops is prompt/agent driven and does not ship a bulk 100k profile scoring API.
- This run uses the upstream public 1-5 rubric shape as a deterministic scorer so the full 100k corpus can be evaluated locally and repeatably.
- The comparison uses the same app-eligible job set for both scorers to isolate scoring/function differences from data-source differences.
- Per-profile Traditional Chinese JSONL output writes one resume result per line.
- No pairwise CSV was written because 100000 profiles x app-eligible jobs would create a very large row-level artifact.
