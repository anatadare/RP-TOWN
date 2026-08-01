import { createClient } from '@supabase/supabase-js'

// Isi kedua value ini di file .env (lihat .env.example)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[RP Town] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diisi. ' +
    'Copy .env.example jadi .env dan isi dengan kredensial Supabase kamu.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
