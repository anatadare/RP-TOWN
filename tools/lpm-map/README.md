# Generator peta LPM

Membangun `miniapp/public/models/lpm.glb` dari gambar referensi `reference-map.png`
(gugusan 7 pulau, 30 marker bernomor).

    pip install numpy scipy scikit-image opencv-python pillow
    python3 extract.py            # gambar -> out/layout_px.json (pulau, danau, jalan, rumah, pohon, marker)
    MPK=250 python3 build_lpm.py  # -> out/lpm_new.glb + out/lpm_layout_world.json (copy glb ke public/models/lpm.glb)

- `MPK` = meter dunia per 1 km peta referensi (default 250 -> peta 3,1 x 2,3 km).
  Skala asli 1:1 (12 km) membuat dunia jalan-jalan ~2 juta segitiga, jadi tidak dipakai.
- 500 titik rumah -> `TPX_Buildings_N` (diganti "Rumah LPM" 2 lantai oleh `lib/lpmHouses.js`).
- 30 marker bernomor -> kotak kosong `TPX_Buildings_F<n>`.
- Node `LpmFixedLayout` menandai tata letak tetap (lihat `addLpmHouses`).

## Jembatan
8 jembatan antar-pulau ditetapkan manual di `BRIDGES` (`build_lpm.py`, koordinat tampilan referensi 2000 px; x1.8 = piksel asli),
bukan dari deteksi otomatis (deteksi memutus jembatan dan membuat Pulau Wisata & Industri terputus):
Wisata-Olahraga, Wisata-Pemukiman, Pemukiman-Terlarang, Pemukiman-Pusat Kota, Olahraga-Pusat Kota,
Olahraga-Industri, Industri-Pusat Kota, Pusat Kota-Pelabuhan.
Dek (9 m) ada di `TPX_RoadsOutlines_bridge` (bisa dipijak); pagar, tiang & pilar ada di node dekor `LpmBridges`
(tanpa prefix `TPX_`, jadi tidak ikut tabrakan). `lpm_layout_world.json` memuat jalur tiap jembatan (`bridges`).

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
