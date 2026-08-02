-- ============================================
-- RP TOWN — Migration: Auto Forum Topic untuk rumah
-- Jalankan SETELAH migration-002-houses.sql
-- ============================================

alter table houses
  add column if not exists telegram_topic_id bigint,
  add column if not exists telegram_topic_url text;

-- (tidak ada perubahan RLS/policy — kolom ini cuma diisi oleh bot lewat
-- service_role key, bukan dari client, jadi tidak perlu policy tambahan)
