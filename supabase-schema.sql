-- Run this in Supabase SQL Editor
-- 1. Enable Google provider in Authentication > Providers
-- 2. Add your site URL and redirect URL in Authentication > URL Configuration

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
