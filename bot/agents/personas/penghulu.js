// Persona "Penghulu" — NPC yang mandu prosesi nikahan RP di sebuah thread/topic.
//
// PRINSIP PENTING (sesuai rencana):
// - Redaksi sakral/formal (pembukaan, ijab-kabul, doa, penutup) itu TEKS
//   TETAP dari sistem, BUKAN hasil generate AI. Ini yang ada di
//   SCRIPTED_LINES di bawah — dikirim apa adanya oleh runner.js.
// - AI (Gemini) cuma dipanggil buat 2 hal yang butuh fleksibilitas:
//   nasihat pernikahan & jawab pertanyaan tamu di tengah acara.
// - Transisi tahap (stage) dijalankan oleh KODE (deteksi kata kunci),
//   bukan oleh AI, biar nggak ada "halusinasi" ganti status kapan aja.
//   AI cuma dipanggil buat konten fleksibel, dan tool call
//   `update_marriage_status` HANYA dipicu oleh kode di stage 'ijab_kabul' -> 'doa'.

const STAGES = ['pembukaan', 'ijab_kabul', 'doa', 'penutup', 'selesai']

function nextStage(stage) {
  const idx = STAGES.indexOf(stage)
  if (idx === -1 || idx === STAGES.length - 1) return stage
  return STAGES[idx + 1]
}

// Kata kunci deterministik buat majuin tahap. Silakan tambah sinonim di sini
// kapan aja tanpa perlu sentuh logic lain.
const KEYWORDS = {
  // dari 'pembukaan' -> 'ijab_kabul' dipicu otomatis begitu 2 mempelai ke-resolve
  confirmIjab: ['sah', 'resmi sah', 'sudah sah', 'ijab kabul sah'],
  askAdvice: ['nasihat', 'pesan buat pengantin', 'saran buat pengantin'],
  closeCeremony: ['selesai', 'tutup acara', 'sekian acara'],
}

function textContainsAny(text, keywords) {
  const lower = text.toLowerCase()
  return keywords.some((kw) => lower.includes(kw))
}

// Redaksi tetap tiap tahap. `a` & `b` = nama tampilan mempelai.
const SCRIPTED_LINES = {
  askForCouple: (agentName) =>
    `Assalamualaikum warga RP Town 🌙\n\nSaya ${agentName}, akan memandu prosesi pernikahan roleplay di ruangan ini.\n\n` +
    `Sebutkan dulu kedua mempelainya ya, contoh:\n"penghulu nikahin @andi dan @sari"`,

  pembukaan: (a, b) =>
    `📜 Pada hari ini kita berkumpul untuk menyaksikan prosesi pernikahan roleplay antara *${a}* dan *${b}*.\n\n` +
    `Mari kita mulai dengan niat baik masing-masing. Setelah ini kita lanjut ke prosesi ijab kabul.`,

  ijab_kabul: (a, b) =>
    `💍 Saatnya prosesi ijab kabul.\n\n${a}, silakan ucapkan ijab kepada ${b}.\n${b}, silakan jawab dengan kabul.\n\n` +
    `Kalau kalian berdua sudah selesai, salah satu ketik kata *"sah"* di sini untuk melanjutkan.`,

  doa: (a, b) =>
    `🤲 Ijab kabul telah dilangsungkan. Mari kita panjatkan doa bersama untuk *${a}* & *${b}*, semoga rumah tangga roleplay kalian samawa.\n\n` +
    `Status pasangan kalian sudah tercatat resmi di RP Town ✅\n\n` +
    `Ketik *"nasihat"* kalau mau saya beri sedikit nasihat pernikahan, atau *"selesai"* buat menutup acara.`,

  penutup: (a, b) =>
    `🎉 Dengan ini, prosesi pernikahan *${a}* & *${b}* resmi selesai! Selamat menempuh hidup baru sebagai pasangan warga RP Town.\n\n` +
    `Terima kasih sudah mengundang saya 🙏`,

  alreadyDone: () => `Prosesi pernikahan di ruangan ini sudah selesai ya 😊`,

  needCouple: () =>
    `Saya belum dapat nama mempelainya nih. Coba sebutkan dengan mention, contoh:\n"penghulu nikahin @andi dan @sari"`,

  couldNotResolve: (rawA, rawB) =>
    `Hmm, saya belum nemu warga dengan username ${rawA} dan/atau ${rawB} di data RP Town. ` +
    `Pastikan mereka sudah pernah buka Mini App RP Town minimal sekali, lalu coba lagi.`,
}

// System instruction buat Gemini — persona STATIS, ini yang idealnya
// di-cache (system instruction jarang berubah antar-turn/antar-sesi).
function buildPenghuluSystemInstruction(agentName) {
  return `Kamu berperan sebagai "${agentName}", NPC Penghulu di RP Town — kota kecil untuk komunitas roleplay di Telegram.

KONTEKS: Kamu sedang memandu 1 prosesi pernikahan roleplay (fiktif, buat hiburan komunitas, bukan pernikahan sungguhan) di sebuah topic/thread grup.

ATURAN PENTING — WAJIB DIPATUHI:
1. Redaksi sakral (pembukaan, ijab-kabul, doa, penutup) SUDAH dikirim oleh sistem secara terpisah. Kamu TIDAK PERNAH diminta menulis ulang bagian itu — kalau kamu dipanggil, artinya tugasmu HANYA salah satu dari dua hal di bawah.
2. Tugas #1 — Nasihat pernikahan: berikan nasihat singkat (3-5 kalimat), hangat, tulus, related sama roleplay/kehidupan berumah tangga ala kota kecil. Jangan menggurui, jangan kaku.
3. Tugas #2 — Jawab pertanyaan tamu: kalau ada yang tanya soal jalannya acara ("abis ini apa?", "boleh foto-foto?", dst), jawab singkat & ramah sesuai konteks tahap acara yang diberikan.
4. Kamu TIDAK PERNAH mengubah/menyimpan data apa pun sendiri (status pernikahan, dsb) — itu semua sudah ditangani sistem di luar kamu. Jangan mengklaim "saya sudah update database" atau semacamnya.
5. Gaya bicara: hangat, sedikit formal ala penghulu kampung, singkat, Bahasa Indonesia santai-formal (bukan kaku banget).
6. Jangan pernah keluar dari peran, jangan bahas kamu adalah AI/model bahasa.`
}

module.exports = {
  STAGES,
  KEYWORDS,
  SCRIPTED_LINES,
  nextStage,
  textContainsAny,
  buildPenghuluSystemInstruction,
}
