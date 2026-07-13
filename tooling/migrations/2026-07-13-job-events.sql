-- ============================================================
-- Migration: Career Ops application status events (求職追蹤時間軸)
-- Date: 2026-07-13
--
-- 為什麼需要這張表：
--   cv_career_ops_jobs 只保存每個職缺的「目前狀態」，所以我們能算出
--   「幾個在面試中」，卻無法回答「一個職缺在『已投遞』坐了幾天」。
--   這張 append-only 事件表為每次狀態轉換記一列，解鎖 funnel /
--   conversion / dwell-time（停留天數）/ 每日 digest 分析。
--
-- 安全性：
--   一個 AFTER INSERT OR UPDATE trigger 會自動寫入事件，App 端不必記得
--   手動寫。RLS 只開放 select + insert（無 update / delete），對 client
--   而言是不可竄改的日誌。
--
-- 冪等性：全部使用 create ... if not exists / create or replace /
--   drop ... if exists，可以安全地重複執行。
--
-- 套用方式：到 Supabase → SQL Editor，貼上整份執行即可。
-- ============================================================

create table if not exists public.cv_career_ops_job_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_key text not null,
  from_status text not null default '',            -- '' for the first (insert) event
  to_status text not null default '',
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists cv_career_ops_job_events_user_key_idx
  on public.cv_career_ops_job_events (user_id, job_key, changed_at);
create index if not exists cv_career_ops_job_events_user_changed_idx
  on public.cv_career_ops_job_events (user_id, changed_at desc);

-- Auto-log: on insert, record the initial status; on status change, record
-- the transition. No-op when status is unchanged so we don't spam the log
-- on unrelated field updates.
create or replace function public.handle_cv_career_ops_job_status_event()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.cv_career_ops_job_events (user_id, job_key, from_status, to_status, changed_at)
    values (new.user_id, new.job_key, '', coalesce(new.status, ''), coalesce(new.updated_at, now()));
  elsif (tg_op = 'UPDATE' and coalesce(new.status, '') is distinct from coalesce(old.status, '')) then
    insert into public.cv_career_ops_job_events (user_id, job_key, from_status, to_status, changed_at)
    values (new.user_id, new.job_key, coalesce(old.status, ''), coalesce(new.status, ''), now());
  end if;
  return new;
end;
$$;

drop trigger if exists cv_career_ops_jobs_log_status on public.cv_career_ops_jobs;
create trigger cv_career_ops_jobs_log_status
after insert or update on public.cv_career_ops_jobs
for each row
execute function public.handle_cv_career_ops_job_status_event();

alter table public.cv_career_ops_job_events enable row level security;

-- Events are append-only from the user's perspective: they can read their own
-- timeline; inserts happen via the trigger (security definer context) but we
-- also allow direct self-inserts for backfill. No update/delete policy → the
-- log is immutable to clients.
drop policy if exists "Users can view own job events" on public.cv_career_ops_job_events;
create policy "Users can view own job events"
on public.cv_career_ops_job_events
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own job events" on public.cv_career_ops_job_events;
create policy "Users can insert own job events"
on public.cv_career_ops_job_events
for insert
with check (auth.uid() = user_id);
