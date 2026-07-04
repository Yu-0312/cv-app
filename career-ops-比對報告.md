# Career-Ops 深度比對報告：`Yu-0312/cv-app` vs `santifer/career-ops`

> 產出日期：2026-07-04　範圍：核心引擎與演算法 ×　架構與工程品質 ×　產品功能與 UX
> 目的：先看清兩者差異與可借鏡之處，再由你決定優化方向（本報告不動任何程式碼）

---

## 0. 一句話結論

兩者解的是**同一個問題（幫求職者從「找職缺 → 評估 → 客製投遞 → 追蹤 → 面試準備」）**，但走了**兩條相反的路線**：

- **你的版本（cv-app）**：以 **確定性 JS 引擎** 為核心。職缺抓取、6 維評分、A/B/C 分層、薪資 benchmark、故事庫全部用程式碼算出來，跑在 GitHub Actions 上每天批次產出 JSON/JS，前端是一支 1.17 MB 的 `app/index.html`（Web Components）。**零 LLM 成本、可重現、跑得快**，代表台灣在地化（104、GSAT、NTD 薪資、CJK 斷詞）是你的獨門優勢。
- **santifer/career-ops**：以 **AI-CLI + 檔案即真相（files-as-canonical）** 為核心。它的「評分引擎」其實是一批 Markdown prompt（`modes/oferta.md` 等）交給任意 AI coding CLI（Claude Code / Codex / Gemini / Ollama）去跑，Markdown 當資料庫、SQLite 只是衍生索引，外加一個 production 級 Next.js 16 web app 與完整的測試/CI/釋出紀律。**彈性高、工程成熟度高，但每次評估要花 LLM token、輸出不可重現**。

**最大落差不在「功能有沒有」，而在三件事**：(1) 工程品質（測試、模組邊界、型別）；(2) 投遞自動化（表單讀取/預填的實作深度）；(3) provider 抽象化的乾淨程度。這三點是最值得從 santifer 借鏡的地方。反過來，你的**在地化深度、零成本可重現、單檔即可部署**是 santifer 沒有的護城河，不該為了模仿而丟掉。

---

## 1. 本質差異：兩種世界觀

| 維度 | `cv-app`（你的） | `santifer/career-ops` |
|---|---|---|
| 評分怎麼算 | JS 確定性公式（`evaluate.mjs` 六維加權） | Markdown prompt 丟給 LLM（`modes/oferta.md` A–G 區塊） |
| 執行成本 | **零 LLM 成本**，純批次運算 | 每次評估燒 token（有多模型/本地 Ollama 選項壓成本） |
| 可重現性 | **高**（同輸入同輸出） | 低（LLM 輸出有變異） |
| 資料儲存 | JSON/JS 檔 + Supabase 快照分片 | Markdown 為真相來源 + SQLite 衍生索引 |
| 前端 | 單檔 `index.html` + Web Components | Next.js 16 + React 19 + TypeScript |
| 部署 | GitHub Actions 每日批次 → Supabase | 本地優先（local-first），web app spawn 子程序跑腳本 |
| 在地化 | **台灣深度**（104/GSAT/NTD/CJK） | 多語 mode（de/fr/pt/pl/ru/ua），但無單一市場深耕 |
| 工程紀律 | 較輕（1 支 smoke test，無型別） | 較重（500+ 檢查、release-please、CodeRabbit、CodeQL） |

**這張表是整份報告的骨架**：你不是「落後版」，而是「另一種取捨」。優化的目標應該是——**在保住零成本 + 在地化優勢的前提下，選擇性吸收 santifer 的工程品質與投遞自動化**，而不是整包倒過去變成 LLM-driven。

---

## 2. 核心引擎與演算法

### 2.1 職缺探索 / 抓取

**你的版本**：`career-ops-source-adapters.mjs`（67 KB，最大檔）內建 Greenhouse、Lever、Ashby、Workable、SmartRecruiters、BambooHR、Workday、Taleo、LinkedIn 等 ATS 正規化器，統一輸出 `{title, company, url, location, description, datePosted, employmentType}`；`career-ops-worker.mjs` 用 Puppeteer 探索連結（預設每頁 25 條）、抓 schema.org JobPosting 微資料；`source-flex.mjs` 做條件式擴充（例如偵測到台灣 profile 就加 104/CakeResume/Yourator）；`source-health.mjs` + `health-monitor.mjs` 監控過期率，>0.30 觸發自動重抓。

**santifer**：`providers/` 有 **45 個** provider，每個實作乾淨的契約 `{ id, detect(entry), fetch(entry, ctx) }`，外掛式載入、有 `_trust-validator.mjs` 驗證；`scan.mjs` 支援標題正/負關鍵字、地點、`sinceDays` 新鮮度、每 ATS 上限；`check-liveness.mjs` 在昂貴評估前先用 HTTP 狀態碼零成本驗活。

