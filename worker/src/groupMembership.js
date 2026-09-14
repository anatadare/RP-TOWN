// Kick SEMENTARA (bukan ban permanen) dari grup Telegram -- dipakai pas 1
// sesi Penghulu (nikah/keluarga) beneran 'selesai', buat "buka slot" ruang
// KUA lagi (lihat catatan panjang di migration-009-kua-capacity-and-kick.sql).
//
// PENTING soal token: bot Penghulu/Pegawai (PENGHULU_i_TOKEN dst) belum
// tentu admin grup. banChatMember/unbanChatMember di Bot API WAJIB
// dijalankan oleh bot yang statusnya admin & punya izin "Ban users" di
// grup itu -- makanya di sini kita SELALU pakai env.BOT_TOKEN (bot utama),
// bukan token agent yang lagi nangani sesi. Pastikan bot utama itu emang
// admin grup KUA-nya, kalau enggak, kick bakal gagal (di-log, gak nge-throw
// -- lihat alasan di bawah).
//
// Kenapa gak boleh gagal (throw) ke pemanggil: kick ini SELALU dipanggil
// SETELAH sesi udah resmi di-release (data nikah/keluarga udah kesimpen).
// Kalau kick gagal (misal bot utama bukan admin), itu gak boleh bikin
// warga ngerasa "prosesinya gagal" -- prosesinya udah selesai beneran,
// cuma bagian "keluar ruangan"-nya yang gak jalan. Jadi di-log aja biar
// ketauan pas ngecek log, dan warga tetap dikasih tau manual buat keluar.

import { callTelegramApi } from './telegramApi.js'

// Return `true` kalau kick (ban lalu unban) berhasil dua-duanya, `false`
// kalau gagal di salah satu langkah -- TIDAK PERNAH throw ke pemanggil,
// biar alur penutupan sesi di agentLogic.js tetap jalan mulus.
//
// Urutan PENTING: unban SELALU dicoba abis ban berhasil, apa pun hasilnya,
// biar gak ada skenario "bannya nyangkut jadi permanen" cuma gara-gara ada
// error lain di antaranya.
export async function kickFromGroupTemporarily(env, chatId, telegramUserId, { reason } = {}) {
  if (!env.BOT_TOKEN) {
    console.error('[groupMembership] BOT_TOKEN kosong, gak bisa kick siapa pun')
    return false
  }
  if (!telegramUserId) {
    console.error('[groupMembership] telegramUserId kosong, skip kick')
    return false
  }

  try {
    await callTelegramApi(env.BOT_TOKEN, 'banChatMember', {
      chat_id: chatId,
      user_id: telegramUserId,
      revoke_messages: false, // cuma keluarin dia, jangan hapusin histori chat dia
    })
  } catch (err) {
    console.error(`[groupMembership] gagal ban ${telegramUserId} (${reason || '-'}):`, err.message)
    return false
  }

  try {
    await callTelegramApi(env.BOT_TOKEN, 'unbanChatMember', {
      chat_id: chatId,
      user_id: telegramUserId,
      only_if_banned: true,
    })
    return true
  } catch (err) {
    // Ini kasus PALING KRITIS -- ban berhasil tapi unban gagal, artinya
    // warga ini bisa KE-BAN PERMANEN kalau gak ditangani manual. Log
    // sekeras mungkin biar gampang ketemu pas cek log Cloudflare.
    console.error(
      `[groupMembership] KRITIS: ban ${telegramUserId} berhasil tapi unban GAGAL -- perlu di-unban manual dari @BotFather/Telegram admin panel. Error:`,
      err.message
    )
    return false
  }
}

// Link deep-link ke 1 topic/thread spesifik di grup, buat dikirim ke
// warga yang lagi ngantre pas slot-nya kebuka. Dua bentuk:
// - Grup publik (punya username): https://t.me/<username>/<threadId>
// - Grup privat (default): https://t.me/c/<internalId>/<threadId>, di mana
//   internalId = chat_id tanpa prefix "-100" (format khusus supergroup).
export function buildRoomLink(env, chatId, threadId) {
  if (env.KUA_GROUP_USERNAME) {
    return `https://t.me/${env.KUA_GROUP_USERNAME}/${threadId}`
  }
  const idStr = String(chatId)
  const internalId = idStr.startsWith('-100') ? idStr.slice(4) : idStr.replace(/^-/, '')
  return `https://t.me/c/${internalId}/${threadId}`
}
