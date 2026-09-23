// Daftar peta 3D yang tersedia di RP Town.
// Tambah peta baru = tambah 1 entry di sini + taro file .glb-nya di public/models/.
// `key` dipakai buat nyimpen room.map_key di database, jadi begitu sudah
// dipakai JANGAN diubah lagi (nanti room lama "kehilangan" petanya).
// `billboard`: posisi papan reklame (lihat Billboard3D.jsx) di peta ini.
// - offsetXFactor / offsetZFactor: posisi relatif terhadap TENGAH pulau,
//   dikali SETENGAH lebar/panjang pulau (jarak tengah -> tepi). 0 = pas di
//   tengah, -1 / +1 = kira-kira pas di TEPI pulau ke arah itu, -1.2/-1.3
//   dst = sudah lewat tepi (nongol di laut, ini yang dipakai di bawah).
//   Nilai di bawah cuma tebakan awal dari posisi yang ditandai di
//   screenshot — kalau pas dicek di app posisinya kurang pas, TINGGAL
//   GESER 2 angka ini aja (gak perlu ubah kode komponennya).
// - imageUrl: kosongin/`null` dulu (billboard tampil putih polos). Begitu
//   fitur order billboard/grup-nya jadi, tinggal isi field ini dengan URL
//   gambarnya, otomatis kepasang di panel depan & belakang.
export const MAPS = [
  {
    key: 'kawasan-pantai',
    name: 'Kawasan Pantai',
    modelUrl: '/models/kawasan-pantai.glb',
    billboard: { offsetXFactor: -0.1, offsetZFactor: -1.25, imageUrl: null },
  },
  {
    key: 'lpm',
    name: 'LPM',
    modelUrl: '/models/lpm.glb',
    billboard: { offsetXFactor: -0.35, offsetZFactor: -1.2, imageUrl: null },
  },
  {
    key: 'rp-town-city',
    name: 'RP Town City',
    modelUrl: '/models/rp-town-city.glb',
    billboard: { offsetXFactor: -0.1, offsetZFactor: -1.3, imageUrl: null },
  },
]

export const DEFAULT_MAP_KEY = MAPS[0].key

export function getMapByKey(key) {
  return MAPS.find((m) => m.key === key) || MAPS[0]
}
