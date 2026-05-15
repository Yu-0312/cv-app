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
