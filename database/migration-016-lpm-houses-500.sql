-- ============================================
-- RP TOWN — Migration 016: petak rumah LPM 1..500
-- Peta LPM baru (gugusan 7 pulau) punya 500 rumah warga (TPX_Buildings_1..500),
-- sebelumnya hanya sedikit petak. Migration ini melengkapi petak 1..500 untuk map_key 'lpm'.
-- Additive & idempoten: petak yang sudah ada tidak diubah, boleh dijalankan ulang.
-- Jalankan di: Supabase Dashboard > SQL Editor
-- ============================================

do $$
declare
  v_room uuid;
  v_price integer;
  v_before integer;
  v_after integer;
begin
  -- distrik & harga diambil dari petak LPM yang sudah ada (bukan ditebak)
  select district_room_id into v_room
  from houses where map_key = 'lpm'
  order by plot_number limit 1;

  if v_room is null then
    raise exception 'Tidak ada petak LPM (map_key = ''lpm'') di tabel houses; hentikan agar tidak salah distrik.';
  end if;

  select coalesce(round(avg(rent_price))::integer, 100) into v_price
  from houses where map_key = 'lpm' and district_room_id = v_room;

  select count(*) into v_before from houses where map_key = 'lpm';

  insert into houses (district_room_id, plot_number, map_key, rent_price)
  select v_room, gs, 'lpm', v_price
  from generate_series(1, 500) gs
  where not exists (
    select 1 from houses h
    where h.map_key = 'lpm' and h.plot_number = gs
  )
  on conflict do nothing;

  select count(*) into v_after from houses where map_key = 'lpm';
  raise notice 'Petak LPM: % -> % (harga sewa petak baru: %)', v_before, v_after, v_price;

  -- gagal keras kalau ada yang tidak masuk (mis. bentrok unique dengan peta lain)
  if v_after < 500 then
    raise exception 'Petak LPM baru % dari 500; cek unique constraint houses (district_room_id, plot_number) yang bentrok dengan map_key lain.', v_after;
  end if;
end $$;
