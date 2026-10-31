#!/usr/bin/env bash
# 在乾淨的 Postgres 上建立 schema，再以 anon / authenticated 身分驗證權限邊界。
# 用法：PGHOST=... PGPORT=... PGUSER=postgres bash tooling/sql-tests/rls-check.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${RLS_TEST_DB:-cv_rls_test}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
P=(psql -v ON_ERROR_STOP=1 -q)
"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${P[@]}" -d "$DB" -f tooling/sql-tests/supabase-stub.sql
"${P[@]}" -d "$DB" -f tooling/supabase-schema.sql >/dev/null
"${P[@]}" -d "$DB" -f tooling/supabase-university-tw-schema.sql >/dev/null
"${P[@]}" -d "$DB" -f tooling/migrations/2026-10-31-security-hardening.sql >/dev/null
"${P[@]}" -d "$DB" -f tooling/sql-tests/fixtures.sql

A=11111111-1111-1111-1111-111111111111
B=22222222-2222-2222-2222-222222222222
fail=0
check() { # role sub expected-regex description sql
  local out
  out=$(psql -q -d "$DB" -tA -c "set role $1; select set_config('request.jwt.claim.sub','$2',false);" -c "$5" 2>&1 | tail -1 || true)
  if [[ "$out" =~ $3 ]]; then echo "ok   - $4"; else echo "FAIL - $4 (got: $out)"; fail=1; fi
}
check anon '' 'permission denied' "anon 不能寫入 university_tw_snapshots" \
  "insert into public.university_tw_snapshots(snapshot_id, generated_at) values ('evil', now())"
check anon '' '^0$' "anon 讀得到 university_tw_snapshots（RLS 開啟、可讀）" \
  "select count(*) from public.university_tw_snapshots"
check anon '' '^0$' "anon 無法列出 career_ops_shared_analyses" \
  "select count(*) from public.career_ops_shared_analyses"
check anon '' '^1$' "anon 可用 slug 取分享（get_shared_analysis）" \
  "select count(*) from public.get_shared_analysis('secret-slug1')"
check anon '' '^0$' "anon 無法列出 cv_public_profiles" \
  "select count(*) from public.cv_public_profiles"
check anon '' '^Alice$' "anon 可用 slug 取公開履歷（get_public_profile）" \
  "select title from public.get_public_profile('alice-cv')"
check authenticated "$A" '^1$' "本人讀得到自己的公開履歷" \
  "select count(*) from public.cv_public_profiles"
check authenticated "$B" '^0$' "他人讀不到 Alice 的公開履歷列" \
  "select count(*) from public.cv_public_profiles"
check anon '' 'permission denied' "anon 不能呼叫 pg_notify_career_ops_analysis" \
  "select public.pg_notify_career_ops_analysis(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())"
check anon '' '^0$' "anon 無法 list cv-images bucket" \
  "select count(*) from storage.objects where bucket_id = 'cv-images'"
check authenticated "$A" '^1$' "本人可讀自己的 storage 物件（upsert 需要）" \
  "select count(*) from storage.objects where bucket_id = 'cv-images'"
check authenticated "$B" '^0$' "他人讀不到 Alice 的 storage 物件" \
  "select count(*) from storage.objects where bucket_id = 'cv-images'"
check authenticated "$A" 'expiry_cap' "分享有效期超過 30 天會被拒絕" \
  "insert into public.career_ops_shared_analyses(slug,user_id,analysis_id,expires_at) values ('long','$A','33333333-3333-3333-3333-333333333333', now() + interval '90 days')"
check authenticated "$A" 'UPSERT_OK' "本人仍可 upsert 自己的公開履歷" \
  "insert into public.cv_public_profiles(user_id, slug, title, content) values ('$A','alice-cv','Alice','{}') on conflict (user_id) do update set title = excluded.title returning 'UPSERT_OK'"
exit $fail
