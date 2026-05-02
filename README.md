# CV Studio

這是一個可安裝成 APP 的 CV 編輯器，支援：

- Google 登入
- 每位使用者編輯自己的 CV
- 模板切換
- 即時預覽
- 下載 PDF
- PWA 安裝成手機 / 桌面 APP

目前主畫面是 [index.html](index.html)，資料表設定在 [supabase-schema.sql](supabase-schema.sql)。

## 上線前設定

1. 到 Supabase 建立專案
2. 在 SQL Editor 執行 `supabase-schema.sql`
3. 到 `Authentication > Providers` 開啟 Google
4. 到 Google Cloud 建立 OAuth Client，回填到 Supabase
5. 到 `Authentication > URL Configuration` 加入你的網站網址與 redirect URL
6. 打開網站，在左側 `Supabase 設定` 填入：
   - `Supabase URL`
   - `Supabase Anon Key`
   - `Site URL`
7. 按 `套用設定`
8. 按 `Google 登入` 測試

如果你不想每次手動輸入，把 [config.example.js](config.example.js) 複製一份改名為 `config.js`，填入你的設定（`config.js` 已加入 `.gitignore`，不會被 commit）：

```js
window.CV_STUDIO_CONFIG = {
  supabaseUrl: "https://your-project.supabase.co",
  supabaseAnonKey: "your-anon-key",
  siteUrl: "",          // 留空會自動使用目前網址
  defaultTemplate: "n-tech"
};
```

專案現在改成用 `GitHub Pages` 部署。執行 `npm run build` 後，會自動把 `index.html`、`manifest.json`、`sw.js`、`icon.svg`、`config.js` 複製到 `dist/`，並補上 `404.html` 與 `.nojekyll`，讓 GitHub Pages 比較穩定。

## GitHub Pages 部署方式

1. 把專案推到 GitHub repository
2. 到 GitHub `Settings > Pages`
3. `Source` 選 `GitHub Actions`
4. 把專案根目錄的 `.github/workflows/deploy.yml` 一起推上去
5. 之後每次 push 到 `main`，GitHub 會自動重新部署

如果你的 Pages 網址是：

```text
https://你的帳號.github.io/你的-repo/
```

記得同步把這個網址加入：

1. Supabase `Authentication > URL Configuration` 的 `Site URL` 與 `Redirect URLs`
2. Google Cloud OAuth 允許的網址設定

另外，根目錄的 [config.js](config.js) 目前已把 `siteUrl` 留空，頁面會自動改用目前開啟的網址當作登入回跳位址；如果你想固定寫死成 GitHub Pages 網址，也可以手動填入。

## Google 登入實作方式

這個專案不是使用已淘汰的 Google Sign-In JavaScript 平台程式庫，也沒有載入 `https://apis.google.com/js/platform.js`、`gapi.auth2` 或 `g-signin2`。

目前網頁是透過 Supabase Auth 的 `signInWithOAuth({ provider: "google" })` 走標準 OAuth redirect flow：

- 前端只負責把使用者導向 Google / Supabase 的登入流程
- 登入完成後，Supabase 會把 session 帶回網站
- 資料庫存取再透過 Supabase session + RLS 控制每位使用者只能讀寫自己的 CV

這樣做的好處是：

- 不必直接整合已淘汰的 Google Sign-In 前端程式庫
- FedCM 對舊版 Google Sign-In 按鈕造成的相容性風險較低
- 前端程式碼更單純，登入狀態也直接和 Supabase 綁在一起

## FedCM / 淘汰影響評估

Google 官方已公告舊版 Google Sign-In for Web 程式庫已淘汰，且 FedCM 已是未來必要方向。這個專案目前不直接依賴那套前端程式庫，因此：

- 不需要在前端加入 `use_fedcm`
- 不需要接 `gapi.auth2.init()` 或 `g-signin2`
- 主要風險不在按鈕元件，而在 OAuth redirect URL 是否正確設定

上線前請至少確認：

1. 網站不是用 `file://` 開啟，而是 `http://localhost` 或正式 `https://` 網址
2. Supabase `Site URL` 與 `Redirect URLs` 已包含實際登入回跳網址
3. Google Cloud OAuth 設定中的 Authorized redirect / origin 已與 Supabase 文件要求一致
4. 在 Chrome 實測一次登入、回跳、重新整理後 session 保持、登出

## 使用方式

- 左側輸入履歷內容，右側即時預覽
- 模板可在 `Academic Warm / Slate / Mono / Serif Ivory / Forest / Rose / Midnight / Sand / Plum` 之間切換
- 登入後按 `儲存我的 CV`，會存到自己帳號的雲端資料
- 按 `下載 PDF` 可以把目前模板匯出成 PDF
- 若瀏覽器支援，按 `安裝 APP` 可直接安裝

## 模板欄位格式

工作 / 實習、學歷、專案這三區使用：

```text
標題 | 副標題 | 日期 | 內容
```

多筆內容之間空一行，例如：

```text
產品設計實習生 | 某某科技 | 2024 - 現在 | 負責後台流程與設計規格整理。

前端協作 | 自由接案 | 2023 - 2024 | 製作品牌官網與活動頁。
```

## 你接下來可以做的事

- 依照你的品牌或求職情境再延伸更多模板色系
- 接 Supabase Storage 上傳頭像或附件
- 增加多頁 CV / 中英雙語切換
- 補分享網址或公開作品頁
