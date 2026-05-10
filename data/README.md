# GSAT 外部資料格式

這個目錄用來收納第三方學測落點來源，不直接把所有外部資料硬塞回 `index.html`。

## 目錄建議

```text
data/
├── raw/
│   ├── 104-standard-115.json
│   └── university-tw-site.json
├── normalized/
│   └── 104-gsat-115.json
```

## University TW 全站資料

現在這個目錄也會收納 `University TW` 的完整抓取結果。

```text
data/
├── raw/
│   ├── 104-standard-115.json
│   └── university-tw-site.json
└── normalized/
    └── 104-gsat-115.json
```

抓取指令：

```bash
npm run university-tw:help
npm run university-tw:scrape
npm run university-tw:build
npm run university-tw:sql
```

`data/raw/university-tw-site.json` 會包含：

- `uac`：分發入學學校頁與校系列表
- `caac`：個人申請學校頁、校系列表、單一校系明細頁
- `star`：繁星推薦學校頁、校系列表、單一校系明細頁
- `female`：男女比總覽與各校系男女比明細
- `register`：註冊率總覽與各校系註冊率明細

另外兩個衍生產物會是：

- `data/app/university-tw-app-data.js`
- `data/app/university-tw-app-data.json`
- `data/sql/university-tw-seed.sql`

用途：

- `data/app/*`：給前端直接載入，讓學測分析頁能顯示校系摘要
- `data/sql/*`：給 Supabase / PostgreSQL 匯入，建立正式資料表內容

目前實際抓取量：

- `uacSchools`: 60
- `uacDepartments`: 1717
- `caacSchools`: 123
- `caacDepartments`: 2674
- `starSchools`: 64
- `starDepartments`: 1612
- `femaleSchools`: 125
- `registerSchools`: 125

## 正規化 JSON 結構

`normalized/*.json` 建議使用以下欄位：

```json
{
  "source": "104",
  "extractedAt": "2026-05-10T12:34:56.000Z",
  "scoreYear": 115,
  "inputMethod": "direct-api",
  "requestCount": 4,
  "majorCount": 120,
  "requestSummaries": [],
  "majors": [
    {
      "source": "104",
      "scoreYear": 115,
      "endpoint": "/api/v1.0/hs/majorList",
      "schoolName": "國立臺灣大學",
      "departmentName": "資訊工程學系",
      "schoolTypeName": "公立一般大學",
      "reportRisk": 2,
      "firstStage": {
        "power": [],
        "standard": [
          { "level": "前", "name": "英文" },
          { "level": "頂", "name": "數學A" }
        ]
      },
      "lowScorePreYear": [],
      "lowScoreThisYear": []
    }
  ]
}
```

## 匯入流程

1. 直接用一組有效學測分數抓 104 校系列表。
2. 或者，在瀏覽器完成一次 104 落點查詢並從 DevTools 匯出 HAR。
3. 執行：

```bash
npm run gsat:104:help
npm run gsat:104:major-list
npm run gsat:104:browser:capture
node scripts/import-104-gsat.mjs extract-capture data/raw/104-browser-capture.json --score-year 115 --out data/normalized/104-gsat-115-browser.json
node scripts/import-104-gsat.mjs extract-har exports/104-session.har --score-year 115 --out data/normalized/104-gsat-115.json
node scripts/import-104-gsat.mjs summarize data/normalized/104-gsat-115.json
npm run gsat:build
```

補充：

- `browser:capture` 會攔截真實瀏覽器裡的 `landingPoint` / `majorList` 回應。
- 未登入狀態下，104 目前只顯示前 20 筆，因此要做更完整的擷取仍需要登入態。

`npm run gsat:build` 會再把 `normalized/*.json` 轉成：

- `data/app/gsat-external-data.js`
- `data/app/gsat-external-data.json`
- `data/app/gsat-external-report.md`

其中 `gsat-external-data.js` 會被前端自動載入，等於是外掛式補充目前 `index.html` 內建的 `DEPTS`。

## 為什麼要先正規化

- `104`、`1111`、`CEIP` 的欄位命名不會一樣。
- 先轉成統一格式，後面才能穩定合併、比對、去重。
- 這樣也能避免把第三方來源結構直接綁死在 `index.html` 的 `DEPTS` 常數裡。
