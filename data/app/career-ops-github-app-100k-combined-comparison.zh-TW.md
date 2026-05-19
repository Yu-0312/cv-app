# 10 萬份履歷評分比較：CV App vs GitHub career-ops

產生時間：2026-05-19T04:33:26.691Z

## 執行範圍

- 履歷資料：100,000 份，來自 `data/career-ops-profiles/manifest.json`
- 職缺快照：89,813 筆，其中 88,790 筆符合 app 評分條件
- App 等效匯入上限：1,000
- 實際共同比較職缺：1,000 筆
- 總配對評分列數：100,000,000
- 每份履歷分開結果：`data/app/career-ops-github-app-100k-combined-profile-results.zh-TW.jsonl.gz`
- GitHub career-ops：`santifer/career-ops` main，commit `5d1f3a38c9c4`

## 結果差距

- CV App 平均分：66.36/100，換算 3.65/5
- GitHub career-ops rubric-compatible 平均分：62.31/100，換算 3.49/5
- 平均差距：App 高 4.05 分，約高 0.16 rating
- 平均絕對差距：4.05 分，約 0.16 rating
- 最大 rating 差距：0.3
- rating 完全相同：1.17%
- rating 差距在 0.1 以內：39.13%
- rating 差距在 0.3 以內：100%
- rating 差距在 0.5 以內：100%
- grade 相同：42.94%
- 投遞行動建議相同：30.06%
- Block G 合法性/風險判斷相同：100%

## 分布差異

### CV App

- 等級：A 1,568、B 17,725,765、C 78,479,656、D 3,793,011
- 建議：值得投遞 27,641,121、強烈投遞 291,984、略過 800,505、觀望 71,266,390

### GitHub career-ops rubric-compatible

- 等級：B 4,609,241、C 47,977,681、D 47,093,702、F 319,376
- 建議：不建議投遞 47,413,078、選擇性投遞 47,977,681、值得投遞 4,609,241

## 主要觀察

- App 整體比 GitHub career-ops rubric-compatible scorer 樂觀，平均差距 4.05/100。
- 兩者的分數尺度很接近，100% 配對落在 0.3 rating 差距以內。
- 行動建議相同率是 30.06%；差異主要來自 GitHub career-ops 對低於 4.0/5 的職缺較保守。
- Block G 風險判斷相同率是 100%，代表兩邊對可疑職缺的規則沒有明顯分歧。

## 差距最大的職缺

- Qonto / Customer Care Agent Deutschland (m/w/d)：App 平均高 5.75 分，行動建議不同 100,000 次
- GE Vernova / Wind Hub Technician - $7500 Sign-on Bonus - SD2 (Wishek, ND)：App 平均高 5.56 分，行動建議不同 97,997 次
- GE Vernova / Wind Hub Technician - $7500 Sign-on Bonus - SD2 (Wishek, ND)：App 平均高 5.56 分，行動建議不同 97,997 次
- GE Vernova / Commissioning & Services Wind Technicians：App 平均高 5.46 分，行動建議不同 100,000 次
- Bank of America / Financial Solutions Advisor Registration Candidate  - South Shore Market：App 平均高 5.44 分，行動建議不同 99,818 次
- GE Vernova / Communications Manager, Public Affairs：App 平均高 5.44 分，行動建議不同 98,690 次
- Bank of America / Merrill Financial Solutions Advisor - North Virginia Market：App 平均高 5.42 分，行動建議不同 99,951 次
- Bank of America / Merrill Financial Solutions Advisor - Ohio Valley Market：App 平均高 5.42 分，行動建議不同 99,951 次
- Perplexity Ashby / Executive Communications Manager：App 平均高 5.41 分，行動建議不同 99,812 次
- Bechtel / Planificador/a Senior：App 平均高 5.37 分，行動建議不同 53,338 次

## 差距最大的履歷角色

- Associate Strategic Finance Analyst：373 份履歷、373,000 列評分，App 平均高 4.93 分
- Junior Strategic Finance Analyst：537 份履歷、537,000 列評分，App 平均高 4.84 分
- Associate Cloud Architect：372 份履歷、372,000 列評分，App 平均高 4.84 分
- Associate Mobile Engineer：340 份履歷、340,000 列評分，App 平均高 4.78 分
- Associate Instructional Design Lead：387 份履歷、387,000 列評分，App 平均高 4.77 分
- Associate People Operations Manager：361 份履歷、361,000 列評分，App 平均高 4.75 分
- Associate QA Automation Engineer：384 份履歷、384,000 列評分，App 平均高 4.74 分
- Junior Mobile Engineer：572 份履歷、572,000 列評分，App 平均高 4.73 分
- Junior Cloud Architect：586 份履歷、586,000 列評分，App 平均高 4.71 分
- Junior Instructional Design Lead：594 份履歷、594,000 列評分，App 平均高 4.7 分

## 功能差距

| 面向 | CV App | GitHub career-ops | 差異 |
|---|---|---|---|
| 資料模型 | CV App 已可保留 Career Ops 結構化 profile，並用前台 tracker 對匯入 jobs 做互動式評分。 | 原版 GitHub career-ops 以單一 `cv.md`、`profile.yml`、`portals.yml` 和本機 tracker 為中心，沒有內建 10 萬份 resume corpus。 | 本次 10 萬筆是用本地批量 scorer 跑完整 corpus；原版若逐筆用 agent A-G 報告跑，會變成 10 萬次以上的 LLM 工作流。 |
| 職缺 coverage | App tracker 上限是 1000 jobs；本次共同比較 1000 筆 app-eligible jobs。 | 上游模板目前約 96/111 enabled companies + 39/45 enabled search queries，但 repo 不附即時 jobs snapshot。 | 結果比較使用同一批 app jobs 以排除資料來源差；功能比較則列出上游 scan/pipeline 能力。 |
| 評分方式 | Browser-local deterministic 100 分制，含 CV match、north star、compensation、culture、red flags、effort，並轉成投遞建議。 | 公開 rubric 是 1-5 分制 A-G agent report：A-F 評估加 Block G legitimacy，理想流程會讀 CV 行號、做 WebSearch compensation/company research、生成 PDF 與 tracker。 | 本次使用 GitHub rubric-compatible deterministic scorer 批量近似；它不能取代原版逐職缺 LLM 報告，但可做 10 萬筆統計比較。 |
| 輸出 | 適合前台操作、排序、狀態追蹤、CSV export、客製 ATS PDF。 | 適合 slash-command/agent workflow、Markdown report、PDF、TSV tracker、batch workers、Go TUI dashboard。 | App 更像產品化 UI；GitHub career-ops 更像本地 agent 作業系統。 |

## 全職缺限制

目前快照不是剛好 100,000 個職缺，而是 89,813 筆，其中 88,790 筆符合評分條件。若用 100,000 份履歷乘上全部符合條件職缺，會產生約 8,879,000,000 筆配對評分；本次為了對齊前台 app tracker 行為，使用 1,000 筆匯入上限後的共同職缺集合。

## 注意事項

- 原版 GitHub career-ops 是 agent/prompt 工作流，沒有內建 10 萬份履歷的批量評分 API。
- 本次 GitHub 分數使用上游公開 1-5 rubric 形狀做 deterministic scorer，以便完整、可重跑地比較 10 萬份資料。
- 每份履歷的分開結果在 JSONL.GZ 中，每一行就是一份履歷的 App/GitHub 平均、差距、最佳職缺與最大差距職缺。
