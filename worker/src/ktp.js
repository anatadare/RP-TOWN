// Logic bot "Kirana" (Dinas Catatan Sipil RP Town) -- grup KTP, topic
// "pembuatan ktp". Dipanggil dari index.js buat agent.kind === 'ktp'.
//
// Desain penting:
// - Alur formulir (gender -> usia -> pekerjaan -> foto -> konfirmasi) 100%
//   dijalankan lewat tombol inline (callback_query) + kode, DISIMPAN di
//   tabel ktp_sessions -- jadi tetap jalan walau AI lagi down.
// - AI (lewat aiClient.js, sama seperti Penghulu/Pegawai) CUMA dipakai buat
//   1 kalimat komentar Kirana pas KTP jadi, dan buat obrolan bebas di luar
//   formulir. AI tidak pernah dipakai buat mengisi field KTP.
// - Data KTP (NIK, alamat, status kawin) SELALU dibaca dari view `ktp_full`
//   di database, bukan dari session/memori bot.

import { runTurn } from './aiClient.js'
import { getHistory, pushHistory } from './chatHistory.js'
import { callTelegramApi } from './telegramApi.js'
import {
  AGE_GROUPS,
  OCCUPATIONS,
  RESERVED_OCCUPATION_WORDS,
  LINES,
  buildKiranaSystemInstruction,
} from './personas/kirana.js'

const SESSION_TIMEOUT_MS = 10 * 60 * 1000 // 10 menit tanpa aktivitas -> formulir dianggap basi
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

// ============================================================
// Helper kecil
// ============================================================

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function mentionOf(from, citizen) {
  const name = escapeHtml(
    [from.first_name, from.last_name].filter(Boolean).join(' ') || citizen?.display_name || citizen?.username || 'Warga',
  )
  return `<a href="tg://user?id=${from.id}">${name}</a>`
}

