-- ============================================
-- migration-013: Sosmed -- ID unik warga, edit/hapus post, chat (DM)
-- Jalankan SETELAH migration-011 & migration-012, di Supabase SQL Editor.
-- Pola sama: tulis lewat function SECURITY DEFINER yang menerima p_citizen_id
-- (belum ada validasi initData Telegram -- perketat bersamaan nanti).
-- ============================================

-- 1) ID unik publik warga (dipakai buat cari profil), contoh: RP482913
alter table citizens add column if not exists public_id text;

create or replace function gen_citizen_public_id()
returns text
language plpgsql
as $$
declare
  v_id text;
begin
  loop
    v_id := 'RP' || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from citizens where public_id = v_id);
  end loop;
  return v_id;
end;
$$;

-- warga lama
update citizens set public_id = gen_citizen_public_id() where public_id is null;

create unique index if not exists idx_citizens_public_id on citizens(public_id);

-- warga baru otomatis dapat ID
create or replace function set_citizen_public_id()
returns trigger
language plpgsql
as $$
begin
  if new.public_id is null then
    new.public_id := gen_citizen_public_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_citizens_public_id on citizens;
create trigger trg_citizens_public_id
  before insert on citizens
  for each row execute function set_citizen_public_id();

-- 2) Edit & hapus post (hanya pemilik post)
alter table social_posts add column if not exists edited_at timestamptz;

create or replace function update_social_post(p_citizen_id uuid, p_post_id uuid, p_body text)
returns social_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_post social_posts;
begin
  select * into v_post from social_posts where id = p_post_id;
  if not found then
    raise exception 'post tidak ditemukan';
  end if;
  if v_post.citizen_id <> p_citizen_id then
    raise exception 'bukan postinganmu';
  end if;
  if char_length(v_body) > 280 then
    raise exception 'keterangan maksimal 280 karakter';
  end if;
  if char_length(v_body) = 0 and v_post.image_url is null then
    raise exception 'isi post kosong';
  end if;

  update social_posts
     set body = v_body, edited_at = now()
   where id = p_post_id
   returning * into v_post;
  return v_post;
end;
$$;

create or replace function delete_social_post(p_citizen_id uuid, p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from social_posts where id = p_post_id and citizen_id = p_citizen_id) then
    raise exception 'post tidak ditemukan atau bukan postinganmu';
  end if;
  -- like & komentar ikut terhapus (on delete cascade)
  delete from social_posts where id = p_post_id;
  return true;
end;
$$;

-- 3) Chat 1-lawan-1.
-- Pesan bersifat PRIVAT: tabel tidak punya policy select/insert/update/delete,
-- jadi baca & tulis cuma lewat function di bawah.
create table if not exists social_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references citizens(id) on delete cascade,
  receiver_id uuid not null references citizens(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create index if not exists idx_social_messages_pair
  on social_messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at desc);
create index if not exists idx_social_messages_receiver_unread
  on social_messages (receiver_id) where read_at is null;

alter table social_messages enable row level security;
-- (sengaja tanpa policy)

create or replace function send_social_message(p_citizen_id uuid, p_to_id uuid, p_body text)
returns social_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_row social_messages;
begin
  if not exists (select 1 from citizens where id = p_citizen_id) then
    raise exception 'citizen tidak ditemukan';
  end if;
  if not exists (select 1 from citizens where id = p_to_id) then
    raise exception 'penerima tidak ditemukan';
  end if;
  if p_citizen_id = p_to_id then
    raise exception 'tidak bisa chat diri sendiri';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'pesan harus 1-500 karakter';
  end if;
  -- anti-spam: maksimal 1 pesan per detik per pengirim
  if exists (
    select 1 from social_messages
    where sender_id = p_citizen_id and created_at > now() - interval '1 second'
  ) then
    raise exception 'terlalu cepat, tunggu sebentar';
  end if;

  insert into social_messages (sender_id, receiver_id, body)
  values (p_citizen_id, p_to_id, v_body)
  returning * into v_row;
  return v_row;
end;
$$;

-- Isi percakapan dengan 1 warga (terbaru di bawah). Sekalian menandai pesan
-- masuk sebagai sudah dibaca.
create or replace function get_social_conversation(p_citizen_id uuid, p_other_id uuid, p_limit integer default 100)
returns setof social_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  update social_messages
     set read_at = now()
   where receiver_id = p_citizen_id and sender_id = p_other_id and read_at is null;

  return query
    select * from (
      select m.*
        from social_messages m
       where (m.sender_id = p_citizen_id and m.receiver_id = p_other_id)
          or (m.sender_id = p_other_id and m.receiver_id = p_citizen_id)
       order by m.created_at desc
       limit least(greatest(coalesce(p_limit, 100), 1), 200)
    ) t
    order by t.created_at asc;
end;
$$;

-- Daftar percakapan (inbox): pesan terakhir + jumlah belum dibaca per lawan bicara.
create or replace function get_social_inbox(p_citizen_id uuid)
returns table (
  other_id uuid,
  display_name text,
  username text,
  avatar_url text,
  public_id text,
  last_body text,
  last_at timestamptz,
  last_from_me boolean,
  unread_count bigint
)
language sql
security definer
set search_path = public
as $$
  with convo as (
    select
      case when m.sender_id = p_citizen_id then m.receiver_id else m.sender_id end as other_id,
      m.body, m.created_at, (m.sender_id = p_citizen_id) as from_me,
      row_number() over (
        partition by case when m.sender_id = p_citizen_id then m.receiver_id else m.sender_id end
        order by m.created_at desc
      ) as rn
    from social_messages m
    where m.sender_id = p_citizen_id or m.receiver_id = p_citizen_id
  ),
  unread as (
    select sender_id as other_id, count(*) as n
      from social_messages
     where receiver_id = p_citizen_id and read_at is null
     group by sender_id
  )
  select c.other_id, ct.display_name, ct.username, ct.avatar_url, ct.public_id,
         c.body, c.created_at, c.from_me, coalesce(u.n, 0)
    from convo c
    join citizens ct on ct.id = c.other_id
    left join unread u on u.other_id = c.other_id
   where c.rn = 1
   order by c.created_at desc
   limit 100;
$$;

create or replace function count_social_unread(p_citizen_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*) from social_messages where receiver_id = p_citizen_id and read_at is null;
$$;

grant execute on function update_social_post(uuid, uuid, text) to anon, authenticated;
grant execute on function delete_social_post(uuid, uuid) to anon, authenticated;
grant execute on function send_social_message(uuid, uuid, text) to anon, authenticated;
grant execute on function get_social_conversation(uuid, uuid, integer) to anon, authenticated;
grant execute on function get_social_inbox(uuid) to anon, authenticated;
grant execute on function count_social_unread(uuid) to anon, authenticated;
