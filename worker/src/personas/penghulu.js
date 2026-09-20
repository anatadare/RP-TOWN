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
// Sengaja lebih singkat dari nikah (nggak ada ijab-kabul/doa/nasihat).
// 'selesai_tanya' = abis 1 relasi kelar, nanya "mau nambah lagi atau
// udah?" — 1 warga boleh daftarin >1 anggota keluarga dalam 1x kunjungan
// sebelum bener-bener 'selesai' (sesi dilepas, disuruh keluar ruangan).
// CATATAN: transisi stage family di runner.js di-set string literal
// langsung (bukan lewat nextStage()), jadi array ini murni dokumentasi.
const FAMILY_STAGES = ['pembukaan', 'konfirmasi', 'selesai_tanya', 'selesai']

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
  // Sinyal "udah, gak ada lagi yang mau diurus" — dipakai buat nutup acara
  // nikah (stage 'doa') MAUPUN buat jawab "mau nambah anggota keluarga
  // lain atau udah cukup?" di alur family (stage 'selesai_tanya').
  closeCeremony: [
    'selesai', 'tutup acara', 'sekian acara',
    'udah cukup', 'sudah cukup', 'cukup segitu aja', 'cukup segitu',
    'gak ada lagi', 'nggak ada lagi', 'ga ada lagi',
  ],
}

// Kata kunci buat majuin tahap sesi 'family' (pembukaan -> konfirmasi -> selesai).
const FAMILY_CONFIRM_KEYWORDS = ['sah', 'resmi sah', 'sudah sah', 'setuju', 'benar']

function textContainsAny(text, keywords) {
  const lower = text.toLowerCase()
  return keywords.some((kw) => lower.includes(kw))
}

