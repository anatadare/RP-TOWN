-- ============================================
-- RP TOWN — Migration: KTP Warga (Kirana / Dinas Catatan Sipil)
-- Jalankan SETELAH schema.sql + migration-002-houses.sql
-- (butuh houses.map_key -- ditambahkan migration lain yang tidak ikut zip
-- ini, tapi sudah dipakai kode kamu di houseWebhook.js/houseIslands.js,
-- dan houses.owner_citizen_id/plot_number dari migration-002)
-- Lokasi: Supabase Dashboard > SQL Editor
-- Diberi nomor 010 supaya tidak bentrok sama migration-009-kua-capacity-
-- and-kick.sql yang sudah ada di databasemu (tidak ikut di zip project).
-- Additive, tidak menghapus data lama.
-- ============================================

-- --------------------------------------------
-- Tabel KTP: 1 warga = 1 KTP (citizen_id unique)
-- Alamat & status perkawinan TIDAK disimpan di sini -- selalu diambil
-- otomatis dari houses & citizens lewat view ktp_full, jadi kalau warga
-- pindah rumah / menikah, KTP-nya ikut berubah sendiri.
-- --------------------------------------------
create table if not exists ktp (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null unique references citizens(id) on delete cascade,
  nik text not null unique check (nik ~ '^[0-9]{16}$'),
  gender text not null check (gender in ('L', 'P')),
  age_group text not null
    check (age_group ~ '^[0-9]{2,3}\+$'
           and substring(age_group from '^[0-9]+')::int >= 18),
  occupation text not null check (char_length(btrim(occupation)) between 2 and 30),
  photo_url text,
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ktp_citizen on ktp(citizen_id);

-- --------------------------------------------
-- Sesi formulir /buat_ktp, /ganti_foto, /ubah_pekerjaan.
-- 1 baris = 1 formulir yang lagi diisi 1 warga di 1 chat (dipakai bot
-- buat nge-tracking tahap tombol inline yang lagi jalan). Dihapus otomatis
-- begitu formulir selesai/dibatalkan; kalau didiamkan lama, bot yang
-- mendeteksi basi lewat updated_at lalu menghapusnya sendiri.
-- --------------------------------------------
create table if not exists ktp_sessions (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  thread_id text,
  citizen_id uuid not null references citizens(id) on delete cascade,
  telegram_user_id bigint not null,
  mode text not null default 'create' check (mode in ('create', 'edit_photo', 'edit_occupation')),
  stage text not null default 'gender',
  gender text,
  age_group text,
  occupation text,
  photo_source text,
  photo_url text, -- URL sementara (staging) hasil upload/foto profil, dipakai saat create_ktp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, citizen_id)
);

-- --------------------------------------------
-- Generator NIK RP Town: 16 digit, awalan '99' (beda dari NIK asli)
-- diikuti 14 digit acak, diulang otomatis kalau kebetulan bentrok.
-- --------------------------------------------
create or replace function generate_ktp_nik()
returns text
language plpgsql
as $$
declare
  v_nik text;
begin
  loop
    v_nik := '99' || lpad(floor(random() * 100000000000000)::bigint::text, 14, '0');
    exit when not exists (select 1 from ktp where nik = v_nik);
  end loop;
  return v_nik;
end;
$$;

-- --------------------------------------------
-- Function: create_ktp -- dipanggil bot (service_role) saat formulir
-- /buat_ktp selesai. 1 warga cuma boleh 1 KTP.
-- --------------------------------------------
create or replace function create_ktp(
  p_citizen_id uuid,
  p_gender text,
  p_age_group text,
  p_occupation text,
  p_photo_url text default null
)
returns ktp
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row ktp;
begin
  if not exists (select 1 from citizens where id = p_citizen_id) then
    raise exception 'Warga tidak ditemukan';
  end if;

  if exists (select 1 from ktp where citizen_id = p_citizen_id) then
    raise exception 'Warga ini sudah punya KTP';
  end if;

  insert into ktp (citizen_id, nik, gender, age_group, occupation, photo_url)
  values (p_citizen_id, generate_ktp_nik(), p_gender, p_age_group, btrim(p_occupation), p_photo_url)
  returning * into v_row;

  return v_row;