> **差異**：兩邊 ATS 覆蓋度相近，但 santifer 的 **provider 契約更乾淨、可獨立測試、外掛式**；你的 adapter 邏輯較多內聯在一個 67 KB 大檔裡，較難單獨測與擴充。santifer 的「評估前先驗活」也是省成本的好習慣。

### 2.2 評分：確定性公式 vs LLM prompt

**你的版本（已驗證）**：`career-ops-evaluate.mjs` 六維加權——
```
cvMatch 0.25 + northStar 0.20 + compensation 0.15 + culture 0.15 + redFlags 0.15 + effort 0.10
→ 0–100 加權平均 → 映射 1–5 星 / A–F
（compensation 無資料時權重歸零並重新正規化 totalW，這個處理很正確）
Block G 另計：合法性分級 High Confidence / Proceed with Caution / Suspicious
門檻：≥4.5 積極投、≥3.0 合格、<2.5 略過
```
斷詞有英文 + 中文停用詞過濾（避免「和」「職缺」噪音），`intelligence.mjs` 再抽 role family / seniority / work mode / 技能向量。

**santifer**：同樣是 A–G 區塊 + 1–5 分 + 獨立的 Block G 合法性——**但這些是 prompt 指令，由 LLM 執行**。優點是能做「精確到 CV 逐行對應」「archetype 驅動的客製」這種需要語意理解的事；缺點是燒 token、不可重現、需要 CLI 環境。

> **差異（關鍵）**：你的評分**便宜、快、可測、可重現**，但語意細膩度天花板較低（regex + 關鍵字重疊）。santifer 語意細膩但貴且飄。**這正是你的機會點**：把確定性引擎當「粗篩 + 排序」，只在使用者點進 Layer A 少數職缺時才選擇性呼叫 LLM 做深度分析（你的 `deep-fit.mjs` 其實已有 `callLlm` 的 gated 入口，只是沒被凸顯/文件化）。

### 2.3 分層與決策

你的 `deep-fit.mjs` 把職缺分 Layer A（roleFit ≥68，完整 dossier）/ B（40–67，精簡卡）/ C（<40，最小訊號卡），決策語言「積極投 / 選擇性投 / 觀望 / 略過」對應分數帶。santifer 沒有等價的三層 UX 分層——這其實是**你的版本比較好的地方**（把「探索」和「該投的」同畫面呈現）。

### 2.4 薪資

你的 `compensation.mjs` 內建 tw/jp/global 的 2024–2025 benchmark（tw 用 NTD 月薪級距），能從 profile 推 seniority 並產生談判話術。santifer 的 Block D 是**即時 WebSearch（硬上限 5 次查詢）** 抓 Glassdoor/Levels/Blind，查不到就明確標記「不可得」、絕不虛構。

> **差異**：你的薪資資料**即時性差**（硬編、會過時），但零成本、涵蓋台灣。santifer 即時但貴、且無台灣深度。可借鏡的是 santifer「查不到就標記、不虛構」的紀律，以及「有預算上限」的節流思路。

---

## 3. 架構與工程品質　←　落差最大的一塊

| 項目 | `cv-app` | `santifer` |
|---|---|---|
| 測試 | 只有 `smoke-test.mjs`（Puppeteer 開站煙霧測試） | `test-all.mjs`（500+ 檢查）＋ 3 支單元測試（process-quality / followup-cadence / detect-reposts）＋ Go dashboard 853 行測試 |
| 型別 | 無（純 .mjs） | web/ 全 TypeScript（strict） |
| CI | 1 條每日 workflow（抓→評→發布） | test + CodeQL + Dependency Review + Plugin Registry 驗證 |
| 釋出紀律 | 一般 commit | release-please 自動 semver + CHANGELOG + CodeRabbit 自動 review + Renovate |
| 模組邊界 | 邏輯多內聯在各腳本，`lib/` 很薄（market + utils） | providers/modes/plugins 三套外掛抽象 + `DATA_CONTRACT.md` 明訂 system/user 檔案邊界 |
| 錯誤處理 | 多為 try-catch 靜默回 `{}`，無重試、無結構化日誌 | `diagnose.ts`（275 行）分類 auth/geo/bot/rate-limit，給使用者可行動訊息 |
| 設定 | 評分權重、38 個技能詞、薪資級距**硬編在源碼** | 較多外部化（portals.yml、plugins-registry.json） |

**santifer 值得借鏡（且風險低）的工程實務**：

