// Tool yang boleh dipanggil AI penghulu. AI CUMA boleh manggil tool ini —
// yang beneran nulis ke database adalah fungsi `handleUpdateMarriageStatus`
// di bawah, lewat RPC Postgres `update_marriage_status` (atomik, di
// database/migration-005-marriage-agents.sql). Ini sengaja dipisah biar
// AI nggak pernah "langsung nulis" data, cuma minta backend yang eksekusi.

const { SchemaType } = require('@google/generative-ai')

const updateMarriageStatusDeclaration = {
  name: 'update_marriage_status',
  description:
    'Tandai dua warga sebagai resmi menikah (status berubah jadi "Taken" & saling ke-link sebagai pasangan). ' +
    'HANYA panggil ini kalau ijab-kabul sudah benar-benar dinyatakan sah oleh sistem (bukan tebakan kamu sendiri).',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      citizenAId: { type: SchemaType.STRING, description: 'UUID warga mempelai A (dari tabel citizens)' },
      citizenBId: { type: SchemaType.STRING, description: 'UUID warga mempelai B (dari tabel citizens)' },
    },
    required: ['citizenAId', 'citizenBId'],
  },
}

async function handleUpdateMarriageStatus(supabaseAdmin, { citizenAId, citizenBId }) {
  if (!citizenAId || !citizenBId) {
    throw new Error('citizenAId dan citizenBId wajib diisi')
  }

  const { error } = await supabaseAdmin.rpc('update_marriage_status', {
    p_citizen_a: citizenAId,
    p_citizen_b: citizenBId,
  })

  if (error) throw error
  return { success: true }
}

// ------------------------------------------------------------------
// Ekspansi silsilah keluarga (mommy/daddy/kaka/abang/nenek/kakek/paman/tante)
// Sama kayak update_marriage_status: HANYA dipanggil oleh kode di stage
// 'konfirmasi' -> 'selesai' (deterministik, bukan hasil keputusan AI).
// Tabel & RPC-nya ada di database/migration-006-family-tree.sql.
// ------------------------------------------------------------------

const FAMILY_RELATION_TYPES = ['mommy', 'daddy', 'kaka', 'abang', 'nenek', 'kakek', 'paman', 'tante']

const addFamilyRelationDeclaration = {
  name: 'add_family_relation',
  description:
    'Catat relasi keluarga non-pasangan (mommy/daddy/kaka/abang/nenek/kakek/paman/tante) antara dua warga. ' +
    'HANYA panggil ini kalau tahap konfirmasi sudah benar-benar dinyatakan sah oleh sistem (bukan tebakan kamu sendiri).',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      citizenId: { type: SchemaType.STRING, description: 'UUID warga yang mendaftarkan (subjek), dari tabel citizens' },
      relatedCitizenId: { type: SchemaType.STRING, description: 'UUID warga yang didaftarkan sebagai relasi, dari tabel citizens' },
      relationType: {
        type: SchemaType.STRING,
        description: `Jenis relasi, salah satu dari: ${FAMILY_RELATION_TYPES.join(', ')}`,
      },
    },
    required: ['citizenId', 'relatedCitizenId', 'relationType'],
  },
}

async function handleAddFamilyRelation(supabaseAdmin, { citizenId, relatedCitizenId, relationType, agentKey }) {
  if (!citizenId || !relatedCitizenId || !relationType) {
    throw new Error('citizenId, relatedCitizenId, dan relationType wajib diisi')
  }
  if (!FAMILY_RELATION_TYPES.includes(relationType)) {
    throw new Error(`relationType tidak valid: ${relationType}`)
  }

  const { data, error } = await supabaseAdmin.rpc('add_family_relation', {
    p_citizen_id: citizenId,
    p_related_citizen_id: relatedCitizenId,
    p_relation_type: relationType,
    p_agent_key: agentKey || null,
  })

  if (error) throw error
  return { success: true, row: data }
}

module.exports = {
  updateMarriageStatusDeclaration,
  handleUpdateMarriageStatus,
  FAMILY_RELATION_TYPES,
  addFamilyRelationDeclaration,
  handleAddFamilyRelation,
}