end;
$$;

-- --------------------------------------------
-- Function: update_ktp_occupation -- dipakai /ubah_pekerjaan
-- --------------------------------------------
create or replace function update_ktp_occupation(p_citizen_id uuid, p_occupation text)
returns ktp
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row ktp;
begin
  update ktp
  set occupation = btrim(p_occupation), updated_at = now()
  where citizen_id = p_citizen_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Warga ini belum punya KTP';
  end if;

  return v_row;
end;
$$;

-- --------------------------------------------
-- Function: update_ktp_photo -- dipakai /ganti_foto
-- --------------------------------------------
create or replace function update_ktp_photo(p_citizen_id uuid, p_photo_url text)
returns ktp
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row ktp;
begin
  update ktp
  set photo_url = p_photo_url, updated_at = now()
  where citizen_id = p_citizen_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Warga ini belum punya KTP';
  end if;

  return v_row;
end;
$$;

-- --------------------------------------------
-- View: ktp_full -- dibaca bot buat nampilin kartu, dan nantinya miniapp
-- buat kartu 3D. Alamat dari houses (rumah paling lama disewa warga ini),
-- status perkawinan otomatis dari data KUA.
-- --------------------------------------------
create or replace view ktp_full
with (security_invoker = true) as
select
  k.id,
  k.nik,
  k.citizen_id,
  c.display_name,
  c.username,
  k.gender,
  k.age_group,
  k.occupation,
  k.photo_url,
  k.issued_at,
  case
    when c.partner_citizen_id is not null or c.spouse_id is not null then 'Kawin'
    else 'Belum Kawin'
  end as marital_status,
  h.map_key as house_map_key,
  case
    when h.map_key is null then null
    when h.map_key = 'lpm' then 'LPM'
    else 'Kawasan Pantai'
  end as house_island,
  h.plot_number as house_plot_number
from ktp k
join citizens c on c.id = k.citizen_id
left join lateral (
  select hh.map_key, hh.plot_number
  from houses hh
  where hh.owner_citizen_id = k.citizen_id
  order by hh.rented_at asc nulls last
  limit 1
) h on true;

-- --------------------------------------------
-- Row Level Security
-- KTP boleh dibaca publik (buat miniapp/QR nanti). ktp_sessions TIDAK
-- publik sama sekali -- cuma state internal bot lewat service_role.
-- Tulis/ubah `ktp` HANYA lewat function di atas, dipanggil service_role.
-- --------------------------------------------
alter table ktp enable row level security;
alter table ktp_sessions enable row level security;

drop policy if exists "ktp: public read" on ktp;
create policy "ktp: public read" on ktp for select using (true);
-- ktp_sessions: sengaja TANPA policy sama sekali -> cuma service_role yang bisa akses.

revoke all on function create_ktp(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function create_ktp(uuid, text, text, text, text) to service_role;

revoke all on function update_ktp_occupation(uuid, text) from public, anon, authenticated;
grant execute on function update_ktp_occupation(uuid, text) to service_role;

revoke all on function update_ktp_photo(uuid, text) from public, anon, authenticated;
grant execute on function update_ktp_photo(uuid, text) to service_role;

revoke all on function generate_ktp_nik() from public, anon, authenticated;
grant execute on function generate_ktp_nik() to service_role;

-- --------------------------------------------
-- Storage bucket buat foto KTP (link permanen, bot yang upload lewat
-- service_role, baca publik).
-- --------------------------------------------
insert into storage.buckets (id, name, public)
values ('ktp-photos', 'ktp-photos', true)
on conflict (id) do nothing;
