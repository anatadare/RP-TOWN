// Pencahayaan interior Rumah Pantai "dipanggang" ke vertex color.
//
// Kenapa: peta asli sekarang ikut digambar di balik jendela (lihat PantaiMapBackdrop
// di TownWalk.jsx), dan lampu three.js berlaku untuk SELURUH scene. Kalau interior
// memakai lampu scene, cahaya interior (terang & tetap) akan ikut menerangi peta di
// luar jendela, jadi petanya tidak cocok dengan suasana luar (terutama malam hari).
// Solusinya: interior tidak memakai lampu sama sekali. Kecerahannya dihitung di sini
// satu kali (rumus difus three.js: ambient + hemisphere + directional) lalu dikalikan
// ke warna vertex, dan digambar dengan MeshBasicMaterial. Hasilnya sama dengan
// MeshStandardMaterial di bawah lampu yang sama, tapi tidak butuh lampu & lebih ringan.
//
// Murni JavaScript (tanpa three.js) supaya bisa dites di Node. Semua warna di sini
// dalam ruang LINEAR (sama dengan vertex color & THREE.Color di three.js).

// n = normal dunia (x, y, z) satuan; cfg lihat makeShading().
// Hasil: irradiance [r, g, b] (belum dibagi PI).
export function irradiance(n, cfg, out = [0, 0, 0]) {
  const t = 0.5 + 0.5 * n[1] // hemisphere: langit di atas, tanah di bawah
  const sun = cfg.sun * Math.max(0, n[0] * cfg.L[0] + n[1] * cfg.L[1] + n[2] * cfg.L[2])
  for (let c = 0; c < 3; c++) {
    out[c] = cfg.ambient * cfg.ambientRGB[c]
      + cfg.hemi * (cfg.groundRGB[c] * (1 - t) + cfg.skyRGB[c] * t)
      + sun
  }
  return out
}

// cfg dari angka mentah. Warna sudah linear ([r, g, b]); sunPos = posisi lampu
// directional (target di titik asal), jadi arah ke lampu = sunPos dinormalkan.
export function makeShading({ ambient, ambientRGB, hemi, skyRGB, groundRGB, sun, sunPos }) {
  const m = Math.hypot(sunPos[0], sunPos[1], sunPos[2]) || 1
  return { ambient, ambientRGB, hemi, skyRGB, groundRGB, sun, L: [sunPos[0] / m, sunPos[1] / m, sunPos[2] / m] }
}

// Kalikan vertex color (Float32Array, 3 per vertex) dengan irradiance / PI sesuai
// normalnya. `mirrorX`: geometri digambar di dalam grup ber-scale x = -1 (denah
// dicerminkan), jadi normal dunia = (-nx, ny, nz).
export function bakeShading(colors, normals, cfg, mirrorX = false) {
  const n = [0, 0, 0], e = [0, 0, 0]
  for (let i = 0; i < colors.length; i += 3) {
    n[0] = mirrorX ? -normals[i] : normals[i]
    n[1] = normals[i + 1]
    n[2] = normals[i + 2]
    irradiance(n, cfg, e)
    colors[i] *= e[0] / Math.PI
    colors[i + 1] *= e[1] / Math.PI
    colors[i + 2] *= e[2] / Math.PI
  }
}

// Rata-rata faktor kecerahan (irradiance / PI) untuk beberapa normal, buat benda
// kecil yang bukan bagian geometri gabungan (daun pintu, kenop).
export function averageShade(normals, cfg) {
  const acc = [0, 0, 0], e = [0, 0, 0]
  for (const n of normals) {
    irradiance(n, cfg, e)
    for (let c = 0; c < 3; c++) acc[c] += e[c] / Math.PI
  }
  return acc.map((v) => v / normals.length)
}
