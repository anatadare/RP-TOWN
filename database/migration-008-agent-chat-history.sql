-- ============================================
-- RP TOWN — Migration: histori obrolan pendek per agent (buat Cloudflare Workers)
-- Jalankan setelah migration terakhir yang sudah ada di Supabase kamu
-- (migration-005/006/007 soal wedding_sessions/family-tree/pegawai-sessions
-- gak ada di file zip ini, tapi kemungkinan besar udah kamu jalanin
-- langsung di Supabase — migration ini gak butuh tabel itu, aman ditambahin kapan aja).
-- Lokasi: Supabase Dashboard > SQL Editor
-- ============================================

-- Di versi Railway (proses Node yang nyala terus), histori 6 pesan terakhir
-- per thread disimpan di variable `Map` in-memory (lihat bot/agents/runner.js,
-- shortHistory) — cuma buat kasih konteks ke Gemini biar jawabannya nyambung,
-- BUKAN sumber kebenaran state acara (itu tetap di wedding_sessions).
--
-- Di Cloudflare Workers, tiap request bisa aja "mulai dari nol" (isolate baru),
-- jadi in-memory Map gak bisa diandalkan lagi. Tabel ini gantiin fungsi itu:
-- histori disimpan di Supabase, jadi tetap nyambung walau request-nya
-- ditangani isolate yang beda-beda.
create table if not exists agent_chat_history (
  id bigint generated always as identity primary key,
  history_key text not null, -- format: "{chatId}:{threadId}" atau "{chatId}:{threadId}:family"
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_chat_history_key_idx
  on agent_chat_history (history_key, created_at desc);

-- Housekeeping ringan: hapus baris yang lebih tua dari 1 hari tiap kali ada
-- insert baru, biar tabel ini gak numpuk terus (histori cuma butuh beberapa
-- pesan TERAKHIR aja, bukan arsip permanen).
create or replace function trim_agent_chat_history()
returns trigger as $$
begin
  delete from agent_chat_history
  where history_key = new.history_key
    and created_at < now() - interval '1 day';
  return new;
end;
$$ language plpgsql;

drop trigger if exists trim_agent_chat_history_trigger on agent_chat_history;
create trigger trim_agent_chat_history_trigger
  after insert on agent_chat_history
  for each row execute function trim_agent_chat_history();
