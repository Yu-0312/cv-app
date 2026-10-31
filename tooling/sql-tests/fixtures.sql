-- RLS 測試用的固定資料（兩位使用者、一筆公開履歷、一筆分析分享、一個 storage 物件）。
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','a@x'),('22222222-2222-2222-2222-222222222222','b@x') on conflict do nothing;
insert into public.cv_public_profiles(user_id, slug, title, content) values ('11111111-1111-1111-1111-111111111111','alice-cv','Alice','{"name":"Alice"}') on conflict do nothing;
insert into public.career_ops_analyses(id, user_id, status) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','completed') on conflict do nothing;
insert into public.career_ops_shared_analyses(slug, user_id, analysis_id, snapshot_json) values ('secret-slug1','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','{"summary":"private"}') on conflict do nothing;
insert into storage.objects(bucket_id, name) values ('cv-images','11111111-1111-1111-1111-111111111111/portfolio-assets/transcript.pdf');
