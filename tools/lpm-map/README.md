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
