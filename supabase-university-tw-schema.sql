-- Run this in Supabase SQL Editor before importing data/sql/university-tw-seed.sql

create table if not exists public.university_tw_snapshots (
  snapshot_id text primary key,
  source_name text not null default 'University TW',
  source_url text,
  generated_at timestamptz not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.university_tw_universities (
  snapshot_id text not null references public.university_tw_snapshots(snapshot_id) on delete cascade,
  university_code text not null,
  school_no text,
  name text not null,
  uac_department_count integer not null default 0,
  caac_department_count integer not null default 0,
  star_department_count integer not null default 0,
  female_summary jsonb not null default '[]'::jsonb,
  female_trends jsonb not null default '[]'::jsonb,
  register_total jsonb not null default '{}'::jsonb,
  source_sections jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, university_code)
);

create index if not exists university_tw_universities_name_idx
  on public.university_tw_universities (name);

create table if not exists public.university_tw_uac_departments (
  snapshot_id text not null,
  university_code text not null,
  department_code text not null,
  department_name text not null,
  standards_text text,
  subjects_text text,
  standard_code text,
  subject_code text,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, university_code, department_code),
  foreign key (snapshot_id, university_code)
    references public.university_tw_universities(snapshot_id, university_code)
    on delete cascade
);

create index if not exists university_tw_uac_departments_name_idx
  on public.university_tw_uac_departments (department_name);

create table if not exists public.university_tw_caac_departments (
  snapshot_id text not null,
  university_code text not null,
  department_code text not null,
  department_name text not null,
  exam_date text,
  admission_info text,
  subject_text text,
  standards jsonb not null default '[]'::jsonb,
  multipliers jsonb not null default '[]'::jsonb,
  previous_year_filter_result jsonb not null default '[]'::jsonb,
  detail_links jsonb not null default '[]'::jsonb,
  history_links jsonb not null default '[]'::jsonb,
  source_url text,
  title text,
  heading text,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, university_code, department_code),
  foreign key (snapshot_id, university_code)
    references public.university_tw_universities(snapshot_id, university_code)
    on delete cascade
);

create index if not exists university_tw_caac_departments_name_idx
  on public.university_tw_caac_departments (department_name);

create table if not exists public.university_tw_star_departments (
  snapshot_id text not null,
  university_code text not null,
  department_code text not null,
  department_name text not null,
  group_name text,
  admission_info text,
  rule_text text,
  subject_text text,
  standards jsonb not null default '[]'::jsonb,
  ranking_items jsonb not null default '[]'::jsonb,
  previous_year_admission_summary text,
  previous_year_admission_details jsonb not null default '[]'::jsonb,
  detail_links jsonb not null default '[]'::jsonb,
  history_links jsonb not null default '[]'::jsonb,
  source_url text,
  title text,
  heading text,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, university_code, department_code),
  foreign key (snapshot_id, university_code)
    references public.university_tw_universities(snapshot_id, university_code)
    on delete cascade
);

create index if not exists university_tw_star_departments_name_idx
  on public.university_tw_star_departments (department_name);

create table if not exists public.university_tw_gender_departments (
  snapshot_id text not null,
  university_code text not null,
  department_name text not null,
  girls_text text,
  boys_text text,
  female_percent_text text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, university_code, department_name),
  foreign key (snapshot_id, university_code)
    references public.university_tw_universities(snapshot_id, university_code)
    on delete cascade
);

create index if not exists university_tw_gender_departments_name_idx
  on public.university_tw_gender_departments (department_name);

create table if not exists public.university_tw_registration_departments (
  snapshot_id text not null,
  university_code text not null,
  row_key text not null,
  department_name text not null,
  quota_minus_reserved_text text,
  registered_count_text text,
  registration_rate_text text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, university_code, row_key),
  foreign key (snapshot_id, university_code)
    references public.university_tw_universities(snapshot_id, university_code)
    on delete cascade
);

alter table if exists public.university_tw_registration_departments
  add column if not exists row_key text;

update public.university_tw_registration_departments
set row_key = coalesce(
  row_key,
  md5(
    concat_ws(
      '::',
      coalesce(department_name, ''),
      coalesce(quota_minus_reserved_text, ''),
      coalesce(registered_count_text, ''),
      coalesce(registration_rate_text, '')
    )
  )
)
where row_key is null;

alter table if exists public.university_tw_registration_departments
  alter column row_key set not null;

alter table if exists public.university_tw_registration_departments
  drop constraint if exists university_tw_registration_departments_pkey;

alter table if exists public.university_tw_registration_departments
  add constraint university_tw_registration_departments_pkey
  primary key (snapshot_id, university_code, row_key);

create index if not exists university_tw_registration_departments_name_idx
  on public.university_tw_registration_departments (department_name);
