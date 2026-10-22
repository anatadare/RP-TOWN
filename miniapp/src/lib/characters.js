// Daftar karakter 3D yang bisa dipilih warga pas pertama kali gabung (52 karakter).
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
  { id: 'base', name: 'Warga Polos', modelUrl: '/models/characters/BaseCharacter.glb' },
  { id: 'bluesoldier_female', name: 'Prajurit Biru (Wanita)', modelUrl: '/models/characters/BlueSoldier_Female.glb' },
  { id: 'bluesoldier_male', name: 'Prajurit Biru (Pria)', modelUrl: '/models/characters/BlueSoldier_Male.glb' },
  { id: 'casual3_female', name: 'Warga Gaul (Wanita)', modelUrl: '/models/characters/Casual3_Female.glb' },
  { id: 'casual3_male', name: 'Warga Gaul (Pria)', modelUrl: '/models/characters/Casual3_Male.glb' },
  { id: 'casual_bald', name: 'Warga Botak', modelUrl: '/models/characters/Casual_Bald.glb' },
  { id: 'chef_female', name: 'Koki (Wanita)', modelUrl: '/models/characters/Chef_Female.glb' },
  { id: 'chef_hat', name: 'Koki Bertopi', modelUrl: '/models/characters/Chef_Hat.glb' },
  { id: 'cow', name: 'Sapi', modelUrl: '/models/characters/Cow.glb' },
  { id: 'cowboy_female', name: 'Koboi (Wanita)', modelUrl: '/models/characters/Cowboy_Female.glb' },
  { id: 'cowboy_hair', name: 'Koboi Berambut', modelUrl: '/models/characters/Cowboy_Hair.glb' },
  { id: 'cowboy_male', name: 'Koboi (Pria)', modelUrl: '/models/characters/Cowboy_Male.glb' },
  { id: 'doctor_female_old', name: 'Dokter Senior (Wanita)', modelUrl: '/models/characters/Doctor_Female_Old.glb' },
  { id: 'doctor_female_young', name: 'Dokter Muda (Wanita)', modelUrl: '/models/characters/Doctor_Female_Young.glb' },
  { id: 'doctor_male_old', name: 'Dokter Senior (Pria)', modelUrl: '/models/characters/Doctor_Male_Old.glb' },
  { id: 'elf', name: 'Peri', modelUrl: '/models/characters/Elf.glb' },
  { id: 'goblin_female', name: 'Goblin (Wanita)', modelUrl: '/models/characters/Goblin_Female.glb' },
  { id: 'goblin_male', name: 'Goblin (Pria)', modelUrl: '/models/characters/Goblin_Male.glb' },
  { id: 'kimono_female', name: 'Kimono (Wanita)', modelUrl: '/models/characters/Kimono_Female.glb' },
  { id: 'kimono_male', name: 'Kimono (Pria)', modelUrl: '/models/characters/Kimono_Male.glb' },
  { id: 'knight_golden_female', name: 'Ksatria Emas (Wanita)', modelUrl: '/models/characters/Knight_Golden_Female.glb' },
  { id: 'knight_golden_male', name: 'Ksatria Emas (Pria)', modelUrl: '/models/characters/Knight_Golden_Male.glb' },
  { id: 'ninja_female', name: 'Ninja (Wanita)', modelUrl: '/models/characters/Ninja_Female.glb' },
  { id: 'ninja_male_hair', name: 'Ninja Berambut', modelUrl: '/models/characters/Ninja_Male_Hair.glb' },
  { id: 'ninja_sand', name: 'Ninja Gurun (Pria)', modelUrl: '/models/characters/Ninja_Sand.glb' },
  { id: 'ninja_sand_female', name: 'Ninja Gurun (Wanita)', modelUrl: '/models/characters/Ninja_Sand_Female.glb' },
  { id: 'oldclassy_female', name: 'Nyonya Elegan', modelUrl: '/models/characters/OldClassy_Female.glb' },
  { id: 'oldclassy_male', name: 'Tuan Elegan', modelUrl: '/models/characters/OldClassy_Male.glb' },
  { id: 'pirate_female', name: 'Bajak Laut (Wanita)', modelUrl: '/models/characters/Pirate_Female.glb' },
  { id: 'pirate_male', name: 'Bajak Laut (Pria)', modelUrl: '/models/characters/Pirate_Male.glb' },
  { id: 'pug', name: 'Anjing Pug', modelUrl: '/models/characters/Pug.glb' },
  { id: 'soldier_female', name: 'Prajurit (Wanita)', modelUrl: '/models/characters/Soldier_Female.glb' },
  { id: 'soldier_male', name: 'Prajurit (Pria)', modelUrl: '/models/characters/Soldier_Male.glb' },
  { id: 'viking_helmet', name: 'Viking Berhelm', modelUrl: '/models/characters/VikingHelmet.glb' },
  { id: 'viking_female', name: 'Viking (Wanita)', modelUrl: '/models/characters/Viking_Female.glb' },
  { id: 'viking_male', name: 'Viking (Pria)', modelUrl: '/models/characters/Viking_Male.glb' },
  { id: 'witch', name: 'Penyihir Wanita', modelUrl: '/models/characters/Witch.glb' },
  { id: 'wizard', name: 'Penyihir Pria', modelUrl: '/models/characters/Wizard.glb' },
  { id: 'zombie_female', name: 'Zombi (Wanita)', modelUrl: '/models/characters/Zombie_Female.glb' },
  { id: 'zombie_male', name: 'Zombi (Pria)', modelUrl: '/models/characters/Zombie_Male.glb' },
]

export const DEFAULT_CHARACTER_ID = CHARACTERS[0].id

export function getCharacterById(id) {
  return CHARACTERS.find((c) => c.id === id) || null
}
