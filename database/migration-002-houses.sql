-- ============================================
-- RP TOWN — Migration: Sistem Perumahan (Houses)
-- Jalankan ini SETELAH schema.sql yang lama (additive, tidak menghapus data lama)
-- Lokasi: Supabase Dashboard > SQL Editor
-- ============================================

-- Ganti room "Rumah" jadi distrik "Perumahan"
update rooms
set name = 'Perumahan', emoji = '🏘️', description = 'Sewa petak rumahmu sendiri di sini'
where slug = 'rumah';

-- Tabel petak rumah — tiap baris = 1 petak yang bisa disewa 1 warga
create table if not exists houses (
  id uuid primary key default gen_random_uuid(),
  district_room_id uuid not null references rooms(id) on delete cascade,
  plot_number integer not null,
  owner_citizen_id uuid references citizens(id) on delete set null,
  rent_price integer not null default 50,
  rented_at timestamptz,
  created_at timestamptz not null default now(),
  unique (district_room_id, plot_number)
);

create index if not exists idx_houses_district on houses(district_room_id);
create index if not exists idx_houses_owner on houses(owner_citizen_id);

-- Isi 12 petak rumah awal di distrik "Perumahan"
insert into houses (district_room_id, plot_number, rent_price)
select r.id, gs, 50 + (gs * 10)
from rooms r, generate_series(1, 12) gs
where r.slug = 'rumah'
on conflict (district_room_id, plot_number) do nothing;

-- ============================================
-- Row Level Security
-- ============================================
alter table houses enable row level security;

create policy "houses: public read" on houses for select using (true);
-- Update langsung dari client dibatasi hanya boleh kalau petak masih kosong
-- (proses sewa yang beneran tetap lewat function rent_house di bawah, ini cuma pagar tambahan)
create policy "houses: public update only if empty" on houses
  for update using (owner_citizen_id is null) with check (true);

-- ============================================
-- Function: rent_house
-- Proses sewa dibungkus jadi 1 transaksi atomik di database,
-- supaya nggak ada race condition (2 orang nyewa petak yang sama bersamaan)
-- atau bug "koin kepotong tapi rumah gagal ke-assign".
-- ============================================
create or replace function rent_house(p_house_id uuid, p_citizen_id uuid)
returns houses
language plpgsql
security definer
as $$
declare
  v_house houses;
  v_citizen citizens;
begin
  select * into v_house from houses where id = p_house_id for update;

  if v_house.id is null then
    raise exception 'Petak rumah tidak ditemukan';
  end if;

  if v_house.owner_citizen_id is not null then
    raise exception 'Petak ini sudah disewa warga lain';
  end if;

  select * into v_citizen from citizens where id = p_citizen_id for update;

  if v_citizen.coins < v_house.rent_price then
    raise exception 'Koin tidak cukup untuk menyewa petak ini';
  end if;

  update citizens set coins = coins - v_house.rent_price where id = p_citizen_id;

  update houses
  set owner_citizen_id = p_citizen_id, rented_at = now()
  where id = p_house_id
  returning * into v_house;

  return v_house;
end;
$$;

grant execute on function rent_house(uuid, uuid) to anon, authenticated;
