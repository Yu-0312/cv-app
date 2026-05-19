# 10 萬份履歷評分比較：CV App vs GitHub career-ops

產生時間：2026-05-19T03:22:28.991Z

## 執行範圍

- 履歷資料：100,000 份，來自 `data/career-ops-profiles/manifest.json`
- 職缺快照：93,093 筆，其中 92,430 筆符合 app 評分條件
- App 等效匯入上限：1,000
- 實際共同比較職缺：998 筆
- 總配對評分列數：99,800,000
- 每份履歷分開結果：`data/app/career-ops-github-app-100k-profile-results.zh-TW.jsonl.gz`
- GitHub career-ops：`santifer/career-ops` main，commit `5d1f3a38c9c4`

## 結果差距

- CV App 平均分：70.84/100，換算 3.83/5
- GitHub career-ops rubric-compatible 平均分：67.23/100，換算 3.69/5
- 平均差距：App 高 3.61 分，約高 0.14 rating
- 平均絕對差距：3.61 分，約 0.14 rating
- 最大 rating 差距：0.3
- rating 完全相同：2.98%
- rating 差距在 0.1 以內：52.72%
- rating 差距在 0.3 以內：100%
- rating 差距在 0.5 以內：100%
- grade 相同：57.25%
- 投遞行動建議相同：42.3%
- Block G 合法性/風險判斷相同：100%

## 分布差異

### CV App

- 等級：A 1,547、B 43,290,362、C 56,507,982、D 109
- 建議：值得投遞 57,197,303、強烈投遞 1,013,060、觀望 41,589,637

### GitHub career-ops rubric-compatible

- 等級：A 1、B 16,981,493、C 66,467,533、D 16,350,973
- 建議：立即投遞 1、不建議投遞 16,350,973、選擇性投遞 66,467,533、值得投遞 16,981,493

## 主要觀察

- App 整體比 GitHub career-ops rubric-compatible scorer 樂觀，平均差距 3.61/100。
- 兩者的分數尺度很接近，100% 配對落在 0.3 rating 差距以內。
- 行動建議相同率是 42.3%；差異主要來自 GitHub career-ops 對低於 4.0/5 的職缺較保守。
- Block G 風險判斷相同率是 100%，代表兩邊對可疑職缺的規則沒有明顯分歧。

## 差距最大的職缺

- Kohler / Sales Executive, Western MA：App 平均高 5.34 分，行動建議不同 94,009 次
- Kohler / Sales Executive, Western MA：App 平均高 5.34 分，行動建議不同 94,009 次
- GE Vernova / Lead Project Engineering Manager：App 平均高 5.15 分，行動建議不同 96,225 次
- DoorDash / Manager, Executive Social Strategy & Operations Lead：App 平均高 5.06 分，行動建議不同 79,632 次
- Ramp Ashby / Sales Development Representative：App 平均高 4.99 分，行動建議不同 82,603 次
- Headway / Senior Partner Success Associate, Care Partnerships：App 平均高 4.96 分，行動建議不同 76,893 次
- ElevenLabs Ashby / Transcription / Subtitling Specialist (Freelance)：App 平均高 4.95 分，行動建議不同 92,013 次
- ElevenLabs Ashby / Dubbing Specialist (Freelance)：App 平均高 4.95 分，行動建議不同 92,013 次
- ElevenLabs Ashby / Audiobook Specialists (Freelance)：App 平均高 4.95 分，行動建議不同 91,902 次
- GE Vernova / Generator Project Engineering Manager：App 平均高 4.94 分，行動建議不同 97,252 次

## 差距最大的履歷角色

- Associate Strategic Finance Analyst：373 份履歷、372,254 列評分，App 平均高 4.58 分
- Associate Mobile Engineer：340 份履歷、339,320 列評分，App 平均高 4.52 分
- Associate Cloud Architect：372 份履歷、371,256 列評分，App 平均高 4.51 分
- Associate Instructional Design Lead：387 份履歷、386,226 列評分，App 平均高 4.5 分
- Associate Developer Documentation Lead：391 份履歷、390,218 列評分，App 平均高 4.47 分
- Associate QA Automation Engineer：384 份履歷、383,232 列評分，App 平均高 4.47 分
- Junior Strategic Finance Analyst：537 份履歷、535,926 列評分，App 平均高 4.46 分
- Junior Mobile Engineer：572 份履歷、570,856 列評分，App 平均高 4.45 分
- Associate People Operations Manager：361 份履歷、360,278 列評分，App 平均高 4.43 分
- Mobile Engineer Intern：150 份履歷、149,700 列評分，App 平均高 4.43 分

## 功能差距

| 面向 | CV App | GitHub career-ops | 差異 |
|---|---|---|---|
| 資料模型 | CV App 已可保留 Career Ops 結構化 profile，並用前台 tracker 對匯入 jobs 做互動式評分。 | 原版 GitHub career-ops 以單一 `cv.md`、`profile.yml`、`portals.yml` 和本機 tracker 為中心，沒有內建 10 萬份 resume corpus。 | 本次 10 萬筆是用本地批量 scorer 跑完整 corpus；原版若逐筆用 agent A-G 報告跑，會變成 10 萬次以上的 LLM 工作流。 |
| 職缺 coverage | App tracker 上限是 1000 jobs；本次共同比較 998 筆 app-eligible jobs。 | 上游模板目前約 96/111 enabled companies + 39/45 enabled search queries，但 repo 不附即時 jobs snapshot。 | 結果比較使用同一批 app jobs 以排除資料來源差；功能比較則列出上游 scan/pipeline 能力。 |
| 評分方式 | Browser-local deterministic 100 分制，含 CV match、north star、compensation、culture、red flags、effort，並轉成投遞建議。 | 公開 rubric 是 1-5 分制 A-G agent report：A-F 評估加 Block G legitimacy，理想流程會讀 CV 行號、做 WebSearch compensation/company research、生成 PDF 與 tracker。 | 本次使用 GitHub rubric-compatible deterministic scorer 批量近似；它不能取代原版逐職缺 LLM 報告，但可做 10 萬筆統計比較。 |
| 輸出 | 適合前台操作、排序、狀態追蹤、CSV export、客製 ATS PDF。 | 適合 slash-command/agent workflow、Markdown report、PDF、TSV tracker、batch workers、Go TUI dashboard。 | App 更像產品化 UI；GitHub career-ops 更像本地 agent 作業系統。 |

## 全職缺限制

目前快照不是剛好 100,000 個職缺，而是 93,093 筆，其中 92,430 筆符合評分條件。若用 100,000 份履歷乘上全部符合條件職缺，會產生約 9,243,000,000 筆配對評分；本次為了對齊前台 app tracker 行為，使用 1,000 筆匯入上限後的共同職缺集合。

## 注意事項

- 原版 GitHub career-ops 是 agent/prompt 工作流，沒有內建 10 萬份履歷的批量評分 API。
- 本次 GitHub 分數使用上游公開 1-5 rubric 形狀做 deterministic scorer，以便完整、可重跑地比較 10 萬份資料。
- 每份履歷的分開結果在 JSONL.GZ 中，每一行就是一份履歷的 App/GitHub 平均、差距、最佳職缺與最大差距職缺。
