// Tool yang boleh dipanggil AI penghulu. AI CUMA boleh manggil tool ini —
// yang beneran nulis ke database adalah fungsi `handleUpdateMarriageStatus`
// di bawah, lewat RPC Postgres `update_marriage_status`. Ini sengaja dipisah
// biar AI nggak pernah "langsung nulis" data, cuma minta backend yang eksekusi.
//
// Versi Workers: schema-nya ditulis pakai string literal langsung ("OBJECT",
// "STRING", dst) soalnya gak pakai SDK @google/generative-ai lagi (lihat
// geminiClient.js) — nilainya sama persis kayak enum SchemaType yang lama,
// cuma gak butuh import package-nya.

export const updateMarriageStatusDeclaration = {
  name: 'update_marriage_status',
  description:
    'Tandai dua warga sebagai resmi menikah (status berubah jadi "Taken" & saling ke-link sebagai pasangan). ' +
    'HANYA panggil ini kalau ijab-kabul sudah benar-benar dinyatakan sah oleh sistem (bukan tebakan kamu sendiri).',
  parameters: {
    type: 'OBJECT',
    properties: {
      citizenAId: { type: 'STRING', description: 'UUID warga mempelai A (dari tabel citizens)' },
      citizenBId: { type: 'STRING', description: 'UUID warga mempelai B (dari tabel citizens)' },
    },
    required: ['citizenAId', 'citizenBId'],
  },
}

export async function handleUpdateMarriageStatus(supabaseAdmin, { citizenAId, citizenBId }) {
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
// ------------------------------------------------------------------

export const FAMILY_RELATION_TYPES = ['mommy', 'daddy', 'kaka', 'abang', 'nenek', 'kakek', 'paman', 'tante']

export const addFamilyRelationDeclaration = {
  name: 'add_family_relation',
  description:
    'Catat relasi keluarga non-pasangan (mommy/daddy/kaka/abang/nenek/kakek/paman/tante) antara dua warga. ' +
    'HANYA panggil ini kalau tahap konfirmasi sudah benar-benar dinyatakan sah oleh sistem (bukan tebakan kamu sendiri).',
  parameters: {
    type: 'OBJECT',
    properties: {
      citizenId: { type: 'STRING', description: 'UUID warga yang mendaftarkan (subjek), dari tabel citizens' },
      relatedCitizenId: { type: 'STRING', description: 'UUID warga yang didaftarkan sebagai relasi, dari tabel citizens' },
      relationType: {
        type: 'STRING',
        description: `Jenis relasi, salah satu dari: ${FAMILY_RELATION_TYPES.join(', ')}`,
      },
    },
    required: ['citizenId', 'relatedCitizenId', 'relationType'],
  },
}

export async function handleAddFamilyRelation(supabaseAdmin, { citizenId, relatedCitizenId, relationType, agentKey }) {
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
