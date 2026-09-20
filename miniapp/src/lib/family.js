import { supabase } from './supabase'

// ------------------------------------------------------------------
// Data pohon keluarga -- SUMBERNYA sama persis dengan yang dicatat NPC
// Penghulu di grup KUA (worker/src/tools.js):
//   - pasangan   -> kolom citizens.partner_citizen_id (RPC update_marriage_status)
//   - non-pasangan -> tabel family_relations (RPC add_family_relation)
//
// Arti 1 baris family_relations:
//   citizen_id         = warga yang mendaftarkan (subjek)
//   related_citizen_id = warga yang didaftarkan
//   relation_type      = related_citizen_id ADALAH <type>-nya citizen_id
//   contoh: "daftarin @sari jadi mommy aku" -> sari = mommy dari si pengirim
// ------------------------------------------------------------------

// Selisih generasi: gen(related) = gen(subjek) + delta
const GEN_DELTA = {
  mommy: -1,
  daddy: -1,
  nenek: -2,
  kakek: -2,
  paman: -1,
  tante: -1,
  kaka: 0,
  abang: 0,
}

// Label relasi dilihat dari sisi subjek (yang mendaftarkan)
const DIRECT_LABELS = {
  mommy: 'Mommy',
  daddy: 'Daddy',
  kaka: 'Kaka',
  abang: 'Abang',
  nenek: 'Nenek',
  kakek: 'Kakek',
  paman: 'Paman',
  tante: 'Tante',
}

// Label kebalikannya: kalau X mendaftarkan KAMU sebagai mommy-nya, berarti X = anak kamu
const INVERSE_LABELS = {
  mommy: 'Anak',
  daddy: 'Anak',
  kaka: 'Adik',
  abang: 'Adik',
  nenek: 'Cucu',
  kakek: 'Cucu',
  paman: 'Keponakan',
  tante: 'Keponakan',
}

const PARENT_TYPES = ['mommy', 'daddy']
const SIBLING_TYPES = ['kaka', 'abang']
const KIN_TYPES = ['nenek', 'kakek', 'paman', 'tante']

const CITIZEN_COLUMNS = 'id, username, display_name, avatar_url, partner_citizen_id, spouse_id'

// Seberapa jauh pohon dijelajahi dari warga yang lagi buka (dalam "lompatan"
// relasi) + batas total anggota, biar 1 keluarga gede gak bikin query/kanvas
// meledak.
const MAX_HOPS = 3
const MAX_NODES = 40

// ------------------------------------------------------------------
// Fetch
// ------------------------------------------------------------------
export async function fetchFamilyData(rootId) {
  const citizens = new Map()
  const relations = new Map()
  const seen = new Set([rootId])
  let frontier = [rootId]

  for (let hop = 0; frontier.length > 0; hop++) {
    const { data: rows, error: citizenError } = await supabase
      .from('citizens')
      .select(CITIZEN_COLUMNS)
      .in('id', frontier)
    if (citizenError) throw citizenError
    for (const row of rows || []) citizens.set(row.id, row)

    // Lompatan terakhir: cukup ambil data warganya, jangan dijelajahi lagi.
    if (hop >= MAX_HOPS) break

    const idList = frontier.join(',')
    const { data: rels, error: relError } = await supabase
      .from('family_relations')
      .select('id, citizen_id, related_citizen_id, relation_type')
      .or(`citizen_id.in.(${idList}),related_citizen_id.in.(${idList})`)
    if (relError) throw relError

    const next = []
    const consider = (id) => {
      if (id && !seen.has(id) && seen.size < MAX_NODES) {
        seen.add(id)
        next.push(id)
      }
    }

    for (const rel of rels || []) {
      if (!(rel.relation_type in GEN_DELTA)) continue
      relations.set(rel.id, rel)
      consider(rel.citizen_id)
      consider(rel.related_citizen_id)
    }
    for (const row of rows || []) consider(row.partner_citizen_id || row.spouse_id)

    frontier = next
  }

  return {
    rootId,
    citizens: [...citizens.values()],
    relations: [...relations.values()],
  }
}

// Link grup KUA (buat tombol di layar kosong). Gak nembak error kalau room-nya
// belum ada / belum punya link -- cukup return null.
export async function fetchKuaRoomUrl() {
  const { data, error } = await supabase
    .from('rooms')
    .select('slug, name, telegram_group_url')
    .or('slug.ilike.*kua*,name.ilike.*kua*,name.ilike.*civil registry*')
    .not('telegram_group_url', 'is', null)
    .limit(1)
  if (error) throw error
  return data?.[0]?.telegram_group_url || null
}

