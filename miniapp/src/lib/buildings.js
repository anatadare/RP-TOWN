// Prefix nama node bangunan di file .glb (sama kayak yang dipakai TownMap3D).
// Ditaro di sini (bukan cuma di TownMap3D) supaya bisa dipakai bareng
// fitur search bangunan di App.jsx tanpa duplikasi string.
export const BUILDING_PREFIX = 'TPX_Buildings_'

// Ambil nomor urut bangunan dari nama node, contoh: "TPX_Buildings_12" -> 12.
// Dipakai buat urutan default (kalau population sama) & label placeholder.
export function buildingNumber(buildingKey) {
  const match = /(\d+)\s*$/.exec(buildingKey || '')
  return match ? Number(match[1]) : 0
}

// Label default buat bangunan yang belum punya room/nama custom.
// Nanti kalau bangunan sudah "disewa" user, ini akan diganti nama custom
// mereka (lewat rooms.name) — jadi placeholder ini cuma dipakai sementara.
export function placeholderBuildingLabel(buildingKey) {
  return `Bangunan ${buildingNumber(buildingKey)}`
}

// Gabungin daftar nomor node bangunan (hasil scan model 3D) dengan daftar
// room yang sudah ke-assign, jadi satu daftar "bangunan" yang seragam buat
// ditampilin di search bar — baik yang sudah punya room maupun yang belum.
export function buildBuildingDirectory(buildingKeys, roomsOnMap) {
  const roomByKey = {}
  roomsOnMap.forEach((r) => {
    if (r.building_key) roomByKey[r.building_key] = r
  })

  return buildingKeys
    .map((key) => {
      const room = roomByKey[key]
      if (room) {
        return {
          buildingKey: key,
          number: buildingNumber(key),
          name: room.name,
          emoji: room.emoji || '📍',
          population: room.occupantCount || 0,
          isClaimed: true,
          room,
        }
      }
      return {
        buildingKey: key,
        number: buildingNumber(key),
        name: placeholderBuildingLabel(key),
        emoji: '🏚️',
        population: 0,
        isClaimed: false,
        room: null,
      }
    })
    .sort((a, b) => a.number - b.number)
}
