# Career Ops — 104 兩階段 Staging 串聯 Runbook

借鏡 [`m124578n/career_agent`](https://github.com/m124578n/career_agent) 的
「清單先進池、挑選後再限量抓詳情」做法，把 104 職缺以**兩階段**落進 Supabase，
達成跨批次的**去重**、**新鮮度追蹤**與**詳情 liveness** 檢查。整條路徑零外部依賴
（原生 `fetch` + `node:crypto`），並且**預設 dry-run**，不加旗標不會碰網路或寫 DB。

## 資料表（見 `tooling/supabase-schema.sql`）

- `career_ops_job_candidates`（Stage 1）— 便宜的清單資料。一列一職缺，
  `unique (source, external_id)`。追蹤 `first_seen_at` / `last_seen_at` /
  `seen_count`、`content_hash`（改版偵測）、`detail_status`
  （`pending`/`fetched`/`failed`/`stale`/`skipped`）與 `is_active`/`is_expired`。
- `career_ops_job_details`（Stage 2）— 節流後抓到的完整 JD。一列一候選，
  帶 `salary_min/max`、`salary_type`、`skills`、`tags`、`contact`、`raw_json`、
  `is_live`、`http_status`、`last_checked_at`。
- `career_ops_job_pool`（view，`security_invoker`）— 前端用的 join 面：
  只露出 `is_active and not is_expired` 的候選 + 其詳情。

RLS 沿用共用基礎設施慣例：`authenticated` 可讀、`service_role` 可寫。

## 兩階段流程

1. **Stage 1（去重 + 新鮮度）**
   - 讀 worker 快照（`career-ops-jobs.json`），過濾出 104 職缺、用
     `job104NoFromUrl()` 解出 `jobNo`，`stableJobKey()` 算跨來源去重鍵。
   - 對 DB 既有候選做 read-modify-write upsert：
     - 新職缺 → 插入，`detail_status='pending'`。
     - 再次出現且內容未變 → `seen_count += 1`、更新 `last_seen_at`，保留
       `first_seen_at` 與既有 `detail_status`。
     - 內容變動（`content_hash` 不同）→ 同上，但把 `detail_status` 重設為
       `pending`，讓 Stage 2 重抓。
     - 本輪快照缺席、DB 仍 active 的 → 標記 `is_active=false, is_expired=true`。

2. **Stage 2（節流詳情 + liveness）**
   - 挑 `detail_status='pending'` 的候選，限量（`--detail-limit`）。
   - 逐筆呼叫 `fetch104JobDetail()`（帶 per-job Referer）+ `normalize104Detail()`，
     每筆之間加 `randomDelay(--min-delay, --max-delay)` jitter，對 104 保持禮貌。
   - 抓到有效內容 → `is_live=true`、候選 `detail_status='fetched'`；抓到空殼 →
     `stale`；請求失敗 → `failed`。詳情 upsert 進 `career_ops_job_details`。

## 指令

```bash
# 1) Dry-run（預設）：只算 stage-1 候選 + 去重/新鮮度，不碰網路、不寫 DB。
#    產出本地 staging 快照 + Markdown 報告供 review。
npm run career-ops:staging

# 2) Probe：不寫 DB，只抓 3 筆詳情端點確認 104 還活著 / normalizer 正常。
npm run career-ops:staging:probe

# 3) 只推 Stage 1（候選去重 + 新鮮度）到 Supabase。
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run career-ops:staging:push

# 4) 推 Stage 1 + 節流抓 Stage 2 詳情（上限 40 筆）。
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run career-ops:staging:push-enrich

# 說明
npm run career-ops:staging:help
```

## 環境變數

| 變數 | 用途 |
| --- | --- |
| `SUPABASE_URL` | Supabase 專案 URL（僅 `--push` 需要） |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 金鑰，用於寫入 staging 表（僅 `--push` 需要） |

> service_role 金鑰只在批次環境（本機 / GitHub Actions secret）使用，
> **絕不**進前端。前端一律讀 `career_ops_job_pool` view（`authenticated` 唯讀）。

## 建議排程

在既有每日批次（`career-ops:daily`）之後接：先 `scrape` 產生新快照，
再 `career-ops:staging:push-enrich` 把 104 職缺落池並限量補詳情。
`--detail-limit` 控制每天補的詳情量，避免對 104 一次打太多。

## 疑難排解

- **詳情端點 403 / 空 body**：104 詳情 API 需要 per-job Referer，
  `fetch104JobDetail()` 已內建；若仍失敗多半是雲端 IP 被 WAF 擋，改從
  住宅 IP 或降低頻率。
- **Stage 1 全被標記 expired**：確認 `--source` 與快照裡的 104 URL 一致，
  且 DB 既有列的 `source` 欄位同樣是小寫 `104`。
- **想離線稽核**：dry-run 的 `--out` JSON 會附上完整候選列（含 `content_hash`），
  可直接 diff 兩次快照確認去重/改版判斷是否正確。
