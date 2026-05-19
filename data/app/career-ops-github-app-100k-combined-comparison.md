# 100k Resume Scoring: CV App vs GitHub career-ops

Generated: 2026-05-19T04:33:26.691Z

## Execution
- Profiles scored: 100000
- Snapshot jobs: 89813
- Snapshot app-eligible jobs: 88790
- App tracker limit: 1000
- App imported jobs: 1000
- App eligible jobs compared: 1000
- Pairwise scoring rows: 100000000
- Upstream repo: santifer/career-ops @ 5d1f3a38c9c4
- Upstream portal template: 96/111 enabled tracked companies, 39/45 enabled search queries

## Result Differences
- App average score: 66.36/100 (3.65/5)
- GitHub career-ops rubric-compatible average: 62.31/100 (3.49/5)
- Average delta (app - GitHub rubric): 4.05 points / 0.16 rating
- Average absolute delta: 4.05 points / 0.16 rating
- Max absolute rating delta: 0.3
- Rating exact match: 1.17%
- Within 0.1 rating: 39.13%
- Within 0.3 rating: 100%
- Within 0.5 rating: 100%
- Grade match: 42.94%
- Action match: 30.06%
- Block G match: 100%

## App Distribution
- Grades: A 1568, B 17725765, C 78479656, D 3793011
- Recommendations: 值得投遞 27641121, 強烈投遞 291984, 略過 800505, 觀望 71266390

## GitHub career-ops Distribution
- Grades: B 4609241, C 47977681, D 47093702, F 319376
- Recommendations: recommend-against 47413078, selective-only 47977681, worth-applying 4609241

## Largest Rating Divergences
- 1. Δ +0.3 - synthetic-resume-00001 -> ElevenLabs Ashby / Enterprise Account Executive - France (app 3.6, GitHub 3.3)
- 2. Δ +0.3 - synthetic-resume-00001 -> DoorDash / Manager, Executive Social Strategy & Operations Lead (app 3.6, GitHub 3.3)
- 3. Δ +0.3 - synthetic-resume-00002 -> ElevenLabs Ashby / Enterprise Account Executive - France (app 3.6, GitHub 3.3)
- 4. Δ +0.3 - synthetic-resume-00002 -> ElevenLabs Ashby / Customer Support Specialist (app 3.6, GitHub 3.3)
- 5. Δ +0.3 - synthetic-resume-00002 -> DoorDash / Manager, Executive Social Strategy & Operations Lead (app 3.6, GitHub 3.3)
- 6. Δ +0.3 - synthetic-resume-00001 -> GE Vernova / Wind Hub Technician - $7500 Sign-on Bonus - SD2 (Wishek, ND) (app 3.5, GitHub 3.2)
- 7. Δ +0.3 - synthetic-resume-00001 -> GE Vernova / Wind Hub Technician - $7500 Sign-on Bonus - SD2 (Wishek, ND) (app 3.5, GitHub 3.2)
- 8. Δ +0.3 - synthetic-resume-00001 -> Liberty Mutual Insurance / Claims Officer, Environmental Claims (app 3.5, GitHub 3.2)
- 9. Δ +0.3 - synthetic-resume-00001 -> Decagon / Strategic Account Director, Healthcare (app 3.5, GitHub 3.2)
- 10. Δ +0.3 - synthetic-resume-00001 -> Decagon / Strategic Account Director, Healthcare (app 3.5, GitHub 3.2)

## Jobs With Largest Average Delta
- 1. Δ +5.75 - Qonto / Customer Care Agent Deutschland (m/w/d) (rows 100000, action diff 100000)
- 2. Δ +5.56 - GE Vernova / Wind Hub Technician - $7500 Sign-on Bonus - SD2 (Wishek, ND) (rows 100000, action diff 97997)
- 3. Δ +5.56 - GE Vernova / Wind Hub Technician - $7500 Sign-on Bonus - SD2 (Wishek, ND) (rows 100000, action diff 97997)
- 4. Δ +5.46 - GE Vernova / Commissioning & Services Wind Technicians (rows 100000, action diff 100000)
- 5. Δ +5.44 - Bank of America / Financial Solutions Advisor Registration Candidate  - South Shore Market (rows 100000, action diff 99818)
- 6. Δ +5.44 - GE Vernova / Communications Manager, Public Affairs (rows 100000, action diff 98690)
- 7. Δ +5.42 - Bank of America / Merrill Financial Solutions Advisor - North Virginia Market (rows 100000, action diff 99951)
- 8. Δ +5.42 - Bank of America / Merrill Financial Solutions Advisor - Ohio Valley Market (rows 100000, action diff 99951)
- 9. Δ +5.41 - Perplexity Ashby / Executive Communications Manager (rows 100000, action diff 99812)
- 10. Δ +5.37 - Bechtel / Planificador/a Senior (rows 100000, action diff 53338)

## Roles With Largest Average Delta
- 1. Δ +4.93 - Associate Strategic Finance Analyst (373 profiles, rows 373000)
- 2. Δ +4.84 - Junior Strategic Finance Analyst (537 profiles, rows 537000)
- 3. Δ +4.84 - Associate Cloud Architect (372 profiles, rows 372000)
- 4. Δ +4.78 - Associate Mobile Engineer (340 profiles, rows 340000)
- 5. Δ +4.77 - Associate Instructional Design Lead (387 profiles, rows 387000)
- 6. Δ +4.75 - Associate People Operations Manager (361 profiles, rows 361000)
- 7. Δ +4.74 - Associate QA Automation Engineer (384 profiles, rows 384000)
- 8. Δ +4.73 - Junior Mobile Engineer (572 profiles, rows 572000)
- 9. Δ +4.71 - Junior Cloud Architect (586 profiles, rows 586000)
- 10. Δ +4.7 - Junior Instructional Design Lead (594 profiles, rows 594000)

## Functional Differences
### 資料模型
- App: CV App 已可保留 Career Ops 結構化 profile，並用前台 tracker 對匯入 jobs 做互動式評分。
- GitHub career-ops: 原版 GitHub career-ops 以單一 `cv.md`、`profile.yml`、`portals.yml` 和本機 tracker 為中心，沒有內建 10 萬份 resume corpus。
- Difference: 本次 10 萬筆是用本地批量 scorer 跑完整 corpus；原版若逐筆用 agent A-G 報告跑，會變成 10 萬次以上的 LLM 工作流。
### 職缺 coverage
- App: App tracker 上限是 1000 jobs；本次共同比較 1000 筆 app-eligible jobs。
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
