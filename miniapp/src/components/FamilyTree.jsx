import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

// Kanvas pohon keluarga -- ukuran tetap di ruang koordinat SVG, nanti
// di-scale otomatis sama TransformWrapper (pola yang sama kayak TownMap.jsx
// buat peta 2D lama).
const TREE_WIDTH = 1000
const TREE_HEIGHT = 720
const NODE_RADIUS = 42

// Data contoh (dummy) -- belum nyambung ke database, cuma buat preview
// tampilan pohon keluarga. Node "Kamu" nanti diganti data citizen asli
// begitu fitur ini beneran dikembangin ke backend.
const DUMMY_NODES = [
  { id: 'kakek', name: 'Kakek', role: 'Kakek', x: 300, y: 90 },
  { id: 'nenek', name: 'Nenek', role: 'Nenek', x: 460, y: 90 },

  { id: 'ibu', name: 'Ibu', role: 'Anak', x: 140, y: 300 },
  { id: 'ayah', name: 'Ayah', role: 'Menantu', x: 300, y: 300 },
  { id: 'om', name: 'Om', role: 'Menantu', x: 620, y: 300 },
  { id: 'tante', name: 'Tante', role: 'Anak', x: 760, y: 300 },

  { id: 'kakak', name: 'Kakak', role: 'Cucu', x: 140, y: 510 },
  { id: 'kamu', name: 'Kamu', role: 'Cucu', x: 300, y: 510, highlight: true },
  { id: 'sepupu1', name: 'Sepupu', role: 'Cucu', x: 620, y: 510 },
  { id: 'sepupu2', name: 'Sepupu', role: 'Cucu', x: 780, y: 510 },
  { id: 'pasangan-sepupu', name: 'Pasangan', role: 'Ipar', x: 920, y: 510 },

  { id: 'anak-sepupu', name: 'Keponakan', role: 'Cicit', x: 850, y: 660 },
]

// Garis pasangan (horizontal, langsung antar 2 node se-level)
const COUPLE_LINKS = [
  ['kakek', 'nenek'],
  ['ibu', 'ayah'],
  ['om', 'tante'],
  ['sepupu2', 'pasangan-sepupu'],
]

// Garis turunan (dari titik tengah 1-2 orang tua turun ke 1+ anak),
// digambar model "siku" (elbow) khas bagan silsilah keluarga.
const DESCENT_LINKS = [
  { from: ['kakek', 'nenek'], to: ['ibu', 'om'] },
  { from: ['ibu', 'ayah'], to: ['kakak', 'kamu'] },
  { from: ['om', 'tante'], to: ['sepupu1', 'sepupu2'] },
  { from: ['sepupu2', 'pasangan-sepupu'], to: ['anak-sepupu'] },
]

function findNode(id) {
  return DUMMY_NODES.find((n) => n.id === id)
}

function midX(ids) {
  const xs = ids.map((id) => findNode(id).x)
  return (Math.min(...xs) + Math.max(...xs)) / 2
}

