-- ============================================
-- migration-011: Sosmed di dalam HP (app "Sosmed")
-- Jalankan di: Supabase Dashboard > SQL Editor
-- Pola sama seperti equip_item: aksi tulis lewat function SECURITY DEFINER
-- yang menerima p_citizen_id (belum ada validasi initData Telegram -- sama
-- seperti fungsi item/HP yang sudah ada; perketat bersamaan nanti).
-- ============================================

create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references citizens(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  likes_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_social_posts_created on social_posts(created_at desc);

create table if not exists social_likes (
  post_id uuid not null references social_posts(id) on delete cascade,
  citizen_id uuid not null references citizens(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, citizen_id)
);

alter table social_posts enable row level security;
alter table social_likes enable row level security;

drop policy if exists "social_posts: public read" on social_posts;
create policy "social_posts: public read" on social_posts for select using (true);
drop policy if exists "social_likes: public read" on social_likes;
create policy "social_likes: public read" on social_likes for select using (true);
-- Tidak ada policy insert/update/delete: semua tulis lewat function di bawah.

create or replace function create_social_post(p_citizen_id uuid, p_body text)
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
  if char_length(v_body) < 1 or char_length(v_body) > 280 then
    raise exception 'isi post harus 1-280 karakter';
  end if;
  -- anti-spam sederhana: maksimal 1 post per 5 detik per warga
  if exists (
    select 1 from social_posts
    where citizen_id = p_citizen_id and created_at > now() - interval '5 seconds'
  ) then
    raise exception 'terlalu cepat, tunggu sebentar';
  end if;

  insert into social_posts (citizen_id, body) values (p_citizen_id, v_body)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function toggle_social_like(p_citizen_id uuid, p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from citizens where id = p_citizen_id) then
    raise exception 'citizen tidak ditemukan';
  end if;

  if exists (select 1 from social_likes where post_id = p_post_id and citizen_id = p_citizen_id) then
    delete from social_likes where post_id = p_post_id and citizen_id = p_citizen_id;
  else
    insert into social_likes (post_id, citizen_id) values (p_post_id, p_citizen_id);
  end if;

  update social_posts
     set likes_count = (select count(*) from social_likes where post_id = p_post_id)
   where id = p_post_id
   returning likes_count into v_count;
  return v_count;
end;
$$;

grant execute on function create_social_post(uuid, text) to anon, authenticated;
grant execute on function toggle_social_like(uuid, uuid) to anon, authenticated;
