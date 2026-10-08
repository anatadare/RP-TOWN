-- ============================================
-- migration-014: HP/Sosmed tidak lagi membocorkan username Telegram asli
-- Jalankan SETELAH migration-013, di Supabase SQL Editor.
--
-- Di dalam HP (Kontak, Sosmed, Chat) warga hanya dikenali lewat nama + ID RP Town
-- (citizens.public_id), bukan username Telegram -- supaya tidak bisa dipakai
-- untuk doksing. Function inbox lama ikut mengembalikan kolom username, jadi
-- dibuat ulang tanpa kolom itu (return type berubah -> harus di-drop dulu).
-- ============================================

drop function if exists get_social_inbox(uuid);

create or replace function get_social_inbox(p_citizen_id uuid)
returns table (
  other_id uuid,
  display_name text,
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
  select c.other_id, ct.display_name, ct.avatar_url, ct.public_id,
         c.body, c.created_at, c.from_me, coalesce(u.n, 0)
    from convo c
    join citizens ct on ct.id = c.other_id
    left join unread u on u.other_id = c.other_id
   where c.rn = 1
   order by c.created_at desc
   limit 100;
$$;

grant execute on function get_social_inbox(uuid) to anon, authenticated;
