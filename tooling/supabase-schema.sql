-- Run this in Supabase SQL Editor
-- 1. Enable Google provider in Authentication > Providers
-- 2. Add your site URL and redirect URL in Authentication > URL Configuration
-- 3. Create the cv-images storage bucket (see bottom of this file).
--    The same public bucket stores avatars, generated share preview images,
--    portfolio images, and portfolio attachments.

create table if not exists public.cv_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  template_id text not null default 'n-tech',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_cv_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cv_profiles_set_updated_at on public.cv_profiles;
create trigger cv_profiles_set_updated_at
before update on public.cv_profiles
for each row
execute function public.handle_cv_profiles_updated_at();

alter table public.cv_profiles enable row level security;

drop policy if exists "Users can view own CV" on public.cv_profiles;
create policy "Users can view own CV"
on public.cv_profiles
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own CV" on public.cv_profiles;
create policy "Users can insert own CV"
on public.cv_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own CV" on public.cv_profiles;
create policy "Users can update own CV"
on public.cv_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own CV" on public.cv_profiles;
create policy "Users can delete own CV"
on public.cv_profiles
for delete
using (auth.uid() = user_id);

-- ============================================================
-- CAREER OPS TRACKER
-- Stores the user's normalized job tracker, evaluations, CRM state,
-- feedback, and tailored application packs. The public job collection
-- still runs in scripts/career-ops-worker.mjs; this table is only for
-- each user's private tracking layer.
-- ============================================================

create table if not exists public.cv_career_ops_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_key text not null,
  title text not null default '',
  company text not null default '',
  url text not null default '',
  location text not null default '',
  description text not null default '',
  source text not null default '',
  source_type text not null default '',
  status text not null default '待評估',
  score integer,
  grade text not null default '',
  recommendation text not null default '',
  notes text not null default '',
  contact_name text not null default '',
  contact_email text not null default '',
  next_follow_up_at timestamptz,
  feedback text not null default '',
  evaluation jsonb,
  tailored jsonb,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  is_new boolean not null default false,
  is_expired boolean not null default false,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_key)
);

drop trigger if exists cv_career_ops_jobs_set_updated_at on public.cv_career_ops_jobs;
create trigger cv_career_ops_jobs_set_updated_at
before update on public.cv_career_ops_jobs
for each row
execute function public.handle_cv_profiles_updated_at();

alter table public.cv_career_ops_jobs enable row level security;

drop policy if exists "Users can view own Career Ops jobs" on public.cv_career_ops_jobs;
create policy "Users can view own Career Ops jobs"
on public.cv_career_ops_jobs
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own Career Ops jobs" on public.cv_career_ops_jobs;
create policy "Users can insert own Career Ops jobs"
on public.cv_career_ops_jobs
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own Career Ops jobs" on public.cv_career_ops_jobs;
create policy "Users can update own Career Ops jobs"
on public.cv_career_ops_jobs
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own Career Ops jobs" on public.cv_career_ops_jobs;
create policy "Users can delete own Career Ops jobs"
on public.cv_career_ops_jobs
for delete
using (auth.uid() = user_id);

-- ============================================================
-- CAREER OPS — APPLICATION STATUS EVENTS (求職追蹤時間軸)
-- One row per status transition of a tracked job. This is the event log
-- that unlocks funnel / conversion / dwell-time analytics: cv_career_ops_jobs
-- only stores the *current* status, so we can count "how many are in
-- interviewing" but not "how long a job sat in 已投遞". A trigger auto-logs
-- every status change, so the app doesn't have to remember to write events.
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

-- ============================================================
-- PUBLIC SHARE PAGES
-- One public snapshot per user. Owners can publish/update/delete
-- their own snapshot; anyone can read by slug.
-- ============================================================

create table if not exists public.cv_public_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique,
  title text,
  template_id text not null default 'n-tech',
  content jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists cv_public_profiles_set_updated_at on public.cv_public_profiles;
create trigger cv_public_profiles_set_updated_at
before update on public.cv_public_profiles
for each row
execute function public.handle_cv_profiles_updated_at();

alter table public.cv_public_profiles enable row level security;

drop policy if exists "Anyone can view public CV shares" on public.cv_public_profiles;
create policy "Anyone can view public CV shares"
on public.cv_public_profiles
for select
using (true);

drop policy if exists "Users can insert own public CV share" on public.cv_public_profiles;
create policy "Users can insert own public CV share"
on public.cv_public_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own public CV share" on public.cv_public_profiles;
create policy "Users can update own public CV share"
on public.cv_public_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own public CV share" on public.cv_public_profiles;
create policy "Users can delete own public CV share"
on public.cv_public_profiles
for delete
using (auth.uid() = user_id);

