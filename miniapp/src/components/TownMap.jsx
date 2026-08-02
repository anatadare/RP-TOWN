import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

// Kanvas peta didesain di ukuran tetap, nanti di-scale otomatis oleh TransformWrapper
export const MAP_WIDTH = 1000
export const MAP_HEIGHT = 1400

// Posisi tiap room di atas kanvas (x, y = titik tengah gedungnya)
// Kalau nanti nambah room baru dengan slug yang belum ada di sini,
// dia otomatis diletakkan di grid fallback di bagian bawah peta.
const ROOM_POSITIONS = {
  rumah: { x: 220, y: 260 },
  kantor: { x: 700, y: 220 },
  kafe: { x: 500, y: 480 },
  taman: { x: 240, y: 640 },
  pantai: { x: 650, y: 900 },
}

function getRoomPosition(room, index) {
  if (ROOM_POSITIONS[room.slug]) return ROOM_POSITIONS[room.slug]
  // fallback grid untuk room yang belum diatur posisinya manual
  const col = index % 3
  const row = Math.floor(index / 3)
  return { x: 200 + col * 300, y: 1100 + row * 220 }
}

function buildPathD(positions) {
  if (positions.length === 0) return ''
  const [first, ...rest] = positions
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ')
}

export default function TownMap({ rooms, onSelectRoom }) {
  const positioned = rooms.map((room, i) => ({ room, pos: getRoomPosition(room, i) }))
  const pathD = buildPathD(positioned.map((p) => p.pos))

  return (
    <TransformWrapper
      initialScale={0.62}
      minScale={0.4}
      maxScale={1.6}
      centerOnInit
      limitToBounds
      wheel={{ step: 0.15 }}
      doubleClick={{ mode: 'zoomIn', step: 0.5 }}
      pinch={{ step: 5 }}
    >
      {({ zoomIn, zoomOut }) => (
        <div className="map-viewport">
          <TransformComponent wrapperClass="map-transform-wrapper" contentClass="map-transform-content">
            <svg
              className="map-canvas"
              width={MAP_WIDTH}
              height={MAP_HEIGHT}
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
            >
              <defs>
                <radialGradient id="groundGlow" cx="50%" cy="35%" r="75%">
                  <stop offset="0%" stopColor="#3a4d6e" />
                  <stop offset="100%" stopColor="#232a45" />
                </radialGradient>
                <pattern id="grassTexture" width="40" height="40" patternUnits="userSpaceOnUse">
                  <rect width="40" height="40" fill="none" />
                  <circle cx="8" cy="10" r="1.1" fill="#4a6350" opacity="0.35" />
                  <circle cx="26" cy="24" r="1.1" fill="#4a6350" opacity="0.3" />
                  <circle cx="34" cy="6" r="1" fill="#4a6350" opacity="0.25" />
                </pattern>
              </defs>

              {/* Ground */}
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#groundGlow)" />
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#grassTexture)" />

              {/* Area pantai (dekorasi air biru di area bawah kanan) */}
              <ellipse cx="820" cy="960" rx="360" ry="260" fill="#2a5a72" opacity="0.55" />
              <ellipse cx="820" cy="960" rx="300" ry="210" fill="#347089" opacity="0.5" />

              {/* Jalur titik-titik menghubungkan tiap room */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="rgba(244,236,216,0.35)"
                  strokeWidth="4"
                  strokeDasharray="2 14"
                  strokeLinecap="round"
                />
              )}

              {/* Dekorasi pohon di beberapa titik acak tetap */}
              {[
                [90, 420], [860, 340], [130, 760], [900, 700], [420, 130], [60, 1050], [760, 1180],
              ].map(([x, y], i) => (
                <g key={i} transform={`translate(${x},${y})`} opacity="0.85">
                  <circle cx="0" cy="0" r="16" fill="#3e5c50" />
                  <circle cx="-8" cy="6" r="12" fill="#345048" />
                  <rect x="-2.5" y="14" width="5" height="12" fill="#5b4632" />
                </g>
              ))}

              {/* Bintang ambient kecil */}
              {[
                [60, 60], [940, 90], [500, 40], [200, 1300], [800, 1340],
              ].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="2" fill="#fff" opacity="0.4" />
              ))}

              {/* Room / gedung */}
              {positioned.map(({ room, pos }) => (
                <g
                  key={room.id}
                  transform={`translate(${pos.x},${pos.y})`}
                  className="map-building"
                  onClick={() => onSelectRoom(room)}
                >
                  {/* Bayangan tanah */}
                  <ellipse cx="0" cy="46" rx="46" ry="12" fill="#000" opacity="0.25" />

                  {/* Base gedung */}
                  <circle r="44" fill="#3e5c50" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />

                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="38"
                    y="1"
                  >
                    {room.emoji}
                  </text>

                  {/* Badge jumlah orang */}
                  {room.occupantCount > 0 && (
                    <g transform="translate(30,-32)">
                      <circle r="16" fill="#ffb454" stroke="#201a2e" strokeWidth="1.5" />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="15"
                        fontWeight="700"
                        fill="#201a2e"
                        fontFamily="'Space Mono', monospace"
                      >
                        {room.occupantCount}
                      </text>
                    </g>
                  )}

                  {/* Label nama room */}
                  <rect x="-58" y="56" width="116" height="26" rx="13" fill="rgba(27,35,64,0.85)" stroke="rgba(244,236,216,0.18)" />
                  <text
                    x="0"
                    y="74"
                    textAnchor="middle"
                    fontSize="14"
                    fontFamily="'Fraunces', serif"
                    fontWeight="600"
                    fill="#f4ecd8"
                  >
                    {room.name}
                  </text>
                </g>
              ))}
            </svg>
          </TransformComponent>

          {/* Kontrol zoom manual (tombol +/-) */}
          <div className="map-zoom-controls">
            <button className="map-zoom-btn" onClick={() => zoomIn()} aria-label="Perbesar peta">+</button>
            <button className="map-zoom-btn" onClick={() => zoomOut()} aria-label="Perkecil peta">−</button>
          </div>
        </div>
      )}
    </TransformWrapper>
  )
}