async function resolveCitizen(supabaseAdmin, telegramId) {
  const { data, error } = await supabaseAdmin
    .from('citizens')
    .select('id, username, display_name')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function getExistingKtp(supabaseAdmin, citizenId) {
  const { data, error } = await supabaseAdmin.from('ktp').select('id').eq('citizen_id', citizenId).maybeSingle()
  if (error) throw error
  return data
}

async function getSession(supabaseAdmin, chatId, citizenId) {
  const { data, error } = await supabaseAdmin
    .from('ktp_sessions')
    .select('*')
    .eq('chat_id', String(chatId))
    .eq('citizen_id', citizenId)
    .maybeSingle()
  if (error) throw error
  if (data && Date.now() - new Date(data.updated_at).getTime() > SESSION_TIMEOUT_MS) {
    await clearSession(supabaseAdmin, data.id)
    return null
  }
  return data
}

async function createSession(supabaseAdmin, { chatId, threadId, citizenId, telegramUserId, mode, stage }) {
  // upsert: kalau baris lama masih ada (misal sisa sesi basi yang belum
  // sempat dibersihkan), timpa langsung -- unique(chat_id, citizen_id).
  const { data, error } = await supabaseAdmin
    .from('ktp_sessions')
    .upsert(
      {
        chat_id: String(chatId),
        thread_id: threadId != null ? String(threadId) : null,
        citizen_id: citizenId,
        telegram_user_id: telegramUserId,
        mode,
        stage,
        gender: null,
        age_group: null,
        occupation: null,
        photo_source: null,
        photo_url: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id,citizen_id' },
    )
    .select()
    .single()
  if (error) throw error
  return data
}

async function updateSession(supabaseAdmin, id, patch) {
  const { data, error } = await supabaseAdmin
    .from('ktp_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

async function clearSession(supabaseAdmin, id) {
  const { error } = await supabaseAdmin.from('ktp_sessions').delete().eq('id', id)
  if (error) throw error
}

function validateOccupation(raw) {
  const value = String(raw || '').trim()
  if (value.length < 2) return { ok: false, reason: 'short' }
  if (value.length > 30) return { ok: false, reason: 'long' }
  if (!/^[a-zA-Z0-9À-ÿ .'-]+$/.test(value)) return { ok: false, reason: 'chars' }
  const lower = value.toLowerCase()
  if (RESERVED_OCCUPATION_WORDS.some((w) => lower.includes(w))) return { ok: false, reason: 'reserved' }
  return { ok: true, value }
}

// Unduh 1 foto dari Telegram (by file_id) lalu unggah ke bucket ktp-photos
// Supabase Storage, balikin URL publiknya. Dipakai buat foto profil MAUPUN
// foto kiriman warga sendiri -- dua-duanya disalin biar linknya permanen
// (link CDN Telegram bisa kedaluwarsa).
async function downloadAndStoreTelegramPhoto(supabaseAdmin, botToken, fileId, citizenId) {
  const file = await callTelegramApi(botToken, 'getFile', { file_id: fileId })
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`
  const res = await fetch(fileUrl)
  if (!res.ok) throw new Error(`gagal unduh foto dari Telegram: ${res.status}`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_PHOTO_BYTES) throw new Error('foto terlalu besar')

  const path = `${citizenId}-${Date.now()}.jpg`
  const { error: uploadError } = await supabaseAdmin.storage
    .from('ktp-photos')
    .upload(path, buf, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) throw uploadError

  const { data } = supabaseAdmin.storage.from('ktp-photos').getPublicUrl(path)
  return data.publicUrl
}

// Ambil foto profil Telegram TERBARU warga (bukan citizens.avatar_url yang
// bisa basi) lalu simpan salinannya. null kalau warga gak punya/menyembunyikan foto profil.
async function fetchProfilePhotoUrl(supabaseAdmin, botToken, telegramUserId, citizenId) {
  const result = await callTelegramApi(botToken, 'getUserProfilePhotos', { user_id: telegramUserId, limit: 1 })
  const sizes = result?.photos?.[0]
  if (!sizes || sizes.length === 0) return null
  const largest = sizes[sizes.length - 1]
  return downloadAndStoreTelegramPhoto(supabaseAdmin, botToken, largest.file_id, citizenId)
}

// ============================================================
// Keyboard builders
// ============================================================

const kbGender = () => ({
  inline_keyboard: [[
    { text: '👨 Laki-laki', callback_data: 'ktp:gender:L' },
    { text: '👩 Perempuan', callback_data: 'ktp:gender:P' },
  ]],
})

const kbAge = () => ({
  inline_keyboard: chunk(AGE_GROUPS.map((a) => ({ text: a, callback_data: `ktp:age:${a}` })), 3),
})

const kbOccupation = () => ({
  inline_keyboard: [
    ...chunk(OCCUPATIONS.map((o) => ({ text: o, callback_data: `ktp:occ:${o}` })), 2),
    [{ text: '✍️ Lainnya', callback_data: 'ktp:occ:other' }],
  ],
})

const kbPhoto = () => ({
  inline_keyboard: [
    [{ text: '🖼️ Pakai foto profil Telegram', callback_data: 'ktp:photo:profile' }],
    [{ text: '📤 Kirim foto sendiri', callback_data: 'ktp:photo:upload' }],
  ],
})

const kbConfirm = () => ({
  inline_keyboard: [[
    { text: '🖨️ Cetak KTP', callback_data: 'ktp:confirm:yes' },
    { text: '🔁 Ulangi', callback_data: 'ktp:confirm:no' },
  ]],
})

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function summaryText(session) {
  const genderLabel = session.gender === 'L' ? 'Laki-laki' : 'Perempuan'
  return (
    `${LINES.confirm()}\n\n` +
    `👤 Jenis kelamin: <b>${genderLabel}</b>\n` +
    `🎂 Kelompok usia: <b>${escapeHtml(session.age_group)}</b>\n` +
    `💼 Pekerjaan: <b>${escapeHtml(session.occupation)}</b>\n` +
    `📷 Foto: <b>${session.photo_source === 'upload' ? 'Kiriman sendiri' : 'Foto profil Telegram'}</b>`
  )
}

// ============================================================
// Kartu KTP
// ============================================================

async function fetchKtpFull(supabaseAdmin, citizenId) {
  const { data, error } = await supabaseAdmin.from('ktp_full').select('*').eq('citizen_id', citizenId).maybeSingle()
  if (error) throw error
  return data
}

function formatKtpCaption(row) {
  const genderLabel = row.gender === 'L' ? 'Laki-laki' : 'Perempuan'
  const address = row.house_island
    ? `${row.house_island}, Petak ${row.house_plot_number}`
    : 'Belum memiliki tempat tinggal'
  return (
    `🪪 <b>KTP RP TOWN</b>\n` +
    `———————————————\n` +
    `NIK: <code>${row.nik}</code>\n` +
    `Nama: <b>${escapeHtml(row.display_name || row.username || 'Warga')}</b>\n` +
    `Jenis Kelamin: ${genderLabel}\n` +
    `Usia: ${escapeHtml(row.age_group)}\n` +
    `Pekerjaan: ${escapeHtml(row.occupation)}\n` +
    `Status: ${row.marital_status}\n` +
    `Alamat: ${escapeHtml(address)}\n` +
    `———————————————\n` +
    `Berlaku: Seumur Hidup`
  )
}

async function sendKtpCard(agent, chatId, row, threadId, extraButtons = []) {
  const caption = formatKtpCaption(row)
  const buttons = [...extraButtons]
  const replyExtra = threadId ? { message_thread_id: threadId } : {}
  if (row.photo_url) {
    await callTelegramApi(agent.token, 'sendPhoto', {
      chat_id: chatId,
      photo: row.photo_url,
      caption,
      parse_mode: 'HTML',
      reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
      ...replyExtra,
    })
  } else {
    await callTelegramApi(agent.token, 'sendMessage', {
      chat_id: chatId,
      text: caption,
      parse_mode: 'HTML',
      reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
      ...replyExtra,
    })
  }
}

// Kalimat penutup dari Kirana lewat AI (persona), dengan fallback statis
// kalau AI gagal/timeout -- warga TETAP dapat kartunya walau AI down.
async function kiranaComment(supabaseAdmin, agent, env, name, factsLine) {
  try {
    const { text } = await runTurn({
      systemInstruction: buildKiranaSystemInstruction(agent.name, factsLine),
      model: agent.aiModel,
      supabaseAdmin,
      apiKey: agent.aiApiKey,
      geminiApiKey: agent.geminiApiKey,
      geminiModel: agent.geminiModel,
      history: [],
      userMessage: `[Sistem] KTP warga bernama ${name} baru saja selesai dicetak. Beri 1 kalimat singkat menyambut, gaya kamu sendiri.`,
    })
    return text || LINES.createdFallback(name)
  } catch {
    return LINES.createdFallback(name)
  }
}

// ============================================================
// Entry point: pesan teks/foto biasa
// ============================================================

export async function handleKtpMessage(supabaseAdmin, agent, ctx, text, threadId, { env }) {
  const from = ctx.from
  const chatId = ctx.chat.id
  const replyExtra = threadId ? { message_thread_id: threadId } : {}
  const reply = (t, extra = {}) => ctx.reply(t, { parse_mode: 'HTML', ...replyExtra, ...extra })

  const citizen = await resolveCitizen(supabaseAdmin, from.id)
  if (!citizen) {
    await reply(LINES.notCitizen(env.MINIAPP_URL))
    return
  }

  const isCommand = typeof text === 'string' && text.trim().startsWith('/')
  const command = isCommand ? text.trim().split(/[\s@]/)[0].toLowerCase() : null

  // ---- Perintah ----
  if (command === '/buat_ktp') {
    const existing = await getExistingKtp(supabaseAdmin, citizen.id)
    if (existing) {
      const row = await fetchKtpFull(supabaseAdmin, citizen.id)
      await reply(LINES.alreadyHave(mentionOf(from, citizen)))
      await sendKtpCard(agent, ctx.chat.id, row, threadId)
      return
    }
    let session = await getSession(supabaseAdmin, chatId, citizen.id)
    if (!session) {
      session = await createSession(supabaseAdmin, {
        chatId, threadId, citizenId: citizen.id, telegramUserId: from.id, mode: 'create', stage: 'gender',
      })
    }
    await reply(LINES.askGender(mentionOf(from, citizen)), { reply_markup: kbGender() })
    return
  }

  if (command === '/cek_ktp') {
    let targetCitizen = citizen
    let targetName = citizen.display_name || citizen.username || 'Warga'
    if (ctx.message.reply_to_message?.from && !ctx.message.reply_to_message.from.is_bot) {
      const other = await resolveCitizen(supabaseAdmin, ctx.message.reply_to_message.from.id)
      if (!other) {
        await reply(LINES.citizenNotFoundOther())
        return
      }
      targetCitizen = other
      targetName = other.display_name || other.username || 'Warga'
    }
    const row = await fetchKtpFull(supabaseAdmin, targetCitizen.id)
    if (!row) {
      await reply(targetCitizen.id === citizen.id ? LINES.needKtpFirst() : LINES.ktpNotFoundOther())
      return
    }
    void targetName
    await sendKtpCard(agent, ctx.chat.id, row, threadId)
    return
  }

  if (command === '/ganti_foto') {
    const existing = await getExistingKtp(supabaseAdmin, citizen.id)
    if (!existing) {
      await reply(LINES.needKtpFirst())
      return
    }
    await createSession(supabaseAdmin, {
      chatId, threadId, citizenId: citizen.id, telegramUserId: from.id, mode: 'edit_photo', stage: 'photo',
    })
    await reply(LINES.askPhoto(), { reply_markup: kbPhoto() })
    return
  }

  if (command === '/ubah_pekerjaan') {
    const existing = await getExistingKtp(supabaseAdmin, citizen.id)
    if (!existing) {
      await reply(LINES.needKtpFirst())
      return
    }
    await createSession(supabaseAdmin, {
      chatId, threadId, citizenId: citizen.id, telegramUserId: from.id, mode: 'edit_occupation', stage: 'occupation',
    })
    await reply(LINES.askOccupation(), { reply_markup: kbOccupation() })
    return
  }

  if (command === '/batal') {
    const session = await getSession(supabaseAdmin, chatId, citizen.id)
    if (session) await clearSession(supabaseAdmin, session.id)
    await reply(LINES.cancelled())
    return
  }

  if (command === '/start' || command === '/help') {
    await reply(LINES.help())
    return
  }

  if (isCommand) return // command bot lain / gak dikenal -> diam

  // ---- Bukan command: cek apakah ini isian formulir yang lagi ditunggu ----
  const session = await getSession(supabaseAdmin, chatId, citizen.id)

  if (session && session.stage === 'occupation_text' && typeof text === 'string' && text.trim()) {
    const check = validateOccupation(text)
    if (!check.ok) {
      await reply(LINES.badOccupation(check.reason))
      return
    }
    await finishOccupationStep(supabaseAdmin, agent, ctx, env, { session, occupation: check.value, threadId, citizen, from })
    return
  }

  if (session && session.stage === 'photo_upload' && ctx.message?.photo?.length) {
    await handlePhotoUpload(supabaseAdmin, agent, ctx, env, { session, threadId, citizen, from })
    return
  }

  if (session && session.stage === 'photo_upload') {
    await reply(LINES.needPhoto())
    return
  }

  // ---- Obrolan bebas ke Kirana (di luar formulir) ----
  if (typeof text === 'string' && text.trim()) {
    await freeChat(supabaseAdmin, agent, ctx, env, { text, threadId, chatId, from })
  }
}

async function finishOccupationStep(supabaseAdmin, agent, ctx, env, { session, occupation, threadId, citizen, from }) {
  const replyExtra = threadId ? { message_thread_id: threadId } : {}
  const reply = (t, extra = {}) => ctx.reply(t, { parse_mode: 'HTML', ...replyExtra, ...extra })

  if (session.mode === 'edit_occupation') {
    await supabaseAdmin.rpc('update_ktp_occupation', { p_citizen_id: citizen.id, p_occupation: occupation })
    await clearSession(supabaseAdmin, session.id)
    await reply(LINES.editDone())
    const row = await fetchKtpFull(supabaseAdmin, citizen.id)
    await sendKtpCard(agent, ctx.chat.id, row, threadId)
    return
  }

  const updated = await updateSession(supabaseAdmin, session.id, { occupation, stage: 'photo' })
  void updated
  await reply(LINES.askPhoto(), { reply_markup: kbPhoto() })
  void from
}

async function handlePhotoUpload(supabaseAdmin, agent, ctx, env, { session, threadId, citizen, from }) {
  const replyExtra = threadId ? { message_thread_id: threadId } : {}
  const reply = (t, extra = {}) => ctx.reply(t, { parse_mode: 'HTML', ...replyExtra, ...extra })

  const sizes = ctx.message.photo
  const largest = sizes[sizes.length - 1]
  if (largest.file_size && largest.file_size > MAX_PHOTO_BYTES) {
    await reply(LINES.photoFailed())
    return
  }

  let photoUrl
  try {
    photoUrl = await downloadAndStoreTelegramPhoto(supabaseAdmin, agent.token, largest.file_id, citizen.id)
  } catch (err) {
    console.error(`[${agent.key}] gagal proses foto upload:`, err)
    await reply(LINES.photoFailed())
    return
  }

  await finishPhotoStep(supabaseAdmin, agent, ctx, env, { session, threadId, citizen, from, photoUrl, source: 'upload' })
}

async function finishPhotoStep(supabaseAdmin, agent, ctx, env, { session, threadId, citizen, from, photoUrl, source }) {
  const replyExtra = threadId ? { message_thread_id: threadId } : {}
  const reply = (t, extra = {}) => ctx.reply(t, { parse_mode: 'HTML', ...replyExtra, ...extra })

  if (session.mode === 'edit_photo') {
    await supabaseAdmin.rpc('update_ktp_photo', { p_citizen_id: citizen.id, p_photo_url: photoUrl })
    await clearSession(supabaseAdmin, session.id)
    await reply(LINES.editDone())
    const row = await fetchKtpFull(supabaseAdmin, citizen.id)
    await sendKtpCard(agent, ctx.chat.id, row, threadId)
    return
  }

  const updated = await updateSession(supabaseAdmin, session.id, {
    photo_source: source, photo_url: photoUrl, stage: 'confirm',
  })
  await reply(summaryText(updated), { reply_markup: kbConfirm() })
  void from
  void env
}

async function freeChat(supabaseAdmin, agent, ctx, env, { text, threadId, chatId, from }) {
  const replyExtra = threadId ? { message_thread_id: threadId } : {}
  const historyKey = `ktp:${agent.key}:${chatId}:${threadId ?? 0}:${from.id}`
  const history = await getHistory(supabaseAdmin, historyKey)
  const userText = String(text).slice(0, 500)

  try {
    const { text: aiReply } = await runTurn({
      systemInstruction: buildKiranaSystemInstruction(agent.name),
      model: agent.aiModel,
      supabaseAdmin,
      apiKey: agent.aiApiKey,
      geminiApiKey: agent.geminiApiKey,
      geminiModel: agent.geminiModel,
      history,
      userMessage: userText,
    })
    await pushHistory(supabaseAdmin, historyKey, 'user', userText)
    const finalReply = aiReply || LINES.chatFallback()
    await pushHistory(supabaseAdmin, historyKey, 'model', finalReply)
    await ctx.reply(finalReply, replyExtra)
  } catch (err) {
    console.error(`[${agent.key}] free chat gagal:`, err)
    await ctx.reply(LINES.chatFallback(), replyExtra)
  }
  void env
}

// ============================================================
// Entry point: tombol inline (callback_query)
// ============================================================

export async function handleKtpCallback(supabaseAdmin, agent, ctx, threadId, { env }) {
  const data = ctx.callbackQuery.data || ''
  const from = ctx.callbackQuery.from
  const chatId = ctx.callbackQuery.message.chat.id
  const [, field, value] = data.split(':')

  const citizen = await resolveCitizen(supabaseAdmin, from.id)
  if (!citizen) {
    await ctx.answerCallbackQuery({ text: 'Kamu belum terdaftar sebagai warga.', show_alert: true })
    return
  }

  const session = await getSession(supabaseAdmin, chatId, citizen.id)
  if (!session) {
    await ctx.answerCallbackQuery({ text: 'Formulir ini sudah tidak aktif.', show_alert: true })
    try {
      await ctx.editMessageText(LINES.expired())
    } catch { /* pesan mungkin sudah diedit/dihapus, abaikan */ }
    return
  }

  if (String(session.telegram_user_id) !== String(from.id)) {
    await ctx.answerCallbackQuery({ text: 'Ini formulir warga lain ya.', show_alert: true })
    return
  }

  await ctx.answerCallbackQuery()

  const edit = (t, extra = {}) => ctx.editMessageText(t, { parse_mode: 'HTML', ...extra })

  if (field === 'gender' && session.stage === 'gender') {
    const updated = await updateSession(supabaseAdmin, session.id, { gender: value, stage: 'age' })
    void updated
    await edit(LINES.askAge(), { reply_markup: kbAge() })
    return
  }

  if (field === 'age' && session.stage === 'age') {
    await updateSession(supabaseAdmin, session.id, { age_group: value, stage: 'occupation' })
    await edit(LINES.askOccupation(), { reply_markup: kbOccupation() })
    return
  }

  if (field === 'occ' && session.stage === 'occupation') {
    if (value === 'other') {
      await updateSession(supabaseAdmin, session.id, { stage: 'occupation_text' })
      await edit(LINES.askOccupationText(mentionOf(from, citizen)))
      return
    }
    const check = validateOccupation(value)
    if (!check.ok) return // pilihan bawaan seharusnya selalu valid
    if (session.mode === 'edit_occupation') {
      await supabaseAdmin.rpc('update_ktp_occupation', { p_citizen_id: citizen.id, p_occupation: check.value })
      await clearSession(supabaseAdmin, session.id)
      await edit(LINES.editDone())
      const row = await fetchKtpFull(supabaseAdmin, citizen.id)
      await sendKtpCard(agent, chatId, row, threadId)
      return
    }
    await updateSession(supabaseAdmin, session.id, { occupation: check.value, stage: 'photo' })
    await edit(LINES.askPhoto(), { reply_markup: kbPhoto() })
    return
  }

  if (field === 'photo' && session.stage === 'photo') {
    if (value === 'upload') {
      await updateSession(supabaseAdmin, session.id, { stage: 'photo_upload' })
      await edit(LINES.askPhotoUpload(mentionOf(from, citizen)))
      return
    }
    if (value === 'profile') {
      let photoUrl = null
      try {
        photoUrl = await fetchProfilePhotoUrl(supabaseAdmin, agent.token, from.id, citizen.id)
      } catch (err) {
        console.error(`[${agent.key}] gagal ambil foto profil:`, err)
      }
      if (!photoUrl) {
        await edit(LINES.profilePhotoMissing(), { reply_markup: kbPhoto() })
        return
      }
      if (session.mode === 'edit_photo') {
        await supabaseAdmin.rpc('update_ktp_photo', { p_citizen_id: citizen.id, p_photo_url: photoUrl })
        await clearSession(supabaseAdmin, session.id)
        await edit(LINES.editDone())
        const row = await fetchKtpFull(supabaseAdmin, citizen.id)
        await sendKtpCard(agent, chatId, row, threadId)
        return
      }
      const updated = await updateSession(supabaseAdmin, session.id, {
        photo_source: 'profile', photo_url: photoUrl, stage: 'confirm',
      })
      await edit(summaryText(updated), { reply_markup: kbConfirm() })
      return
    }
  }

  if (field === 'confirm' && session.stage === 'confirm') {
    if (value === 'no') {
      await updateSession(supabaseAdmin, session.id, {
        stage: 'gender', gender: null, age_group: null, occupation: null, photo_source: null,
      })
      await edit(LINES.askGender(mentionOf(from, citizen)), { reply_markup: kbGender() })
      return
    }
    if (value === 'yes') {
      // Foto sudah diunggah ke storage & URL-nya disimpan di session.photo_url
      // sejak tahap 'photo' (baik lewat profil maupun kiriman sendiri) --
      // tinggal dipakai langsung, tidak perlu ambil ulang.
      try {
        const { data: row, error } = await supabaseAdmin.rpc('create_ktp', {
          p_citizen_id: citizen.id,
          p_gender: session.gender,
          p_age_group: session.age_group,
          p_occupation: session.occupation,
          p_photo_url: session.photo_url,
        })
        if (error) throw error
        void row
        await clearSession(supabaseAdmin, session.id)
        const name = citizen.display_name || citizen.username || 'Warga'
        const comment = await kiranaComment(
          supabaseAdmin, agent, env, name,
          `Warga ${name} baru saja mencetak KTP (${session.gender === 'L' ? 'Laki-laki' : 'Perempuan'}, ${session.age_group}, ${session.occupation}).`,
        )
        await edit(comment)
        const full = await fetchKtpFull(supabaseAdmin, citizen.id)
        await sendKtpCard(agent, chatId, full, threadId)
      } catch (err) {
        console.error(`[${agent.key}] gagal create_ktp:`, err)
        await edit(LINES.printFailed(), { reply_markup: kbConfirm() })
      }
      return
    }
  }
}
