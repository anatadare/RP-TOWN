// Daftar karakter 3D yang bisa dipilih warga pas pertama kali gabung.
// Model .glb-nya low-poly (Quaternius, CC0 — lisensi bebas dipakai) dan
// sudah di-compress (Draco) supaya ringan buat mini app. Semua model punya
// animasi 'Idle' & 'Walk' yang sama namanya, jadi bisa dipakai generic di
// CharacterSelect & Landing tanpa perlu tau detail tiap model.
export const CHARACTERS = [
  { id: 'casual_male', name: 'Warga Kasual (Pria)', modelUrl: '/models/characters/Casual_Male.glb' },
  { id: 'casual_female', name: 'Warga Kasual (Wanita)', modelUrl: '/models/characters/Casual_Female.glb' },
  { id: 'casual2_male', name: 'Warga Santai (Pria)', modelUrl: '/models/characters/Casual2_Male.glb' },
  { id: 'casual2_female', name: 'Warga Santai (Wanita)', modelUrl: '/models/characters/Casual2_Female.glb' },
  { id: 'worker_male', name: 'Pekerja (Pria)', modelUrl: '/models/characters/Worker_Male.glb' },
  { id: 'worker_female', name: 'Pekerja (Wanita)', modelUrl: '/models/characters/Worker_Female.glb' },
  { id: 'suit_male', name: 'Pebisnis (Pria)', modelUrl: '/models/characters/Suit_Male.glb' },
  { id: 'suit_female', name: 'Pebisnis (Wanita)', modelUrl: '/models/characters/Suit_Female.glb' },
  { id: 'chef_male', name: 'Koki', modelUrl: '/models/characters/Chef_Male.glb' },
  { id: 'doctor_male', name: 'Dokter', modelUrl: '/models/characters/Doctor_Male_Young.glb' },
  { id: 'ninja_male', name: 'Ninja', modelUrl: '/models/characters/Ninja_Male.glb' },
  { id: 'knight_male', name: 'Ksatria', modelUrl: '/models/characters/Knight_Male.glb' },
]

export const DEFAULT_CHARACTER_ID = CHARACTERS[0].id

export function getCharacterById(id) {
  return CHARACTERS.find((c) => c.id === id) || null
}
