-- ============================================
-- RP TOWN — Skema Database (Supabase / Postgres)
-- Jalankan di: Supabase Dashboard > SQL Editor
-- ============================================

-- Tabel warga (user Telegram yang sudah pernah buka Mini App)
create table if not exists citizens (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username text,
  display_name text,
  avatar_url text,
  coins integer not null default 100,
  energy integer not null default 100,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Tabel room / lokasi di kota
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,          -- contoh: 'pantai', 'rumah', 'kantor'
  name text not null,                 -- contoh: 'Pantai'
  emoji text not null default '📍',
  description text,
  telegram_group_url text,            -- link invite grup Telegram khusus room ini, contoh: https://t.me/+AbCdEfGhIjK
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Tabel presence: 1 baris = 1 citizen lagi berada di 1 room
-- (citizen_id unique = seorang warga cuma bisa ada di 1 room dalam satu waktu)
create table if not exists room_presence (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references citizens(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  entered_at timestamptz not null default now(),
  unique (citizen_id)
);

-- Index buat query yang sering dipakai
create index if not exists idx_room_presence_room_id on room_presence(room_id);
create index if not exists idx_citizens_telegram_id on citizens(telegram_id);

-- ============================================
-- Row Level Security
-- Mini App pakai anon key, jadi kita buka akses publik dulu untuk MVP.
-- Nanti bisa diperketat pakai Telegram initData validation di backend.
-- ============================================
alter table citizens enable row level security;
alter table rooms enable row level security;
alter table room_presence enable row level security;

create policy "citizens: public read" on citizens for select using (true);
create policy "citizens: public upsert" on citizens for insert with check (true);
create policy "citizens: public update own" on citizens for update using (true);

create policy "rooms: public read" on rooms for select using (true);

create policy "presence: public read" on room_presence for select using (true);
create policy "presence: public insert" on room_presence for insert with check (true);
create policy "presence: public delete" on room_presence for delete using (true);

-- ============================================
-- Aktifkan Realtime untuk tabel room_presence
-- (biar peta kota update live tanpa refresh)
-- ============================================
alter publication supabase_realtime add table room_presence;

-- ============================================
-- Data awal: 5 room pertama
-- Ganti telegram_group_url dengan link invite grup beneran setelah kamu
-- bikin grup terpisah untuk tiap room (lihat README).
-- ============================================
insert into rooms (slug, name, emoji, description, sort_order) values
  ('rumah', 'Rumah', '🏠', 'Tempat istirahat & personal space kamu', 1),
  ('kantor', 'Tempat Kerja', '🏢', 'Cari cuan, ketemu rekan kerja', 2),
  ('pantai', 'Pantai', '🏖️', 'Santai, ngobrol santai sore hari', 3),
  ('kafe', 'Kafe', '☕', 'Ngopi & ngobrol kasual', 4),
  ('taman', 'Taman Kota', '🌳', 'Tempat kumpul warga kota', 5)
on conflict (slug) do nothing;
