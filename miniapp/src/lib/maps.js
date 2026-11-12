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
// `landRaise`: (opsional, meter, default 0) daratan di peta 3D tampilan luar
// (TownMap3D) diangkat segini terhadap laut. Dipakai kalau ombak laut
// nongol/nutupin daratan. Tinggi ombak laut otomatis dikecilin supaya puncak
// ombak selalu ada di bawah permukaan daratan (lihat OceanSurface). Gak
// ngaruh ke mode Jelajahi (TownWalk) — itu punya lautnya sendiri.
// `walkWaterDrop`: (opsional, meter, default 0) di mode Jelajahi (TownWalk)
// permukaan air (laut, teluk, kolam) diturunkan segini terhadap daratan.
// Dipakai kalau air kelihatan "menggenang" rata di atas daratan (tinggi air
// = tinggi tanah). Cuma visual: area yang bisa dipijak & tabrakan gak berubah.
// `enterableBuildings`: true = di mode Jelajahi, tiap bangunan bernomor
// (TPX_Buildings_N) bisa dimasuki lewat pop up "Masuki rumah". Interiornya
// denah standar "Desain Rumah RP Town" (lib/houseInterior.js): 3 kamar tidur,
// 1 kamar mandi, dapur, ruang makan, ruang tamu, ruang cuci.
// `interiorPlan`: (opsional) denah interior yang dipakai kalau `enterableBuildings`
// true. Kosong = denah standar 1 lantai (lib/houseInterior.js). 'pantai' = Rumah
// Pantai 2 lantai (lib/houseInteriorPantai.js). 'lpm' = Rumah LPM 2 lantai
// (lib/houseInteriorLpm.js).
// `enterableNumbers`: (opsional) kalau diisi, cuma bangunan dengan nomor di daftar
// ini yang muncul pop up "Masuki rumah" (kosong = semua bangunan bernomor).
export const MAPS = [
  {
    key: 'kawasan-pantai',
    name: 'Kawasan Pantai',
    modelUrl: '/models/kawasan-pantai.glb',
    // Rumah di daratan bisa dimasuki di mode Jelajahi, pakai denah "Rumah Pantai"
    // 2 lantai (lib/houseInteriorPantai.js). Cuma bangunan yang punya model
    // BeachHouse_N di .glb (nomor 0-17 & 45-47). Bangunan nomor 18-44 ada di
    // area laut: rumah panggung (lib/pantaiLaut.js) yang interiornya langsung ada
    // di peta (tanpa layar "Masuki rumah"), jadi tidak masuk daftar ini.
    enterableBuildings: true,
    interiorPlan: 'pantai',
    enterableNumbers: [...Array(18).keys(), 45, 46, 47],
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
    // Tampilan luar (Peta) pakai gambar 2D ringan dari glb ini (tools/lpm-map/build_lpm.py -> out/lpm_preview.webp), bukan Peta 3D;
    // lpm.glb (besar) baru dimuat saat pemain masuk mode Jelajahi. Hapus baris ini untuk kembali ke Peta 3D.
    preview2d: '/maps/lpm-preview.webp',
    // Daratan di glb sudah +3,2 m di atas air (LAND_H di tools/lpm-map/build_lpm.py; tebing tepi pantai/sungai/danau)
    // -> landRaise 0,8 membuat total beda tinggi daratan-laut di tampilan Peta 4 m (dulu 1,2 + 0,8 = 2 m).
    landRaise: 0.8,
    groundVariation: 1.7, // mode Jelajahi: variasi warna tanah (bercak terang/gelap/kering); 0 = satu warna rata
    walkWaterDrop: 0.6, // mode Jelajahi: air 0.6 m di bawah daratan, bukan rata = gak kelihatan genangan
    // Peta LPM = gugusan 7 pulau (Pusat Kota, Pemukiman, Olahraga, Industri,
    // Pelabuhan, Wisata, Terlarang), ~3,1 x 2,3 km (skala 250 m dunia per 1 km
    // peta referensi). Dibangun dari gambar referensi: jalan, jembatan, danau,
    // pohon & 500 titik rumah warga; 30 marker bernomor jadi KOTAK KOSONG
    // (TPX_BuildingsFacility_N) yang nanti diisi bangunan fasilitas.
    // Tata letak TETAP (node LpmFixedLayout di glb): lpmHouses.js memakai posisi
    // & arah rumah dari glb apa adanya, tanpa menyusun jalan/slot sendiri.
    walkCell: 4, // sel grid tanah jalan-jalan (m); 2 m di peta seluas ini = >1 jt segitiga
    enterableBuildings: true, // semua rumah warga bisa dimasuki di mode Jelajahi (lihat houseInteriorLpm.js)
    interiorPlan: 'lpm', // Rumah LPM 2 lantai (lib/houseInteriorLpm.js + lib/lpmHouses.js)
    billboard: { offsetXFactor: -0.3, offsetZFactor: -1.15, imageUrl: null },
    walkBillboards: [
      { x: 1695.0, z: -1378.4, imageUrl: null },
      { x: 2297.1, z: -804.8, imageUrl: null },
      { x: 1739.4, z: -1852.3, imageUrl: null },
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
