-- ============================================
-- migration-012: Sosmed ala feed foto -- foto, komentar
-- Jalankan SETELAH migration-011-social.sql, di Supabase SQL Editor.
-- ============================================

-- 1) Kolom baru di social_posts + izinkan post foto tanpa teks
alter table social_posts add column if not exists image_url text;
alter table social_posts add column if not exists comments_count integer not null default 0;

alter table social_posts drop constraint if exists social_posts_body_check;
alter table social_posts add constraint social_posts_body_len check (char_length(body) <= 280);
alter table social_posts drop constraint if exists social_posts_has_content;
alter table social_posts add constraint social_posts_has_content check (char_length(body) > 0 or image_url is not null);

-- 2) Komentar
create table if not exists social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references social_posts(id) on delete cascade,
  citizen_id uuid not null references citizens(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists idx_social_comments_post on social_comments(post_id, created_at);

alter table social_comments enable row level security;
drop policy if exists "social_comments: public read" on social_comments;
create policy "social_comments: public read" on social_comments for select using (true);
-- tulis lewat create_social_comment (di bawah), tidak ada policy insert langsung

-- 3) Bucket foto (publik baca, maks 1 MB, hanya jpeg/png/webp)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-photos', 'social-photos', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "social-photos: public read" on storage.objects;
create policy "social-photos: public read" on storage.objects
  for select using (bucket_id = 'social-photos');
drop policy if exists "social-photos: anon upload" on storage.objects;
create policy "social-photos: anon upload" on storage.objects
  for insert with check (bucket_id = 'social-photos');

-- 4) create_social_post versi baru (ada p_image_url)
drop function if exists create_social_post(uuid, text);

create or replace function create_social_post(p_citizen_id uuid, p_body text, p_image_url text default null)
returns social_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_row social_posts;
begin
  if not exists (select 1 from citizens where id = p_citizen_id) then
    raise exception 'citizen tidak ditemukan';
  end if;
  if char_length(v_body) > 280 then
    raise exception 'keterangan maksimal 280 karakter';
  end if;
  if char_length(v_body) = 0 and p_image_url is null then
    raise exception 'isi post kosong';
  end if;
  -- foto harus dari bucket social-photos milik proyek ini
  if p_image_url is not null and p_image_url not like '%/storage/v1/object/public/social-photos/%' then
    raise exception 'url foto tidak valid';
  end if;
  if exists (
    select 1 from social_posts
    where citizen_id = p_citizen_id and created_at > now() - interval '5 seconds'
  ) then
    raise exception 'terlalu cepat, tunggu sebentar';
  end if;

  insert into social_posts (citizen_id, body, image_url) values (p_citizen_id, v_body, p_image_url)
  returning * into v_row;
  return v_row;
end;
$$;

-- 5) komentar
create or replace function create_social_comment(p_citizen_id uuid, p_post_id uuid, p_body text)
returns social_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_row social_comments;
begin
  if not exists (select 1 from citizens where id = p_citizen_id) then
    raise exception 'citizen tidak ditemukan';
  end if;
  if not exists (select 1 from social_posts where id = p_post_id) then
    raise exception 'post tidak ditemukan';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 200 then
    raise exception 'komentar harus 1-200 karakter';
  end if;
  if exists (
    select 1 from social_comments
    where citizen_id = p_citizen_id and created_at > now() - interval '2 seconds'
  ) then
    raise exception 'terlalu cepat, tunggu sebentar';
  end if;

  insert into social_comments (post_id, citizen_id, body) values (p_post_id, p_citizen_id, v_body)
  returning * into v_row;
  update social_posts set comments_count = comments_count + 1 where id = p_post_id;
  return v_row;
end;
$$;

grant execute on function create_social_post(uuid, text, text) to anon, authenticated;
grant execute on function create_social_comment(uuid, uuid, text) to anon, authenticated;