// Tanda tangan data -- dipakai polling supaya gak re-render (dan gak reset
// zoom/geser) kalau isinya ternyata sama.
export function signatureOf(data) {
  const cs = data.citizens
    .map((c) => [c.id, c.display_name, c.username, c.avatar_url, c.partner_citizen_id, c.spouse_id].join('~'))
    .sort()
  const rs = data.relations.map((r) => [r.id, r.citizen_id, r.related_citizen_id, r.relation_type].join('~')).sort()
  return `${cs.join('|')}##${rs.join('|')}`
}

// ------------------------------------------------------------------
// Layout
// ------------------------------------------------------------------
export const LAYOUT = {
  NODE_RADIUS: 42,
  LABEL_BOTTOM: 42 + 54, // dasar kotak nama di bawah node
  COUPLE_GAP: 176, // jarak antar 2 pasangan (pusat ke pusat)
  UNIT_GAP: 210, // jarak antar "unit" (pasangan/single) di 1 baris
  ROW_GAP: 270,
  MARGIN_X: 90,
  MARGIN_TOP: 120,
  MARGIN_BOTTOM: 110,
  MIN_WIDTH: 560,
}

function displayNameOf(c) {
  return c.display_name || c.username || 'Warga'
}

export function buildFamilyLayout({ rootId, citizens, relations }) {
  const byId = new Map(citizens.map((c) => [c.id, c]))
  if (!byId.has(rootId)) return null

  // ---- 1. Kumpulin semua edge (relasi + pasangan) ----
  const edges = []
  for (const r of relations) {
    if (r.citizen_id === r.related_citizen_id) continue
    if (!byId.has(r.citizen_id) || !byId.has(r.related_citizen_id)) continue
    if (!(r.relation_type in GEN_DELTA)) continue
    edges.push({ a: r.citizen_id, b: r.related_citizen_id, type: r.relation_type, delta: GEN_DELTA[r.relation_type] })
  }

  const partnerPairs = new Map()
  for (const c of citizens) {
    const p = c.partner_citizen_id || c.spouse_id
    if (!p || p === c.id || !byId.has(p)) continue
    partnerPairs.set([c.id, p].sort().join('|'), [c.id, p])
  }
  for (const [a, b] of partnerPairs.values()) edges.push({ a, b, type: 'partner', delta: 0 })

  // ---- 2. Tentuin generasi tiap orang (BFS dari warga yang lagi buka) ----
  const adj = new Map()
  const addAdj = (x, y, d) => {
    if (!adj.has(x)) adj.set(x, [])
    adj.get(x).push([y, d])
  }
  for (const e of edges) {
    addAdj(e.a, e.b, e.delta)
    addAdj(e.b, e.a, -e.delta)
  }

  const gen = new Map([[rootId, 0]])
  const queue = [rootId]
  while (queue.length > 0) {
    const x = queue.shift()
    for (const [y, d] of adj.get(x) || []) {
      if (!gen.has(y)) {
        gen.set(y, gen.get(x) + d)
        queue.push(y)
      }
    }
  }
  const ids = [...gen.keys()] // urutan penemuan (root duluan)
  const inTree = (id) => gen.has(id)
  const liveEdges = edges.filter((e) => inTree(e.a) && inTree(e.b))

  // ---- 3. Label peran relatif ke warga yang lagi buka ----
  const roles = new Map([[rootId, 'Kamu']])
  for (const e of liveEdges) {
    if (e.type === 'partner') {
      if (e.a === rootId && !roles.has(e.b)) roles.set(e.b, 'Pasangan')
      if (e.b === rootId && !roles.has(e.a)) roles.set(e.a, 'Pasangan')
    } else if (e.a === rootId && !roles.has(e.b)) {
      roles.set(e.b, DIRECT_LABELS[e.type])
    }
  }
  for (const e of liveEdges) {
    if (e.type !== 'partner' && e.b === rootId && !roles.has(e.a)) roles.set(e.a, INVERSE_LABELS[e.type])
  }
  const partnerIds = new Set([...roles].filter(([, r]) => r === 'Pasangan').map(([id]) => id))
  for (const e of liveEdges) {
    if (PARENT_TYPES.includes(e.type) && partnerIds.has(e.a) && !roles.has(e.b)) roles.set(e.b, 'Mertua')
  }

  // ---- 4. Hubungan orang tua -> anak ----
  const parentsOf = new Map() // anak -> Set(orang tua)
  for (const e of liveEdges) {
    if (!PARENT_TYPES.includes(e.type)) continue
    if (!parentsOf.has(e.a)) parentsOf.set(e.a, new Set())
    parentsOf.get(e.a).add(e.b)
  }
  // Kaka/abang dianggap satu orang tua sama (kalau salah satunya belum punya
  // orang tua tercatat). Ditandai `inferred` supaya garisnya putus-putus.
  const inferredChild = new Set()
  for (let pass = 0; pass < 3; pass++) {
    for (const e of liveEdges) {
      if (!SIBLING_TYPES.includes(e.type)) continue
      const ps = parentsOf.get(e.a)
      const pk = parentsOf.get(e.b)
      if (ps?.size && !pk?.size) {
        parentsOf.set(e.b, new Set(ps))
        inferredChild.add(e.b)
      } else if (pk?.size && !ps?.size) {
        parentsOf.set(e.a, new Set(pk))
        inferredChild.add(e.a)
      }
    }
  }

  const groupMap = new Map()
  for (const [child, ps] of parentsOf) {
    const parents = [...ps].sort()
    const key = parents.join('|')
    if (!groupMap.has(key)) groupMap.set(key, { parents, children: [] })
    groupMap.get(key).children.push({ id: child, inferred: inferredChild.has(child) })
  }
  const groups = [...groupMap.values()]

  // ---- 5. Bikin "unit" per baris (pasangan nempel bareng) ----
  const unitOf = new Map()
  const units = []
  const makeUnit = (members, kind) => {
    const unit = { ids: members, gen: gen.get(members[0]), kind, x0: 0 }
    units.push(unit)
    for (const id of members) unitOf.set(id, unit)
  }

  const realCouples = []
  for (const [a, b] of partnerPairs.values()) {
    if (!inTree(a) || !inTree(b)) continue
    if (unitOf.has(a) || unitOf.has(b)) continue
    if (gen.get(a) !== gen.get(b)) continue
    makeUnit([a, b], 'couple')
    realCouples.push([a, b])
  }
  // Orang tua yang sama-sama tercatat buat 1 anak tapi belum "menikah" di
  // sistem -- tetap ditaruh bersebelahan (tanpa garis pasangan).
  for (const g of groups) {
    if (g.parents.length !== 2) continue
    const [a, b] = g.parents
    if (unitOf.has(a) || unitOf.has(b)) continue
    if (gen.get(a) !== gen.get(b)) continue
    makeUnit([a, b], 'co-parent')
  }
  for (const id of ids) if (!unitOf.has(id)) makeUnit([id], 'single')

  const genValues = [...new Set(units.map((u) => u.gen))].sort((x, y) => x - y)
  const rows = new Map(genValues.map((g) => [g, []]))
  // urutan awal = urutan penemuan anggota pertama tiap unit
  const discoveryIndex = new Map(ids.map((id, i) => [id, i]))
  for (const u of [...units].sort((p, q) => discoveryIndex.get(p.ids[0]) - discoveryIndex.get(q.ids[0]))) {
    rows.get(u.gen).push(u)
  }

  // ---- 6. Tetangga (level unit & level anggota) ----
  const unitLinks = new Map(units.map((u) => [u, new Set()]))
  const memberNbrs = new Map(ids.map((id) => [id, new Set()]))
  const linkUnits = (idA, idB) => {
    const ua = unitOf.get(idA)
    const ub = unitOf.get(idB)
    if (!ua || !ub || ua === ub) return
    unitLinks.get(ua).add(ub)
    unitLinks.get(ub).add(ua)
    memberNbrs.get(idA).add(idB)
    memberNbrs.get(idB).add(idA)
  }
  for (const g of groups) for (const p of g.parents) for (const c of g.children) linkUnits(p, c.id)
  for (const e of liveEdges) linkUnits(e.a, e.b)

  const span = (u) => (u.ids.length - 1) * LAYOUT.COUPLE_GAP
  const centerOf = (u) => u.x0 + span(u) / 2
  const posX = (id) => {
    const u = unitOf.get(id)
    return u.x0 + u.ids.indexOf(id) * LAYOUT.COUPLE_GAP
  }

  function placeRows() {
    for (const row of rows.values()) {
      const total = row.reduce((sum, u) => sum + span(u), 0) + (row.length - 1) * LAYOUT.UNIT_GAP
      let cursor = -total / 2
      for (const u of row) {
        u.x0 = cursor
        cursor += span(u) + LAYOUT.UNIT_GAP
      }
    }
  }

  // 6a. Urutan unit per baris (barycenter, biar garis gak terlalu silang)
  placeRows()
  for (let iter = 0; iter < 6; iter++) {
    const order = iter % 2 === 0 ? genValues : [...genValues].reverse()
    for (const g of order) {
      const row = rows.get(g)
      const scored = row.map((u, i) => {
        const nbrs = [...unitLinks.get(u)]
        const bary = nbrs.length ? nbrs.reduce((s, n) => s + centerOf(n), 0) / nbrs.length : centerOf(u)
        return { u, bary, i }
      })
      scored.sort((p, q) => p.bary - q.bary || p.i - q.i)
      rows.set(g, scored.map((s) => s.u))
      placeRows()
    }
  }

  // 6b. Geser posisi X supaya tiap unit sejajar sama "tetangganya" (orang
  // tua di atas anak-anaknya, dst), tanpa saling numpuk. Urutannya tetap.
  // Penyelesaian tabrakan pakai isotonic regression (PAVA): posisi paling
  // dekat ke posisi ideal dengan syarat jarak minimum antar unit terjaga.
  for (let iter = 0; iter < 15; iter++) {
    const order = iter % 2 === 0 ? genValues : [...genValues].reverse()
    for (const g of order) {
      const row = rows.get(g)

      // arah pasangan: anggota yang punya relasi ke sisi kiri ditaruh di kiri
      for (const u of row) {
        if (u.ids.length !== 2) continue
        const cost = (pair) =>
          pair.reduce((sum, id, i) => {
            const nb = [...memberNbrs.get(id)]
            if (nb.length === 0) return sum
            const target = nb.reduce((t, n) => t + posX(n), 0) / nb.length
            return sum + Math.abs(u.x0 + i * LAYOUT.COUPLE_GAP - target)
          }, 0)
        const [a, b] = u.ids
        if (cost([b, a]) < cost([a, b]) - 1) u.ids = [b, a]
      }

      const desiredX0 = row.map((u) => {
        const cands = []
        u.ids.forEach((id, i) => {
          const offset = i * LAYOUT.COUPLE_GAP - span(u) / 2
          for (const n of memberNbrs.get(id)) cands.push(posX(n) - offset)
        })
        const center = cands.length ? cands.reduce((s, v) => s + v, 0) / cands.length : centerOf(u)
        return center - span(u) / 2
      })

      const offsets = []
      let acc = 0
      for (const u of row) {
        offsets.push(acc)
        acc += span(u) + LAYOUT.UNIT_GAP
      }
      const blocks = []
      desiredX0.forEach((d, i) => {
        blocks.push({ sum: d - offsets[i], count: 1 })
        while (blocks.length > 1) {
          const b = blocks[blocks.length - 1]
          const a = blocks[blocks.length - 2]
          if (a.sum / a.count <= b.sum / b.count) break
          blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, count: a.count + b.count })
        }
      })
      let idx = 0
      for (const b of blocks) {
        const base = b.sum / b.count
        for (let k = 0; k < b.count; k++, idx++) row[idx].x0 = base + offsets[idx]
      }
    }
  }

  // ---- 7. Koordinat final ----
  const pos = new Map()
  for (const [g, row] of rows) {
    const y = LAYOUT.MARGIN_TOP + genValues.indexOf(g) * LAYOUT.ROW_GAP
    for (const u of row) u.ids.forEach((id, i) => pos.set(id, { x: u.x0 + i * LAYOUT.COUPLE_GAP, y }))
  }
  const xs = [...pos.values()].map((p) => p.x)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const offset = LAYOUT.MARGIN_X - minX
  for (const p of pos.values()) p.x += offset

  const width = Math.max(LAYOUT.MIN_WIDTH, maxX - minX + LAYOUT.MARGIN_X * 2)
  const shift = (width - (maxX - minX + LAYOUT.MARGIN_X * 2)) / 2 // tengahin kalau lebih sempit dari MIN_WIDTH
  for (const p of pos.values()) p.x += shift
  const height = LAYOUT.MARGIN_TOP + (genValues.length - 1) * LAYOUT.ROW_GAP + LAYOUT.MARGIN_BOTTOM

  const nodes = ids.map((id) => {
    const c = byId.get(id)
    const p = pos.get(id)
    return {
      id,
      x: p.x,
      y: p.y,
      name: displayNameOf(c),
      username: c.username || null,
      avatarUrl: c.avatar_url || null,
      role: roles.get(id) || 'Kerabat',
      isRoot: id === rootId,
    }
  })

  // ---- 8. Garis-garis yang perlu digambar ----
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const couples = realCouples.filter(([a, b]) => nodeById.get(a).y === nodeById.get(b).y)

  const inSameGroup = (x, y) => groups.some((g) => g.children.some((c) => c.id === x) && g.children.some((c) => c.id === y))
  const siblingLinks = []
  const kinLinks = []
  const seenPairs = new Set()
  for (const e of liveEdges) {
    if (SIBLING_TYPES.includes(e.type) && !inSameGroup(e.a, e.b)) {
      const key = [e.a, e.b].sort().join('|')
      if (!seenPairs.has(key)) {
        seenPairs.add(key)
        siblingLinks.push({ a: e.a, b: e.b })
      }
    } else if (KIN_TYPES.includes(e.type)) {
      // e.b (nenek/kakek/paman/tante) -> e.a (yang mendaftarkan)
      kinLinks.push({ from: e.b, to: e.a })
    }
  }

  return { width, height, rootId, nodes, couples, groups, siblingLinks, kinLinks }
}
