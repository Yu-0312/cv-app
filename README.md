# CV Studio

> 一鍵建立、即時預覽、雲端儲存的 PWA 履歷編輯器

[English Version](README.en.md)

---

## 功能特色

- **Google 登入** — 透過 Supabase OAuth 安全驗證，資料自動綁定個人帳號
- **多套模板** — 9 種配色方案（Academic Warm、Slate、Mono、Serif Ivory、Forest、Rose、Midnight、Sand、Plum）
- **即時預覽** — 左側填寫，右側同步渲染
- **WYSIWYG 直接編輯** — 登入後可直接在預覽畫面點選欄位修改，無需切換表單
- **雲端儲存** — 登入後一鍵存取個人 CV 資料
- **PDF 匯出** — 保留模板樣式，完整匯出成 PDF
- **學習歷程（Portfolio）** — 獨立分頁，可建立章節式作品集並匯出 PDF
- **PWA 安裝** — 可安裝為手機或桌面 APP，支援離線快取

---

## 快速開始

### 前置需求

| 工具 | 說明 |
|------|------|
| [Supabase](https://supabase.com) 帳號 | 提供資料庫與 OAuth |
| Google Cloud 專案 | 建立 OAuth Client ID |
| GitHub 帳號（選用） | 免費部署至 GitHub Pages |

### 1. 設定 Supabase

1. 到 Supabase 建立新專案
2. 在 **SQL Editor** 貼上並執行 [`supabase-schema.sql`](supabase-schema.sql)
3. 到 **Authentication > Providers**，開啟 Google 登入
4. 到 [Google Cloud Console](https://console.cloud.google.com) 建立 OAuth Client，將 Client ID / Secret 回填到 Supabase
5. 到 **Authentication > URL Configuration**，加入你的網站網址與 redirect URL

### 2. 設定本機環境

複製設定檔範本並填入你的 Supabase 資訊：

```bash
cp config.example.js config.js
```

編輯 `config.js`：

```js
window.CV_STUDIO_CONFIG = {
  supabaseUrl: "https://your-project.supabase.co",
  supabaseAnonKey: "your-anon-key",
  canvaConnectUrl: "https://www.canva.com/",
  siteUrl: "",          // 留空會自動使用目前網址
  defaultTemplate: "n-tech"
};
```

> `config.js` 已列入 `.gitignore`，不會被 commit。

或者，你也可以開啟網站後在左側「**Supabase 設定**」欄位手動填入設定，按「套用設定」即可生效。

### 3. 建置與部署（GitHub Pages）

```bash
npm run build
# 輸出至 dist/，包含 index.html、manifest.json、sw.js、icon.svg、config.js、404.html、.nojekyll
```

部署步驟：

1. 將專案推送至 GitHub repository
2. 到 **Settings > Pages**，Source 選「**GitHub Actions**」
3. 確認 `.github/workflows/deploy.yml` 已推上去
4. 之後每次 push 到 `main`，會自動重新部署

> 若你的 Pages 網址是 `https://你的帳號.github.io/你的-repo/`，記得同步更新 Supabase 與 Google Cloud OAuth 的允許網址設定。

---

## 使用說明

### CV 編輯器

- 左側表單填入履歷內容，右側即時預覽
- 點選頂部模板切換鈕，可在 9 種配色之間切換
- 登入後按「**儲存我的 CV**」，資料存至雲端帳號
- 按「**下載 PDF**」匯出目前模板的 PDF
- 若瀏覽器支援，按「**安裝 APP**」直接安裝為本地應用程式

### 草稿模式（未登入）

未登入的訪客可自由瀏覽並在本機編輯草稿，但**無法儲存至雲端**。登入後才能將資料存入自己的帳號。

### WYSIWYG 直接編輯

登入後，在 CV 預覽或學習歷程頁面直接點選任意欄位即可編輯，修改結果即時同步，無需回到左側表單。

### 學習歷程（Portfolio）

切換上方「**學習歷程**」分頁，可建立章節式作品集，並支援匯出為 PDF。

---
## 模板欄位格式

工作經歷、學歷、專案、獎項這幾個區塊使用以下格式：

```
標題 | 副標題 | 日期 | 內容說明
```

多筆之間空一行，例如：

```
產品設計實習生 | 某某科技 | 2024 - 現在 | 負責後台流程與設計規格整理。

前端協作 | 自由接案 | 2023 - 2024 | 製作品牌官網與活動頁。
```

---

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | Vanilla JavaScript、單一 HTML 檔（無框架依賴） |
| 認證 | Supabase Auth + Google OAuth 2.0 |
| 資料庫 | Supabase PostgreSQL（JSONB 儲存 CV 內容） |
| 資料存取控制 | Row-Level Security（RLS）確保使用者只能讀寫自己的資料 |
| PDF 匯出 | html2pdf.js（CDN 載入，附備援） |
| PWA | Service Worker 快取策略，支援離線使用 |
| 部署 | GitHub Actions → GitHub Pages |

---

## 專案結構

```
CV-App/
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions 自動部署流程
├── index.html               # 主頁面（UI、樣式、應用程式邏輯全部在此）
├── sw.js                    # Service Worker，PWA 離線快取
├── manifest.json            # PWA 安裝設定
├── icon.svg                 # APP 圖示
├── supabase-schema.sql      # 資料庫結構與 RLS 規則
├── config.js                # 本機 Supabase 設定（不 commit）
├── config.example.js        # 設定檔範本
└── package.json             # npm 設定與 build 腳本
```

---

## Google 登入實作說明

本專案**不使用**已淘汰的 `google-signin2` / `gapi.auth2` 前端程式庫，而是透過 Supabase Auth 的 `signInWithOAuth({ provider: "google" })` 走標準 OAuth redirect flow：

- 前端只負責將使用者導向 Google 登入頁面
- 登入完成後，Supabase 自動帶回 session
- 資料庫透過 session + RLS 控制每位使用者只能存取自己的資料

**FedCM 相容性**：本專案不直接依賴舊版 Google Sign-In 前端程式庫，因此不需要額外處理 `use_fedcm` 旗標，相容性風險較低。

---

## 上線前確認清單

- [ ] 網站以 `http://localhost` 或正式 `https://` 開啟（非 `file://`）
- [ ] Supabase `Site URL` 與 `Redirect URLs` 已包含實際登入回跳網址
- [ ] Google Cloud OAuth 的 Authorized redirect / origin 已與 Supabase 文件要求一致
- [ ] 在 Chrome 實測：登入 → 回跳 → 重整 session 保持 → 登出

---

## 後續延伸方向

- 增加更多模板配色或自訂主題
- 串接 Supabase Storage 支援頭像上傳
- 多頁 CV 或中英雙語切換
- 公開分享網址或線上作品集頁面
