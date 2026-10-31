-- ============================================================
-- Migration: 權限收斂（Security hardening）
-- Date: 2026-10-31
--
-- 修正 code review 找到的五個權限問題：
--   1. university_tw_* 8 張表沒有 RLS → anon key 可寫入/刪除
--   2. career_ops_shared_analyses、cv_public_profiles 可被整張列出
--      （RLS 無法強制「必須帶 slug」）→ 改由 security definer RPC 一次取一筆
--   3. storage「Public can read cv-images」讓匿名者能 list 整個 bucket
--   4. pg_notify_career_ops_analysis 是 security definer、EXECUTE 開給 PUBLIC
--   5. 分享連結有效期上限只寫在 Edge Function，直接 insert 可繞過
--
-- 套用順序：先執行本 migration，再立刻合併前端（app/index.html）並部署兩支
-- Edge Function——新版前端與函式改用 get_public_profile / get_shared_analysis
-- 這兩個 RPC。中間幾分鐘（GitHub Pages 部署期間）舊版公開履歷頁會讀不到資料。
--
-- 冪等：可安全重複執行。套用方式：Supabase → SQL Editor 貼上整份執行。
-- ============================================================

-- ------------------------------------------------------------
-- 1. University TW 快照：開啟 RLS，前端只能讀
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'university_tw_snapshots',
    'university_tw_universities',
    'university_tw_uac_departments',
    'university_tw_caac_departments',
    'university_tw_caac_scores',
    'university_tw_star_departments',
    'university_tw_gender_departments',
    'university_tw_registration_departments'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (true)',
        t || '_public_read', t
      );
      execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2a. 公開履歷：只有本人能 select 自己那列；訪客改用 RPC 依 slug 取一筆
-- ------------------------------------------------------------
drop policy if exists "Anyone can view public CV shares" on public.cv_public_profiles;
drop policy if exists "Users can view own public CV share" on public.cv_public_profiles;
create policy "Users can view own public CV share"
on public.cv_public_profiles
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.get_public_profile(p_slug text)
returns table (content jsonb, template_id text, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.content, p.template_id, p.title
  from public.cv_public_profiles p
  where p.slug = p_slug
  limit 1;
$$;

revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 2b. 分析分享：同上，訪客只能依 slug 取一筆未過期快照，且不回傳 user_id
-- ------------------------------------------------------------
drop policy if exists "Anyone can view shared analysis by slug" on public.career_ops_shared_analyses;
drop policy if exists "Users can view own shared analyses" on public.career_ops_shared_analyses;
create policy "Users can view own shared analyses"
on public.career_ops_shared_analyses
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.get_shared_analysis(p_slug text)
returns table (snapshot_json jsonb, expires_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.snapshot_json, s.expires_at, s.created_at
  from public.career_ops_shared_analyses s
  where s.slug = p_slug
    and s.expires_at > now()
  limit 1;
$$;

revoke all on function public.get_shared_analysis(text) from public;
grant execute on function public.get_shared_analysis(text) to anon, authenticated;

-- 5. 有效期上限放到資料庫（NOT VALID：不檢查既有資料，只約束新資料）
alter table public.career_ops_shared_analyses
  drop constraint if exists career_ops_shared_analyses_expiry_cap;
alter table public.career_ops_shared_analyses
  add constraint career_ops_shared_analyses_expiry_cap
  check (expires_at <= created_at + interval '30 days') not valid;

-- ------------------------------------------------------------
-- 3. Storage：拿掉公開 list；本人仍可讀自己的物件（upsert 需要 select）
--    Public bucket 的公開網址不經過 RLS，分享頁圖片照常顯示。
-- ------------------------------------------------------------
drop policy if exists "Public can read cv-images" on storage.objects;
drop policy if exists "Users can read own images" on storage.objects;
create policy "Users can read own images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'cv-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ------------------------------------------------------------
-- 4. Worker 通知函式：固定 search_path，只給 service_role 執行
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.pg_notify_career_ops_analysis(uuid, uuid, uuid)') is not null then
    alter function public.pg_notify_career_ops_analysis(uuid, uuid, uuid) set search_path = '';
    revoke all on function public.pg_notify_career_ops_analysis(uuid, uuid, uuid) from public, anon, authenticated;
    grant execute on function public.pg_notify_career_ops_analysis(uuid, uuid, uuid) to service_role;
  end if;
end $$;
