// Daftar peta 3D yang tersedia di RP Town.
// Tambah peta baru = tambah 1 entry di sini + taro file .glb-nya di public/models/.
// `key` dipakai buat nyimpen room.map_key di database, jadi begitu sudah
// dipakai JANGAN diubah lagi (nanti room lama "kehilangan" petanya).
// `billboard`: posisi papan reklame (lihat Billboard3D.jsx) di peta ini.
// - offsetXFactor / offsetZFactor: posisi relatif terhadap TENGAH kumpulan
//   BANGUNAN (bukan seluruh pulau), dikali SETENGAH lebar/panjang area
//   bangunan itu (jarak tengah -> tepi). 0 = pas di tengah, -1 / +1 = kira²
//   pas di TEPI kumpulan bangunan ke arah itu, -1.2/-1.3 dst = sedikit lewat
//   tepi situ (nongol di laut, ini yang dipakai di bawah). Basis "bangunan"
//   ini sengaja dipakai (bukan tepi pulau) karena itu juga basis yang
//   dipakai app buat nge-frame kamera pas peta pertama dibuka — jadi
//   billboard dijamin kelihatan tanpa perlu zoom-out dulu.
//   Nilai di bawah cuma tebakan awal dari posisi yang ditandai di
//   screenshot — kalau pas dicek di app posisinya kurang pas, TINGGAL
//   GESER 2 angka ini aja (gak perlu ubah kode komponennya).
// - imageUrl: kosongin/`null` dulu (billboard tampil putih polos). Begitu
//   fitur order billboard/grup-nya jadi, tinggal isi field ini dengan URL
//   gambarnya, otomatis kepasang di panel depan & belakang.
// `walkBillboards`: billboard KECIL yang muncul di mode Jelajahi (TownWalk),
// masing-masing peta 3 buah. Bentuk & warnanya sama dengan billboard besar,
// tingginya ~2.4 m (lihat WALK_PANEL_WIDTH di Billboard3D.jsx).
// - x / z: koordinat DUNIA (sama dengan koordinat di walkWorld.js, bukan
//   offset relatif seperti `billboard` di atas). Tinggi tanahnya dihitung
//   otomatis saat peta dibuka, jadi cukup isi x & z.
// - Semuanya di sisi samping persimpangan jalan (di petak tanah kosong, min.
//   ~2.5 m dari tepi jalan, jauh dari bangunan & batang pohon) dan antar
//   billboard di satu peta berjarak >= ~45 m.
// - Kawasan Pantai: 2 di pulau (persimpangan utara & timur) + 1 di daratan
//   sebelum jalan masuk ke kawasan dermaga/air (sisi darat, bukan di laut).
// - imageUrl: sama seperti billboard besar, kosong = putih polos.
export const MAPS = [
  {
    key: 'kawasan-pantai',
    name: 'Kawasan Pantai',
    modelUrl: '/models/kawasan-pantai.glb',
    billboard: { offsetXFactor: -0.15, offsetZFactor: -1.2, imageUrl: null },
    walkBillboards: [
      { x: 242.4, z: -124.5, imageUrl: null }, // samping persimpangan utara pulau
      { x: 348.1, z: -235.5, imageUrl: null }, // samping persimpangan timur pulau
      { x: 401.2, z: -255.3, imageUrl: null }, // daratan, sebelum jalan masuk ke kawasan air
    ],
  },
  {
    key: 'lpm',
    name: 'LPM',
    modelUrl: '/models/lpm.glb',
    billboard: { offsetXFactor: -0.3, offsetZFactor: -1.15, imageUrl: null },
    walkBillboards: [
      { x: 76.1, z: -104.2, imageUrl: null },
      { x: 116.5, z: -68.0, imageUrl: null },
      { x: 159.0, z: -89.5, imageUrl: null },
    ],
  },
  {
    key: 'rp-town-city',
    name: 'RP Town City',
    modelUrl: '/models/rp-town-city.glb',
    billboard: { offsetXFactor: -0.15, offsetZFactor: -1.2, imageUrl: null },
    walkBillboards: [
      { x: 264.6, z: -137.7, imageUrl: null },
      { x: 283.4, z: -227.1, imageUrl: null },
      { x: 285.6, z: -294.2, imageUrl: null },
    ],
  },
]

export const DEFAULT_MAP_KEY = MAPS[0].key

export function getMapByKey(key) {
  return MAPS.find((m) => m.key === key) || MAPS[0]
}
