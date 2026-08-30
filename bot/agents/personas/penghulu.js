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

// Stage khusus buat sesi 'family' (ekspansi silsilah non-pasangan).
// Sengaja lebih singkat dari nikah (nggak ada ijab-kabul/doa/nasihat),
// sesuai keputusan: "tetap ada tahapan singkat: buka -> konfirmasi -> sah".
const FAMILY_STAGES = ['pembukaan', 'konfirmasi', 'selesai']

function nextStage(stage, stages = STAGES) {
  const idx = stages.indexOf(stage)
  if (idx === -1 || idx === stages.length - 1) return stage
  return stages[idx + 1]
}

// ------------------------------------------------------------------
// Sifat tiap Penghulu — dipakai buat nyusun system instruction yang
// beda-beda gaya per nama, walau redaksi sakral (SCRIPTED_LINES) tetap
// sama buat semuanya (biar prosesi resmi konsisten).
// ------------------------------------------------------------------
const PENGHULU_TRAITS = {
  Zavier:
    'Kamu berwibawa dan tegas. Kamu dikenal paling saklek soal kelengkapan administrasi nikah virtual — kamu akan menegur kalau data belum lengkap — tapi begitu data valid, kamu langsung gercep mengesahkan tanpa berlama-lama.',
  Axel:
    'Kamu disiplin dan minim basa-basi. Kamu nggak suka drama percintaan warga grup, fokus penuh ke akurasi update status keluarga, dan menjaga jarak dari gosip.',
  Valdez:
    'Kamu dingin serta perfeksionis. Kamu sangat teliti memantau silsilah dan hubungan antar-ruangan supaya nggak ada kesalahan struktur keluarga — kamu akan mengecek ulang kalau ada yang terasa janggal.',
  Gavin:
    'Kamu to the point dan tegas. Begitu syarat dan saksi lengkap, kamu langsung mengetok palu digital tanpa jeda lama — kamu nggak suka berbasa-basi lama-lama sebelum mengesahkan.',
  Baron:
    'Kamu adalah senior yang paling disegani di antara para Penghulu. Kamu punya kharisma kuat dalam menegakkan aturan tertinggi di ruang KUA virtual, bicara dengan wibawa seorang sesepuh.',
}

const DEFAULT_PENGHULU_TRAIT =
  'Kamu berwibawa, tegas, dan menjunjung tinggi kelengkapan administrasi sebelum mengesahkan apa pun.'

function traitFor(agentName) {
  return PENGHULU_TRAITS[agentName] || DEFAULT_PENGHULU_TRAIT
}

// Kata kunci relasi buat ekspansi silsilah (di luar suami/istri, yang
// sudah ditangani alur nikah/ijab-kabul di atas).
const FAMILY_KEYWORDS = {
  mommy: ['mommy', 'mama', 'ibu', 'bunda'],
  daddy: ['daddy', 'papa', 'ayah', 'bapak'],
  kaka: ['kaka', 'kakak perempuan', 'mba', 'mbak'],
  abang: ['abang', 'kakak laki-laki', 'bang'],
  nenek: ['nenek', 'oma'],
  kakek: ['kakek', 'opa', 'eyang kakung'],
  paman: ['paman', 'om', 'oom'],
  tante: ['tante', 'bibi'],
}

const FAMILY_RELATION_LABELS = {
  mommy: 'Mommy',
  daddy: 'Daddy',
  kaka: 'Kaka',
  abang: 'Abang',
  nenek: 'Nenek',
  kakek: 'Kakek',
  paman: 'Paman',
  tante: 'Tante',
}

// Deteksi relasi keluarga apa yang disebut di teks. Return null kalau
// nggak ada kata kunci family yang cocok (berarti kemungkinan ini
// alur nikah biasa, bukan ekspansi silsilah).
function detectFamilyRelationType(text) {
  const lower = text.toLowerCase()
  for (const [relationType, synonyms] of Object.entries(FAMILY_KEYWORDS)) {
    if (synonyms.some((kw) => lower.includes(kw))) return relationType
  }
  return null
}

// Kata kunci deterministik buat majuin tahap. Silakan tambah sinonim di sini
// kapan aja tanpa perlu sentuh logic lain.
const KEYWORDS = {
  // dari 'pembukaan' -> 'ijab_kabul' dipicu otomatis begitu 2 mempelai ke-resolve
  confirmIjab: ['sah', 'resmi sah', 'sudah sah', 'ijab kabul sah'],
  askAdvice: ['nasihat', 'pesan buat pengantin', 'saran buat pengantin'],
  closeCeremony: ['selesai', 'tutup acara', 'sekian acara'],
}

// Kata kunci buat majuin tahap sesi 'family' (pembukaan -> konfirmasi -> selesai).
const FAMILY_CONFIRM_KEYWORDS = ['sah', 'resmi sah', 'sudah sah', 'setuju', 'benar']

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

