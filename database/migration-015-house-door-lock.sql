-- ============================================================
-- Migration 015: kunci pintu rumah
-- Jalankan di Supabase: SQL Editor > New query > paste > Run.
--
-- Pintu depan rumah di mode Jelajahi (rumah panggung laut Kawasan Pantai) bisa
-- dibuka-tutup oleh siapa saja KECUALI kalau dikunci pemilik rumahnya:
--   - door_locked = true  + rumah ada pemilik -> cuma PEMILIK yang bisa membuka.
--   - rumah belum ada pemilik (owner_citizen_id null) -> tidak pernah terkunci.
--
-- Default TRUE: begitu rumah disewa/dibeli, otomatis terkunci buat orang lain
-- (aman dari maling). Pemilik membuka kunci dari tombol di depan pintu.
--
-- Yang mengubah kolom ini HANYA Worker (service role) lewat POST /api/house-door,
-- setelah memverifikasi identitas Telegram pemilik. Klien cuma membacanya.
-- ============================================================

alter table houses
  add column if not exists door_locked boolean not null default true;

comment on column houses.door_locked is
  'Pintu depan rumah terkunci (true) atau tidak (false). Hanya berlaku kalau rumah punya pemilik; diubah lewat Worker /api/house-door.';