function initialsOf(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

// Elbow connector: turun dari (fromX,fromY) -> belok di tengah -> nyebar ke tiap anak
function ElbowConnector({ from, to }) {
  const fromY = findNode(from[0]).y
  const parentX = midX(from)
  const childY = findNode(to[0]).y
  const childXs = to.map((id) => findNode(id).x)
  const bendY = fromY + (childY - fromY) / 2

  return (
    <g className="family-tree-link">
      {/* turun dari orang tua ke titik belok */}
      <path d={`M ${parentX} ${fromY + NODE_RADIUS} L ${parentX} ${bendY}`} />
      {/* palang horizontal di titik belok (kalau anaknya lebih dari satu) */}
      {childXs.length > 1 && (
        <path d={`M ${Math.min(...childXs)} ${bendY} L ${Math.max(...childXs)} ${bendY}`} />
      )}
      {/* turun ke tiap anak */}
      {childXs.map((cx) => (
        <path key={cx} d={`M ${cx} ${bendY} L ${cx} ${childY - NODE_RADIUS}`} />
      ))}
    </g>
  )
}

function CoupleConnector({ pair }) {
  const [a, b] = pair.map(findNode)
  return (
    <line
      className="family-tree-link"
      x1={a.x + NODE_RADIUS}
      y1={a.y}
      x2={b.x - NODE_RADIUS}
      y2={b.y}
    />
  )
}

function FamilyNode({ node, citizen }) {
  const isYou = node.id === 'kamu'
  const displayName = isYou ? citizen?.display_name || citizen?.username || node.name : node.name
  const avatarUrl = isYou ? citizen?.avatar_url : null

  return (
    <g transform={`translate(${node.x},${node.y})`} className={`family-node${node.highlight ? ' is-you' : ''}`}>
      <ellipse className="family-node-shadow" cy={NODE_RADIUS + 8} rx={NODE_RADIUS * 0.7} ry="8" />
      {avatarUrl ? (
        <>
          <clipPath id={`clip-${node.id}`}>
            <circle r={NODE_RADIUS - 3} />
          </clipPath>
          <image
            href={avatarUrl}
            x={-(NODE_RADIUS - 3)}
            y={-(NODE_RADIUS - 3)}
            width={(NODE_RADIUS - 3) * 2}
            height={(NODE_RADIUS - 3) * 2}
            clipPath={`url(#clip-${node.id})`}
            preserveAspectRatio="xMidYMid slice"
          />
          <circle className="family-node-ring" r={NODE_RADIUS} />
        </>
      ) : (
        <>
          <circle className="family-node-circle" r={NODE_RADIUS} />
          <text className="family-node-initials" textAnchor="middle" dominantBaseline="central">
            {initialsOf(displayName)}
          </text>
        </>
      )}
      <rect
        className="family-node-label-bg"
        x={-70}
        y={NODE_RADIUS + 12}
        width="140"
        height="40"
        rx="10"
      />
      <text className="family-node-name" textAnchor="middle" x="0" y={NODE_RADIUS + 28}>
        {displayName}
      </text>
      <text className="family-node-role" textAnchor="middle" x="0" y={NODE_RADIUS + 44}>
        {node.role}
      </text>
    </g>
  )
}

// Kanvas pohon keluarga yang bisa di-pinch/scroll buat zoom, dan digeser
// (drag) buat pan -- dipakai kalau keluarganya banyak dan gak muat 1 layar.
export default function FamilyTree({ citizen }) {
  return (
    <div className="family-tree-card">
      <TransformWrapper
        initialScale={0.62}
        minScale={0.35}
        maxScale={2}
        centerOnInit
        limitToBounds
        wheel={{ step: 0.15 }}
        doubleClick={{ mode: 'zoomIn', step: 0.5 }}
        pinch={{ step: 5 }}
      >
        {({ zoomIn, zoomOut }) => (
          <>
            <TransformComponent
              wrapperClass="family-tree-wrapper"
              contentClass="family-tree-content"
            >
              <svg
                className="family-tree-canvas"
                width={TREE_WIDTH}
                height={TREE_HEIGHT}
                viewBox={`0 0 ${TREE_WIDTH} ${TREE_HEIGHT}`}
              >
                {DESCENT_LINKS.map((link, i) => (
                  <ElbowConnector key={i} from={link.from} to={link.to} />
                ))}
                {COUPLE_LINKS.map((pair, i) => (
                  <CoupleConnector key={i} pair={pair} />
                ))}
                {DUMMY_NODES.map((node) => (
                  <FamilyNode key={node.id} node={node} citizen={citizen} />
                ))}
              </svg>
            </TransformComponent>

            <div className="family-tree-hint">↔ Geser &amp; cubit buat zoom</div>

            <div className="family-tree-zoom-controls">
              <button type="button" className="map-zoom-btn" onClick={() => zoomIn()} aria-label="Perbesar pohon keluarga">+</button>
              <button type="button" className="map-zoom-btn" onClick={() => zoomOut()} aria-label="Perkecil pohon keluarga">−</button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  )
}
