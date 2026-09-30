// Nama pulau rumah, dipakai Pak Darma buat nampilin listing/detail rumah.
// SENGAJA disalin dari miniapp/src/lib/houses.js (RENTABLE_ISLANDS) --
// worker dan miniapp adalah 2 app/build yang beda, jadi tidak saling
// import. Kalau nambah/ganti nama pulau di miniapp, samakan juga di sini.
const ISLAND_NAMES = {
  'kawasan-pantai': 'Kawasan Pantai',
  lpm: 'LPM',
}

export function getIslandName(mapKey) {
  return ISLAND_NAMES[mapKey] || mapKey || 'pulau tidak diketahui'
}
