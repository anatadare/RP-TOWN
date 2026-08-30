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

module.exports = { updateMarriageStatusDeclaration, handleUpdateMarriageStatus }
