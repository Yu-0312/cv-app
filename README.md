# CV Studio

> 一個整合履歷、學習歷程、求職顧問與學測落點分析的 PWA 工作台。

[English Version](README.en.md)

正式站：<https://yu-0312.github.io/cv-app/>

CV Studio 是一個無框架的單頁 Web App，主打「打開就能用」的履歷與申請資料整理流程。未登入時可使用本機草稿；登入 Google 後可透過 Supabase 將 CV 資料綁定到個人帳號，並在 GitHub Pages 上自動部署。

## 功能亮點

- **CV 履歷編輯器**：28 種履歷模板、即時預覽、版面微調、PDF 預覽與匯出。
- **WYSIWYG 直接編輯**：可在履歷預覽中直接點選欄位修改內容。
- **Google 登入與雲端同步**：使用 Supabase Auth + Google OAuth，搭配 RLS 保護個人資料。
- **未登入草稿模式**：未登入時可編輯本機草稿；登出後會回到未登入草稿，不殘留雲端個資。
- **學習歷程 Portfolio**：章節式作品集、圖片與成果摘要整理，支援 PDF 匯出。
- **Career 求職顧問**：可讀取 CV 摘要、分析職缺適配度、推薦崗位、產生面試準備與求職信。
- **學測落點分析**：支援 115 學年度校系資料、University TW 快照與 104 落點資料匯入流程。
- **PWA 支援**：可安裝為桌面或手機 App，並透過 Service Worker 提供離線快取。

## 快速開始

### 需求

- Node.js 20 或以上
- Supabase 專案
- Google Cloud OAuth Client
- GitHub repository（若要使用 GitHub Pages 部署）

### 安裝

```bash
npm install
```

### 設定 Supabase

如果你 fork 或自架這個專案，請先複製設定檔範本，或直接更新既有的 `config.js`：

```bash
cp config.example.js config.js
```

編輯 `config.js`：

```js
window.CV_STUDIO_CONFIG = {
  supabaseUrl: "https://your-project.supabase.co",
  supabaseAnonKey: "your-anon-key",
  siteUrl: "https://your-username.github.io/your-repo/",
  canvaConnectUrl: "https://www.canva.com/",
  defaultTemplate: "n-tech"
};
```

Supabase anon key 是前端可公開使用的 key，但仍需要搭配資料庫 RLS。若要改成自己的專案，請同步更新 Supabase 與 Google OAuth 的允許網址。正式部署時，GitHub Actions 會在沒有 `config.js` 的情況下產生安全 fallback；若要啟用正式登入，請確保部署環境有正確設定檔或在前端設定面板填入 Supabase 資訊。

### 建置

```bash
npm run build
```

輸出會寫入 `dist/`，包含：

- `index.html`
- `404.html`
- `manifest.json`
- `sw.js`
- `config.js`
- `data/app/*`
- `.nojekyll`

### 測試

```bash
npm run smoke:test
```

Smoke test 會先建置 `dist/`，再用 headless Chrome 檢查主要流程：

- Google 登入與登出 UI 狀態
- 登出後清除 session 並恢復未登入草稿
- Career 頁基本互動
- 學測落點分析正向流程與 fallback
- 模板 placeholder 一致性

## 部署到 GitHub Pages

本專案已內建 `.github/workflows/deploy.yml`。

1. 將 repository 推到 GitHub。
2. 到 **Settings > Pages**。
3. Source 選擇 **GitHub Actions**。
4. 每次 push 到 `main` 都會自動建置並部署 `dist/`。

目前正式站：

```text
https://yu-0312.github.io/cv-app/
```

如果更換 GitHub Pages 網址，請同步更新：

- `config.js` 的 `siteUrl`
- Supabase Authentication 的 Site URL / Redirect URLs
- Google Cloud OAuth 的 Authorized JavaScript origins / redirect URIs

Google OAuth 無法從 `file://` 本機檔案模式正常回跳。請使用 `http://localhost` 或正式 `https://` 網址測試登入。

## 使用方式

### CV 履歷

- 在表單區輸入資料，預覽區會即時更新。
- 可切換模板、調整版面、套用職位推薦模板。
- 支援 JSON 匯入/匯出、快照、復原/重做、QR Code、PDF 預覽與下載。

### 未登入與登入資料

- 未登入：資料只保存在目前瀏覽器的本機草稿。
- 登入後：可讀取與儲存 Supabase 雲端 CV。
- 登出後：系統會清除 Supabase session，並恢復未登入草稿，避免雲端個資殘留在未登入畫面。