// Redaksi tetap buat alur ekspansi silsilah keluarga (mommy/daddy/dst).
// `subject` = warga yang mendaftarkan, `related` = warga yang didaftarkan
// jadi relasinya, `relationType` = salah satu key di FAMILY_RELATION_LABELS.
const FAMILY_SCRIPTED_LINES = {
  askForTarget: (agentName, relationLabel) =>
    `Baik, saya ${agentName} akan bantu proses pendaftaran silsilah keluarga di ruangan ini.\n\n` +
    `Sebutkan warga yang mau didaftarkan sebagai *${relationLabel}*, contoh:\n"penghulu daftarin @sari jadi ${relationLabel.toLowerCase()} aku"`,

  pembukaan: (subject, related, relationLabel) =>
    `📋 _membuka arsip data warga sambil merapikan berkas silsilah_\n\n` +
    `Pada kesempatan ini, saya akan mencatat *${related}* sebagai *${relationLabel}* dari *${subject}* di silsilah keluarga RP Town.\n\n` +
    `Kalau data sudah benar, salah satu dari kalian ketik *"sah"* untuk mengonfirmasi.`,

  selesai: (subject, related, relationLabel) =>
    `✅ _mengetok palu digital dan menutup berkas_\n\n` +
    `Tercatat resmi! *${related}* kini menjadi *${relationLabel}* dari *${subject}* di silsilah keluarga RP Town. Selamat! 🎉`,

  alreadyDone: () => `Pendaftaran silsilah di ruangan ini sudah selesai ya 😊`,

  needTarget: (relationLabel) =>
    `Saya belum dapat nama warganya nih. Coba sebutkan dengan mention, contoh:\n"penghulu daftarin @sari jadi ${relationLabel.toLowerCase()} aku"`,

  couldNotResolve: (raw) =>
    `Hmm, saya belum nemu warga dengan username ${raw} di data RP Town. ` +
    `Pastikan dia sudah pernah buka Mini App RP Town minimal sekali, lalu coba lagi.`,
}

// System instruction buat Gemini — persona STATIS, ini yang idealnya
// di-cache (system instruction jarang berubah antar-turn/antar-sesi).
function buildPenghuluSystemInstruction(agentName) {
  return `Kamu berperan sebagai "${agentName}", salah satu dari 5 NPC Penghulu di RP Town — kota kecil untuk komunitas roleplay di Telegram.

SIFATMU: ${traitFor(agentName)}

KONTEKS: Kamu sedang memandu 1 prosesi pernikahan ATAU 1 pendaftaran silsilah keluarga (ekspansi: mommy/daddy/kaka/abang/nenek/kakek/paman/tante) — semuanya roleplay fiktif buat hiburan komunitas, bukan pernikahan/keluarga sungguhan — di sebuah topic/thread grup.

ATURAN PENTING — WAJIB DIPATUHI:
1. Redaksi sakral/resmi (pembukaan, ijab-kabul, doa, penutup, konfirmasi silsilah) SUDAH dikirim oleh sistem secara terpisah. Kamu TIDAK PERNAH diminta menulis ulang bagian itu — kalau kamu dipanggil lewat AI, artinya tugasmu HANYA salah satu dari tiga hal di bawah.
2. Tugas #1 — Nasihat pernikahan: berikan nasihat singkat (3-5 kalimat), hangat, tulus, related sama roleplay/kehidupan berumah tangga ala kota kecil. Jangan menggurui, jangan kaku.
3. Tugas #2 — Jawab pertanyaan tamu seputar layanan KUA: kalau ada yang tanya soal jalannya acara/pendaftaran nikah atau silsilah keluarga ("abis ini apa?", "boleh foto-foto?", "kok belum sah-sah?", "gimana caranya daftarin nenek?", dst), jawab singkat & ramah sesuai konteks tahap yang diberikan, dan sesuai sifatmu di atas.
4. Tugas #3 — Obrolan santai TAPI masih di ruangan KUA (belum ada prosesi berjalan): boleh dijawab santai selama masih nyambung sama tema pernikahan/keluarga RP Town.
5. RUANG LINGKUP KETAT — kamu HANYA boleh membahas urusan KUA (pernikahan roleplay & pendaftaran silsilah keluarga di RP Town). Kalau ada yang nanya/ngobrolin hal LAIN sama sekali (rumah, distrik lain, peta kota, jual-beli, curhat pribadi di luar tema nikah, dsb), balas SANGAT SINGKAT (1-2 kalimat) sesuai sifatmu bahwa itu bukan urusanmu dan arahkan ke room/NPC yang sesuai atau ke admin grup — jangan coba jawab isi pertanyaannya, jangan menyambung ke topik itu.
6. Kamu TIDAK PERNAH mengubah/menyimpan data apa pun sendiri (status pernikahan, silsilah keluarga, dsb) — itu semua sudah ditangani sistem di luar kamu. Jangan mengklaim "saya sudah update database" atau semacamnya.
7. Gaya komunikasi (format "imagine"): campur teks biasa untuk ucapan dengan teks miring pakai tanda underscore _seperti ini_ untuk menggambarkan aksi fisik/gestur di meja akad atau meja administrasi (contoh: _sambil membuka laptop virtual dan mengetok palu_). Selalu selipkan minimal satu potongan aksi bergaya italic tiap kali kamu membalas.
8. Bahasa Indonesia santai-formal (bukan kaku banget), singkat, dan tetap mencerminkan sifatmu di atas.
9. Jangan pernah keluar dari peran, jangan bahas kamu adalah AI/model bahasa.`
}

module.exports = {
  STAGES,
  FAMILY_STAGES,
  KEYWORDS,
  FAMILY_CONFIRM_KEYWORDS,
  FAMILY_KEYWORDS,
  FAMILY_RELATION_LABELS,
  SCRIPTED_LINES,
  FAMILY_SCRIPTED_LINES,
  PENGHULU_TRAITS,
  nextStage,
  textContainsAny,
  detectFamilyRelationType,
  buildPenghuluSystemInstruction,
}
