import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { fetchFamilyData, buildFamilyLayout, signatureOf, LAYOUT } from '../lib/family'
import { fetchHasKuaRoom, requestKuaInvite, kuaInviteErrorMessage } from '../lib/kua'
import { openTelegramLink, hapticSelect } from '../lib/telegram'
import './FamilyTree.css'

const { NODE_RADIUS, LABEL_BOTTOM } = LAYOUT

// Polling ringan (bukan realtime, sama kayak polling room di App.jsx) --
// biar pohon langsung ke-update abis Penghulu di KUA nyatat relasi baru.
const REFRESH_INTERVAL_MS = 15000

function initialsOf(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
}

function shortName(name, max = 14) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

// ------------------------------------------------------------------
// Garis
// ------------------------------------------------------------------

// Orang tua -> anak-anak, model "siku" (elbow) khas bagan silsilah.
function DescentConnector({ group, nodeById }) {
  const parents = group.parents.map((id) => nodeById.get(id)).filter(Boolean)
  const children = group.children
    .map((c) => ({ ...c, node: nodeById.get(c.id) }))
    .filter((c) => c.node)
  if (parents.length === 0 || children.length === 0) return null

  const parentBottom = Math.max(...parents.map((p) => p.y))
  const childTop = Math.min(...children.map((c) => c.node.y))
  if (childTop <= parentBottom) return null // data janggal (anak sejajar/di atas orang tua)

  const parentX = parents.reduce((s, p) => s + p.x, 0) / parents.length
  // Pasangan: garis turun dari tengah garis pasangan. Orang tua tunggal:
  // mulai dari bawah kotak namanya biar gak nabrak tulisan.
  const startY = parents.length === 2 ? parentBottom : parentBottom + LABEL_BOTTOM
  const bendY = startY + (childTop - NODE_RADIUS - startY) / 2
  const childXs = children.map((c) => c.node.x)
  const barMin = Math.min(parentX, ...childXs)
  const barMax = Math.max(parentX, ...childXs)

  return (
    <g className="family-tree-link-group">
      <path className="family-tree-link" d={`M ${parentX} ${startY} L ${parentX} ${bendY}`} />
      {barMax > barMin && <path className="family-tree-link" d={`M ${barMin} ${bendY} L ${barMax} ${bendY}`} />}
      {children.map((c) => (
        <path
          key={c.id}
          className={`family-tree-link${c.inferred ? ' is-dashed' : ''}`}
          d={`M ${c.node.x} ${bendY} L ${c.node.x} ${c.node.y - NODE_RADIUS}`}
        />
      ))}
    </g>
  )
}

function CoupleConnector({ pair, nodeById }) {
  const [a, b] = pair.map((id) => nodeById.get(id))
  if (!a || !b) return null
  const left = a.x <= b.x ? a : b
  const right = left === a ? b : a
  const midX = (left.x + right.x) / 2
  return (
    <g>
      <line
        className="family-tree-link"
        x1={left.x + NODE_RADIUS}
        y1={left.y}
        x2={right.x - NODE_RADIUS}
        y2={right.y}
      />
      <circle className="family-heart-bg" cx={midX} cy={left.y} r="15" />
      <text className="family-heart" x={midX} y={left.y} textAnchor="middle" dominantBaseline="central">
        ♥
      </text>
    </g>
  )
}

// Nenek/kakek/paman/tante: gak ketahuan dari sisi mana (ayah/ibu), jadi
// digambar putus-putus langsung ke warga yang mendaftarkan.
function KinConnector({ link, nodeById }) {
  const from = nodeById.get(link.from)
  const to = nodeById.get(link.to)
  if (!from || !to || from.y === to.y) return null

  const upper = from.y < to.y ? from : to
  const lower = upper === from ? to : from
  const y1 = upper.y + LABEL_BOTTOM
  const y2 = lower.y - NODE_RADIUS
  const ym = (y1 + y2) / 2
  return <path className="family-tree-link is-dashed" d={`M ${upper.x} ${y1} C ${upper.x} ${ym}, ${lower.x} ${ym}, ${lower.x} ${y2}`} />
}

// Kaka/abang yang orang tuanya belum tercatat: busur putus-putus di atas node.
function SiblingConnector({ link, nodeById }) {
  const a = nodeById.get(link.a)
  const b = nodeById.get(link.b)
  if (!a || !b || a.y !== b.y) return null
  const y = a.y - NODE_RADIUS
  const lift = Math.min(56, 22 + Math.abs(a.x - b.x) / 8) // tinggi puncak busur
  return <path className="family-tree-link is-dashed" d={`M ${a.x} ${y} Q ${(a.x + b.x) / 2} ${y - lift * 2} ${b.x} ${y}`} />
}