### 學習歷程

Portfolio 分頁可建立章節式作品集，支援封面、章節、小節、圖片與摘要內容，適合整理備審資料或作品紀錄。

### Career 求職顧問

Career 分頁可使用履歷摘要與職缺描述，產生：

- 職位適配度分析
- 推薦崗位
- STAR 面試故事
- 求職信草稿

API Key 只保留在目前瀏覽器頁籤的 `sessionStorage`，不會寫入 Supabase。

### 學測落點

GSAT 分頁整合本地快照資料，支援依學測成績、學校、科系與資料覆蓋狀態進行分析。資料來源與補查紀錄請見 [gsat-source-audit.md](gsat-source-audit.md)。

## 常用指令

| 指令 | 用途 |
|------|------|
| `npm run build` | 建置靜態網站到 `dist/` |
| `npm run smoke:test` | 建置並跑主要互動 smoke test |
| `npm run university-tw:scrape` | 抓取 University TW 靜態資料 |
| `npm run university-tw:build` | 產生前端可載入的 University TW app data |
| `npm run university-tw:sql` | 產生 Supabase / PostgreSQL seed SQL |
| `npm run gsat:104:standard` | 下載 104 公開五標資料 |
| `npm run gsat:104:major-list` | 用指定分數抓取 104 校系列表 |
| `npm run gsat:build` | 整理 GSAT external data 給前端載入 |

## 資料管線

### University TW 快照

```bash
npm run university-tw:scrape
npm run university-tw:build
npm run university-tw:sql
```

主要輸出：

```text
data/raw/university-tw-site.json
data/app/university-tw-app-data.js
data/app/university-tw-app-data.json
data/sql/university-tw-seed.sql
```

若要匯入 Supabase，先執行：

```text
supabase-university-tw-schema.sql
```

再匯入：

```text
data/sql/university-tw-seed.sql
```

### 104 學測資料

```bash
npm run gsat:104:standard
npm run gsat:104:major-list
npm run gsat:build
```

也支援 browser capture 與 HAR 轉換流程：

```bash
npm run gsat:104:browser:probe
npm run gsat:104:browser:capture
node scripts/import-104-gsat.mjs extract-har exports/104-session.har --score-year 115 --out data/normalized/104-gsat-115.json
```

更多細節請見：

- [data/README.md](data/README.md)
- [gsat-source-audit.md](gsat-source-audit.md)

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | Vanilla JavaScript、單一 `index.html` |
| 認證 | Supabase Auth + Google OAuth 2.0 |
| 資料庫 | Supabase PostgreSQL / JSONB |
| 權限 | Row-Level Security，使用者只能讀寫自己的資料 |
| PDF | html2pdf.js |
| AI | 使用者自行提供 API Key，支援 Anthropic、OpenAI、Google Gemini、Groq |
| PWA | `manifest.json` + `sw.js` |
| 部署 | GitHub Actions + GitHub Pages |

## 專案結構

```text
CV App/
├── .github/workflows/deploy.yml
├── data/
│   ├── app/
│   ├── normalized/
│   ├── raw/
│   └── sql/
├── scripts/
├── index.html
├── sw.js
├── manifest.json
├── icon.svg
├── config.js
├── config.example.js
├── supabase-schema.sql
├── supabase-university-tw-schema.sql
├── package.json
└── README.md
```

## Google 登入備註

本專案不使用已淘汰的 `google-signin2` 或 `gapi.auth2`。登入流程由 Supabase Auth 接管：

1. 前端呼叫 `signInWithOAuth({ provider: "google" })`。
2. 使用者前往 Google 完成登入。
3. Supabase 帶回 session。
4. 前端依 session 讀寫 `cv_profiles`。

由於資料庫層使用 RLS，每個使用者只能存取自己的 CV profile。

## 上線檢查清單

- [ ] 正式站使用 `https://`，不是 `file://`
- [ ] Supabase Site URL / Redirect URLs 已包含正式網址
- [ ] Google Cloud OAuth origins / redirect URIs 已同步
- [ ] Chrome 實測登入、刷新、登出、再次刷新
- [ ] `npm run smoke:test` 通過
- [ ] GitHub Pages workflow 部署成功

## 後續方向

- Supabase Storage 頭像與附件上傳
- 履歷公開分享頁
- 多頁 CV
- 更完整的中英雙語履歷切換
- 自動化學測資料定期更新