1. **抽出可測的純函式 + 加單元測試**：你的評分公式 `0.25*cvMatch + …`、斷詞、adapter 正規化目前**零單元測試**，改權重無回歸保護。這是投報比最高的一步。
2. **把硬編常數外部化成設定檔**：權重、技能詞、薪資級距、Layer 門檻搬到 `config/*.json`，才能 A/B 調參不動源碼。
3. **system/user 檔案邊界**（`DATA_CONTRACT.md` 那套）：若你之後讓使用者存自己的 profile/追蹤，明訂哪些檔會被自動覆寫、哪些不會，可避免更新時吃掉使用者資料。
4. **評估前先驗活**（`check-liveness.mjs`）：抓取後、重運算前先用 HTTP 狀態碼剔除死連結，省後續成本。
5. **provider 契約化**：把 67 KB 的 `source-adapters.mjs` 拆成 `{id, detect, fetch}` 契約的小檔，每個 adapter 可獨立測試。

**你的版本工程上的具體弱點**（探勘中發現）：
- 評分權重/技能詞/薪資硬編、無 schema 驗證輸入
- CJK 斷詞停用詞清單偏薄（少「公司」「職務」等常見詞），seniority 用 word-boundary regex 在中文標題易誤判
- worker 對 fetch 錯誤一律靜默吞掉，呼叫端分不清 404/timeout/auth
- 快照發到 Supabase 沒有 schema 版本標記，job schema 若變動可能讓前端顯示壞掉
- 最近的 commit（`Fix undefined .filter crash…`）顯示前端在跑分時有過 null 崩潰——正說明缺少單元測試的代價

---

## 4. 產品功能與 UX

### 4.1 功能對照

| 功能 | `cv-app` | `santifer` | 備註 |
|---|---|---|---|
| 職缺探索 + 排序 | ✅ 每日批次、A/B/C 分層 | ✅ 串流 NDJSON、即時進度 | 你的分層 UX 更好；它的串流體驗更即時 |
| CV↔JD 比對 | ✅ 關鍵字命中/未命中 | ✅ **逐行對應**（LLM） | 它更細膩，但貴 |
| 深度 dossier | ✅ Layer A 完整分析 | ✅ oferta A–G | 打平 |
| 薪資/談判 | ✅ 硬編 benchmark + 話術 | ✅ 即時查 + 話術 | 各有優劣 |
| 故事庫 (STAR) | ✅ `story-bank.mjs` | ✅ **STAR+R**（多反思欄） | 它多一個「反思/學到什麼」欄，面試更有層次 |
| 申請材料 | ✅ `application-kit.mjs`（信、ATS 關鍵字、追蹤節奏） | ✅ PDF/LaTeX/cover 模板 + 字型自帶 | 它有 LaTeX/Overleaf 產出 |
| **表單投遞** | ⚠️ `apply-agent.mjs` **只有 dry-run** | ✅ **Playwright 讀表單 → 預填 → 使用者確認 → 填回（絕不自動送出）** | **santifer 明顯領先** |
| 追蹤器 | 有（Supabase） | ✅ Markdown 表 + SQLite 索引 + 原子寫入 + 跟進節奏分析 | 它的資料流更穩健 |
| 面試準備 | 分散在 story-bank / decision-report | ✅ 獨立 `interview-prep/`＋逐場 session 逐字稿＋pattern 分析 | 它是完整子系統 |
| 重貼/流程品質偵測 | 部分（health/quality） | ✅ `detect-reposts` / `process-quality`（有測試） | 它更完整 |
| 台灣在地化 | ✅✅ 104/GSAT/NTD/CJK | ❌ | **你的獨門** |
| 零成本可重現 | ✅✅ | ❌（LLM） | **你的獨門** |
| 單檔部署 | ✅（index.html） | ❌（要 Next.js 環境） | **你的獨門** |

### 4.2 santifer 最值得看的產品點

- **表單投遞（apply flow）**：`web/src/lib/apply/` 用 Playwright 無頭開啟申請表 → 自動關 cookie 同意框 → DOM 抽欄位 → 從 cv.md 預填 → **給使用者純文字預覽確認** → 才填回真表單、**永不自動送出**、並用 `diagnose.ts` 分類「要登入/被 geo 擋/bot 檢查」給可行動訊息。這是你 dry-run apply-agent 想做卻還沒做完的部分，且它處理得很負責任（人類點最後送出鍵）。
- **STAR+R 的 R（Reflection）**：面試故事多一欄「學到什麼/反思」，對資深職位敘事更有說服力。你的 story-bank 可以低成本加這一欄。
- **追蹤器資料流**：Markdown 當真相 + SQLite 當索引 + 原子寫入，避免競態與資料損壞。

---

## 5. 你的版本領先/獨有（不要弄丟的護城河）

