# Generator peta LPM

Membangun `miniapp/public/models/lpm.glb` dari gambar referensi `reference-map.png`
(gugusan 7 pulau, 30 marker bernomor).

    pip install numpy scipy scikit-image opencv-python pillow
    python3 extract.py            # gambar -> out/layout_px.json (pulau, danau, jalan, rumah, pohon, marker)
    MPK=250 python3 build_lpm.py  # -> out/lpm_new.glb + out/lpm_layout_world.json (copy glb ke public/models/lpm.glb)

- `MPK` = meter dunia per 1 km peta referensi (default 250 -> peta 3,1 x 2,3 km).
  Skala asli 1:1 (12 km) membuat dunia jalan-jalan ~2 juta segitiga, jadi tidak dipakai.
- 500 titik rumah -> `TPX_Buildings_N` (diganti "Rumah LPM" 2 lantai oleh `lib/lpmHouses.js`).
- `LH` = tinggi daratan di atas air (m), default 3,2 (dulu 1,2 -> terasa rata). Tebing tepi pantai/sungai/danau, jalan, rumah,
  pohon, jembatan & trotoar semua relatif ke nilai ini; JS membaca tinggi dari mesh jadi tidak perlu diubah. Total beda tinggi
  daratan-laut: Jelajahi = LH + `walkWaterDrop` (0,6); Peta = LH + `landRaise` (0,8), keduanya di `maps.js`.
- `KH` = skala rumah (default 1.0 = ukuran asli interior; sebelumnya 0.65). Nilainya HARUS sama dengan `FIXED_K` di
  `lib/lpmHouses.js`. Jari-jari pengaman rumah (`RHO`) dihitung otomatis dari ukuran tapak, dan skrip mencetak
  diagnostik jarak rumah ke jalan (termasuk jangkauan pagar/carport depan).
- 30 marker bernomor -> kotak kosong `TPX_Buildings_F<n>`.
- Node `LpmFixedLayout` menandai tata letak tetap (lihat `addLpmHouses`).

## Jembatan
8 jembatan antar-pulau ditetapkan manual di `BRIDGES` (`build_lpm.py`, koordinat tampilan referensi 2000 px; x1.8 = piksel asli),
bukan dari deteksi otomatis (deteksi memutus jembatan dan membuat Pulau Wisata & Industri terputus):
Wisata-Olahraga, Wisata-Pemukiman, Pemukiman-Terlarang, Pemukiman-Pusat Kota, Olahraga-Pusat Kota,
Olahraga-Industri, Industri-Pusat Kota, Pusat Kota-Pelabuhan.
Dek (9 m) ada di `TPX_RoadsOutlines_bridge` (bisa dipijak); pagar, tiang & pilar ada di node dekor `LpmBridges`
(tanpa prefix `TPX_`, jadi tidak ikut tabrakan). `lpm_layout_world.json` memuat jalur tiap jembatan (`bridges`).

## Trotoar
Jalan biasa & utama (jembatan tidak) punya trotoar abu-abu gelap di kedua sisi: lebar `SW` (default 1,6 m; `SW=0` =
tanpa trotoar), naik 12 cm dari aspal, tepi miring landai ke aspal dan ke rumput. Dibuat sebagai SATU area utuh, bukan
potongan per ruas jalan: jaringan jalan dirasterisasi halus (0,25 m/piksel), trotoar = pelebaran jalan - badan jalan,
dihaluskan, diambil kontur-nya, lalu ditriangulasi dengan Delaunay yang dipaksa memuat semua sisi kontur (titik
ditambah di tengah sisi yang belum ada) dan segitiga di dalam area dipilih eksak. Karena itu sudut persimpangan
membulat mulus dan trotoar terpotong rapi di tepi jalan lain. Skrip mencetak luas permukaan atas vs luas poligon
(harus selisih 0,000% = tanpa lubang/luapan). Satu mesh `TPX_RoadsOutlines_sidewalk` (warna per titik) di grup jalan,
jadi bisa dipijak dan tingginya dibaca persis oleh `walkWorld.js` (batas naik karakter 0,6 m). Trotoar dipangkas di
air/tepi pantai dan kotak fasilitas; rumah, pohon & billboard menghindari jalan + trotoar (`road_sw`).
Pengaturan lewat env: `SW` (lebar), `SWP` (toleransi penyederhanaan kontur, piksel), `SWS` (jendela penghalus kontur),
`SWE` (jarak maks titik kontur, m) -- semakin kecil `SWP`/`SWE` semakin halus tapi semakin banyak segitiga.
Warna: `SW_TOP` / `SW_EDGE` di blok trotoar `build_lpm.py`.

## Penyambungan jalan
Ekstraksi jalan dari gambar memecah jaringan jadi ~29 potongan (celah di bawah ikon marker, persimpangan,
garis kuning putus-putus). `build_lpm.py` menyambung ujung jalan yang menggantung ke jalan terdekat di komponen
lain (maks ~80 m, garis harus di daratan; ujung jembatan boleh melintasi pantai) sampai jaringan jadi 1 komponen.
Relaksasi posisi rumah dijalankan minimal 8 iterasi supaya rumah menjauh dari jalan sambungan.

## Air & daratan (sungai, danau, tebing tepi)
- Daratan dinaikkan `LAND_H = 1,2 m` di atas air (green mesh, jalan, pohon, rumah, kotak ikut). Tepi daratan (pantai,
  sungai, danau) punya dinding tebing `LpmBanks` turun sampai -1 m (batas air/darat jelas, tidak flat).
  Titik terendah model tetap -1 m, jadi posisi laut di tampilan Peta tidak berubah; `landRaise` di `maps.js` diturunkan
  2 -> 0,8 supaya beda tinggi darat-laut total tetap 2 m.
- Sungai Pusat Kota (3 penyeberangan) & kanal ke Danau Pemukiman (1) tadinya terpotong oleh jalan yang menyeberang
  (jalan abu-abu terbaca sebagai daratan). `extract.py` (`RIVER_CROSSINGS`) menyimpan celahnya (`river_gaps`) dan
  `build_lpm.py` membukanya lagi: sungai menerus, jalannya jadi jembatan kecil berpagar (`LpmBridges`).
- Masker daratan dihaluskan (Gaussian) supaya garis pantai/sungai/danau tidak bergerigi; titik bantu dekat pantai
  ditambahkan ke triangulasi supaya mesh air/darat tidak bolong.