-- ============================================================
-- STORAGE: cv-images bucket
-- Run once in Supabase SQL Editor after creating the bucket
-- in Storage > New Bucket (name: cv-images, Public: ON).
-- Objects are organized under auth.uid() folders:
--   {user_id}/avatar-*.*
--   {user_id}/share-og/*.png
--   {user_id}/portfolio-assets/*.*
-- ============================================================

-- Allow any authenticated user to upload into their own folder
drop policy if exists "Users can upload own images" on storage.objects;
create policy "Users can upload own images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'cv-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to update/replace their own images
drop policy if exists "Users can update own images" on storage.objects;
create policy "Users can update own images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'cv-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to delete their own images
drop policy if exists "Users can delete own images" on storage.objects;
create policy "Users can delete own images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cv-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow everyone (including anon) to read images (for public CV preview & PDF)
drop policy if exists "Public can read cv-images" on storage.objects;
create policy "Public can read cv-images"
on storage.objects
for select
to public
using (bucket_id = 'cv-images');

-- ============================================================
-- CAREER OPS SAAS — ANALYSIS LAYER
-- Stores per-user analysis requests, results, and job health
-- snapshots. Designed for a SaaS flow where:
--   1. User uploads resume → stored in career_ops_user_profiles
--   2. Analysis job queued → tracked in career_ops_analyses
--   3. Results saved →      career_ops_analyses.results_json
--   4. Share link →         career_ops_shared_analyses
--   5. Job health cron →    career_ops_job_health_log
-- ============================================================

-- Per-user Career Ops profile (extracted from uploaded resume or filled form)
create table if not exists public.career_ops_user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null default 1,
  source text not null default 'manual',         -- 'manual' | 'pdf_upload' | 'cv_import'
  profile_json jsonb not null default '{}'::jsonb, -- normalized profile (role, skills, experience, etc.)
  raw_text text not null default '',               -- original resume text for re-extraction
  is_active boolean not null default true,         -- only one active profile per user
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists career_ops_user_profiles_set_updated_at on public.career_ops_user_profiles;
create trigger career_ops_user_profiles_set_updated_at
before update on public.career_ops_user_profiles
for each row execute function public.handle_cv_profiles_updated_at();

alter table public.career_ops_user_profiles enable row level security;

drop policy if exists "Users can view own Career Ops profiles" on public.career_ops_user_profiles;
create policy "Users can view own Career Ops profiles"
on public.career_ops_user_profiles for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own Career Ops profiles" on public.career_ops_user_profiles;
create policy "Users can insert own Career Ops profiles"
on public.career_ops_user_profiles for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own Career Ops profiles" on public.career_ops_user_profiles;
create policy "Users can update own Career Ops profiles"
on public.career_ops_user_profiles for update
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Analysis queue: tracks each run of the pipeline for a user
create table if not exists public.career_ops_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid references public.career_ops_user_profiles(id) on delete set null,
  status text not null default 'queued',           -- queued | running | completed | failed
  stage text not null default '',                  -- current pipeline stage (for progress reporting)
  progress integer not null default 0,             -- 0-100
  error text,
  -- Output layers (populated when status = completed)
  summary_json jsonb,                              -- { totalResults, layerA, layerB, layerC, ... }
  layer_a_json jsonb,                              -- Full dossiers (top 25)
  layer_b_json jsonb,                              -- Standard matches (top 40)
  layer_c_json jsonb,                              -- Exploratory signals (top 30)
  decision_report_json jsonb,                      -- Decision report
  job_snapshot_hash text,                          -- Hash of job DB at time of analysis (for cache invalidation)
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists career_ops_analyses_set_updated_at on public.career_ops_analyses;
create trigger career_ops_analyses_set_updated_at
before update on public.career_ops_analyses
for each row execute function public.handle_cv_profiles_updated_at();

alter table public.career_ops_analyses enable row level security;

drop policy if exists "Users can view own analyses" on public.career_ops_analyses;
create policy "Users can view own analyses"
on public.career_ops_analyses for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own analyses" on public.career_ops_analyses;
create policy "Users can insert own analyses"
on public.career_ops_analyses for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own analyses" on public.career_ops_analyses;
create policy "Users can update own analyses"
on public.career_ops_analyses for update
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Shared analysis snapshots (public read via slug, expires after 7 days by default)
create table if not exists public.career_ops_shared_analyses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                        -- random short slug (e.g. 'abc123xy')
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid not null references public.career_ops_analyses(id) on delete cascade,
  -- Frozen snapshot (so edits don't change what the link shows)
  snapshot_json jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

alter table public.career_ops_shared_analyses enable row level security;

drop policy if exists "Anyone can view shared analysis by slug" on public.career_ops_shared_analyses;
create policy "Anyone can view shared analysis by slug"
on public.career_ops_shared_analyses for select
using (expires_at > now());

drop policy if exists "Users can create own shared analyses" on public.career_ops_shared_analyses;
create policy "Users can create own shared analyses"
on public.career_ops_shared_analyses for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own shared analyses" on public.career_ops_shared_analyses;
create policy "Users can delete own shared analyses"
on public.career_ops_shared_analyses for delete
using (auth.uid() = user_id);

-- Job health log: tracks expiry rate over time for the shared job database
create table if not exists public.career_ops_job_health_log (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default now(),
  total_jobs integer not null default 0,
  active_jobs integer not null default 0,
  expired_jobs integer not null default 0,
  stale_jobs integer not null default 0,
  expired_rate numeric(5,4) not null default 0,    -- e.g. 0.2800 = 28%
  status text not null default 'healthy',          -- healthy | warning | degraded | critical
  scrape_triggered boolean not null default false,
  threshold numeric(5,4) not null default 0.30
);

alter table public.career_ops_job_health_log enable row level security;

-- Health log is read-only for all authenticated users (shared infrastructure visibility)
drop policy if exists "Authenticated users can read job health log" on public.career_ops_job_health_log;
create policy "Authenticated users can read job health log"
on public.career_ops_job_health_log for select to authenticated using (true);

-- Service role (Edge Function) can insert health log entries
drop policy if exists "Service role can insert job health log" on public.career_ops_job_health_log;
create policy "Service role can insert job health log"
on public.career_ops_job_health_log for insert to service_role with check (true);

-- pg_notify helper called by career-ops-run-analysis Edge Function to wake the worker
create or replace function public.pg_notify_career_ops_analysis(
  analysis_id uuid,
  user_id uuid,
  profile_id uuid
) returns void language plpgsql security definer as $$
begin
  perform pg_notify(
    'career_ops_analysis_queued',
    json_build_object(
      'analysis_id', analysis_id,
      'user_id', user_id,
      'profile_id', profile_id
    )::text
  );
end;
$$;

-- Helpful indexes
create index if not exists career_ops_analyses_user_id_idx on public.career_ops_analyses (user_id);
create index if not exists career_ops_analyses_status_idx on public.career_ops_analyses (status);
create index if not exists career_ops_shared_analyses_slug_idx on public.career_ops_shared_analyses (slug);
create index if not exists career_ops_job_health_log_checked_at_idx on public.career_ops_job_health_log (checked_at desc);

-- ============================================================
-- CAREER OPS — 104 STAGING POOL (two-stage 串聯 / two-stage linking)
-- Evolves the old "one big JSON snapshot" model into a persisted,
-- deduped, two-stage job pool inspired by the 104-job-tracker pattern:
--
--   Stage 1 (cheap, no detail cost):
--     crawl the 104 search list JSON API  →  career_ops_job_candidates
--   Stage 2 (throttled, on-demand):
--     fetch the 104 detail JSON API        →  career_ops_job_details
--
-- Dedup key:  (source, external_id)  e.g. ('104', jobNo).
-- job_key mirrors scripts/lib/utils.mjs stableJobKey() for cross-source dedup.
-- Freshness:  first_seen_at / last_seen_at / seen_count + is_expired,
--             so daily runs can tell "new / still-live / gone (expired)".
-- Liveness:   career_ops_job_details.is_live + http_status let the pipeline
--             drop dead links before expensive recompute.
--
-- Access mirrors career_ops_job_health_log (shared infrastructure):
--   read  = any authenticated user
--   write = service_role only (the crawler / staging script)
--
-- When you add/rename columns, bump schema_version on write and keep the
-- frontend guarding on it so a shape change never silently breaks the UI.
-- ============================================================

-- Stage 1 — candidate pool (one row per live 104 posting, cheap list fields)
create table if not exists public.career_ops_job_candidates (
  id uuid primary key default gen_random_uuid(),
  source text not null,                              -- '104' | 'yourator' | ...
  external_id text not null,                         -- per-source stable id (104 jobNo)
  job_key text not null default '',                  -- stableJobKey() url:... (cross-source dedup)
  title text not null default '',
  company text not null default '',
  url text not null default '',
  location text not null default '',
  salary_desc text not null default '',
  employment_type text not null default '',
  appear_date text not null default '',              -- raw 104 appearDate
  market text not null default 'tw',
  list_json jsonb not null default '{}'::jsonb,       -- raw stage-1 list row (audit / re-normalize)
  content_hash text not null default '',             -- hash of meaningful fields (repost / change detection)
  detail_status text not null default 'pending',     -- pending | fetched | failed | stale | skipped
  detail_fetched_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  is_active boolean not null default true,
  is_expired boolean not null default false,
  expired_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

drop trigger if exists career_ops_job_candidates_set_updated_at on public.career_ops_job_candidates;
create trigger career_ops_job_candidates_set_updated_at
before update on public.career_ops_job_candidates
for each row execute function public.handle_cv_profiles_updated_at();

alter table public.career_ops_job_candidates enable row level security;

drop policy if exists "Authenticated users can read job candidates" on public.career_ops_job_candidates;
create policy "Authenticated users can read job candidates"
on public.career_ops_job_candidates for select to authenticated using (true);

drop policy if exists "Service role can write job candidates" on public.career_ops_job_candidates;
create policy "Service role can write job candidates"
on public.career_ops_job_candidates for all to service_role using (true) with check (true);

-- Stage 2 — enriched detail (one row per candidate, fetched on demand)
create table if not exists public.career_ops_job_details (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.career_ops_job_candidates(id) on delete cascade,
  source text not null,
  external_id text not null,
  job_key text not null default '',
  description text not null default '',              -- full JD (stage-2)
  requirements text not null default '',
  salary_min integer,
  salary_max integer,
  salary_type text not null default '',              -- monthly | yearly | hourly | negotiable | ''
  salary_desc text not null default '',
  work_experience text not null default '',
  education text not null default '',
  industry text not null default '',
  headcount text not null default '',
  skills jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,        -- raw 104 detail payload
  detail_hash text not null default '',
  is_live boolean not null default true,             -- liveness check result
  http_status integer,
  last_checked_at timestamptz,
  schema_version integer not null default 1,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

drop trigger if exists career_ops_job_details_set_updated_at on public.career_ops_job_details;
create trigger career_ops_job_details_set_updated_at
before update on public.career_ops_job_details
for each row execute function public.handle_cv_profiles_updated_at();

alter table public.career_ops_job_details enable row level security;

drop policy if exists "Authenticated users can read job details" on public.career_ops_job_details;
create policy "Authenticated users can read job details"
on public.career_ops_job_details for select to authenticated using (true);

drop policy if exists "Service role can write job details" on public.career_ops_job_details;
create policy "Service role can write job details"
on public.career_ops_job_details for all to service_role using (true) with check (true);

-- Staging pool indexes
create index if not exists career_ops_job_candidates_source_status_idx
  on public.career_ops_job_candidates (source, detail_status);
create index if not exists career_ops_job_candidates_job_key_idx
  on public.career_ops_job_candidates (job_key);
create index if not exists career_ops_job_candidates_last_seen_idx
  on public.career_ops_job_candidates (last_seen_at desc);
create index if not exists career_ops_job_candidates_active_idx
  on public.career_ops_job_candidates (is_active, is_expired);
create index if not exists career_ops_job_details_job_key_idx
  on public.career_ops_job_details (job_key);
create index if not exists career_ops_job_details_live_idx
  on public.career_ops_job_details (is_live);

-- Convenience join surface for the frontend: live candidates + their detail.
-- security_invoker = true → the base tables' RLS applies to the caller.
drop view if exists public.career_ops_job_pool;
create view public.career_ops_job_pool
with (security_invoker = true) as
select
  c.source,
  c.external_id,
  c.job_key,
  c.title,
  c.company,
  c.url,
  c.location,
  coalesce(nullif(d.salary_desc, ''), c.salary_desc) as salary_desc,
  d.salary_min,
  d.salary_max,
  d.salary_type,
  coalesce(d.description, '')                         as description,
  d.skills,
  d.industry,
  d.education,
  d.work_experience,
  c.detail_status,
  coalesce(d.is_live, true)                           as is_live,
  c.first_seen_at,
  c.last_seen_at,
  c.seen_count,
  c.is_active,
  c.is_expired
from public.career_ops_job_candidates c
left join public.career_ops_job_details d
  on d.source = c.source and d.external_id = c.external_id
where c.is_active and not c.is_expired;