1. **台灣在地化深度**：104 / CakeResume / Yourator 來源、GSAT/大學分發教育分級、NTD 薪資級距、CJK 停用詞——santifer 完全沒有。這是真正的差異化。
2. **零 LLM 成本、可重現**：每天批次跑純運算，不燒 token、同輸入同輸出，適合大量掃描與公開部署。
3. **A/B/C 三層探索 UX**：把「探索」和「該投的」放同一畫面，比 santifer 更直覺。
4. **單檔前端 + Supabase 快照分片**：`index.html` 即可部署，10 萬級職缺用分片快照按需載入，運維極輕。

---

## 6. 優化選項清單（給你拍板，含風險 / 工作量 / 收益）

> 分成三批。建議先做「工程地基（低風險高收益）」，再挑「產品增益」，最後才碰「架構級改動」。

### A. 工程地基　▶ 低風險、高收益（建議優先）

| # | 優化項 | 收益 | 風險 | 估工作量 |
|---|---|---|---|---|
| A1 | 為評分/斷詞/adapter 抽純函式 + 加 **Vitest 單元測試**（先蓋 evaluate、intelligence、compensation 的核心公式） | 改權重有回歸保護；杜絕像上次 `.filter` 崩潰的 bug | 低（不改行為，只加測試） | 中 |
| A2 | 把**硬編常數外部化**（權重、技能詞、Layer 門檻、薪資級距 → `tooling/config/*.json`） | 可調參、可 A/B、不動源碼 | 低 | 小–中 |
| A3 | **強化 CJK 斷詞**：補停用詞、seniority 中文標題規則、加測試案例 | 台灣職缺評分更準 | 低 | 小 |
| A4 | worker **錯誤分類**（區分 404/timeout/auth）+ 結構化日誌（"新增 N、過期 M、adapter 失敗 K"） | 抓取問題可觀測、可除錯 | 低 | 小–中 |
| A5 | Supabase 快照加 **schema 版本標記** | 未來改 job schema 不會讓前端顯示壞掉 | 低 | 小 |

### B. 產品增益　▶ 中風險、看你要不要（挑著做）

| # | 優化項 | 收益 | 風險 | 估工作量 |
|---|---|---|---|---|
| B1 | **評估前先驗活**（仿 `check-liveness.mjs`，抓完先 HTTP 驗，剔死連結再運算） | 省後續成本、少無效卡片 | 低–中 | 小–中 |
| B2 | story-bank 加 **STAR+R 的反思欄** | 面試敘事層次提升 | 低 | 小 |
| B3 | **選擇性 LLM 深度分析**：只在使用者點進 Layer A 職缺時呼叫 `deep-fit` 的 `callLlm`（你已有入口），並文件化 fallback | 兼顧語意細膩 + 成本可控 | 中（要管 API key/失敗降級） | 中 |
| B4 | **provider 契約化**：把 67 KB `source-adapters.mjs` 拆成 `{id,detect,fetch}` 小檔 + 各自測試 | 好維護、好擴充、少靜默壞掉 | 中（重構有回歸風險，需先有 A1 測試護體） | 中–大 |

### C. 架構級　▶ 高風險 / 大工程（多半不建議，除非你要轉型）

| # | 優化項 | 收益 | 風險 | 估工作量 |
|---|---|---|---|---|
| C1 | 真的把 **apply flow（Playwright 讀表單→預填→確認→填回、不自動送出）** 做起來 | 補上最大功能缺口 | **高**（各站反爬/法遵/維護重） | 大 |
| C2 | 導入 **files-as-canonical + SQLite 索引** 的追蹤器資料流 | 資料更穩健、git 友善 | 高（動到核心資料模型） | 大 |
| C3 | 前端從單檔 `index.html` 遷 Next.js/TS | 工程可維護性↑ | **很高**（等於重寫，且丟掉單檔部署優勢） | 很大 |

---

## 7. 我的建議（供參考，最終你決定）

如果要我排一個「投報比」順序：**先做 A1 + A2 + A3**（測試護體 + 常數外部化 + CJK 強化）——這三個低風險、直接解掉你目前最痛的「改東西容易崩、台灣評分不夠準」，而且是後面所有重構的地基。接著視興趣挑 **B2（STAR+R，最便宜的產品提升）** 和 **B1（驗活省成本）**。**B3 選擇性 LLM** 是你「確定性引擎 + 語意細膩」兩全的甜蜜點，值得中期做。**C 類（apply 自動化、資料模型重構、前端遷移）風險大、且會侵蝕你的單檔/零成本優勢，除非你明確要往那個方向轉型，否則我不建議現在碰。**

告訴我你想從哪幾項開始（例如「A1+A2+A3」或「先做 B2」），我就實際在你的 repo 上動手，並用 git 分開 commit 讓你逐一 review。
