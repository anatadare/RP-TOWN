-- ============================================
-- RP TOWN — Migration: Multi-Map (Kawasan Pantai & LPM)
-- Jalankan SETELAH migration-003-house-topics.sql
-- ============================================

-- Catatan: kolom building_key (dipakai admin buat nempelin room ke bangunan
-- di 3D map) sebelumnya ditambah manual lewat Supabase Dashboard, jadi belum
-- ada di file migration manapun. Ditambahkan lagi di sini pakai
-- "if not exists" biar migration ini aman dijalankan di project manapun
-- (yang sudah punya kolomnya ataupun belum).
alter table rooms
  add column if not exists building_key text;

-- Kolom baru: peta mana yang punya room/bangunan ini. Nilai ini harus cocok
-- dengan salah satu `key` di miniapp/src/lib/maps.js.
-- Room-room lama (yang dibuat sebelum fitur multi-map ada) otomatis dianggap
-- punya peta 'kawasan-pantai', soalnya cuma itu peta yang ada sebelum ini.
alter table rooms
  add column if not exists map_key text not null default 'kawasan-pantai';

update rooms set map_key = 'kawasan-pantai' where map_key is null;

create index if not exists idx_rooms_map_key on rooms(map_key);

-- Nomor node bangunan hasil export topoexport mulai dari 0 lagi di tiap peta
-- (TPX_Buildings_0, _1, dst), jadi building_key SAMA bisa muncul di 2 peta
-- berbeda tanpa itu berarti bangunan yang sama. Makanya kombinasi
-- (map_key, building_key) yang harus unik, bukan building_key sendirian.
drop index if exists rooms_building_key_key;
create unique index if not exists idx_rooms_map_building_unique
  on rooms(map_key, building_key)
  where building_key is not null;