// ------------------------------------------------------------------
// Node
// ------------------------------------------------------------------
function FamilyNode({ node }) {
  const [imgFailed, setImgFailed] = useState(false)
  const showAvatar = node.avatarUrl && !imgFailed
  const clipId = `family-clip-${node.id}`

  return (
    <g transform={`translate(${node.x},${node.y})`} className={`family-node${node.isRoot ? ' is-you' : ''}`}>
      <ellipse className="family-node-shadow" cy={NODE_RADIUS + 8} rx={NODE_RADIUS * 0.7} ry="8" />
      {showAvatar ? (
        <>
          <clipPath id={clipId}>
            <circle r={NODE_RADIUS - 3} />
          </clipPath>
          <circle className="family-node-circle" r={NODE_RADIUS} />
          <image
            href={node.avatarUrl}
            x={-(NODE_RADIUS - 3)}
            y={-(NODE_RADIUS - 3)}
            width={(NODE_RADIUS - 3) * 2}
            height={(NODE_RADIUS - 3) * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
            onError={() => setImgFailed(true)}
          />
          <circle className="family-node-ring" r={NODE_RADIUS} />
        </>
      ) : (
        <>
          <circle className="family-node-circle" r={NODE_RADIUS} />
          <text className="family-node-initials" textAnchor="middle" dominantBaseline="central">
            {initialsOf(node.name)}
          </text>
        </>
      )}
      <rect className="family-node-label-bg" x={-70} y={NODE_RADIUS + 12} width="140" height="40" rx="10" />
      <text className="family-node-name" textAnchor="middle" x="0" y={NODE_RADIUS + 28}>
        {shortName(node.name)}
      </text>
      <text className="family-node-role" textAnchor="middle" x="0" y={NODE_RADIUS + 44}>
        {node.role}
      </text>
    </g>
  )
}

// ------------------------------------------------------------------
// Komponen utama
// ------------------------------------------------------------------
// Kanvas pohon keluarga yang bisa di-pinch/scroll buat zoom, dan digeser
// (drag) buat pan. Datanya beneran dari database: pasangan (ijab kabul) dan
// relasi mommy/daddy/kaka/abang/nenek/kakek/paman/tante yang dicatat NPC
// Penghulu di grup KUA.
export default function FamilyTree({ citizen }) {
  const citizenId = citizen?.id
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [errorMsg, setErrorMsg] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [hasKua, setHasKua] = useState(false)
  const [kuaBusy, setKuaBusy] = useState(false)
  const [kuaError, setKuaError] = useState(null)
  const signatureRef = useRef('')

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!citizenId) return
      try {
        const next = await fetchFamilyData(citizenId)
        const sig = signatureOf(next)
        if (sig !== signatureRef.current) {
          signatureRef.current = sig
          setData(next)
        }
        setStatus('ready')
        setErrorMsg('')
      } catch (err) {
        console.error('[FamilyTree] gagal ambil data keluarga:', err)
        if (!silent) {
          setErrorMsg(err?.message || 'Gagal memuat pohon keluarga.')
          setStatus('error')
        }
      }
    },
    [citizenId]
  )

  useEffect(() => {
    signatureRef.current = ''
    setData(null)
    setStatus('loading')
    load()

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true })
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    let cancelled = false
    fetchHasKuaRoom()
      .then((exists) => {
        if (!cancelled) setHasKua(exists)
      })
      .catch((err) => console.warn('[FamilyTree] ruang KUA gak ketemu:', err))
    return () => {
      cancelled = true
    }
  }, [])

  // Link masuk KUA dibuat bot on-demand (sekali pakai, kedaluwarsa cepat,
  // dicek kapasitasnya) -- gak ada link statis yang bisa disebar.
  async function handleOpenKua() {
    hapticSelect()
    setKuaBusy(true)
    setKuaError(null)
    try {
      const invite = await requestKuaInvite()
      if (invite.ok) {
        openTelegramLink(invite.url)
      } else {
        setKuaError(kuaInviteErrorMessage(invite))
      }
    } finally {
      setKuaBusy(false)
    }
  }

  async function handleManualRefresh() {
    hapticSelect()
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const layout = useMemo(() => (data ? buildFamilyLayout(data) : null), [data])
  const isEmpty = layout ? layout.nodes.length <= 1 : false
  const hasDashed = layout ? layout.kinLinks.length > 0 || layout.siblingLinks.length > 0 || layout.groups.some((g) => g.children.some((c) => c.inferred)) : false

  const nodeById = useMemo(() => new Map((layout?.nodes || []).map((n) => [n.id, n])), [layout])

  const initialScale = layout
    ? Math.min(0.9, Math.max(0.3, ((typeof window !== 'undefined' ? window.innerWidth : 390) - 32) / layout.width))
    : 0.6

  return (
    <div className="family-tree-card">
      {layout ? (
        <TransformWrapper
          key={`${Math.round(layout.width)}x${Math.round(layout.height)}`}
          initialScale={initialScale}
          minScale={0.25}
          maxScale={2}
          centerOnInit
          limitToBounds={false}
          wheel={{ step: 0.15 }}
          doubleClick={{ mode: 'zoomIn', step: 0.5 }}
          pinch={{ step: 5 }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <TransformComponent wrapperClass="family-tree-wrapper" contentClass="family-tree-content">
                <svg
                  className="family-tree-canvas"
                  width={layout.width}
                  height={layout.height}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                >
                  {layout.groups.map((g, i) => (
                    <DescentConnector key={`g-${i}`} group={g} nodeById={nodeById} />
                  ))}
                  {layout.kinLinks.map((k, i) => (
                    <KinConnector key={`k-${i}`} link={k} nodeById={nodeById} />
                  ))}
                  {layout.siblingLinks.map((s, i) => (
                    <SiblingConnector key={`s-${i}`} link={s} nodeById={nodeById} />
                  ))}
                  {layout.couples.map((pair, i) => (
                    <CoupleConnector key={`c-${i}`} pair={pair} nodeById={nodeById} />
                  ))}
                  {layout.nodes.map((node) => (
                    <FamilyNode key={node.id} node={node} />
                  ))}
                </svg>
              </TransformComponent>

              <div className="family-tree-badge">
                {isEmpty ? 'Belum ada keluarga tercatat' : `${layout.nodes.length} anggota tercatat`}
                {hasDashed && !isEmpty && <span className="family-tree-badge-sub">garis putus-putus = relasi tidak langsung</span>}
              </div>

              {!isEmpty && <div className="family-tree-hint">↔ Geser &amp; cubit buat zoom</div>}

              <div className="family-tree-zoom-controls">
                <button type="button" className="map-zoom-btn" onClick={() => zoomIn()} aria-label="Perbesar pohon keluarga">+</button>
                <button type="button" className="map-zoom-btn" onClick={() => zoomOut()} aria-label="Perkecil pohon keluarga">−</button>
                <button type="button" className="map-zoom-btn" onClick={() => resetTransform()} aria-label="Kembalikan tampilan pohon keluarga">⤢</button>
                <button
                  type="button"
                  className={`map-zoom-btn${refreshing ? ' is-spinning' : ''}`}
                  onClick={handleManualRefresh}
                  disabled={refreshing}
                  aria-label="Muat ulang pohon keluarga"
                >
                  ⟳
                </button>
              </div>
            </>
          )}
        </TransformWrapper>
      ) : null}

      {status === 'loading' && !layout && (
        <div className="family-tree-overlay">
          <p className="family-tree-overlay-title">Memuat pohon keluarga…</p>
        </div>
      )}

      {status === 'error' && !layout && (
        <div className="family-tree-overlay">
          <p className="family-tree-overlay-title">Pohon keluarga gagal dimuat</p>
          <p className="family-tree-overlay-text">{errorMsg}</p>
          <button type="button" className="family-tree-overlay-btn" onClick={handleManualRefresh}>
            Coba lagi
          </button>
        </div>
      )}

      {status === 'ready' && !layout && (
        <div className="family-tree-overlay">
          <p className="family-tree-overlay-title">Data warga belum ketemu</p>
          <p className="family-tree-overlay-text">Coba tutup lalu buka lagi Mini App-nya.</p>
        </div>
      )}

      {isEmpty && (
        <div className="family-tree-empty">
          <p className="family-tree-overlay-text">
            Pohon keluarga diisi oleh Penghulu di grup KUA. Minta dicatat lewat, misalnya:
            <br />
            <em>“daftarin @username jadi mommy aku”</em>
            <br />
            atau nikah lewat <em>“nikahin @andi dan @sari”</em>.
          </p>
          {hasKua && (
            <>
              <button
                type="button"
                className="family-tree-overlay-btn"
                onClick={handleOpenKua}
                disabled={kuaBusy}
              >
                {kuaBusy ? 'Membuka pintu...' : '🏛️ Buka grup KUA'}
              </button>
              {kuaError && (
                <p className="family-tree-overlay-text" style={{ color: '#ff8a8a' }}>
                  {kuaError}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