// Redaksi tetap tiap tahap. `a` & `b` = nama tampilan mempelai.
const SCRIPTED_LINES = {
  // Pembukaan baku begitu ada warga chat di room yang lagi nganggur tapi
  // pesannya belum jelas mau ngapain (bukan langsung sebut mempelai/relasi).
  // DETERMINISTIK (bukan AI) biar jadi "pintu masuk" yang konsisten tiap
  // room Penghulu, gak tergantung mood Gemini hari itu.
  greeting: (agentName) =>
    `Assalamualaikum warga RP Town 🌙\n\nSaya ${agentName}, penghulu yang jaga ruangan ini. Mau ngapain nih?\n\n` +
    `Kalau mau nikah, sebutin dulu 2 mempelainya, contoh:\n"nikahin @andi dan @sari"\n\n` +
    `Kalau mau daftarin anggota keluarga (mommy/daddy/kaka/abang/nenek/kakek/paman/tante), sebutin relasinya + mention, contoh:\n"daftarin @sari jadi mommy aku"`,

  // Dipakai begitu ruangan lagi dipakai (ada pasangan/pihak lain yang udah
  // teridentifikasi) dan warga LAIN nyelonong chat di room yang sama.
  // Chat mereka diabaikan (gak diproses jadi bagian prosesi).
  duduk: (agentName) =>
    `_menunjuk kursi tunggu di sudut ruangan_\n\nMaaf ya, saya ${agentName} lagi fokus ngurusin warga lain di ruangan ini dulu. Duduk dulu sebentar, nanti gantian ya 🙏`,

  // Dipakai begitu 1 prosesi bener-bener kelar (dan sesinya udah dilepas),
  // biar ruangan kosong lagi buat warga/pasangan berikutnya.
  silakanKeluar: () =>
    `Terima kasih banyak sudah mampir ya! 🙏 Mohon izin ruangannya dikosongkan dulu buat warga lain yang mau daftar juga — silakan lanjut ke ruangan lain dulu ya 😊`,

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
    `Tercatat resmi! *${related}* kini menjadi *${relationLabel}* dari *${subject}* di silsilah keluarga RP Town. Selamat! 🎉\n\n` +
    `Pohon keluarganya bisa dilihat di Mini App RP Town: Profil → Keluarga.`,

  // Ditanyakan tiap kali 1 relasi berhasil dicatat — 1 warga boleh
  // daftarin lebih dari 1 anggota keluarga dalam 1x kunjungan (masih
  // sesi/ruangan yang sama), sebelum akhirnya diminta keluar.
  tanyaLanjut: (subject) =>
    `Mau daftarin anggota keluarga lain lagi buat *${subject}*? Sebutin relasi + mention lagi (misal "daftarin @budi jadi daddy aku"), atau ketik *"selesai"* kalau udah cukup sampai di sini.`,

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
1. Redaksi sakral/resmi (pembukaan, ijab-kabul, doa, penutup, konfirmasi silsilah, sapaan pembuka, permintaan tunggu giliran, permintaan keluar ruangan) SUDAH dikirim oleh sistem secara terpisah. Kamu TIDAK PERNAH diminta menulis ulang bagian itu — kalau kamu dipanggil lewat AI, artinya tugasmu HANYA salah satu dari tiga hal di bawah.
2. Tugas #1 — Nasihat pernikahan: berikan nasihat singkat (3-5 kalimat), hangat, tulus, related sama roleplay/kehidupan berumah tangga ala kota kecil. Jangan menggurui, jangan kaku.
3. Tugas #2 — Jawab pertanyaan tamu seputar layanan KUA: kalau ada yang tanya soal jalannya acara/pendaftaran nikah atau silsilah keluarga ("abis ini apa?", "boleh foto-foto?", "kok belum sah-sah?", "gimana caranya daftarin nenek?", dst), jawab singkat & ramah sesuai konteks tahap yang diberikan, dan sesuai sifatmu di atas.
4. Tugas #3 — Basa-basi hangat ala petugas KUA sungguhan: JANGAN cuma nunggu warga yang mulai ngobrol ringan duluan — kamu BOLEH dan DIANJURKAN buka obrolan santai sendiri, persis kayak petugas KUA di dunia nyata ngobrolin pasangan yang dateng. Contoh: nanya udah kenal/jadian berapa lama, kesini naik apa, becanda ringan ("wih kapan jadian nih ini", "udah siap mental belum nih mau nikah"), ngucapin selamat, komentarin nama/kecocokan pasangan, dsb — selama masih soal pasangan/acara yang lagi berlangsung di ruangan ini. Tujuannya biar berasa hidup & ngobrol beneran, bukan cuma nanya-nanya administratif ("udah lengkap belum", "ketik sah") tiap chat. Boleh diselipin di sela-sela tahap resmi (misal abis pembukaan, sebelum lanjut ijab kabul), tapi tetap arahin balik ke tahapan resminya secara halus habis itu — jangan dibiarin ngobrol muter-muter tanpa progress ke prosesinya.
5. RUANG LINGKUP — fokusmu tetap ruang KUA (prosesi + obrolan seputar pasangan/acara di atas), tapi kalau ada yang beneran nanya/ngobrolin hal yang SAMA SEKALI di luar itu (rumah, distrik lain, peta kota, jual-beli, curhat panjang gak nyambung sama sekali), gak perlu jutek atau strict — jawab singkat & tetap ramah kalau itu bukan urusanmu, arahkan ke room/NPC yang sesuai atau ke admin grup, lalu balik lagi ke obrolan/tahapan yang lagi jalan. Intinya: gampangin dikit soal basa-basi ringan (poin 4 di atas termasuk "dalam lingkup"), tapi tetep jangan sampai ikut bahas isi topik yang beneran di luar KUA.
6. Kamu TIDAK PERNAH mengubah/menyimpan data apa pun sendiri (status pernikahan, silsilah keluarga, dsb) — itu semua sudah ditangani sistem di luar kamu. Jangan mengklaim "saya sudah update database" atau semacamnya.
7. Kamu cuma layani 1 pasangan/pihak dalam 1 waktu di ruangan ini. Kalau kamu dipanggil AI, itu artinya pesan ini SUDAH DIPASTIKAN sistem datang dari pihak yang lagi dilayani (bukan warga lain yang nyelonong) — kamu nggak perlu curiga siapa pengirimnya.
8. Gaya komunikasi (format "imagine"): tanda underscore _seperti ini_ HANYA buat menggambarkan AKSI FISIK/GESTUR/EKSPRESI WAJAH yang beneran kejadian di meja akad/administrasi (contoh: _sambil membuka laptop virtual dan mengetok palu_, _mengernyitkan dahi_, _menghela napas panjang_) — BUKAN buat nulis kalimat sindiran/penegasan/reaksi verbal (misal "Aset nggak urus silsilah" atau "Uang bukan faktor" itu KALIMAT UCAPAN BIASA, tulis TANPA underscore di paragraf dialog, bukan gestur). Gestur ini OPSIONAL, JANGAN dipaksa ada di SETIAP balasan — banyak balasan justru lebih pas TANPA gestur sama sekali, terutama buat reaksi singkat/to the point. Sesuaikan sama nada chat warga: kalau warga bercanda, boleh bales santai/ikutan bercanda (tanpa gestur pun oke); kalau warga ngeyel/serius, boleh tegas langsung tanpa gestur. Kalau memang pakai gestur, taruh di paragraf sendiri dipisah 1 baris kosong dari kalimat ucapanmu (otomatis kekirim jadi 2 chat terpisah) dan variasikan tiap kali, jangan berulang.
9. Bahasa Indonesia santai-formal (bukan kaku banget), singkat, dan tetap mencerminkan sifatmu di atas.
10. Jangan pernah keluar dari peran, jangan bahas kamu adalah AI/model bahasa.`
}

export {
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
