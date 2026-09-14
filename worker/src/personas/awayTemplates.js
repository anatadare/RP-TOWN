// Template "pergi sebentar" buat Pegawai (Naya/Mimi/Cika) pas AI beneran
// timeout total (semua model di aiClient.js gagal/timeout).
//
// KENAPA INI ADA: daripada balikin pesan generik "(sinyal lagi kurang
// bagus...)" tiap kali timeout -- yang kerasa robotic kalau keluar
// berkali-kali -- kita "ceritain" pegawainya lagi pergi sebentar (ke wc,
// diteleponin, dst), TRIGGER CUMA SEKALI per episode timeout (lihat
// awayState.js: kalau udah "away", pesan berikutnya dari warga yang sama
// didiemin aja, gak dibales lagi, sampai AI beneran nyala lagi).
//
// Tiap entry punya 2 bagian:
// - leave: 3 pesan berurutan (dikirim sebagai 3 chat terpisah, sama kayak
//   pola SCRIPTED_LINES di personas/penghulu.js) -- enter (alasan/gestur),
//   say (kalimat pamit, TANPA underscore), exit (gestur keluar ruangan).
// - back: 1 pesan gestur "balik" yang NYAMBUNG sama alasan yang sama persis
//   dipakai pas leave (biar reader ngerasa ini alur yang konsisten, bukan
//   acak), dikirim SEBELUM jawaban asli dari AI.
//
// Placeholder yang dipakai (diganti pas dipanggil, lihat pickAwayTemplate +
// fillAwayTemplate di bawah):
// - {name}    -> nama pegawai yang lagi jaga (Naya/Mimi/Cika)
// - {mention} -> @username warga yang lagi ditinggal (atau nama depannya
//                kalau dia gak punya username publik)

const LEAVE_TEMPLATES = [
  {
    enter: '_perut {name} tiba-tiba mules banget_',
    say: 'eh bentar mau ke wc dulu ya',
    exit: '_{name} berdiri dan buru-buru keluar dari ruangannya_',
    back: '_{name} balik dari wc dan duduk lagi, menatap ke {mention}_',
  },
  {
    enter: '_{name} ngerasa kebelet pipis dari tadi_',
    say: 'duh kebelet, ke wc dulu bentar ya kak',
    exit: '_{name} ngesot ke pintu terus ngacir keluar_',
    back: '_{name} balik dari kamar kecil, narik kursi, terus nengok ke {mention}_',
  },
  {
    enter: '_{name} keselek liur sendiri, batuk-batuk_',
    say: 'astaga keselek, bentar mau minum dulu ya',
    exit: '_{name} berdiri sambil megangin leher, jalan ke dispenser_',
    back: '_{name} balik sambil masih megang gelas, duduk, ngeliat ke {mention}_',
  },
  {
    enter: '_HP {name} tiba-tiba bergetar kenceng banget di meja_',
    say: 'eh bentar ya, telpon dari mama nih, sebentar aja',
    exit: '_{name} ngangkat HP-nya dan jalan keluar ruangan biar gak ganggu_',
    back: '_{name} balik masukin HP ke saku, duduk lagi, langsung ngeliat ke {mention}_',
  },
  {
    enter: '_grup kerjaan {name} tiba-tiba rame banget notifnya_',
    say: 'waduh dipanggil di grup kerjaan, bentar ya',
    exit: '_{name} beranjak ke pojokan ruangan buat bales chat_',
    back: '_{name} balik ke meja sambil masih megang HP, duduk, menatap {mention}_',
  },
  {
    enter: '_kepala kantor tiba-tiba manggil nama {name} dari luar_',
    say: 'waduh dipanggil kepala kantor, bentar ya kak',
    exit: '_{name} buru-buru berdiri dan keluar ruangan_',
    back: '_{name} balik dengan wajah agak lega, duduk lagi, ngeliat ke {mention}_',
  },
  {
    enter: '_salah satu Penghulu manggil {name} minta bantuan sebentar_',
    say: 'dipanggil penghulu bentar, ada yang perlu dibantuin, sabar ya',
    exit: '_{name} berdiri dan jalan ke ruangan penghulu_',
    back: '_{name} balik dari ruangan penghulu, duduk lagi, menatap {mention}_',
  },
  {
    enter: '_perut {name} bunyi keras banget, laper ternyata_',
    say: 'laper parah, bentar ambil cemilan dulu ya kak',
    exit: '_{name} berdiri sambil megangin perut, jalan ke pantry_',
    back: '_{name} balik sambil ngunyah kecil, duduk lagi, ngeliat {mention}_',
  },
  {
    enter: '_mata {name} tiba-tiba berat banget, ngantuk_',
    say: 'ngantuk parah nih, cuci muka dulu bentar ya',
    exit: '_{name} berdiri sambil ngucek mata, jalan ke wastafel_',
    back: '_{name} balik dengan wajah lebih seger, duduk, menatap {mention}_',
  },
  {
    enter: '_mata {name} perih kena angin AC terus-terusan_',
    say: 'mata perih nih, bentar tetesin obat mata dulu ya',
    exit: '_{name} berdiri sambil merem-merem jalan keluar_',
    back: '_{name} balik sambil masih ngedip-ngedipin mata, duduk, ngeliat {mention}_',
  },
  {
    enter: '_HP {name} tiba-tiba mati kehabisan baterai_',
    say: 'aduh HP mati, bentar charge dulu di ruang sebelah ya',
    exit: '_{name} berdiri bawa HP dan kabel, jalan keluar ruangan_',
    back: '_{name} balik bawa HP yang udah nyala lagi, duduk, menatap {mention}_',
  },
  {
    enter: '_printer di sudut ruangan {name} tiba-tiba macet berisik_',
    say: 'duh printernya macet, bentar dibenerin dulu ya',
    exit: '_{name} berdiri dan ngoprek printer sambil gerutu kecil_',
    back: '_{name} balik ngelap tangan ke celana, duduk, ngeliat {mention}_',
  },
  {
    enter: '_koneksi wifi ruangan {name} tiba-tiba lemot parah_',
    say: 'wifinya lemot banget, bentar restart router dulu ya',
    exit: '_{name} berdiri dan jalan ke arah router di sudut ruangan_',
    back: '_{name} balik ke meja, duduk lagi, menatap {mention}_',
  },
  {
    enter: '_lampu ruangan {name} kedap-kedip terus_',
    say: 'lampunya kedip-kedip, bentar cek sekring dulu ya',
    exit: '_{name} berdiri dan jalan keluar buat ngecek panel listrik_',
    back: '_{name} balik ke ruangan yang lampunya udah normal lagi, duduk, ngeliat {mention}_',
  },
  {
    enter: '_ada yang ngetuk pintu ruangan {name} tiba-tiba_',
    say: 'eh ada tamu dulu bentar ya kak, sabar',
    exit: '_{name} berdiri dan jalan ke pintu buat nerima tamunya_',
    back: '_{name} balik ke meja abis ngurusin tamu tadi, duduk, menatap {mention}_',
  },
  {
    enter: '_{name} baru inget ada berkas ketinggalan di ruang arsip_',
    say: 'aduh ada berkas ketinggalan, ambil dulu bentar ya',
    exit: '_{name} berdiri dan buru-buru jalan ke ruang arsip_',
    back: '_{name} balik bawa map di tangan, duduk, ngeliat ke {mention}_',
  },
  {
    enter: '_kaki {name} kesemutan parah abis duduk kelamaan_',
    say: 'duh kesemutan, jalan-jalan bentar ya biar ilang',
    exit: '_{name} berdiri pincang-pincang keluar ruangan_',
    back: '_{name} balik sambil jalan udah normal lagi, duduk, menatap {mention}_',
  },
  {
    enter: '_{name} bersin berkali-kali gara-gara debu_',
    say: 'hatchi-- bentar ambil tisu dulu ya',
    exit: '_{name} berdiri sambil nutup hidung, jalan keluar_',
    back: '_{name} balik sambil masih agak pilek, duduk, ngeliat {mention}_',
  },
  {
    enter: '_hujan deras tiba-tiba turun dan {name} inget jendela belum ditutup_',
    say: 'astaga jendela belum ditutup, bentar ya',
    exit: '_{name} berdiri buru-buru ke ruangan sebelah_',
    back: '_{name} balik agak basah dikit, duduk, menatap {mention}_',
  },
  {
    enter: '_kucing kantor tiba-tiba manjat ke atas meja {name}_',
    say: 'eh ini kucing lagi, bentar turunin dulu ya',
    exit: '_{name} berdiri sambil gendong kucingnya keluar ruangan_',
    back: '_{name} balik setelah nitipin kucingnya ke Mimi, duduk, ngeliat {mention}_',
  },
  {
    enter: '_dokumen di meja {name} numpuk dan butuh dirapiin bareng_',
    say: 'bentar minta tolong rapiin berkas dulu ke sebelah ya',
    exit: '_{name} berdiri bawa setumpuk map ke ruangan sebelah_',
    back: '_{name} balik dengan map yang udah rapi, duduk, menatap {mention}_',
  },
  {
    enter: '_{name} baru inget lupa matiin kompor listrik buat masak air_',
    say: 'anjay lupa matiin kompor, bentar ya kak',
    exit: '_{name} berdiri panik dan buru-buru keluar ruangan_',
    back: '_{name} balik dengan wajah lega, duduk, ngeliat {mention}_',
  },
  {
    enter: '_ada paket datang dan {name} dipanggil ke resepsionis_',
    say: 'eh ada paket dulu bentar ya, ambil dulu',
    exit: '_{name} berdiri dan jalan ke arah resepsionis_',
    back: '_{name} balik bawa kotak paket kecil, duduk, menatap {mention}_',
  },
  {
    enter: '_stapler {name} tiba-tiba kehabisan isi_',
    say: 'staplesnya abis, bentar ambil ke gudang dulu ya',
    exit: '_{name} berdiri dan jalan ke arah gudang alat tulis_',
    back: '_{name} balik bawa stapler yang udah keisi lagi, duduk, ngeliat {mention}_',
  },
  {
    enter: '_punggung {name} pegel banget abis duduk lama_',
    say: 'pegel banget nih, stretching bentar ya',
    exit: '_{name} berdiri sambil ngeregangin badan, jalan ke pojok ruangan_',
    back: '_{name} balik sambil muter-muterin bahu, duduk, menatap {mention}_',
  },
  {
    enter: '_grup warga RP Town tiba-tiba rame notifnya_',
    say: 'bentar ya, ada urusan di grup warga dulu',
    exit: '_{name} berdiri sambil pegang HP, jalan ke pojok ruangan_',
    back: '_{name} balik masukin HP lagi, duduk, ngeliat {mention}_',
  },
  {
    enter: '_galon di ruangan {name} ternyata udah kosong_',
    say: 'duh galonnya kosong, isi ulang dulu bentar ya',
    exit: '_{name} berdiri bawa galon kosong keluar ruangan_',
    back: '_{name} balik bawa galon yang udah keisi, duduk, menatap {mention}_',
  },
  {
    enter: '_kepala {name} tiba-tiba pusing_',
    say: 'pusing dikit nih, ambil obat di kotak P3K dulu ya',
    exit: '_{name} berdiri pelan-pelan jalan ke lemari P3K_',
    back: '_{name} balik dengan wajah udah agak mendingan, duduk, ngeliat {mention}_',
  },
  {
    enter: '_AC ruangan {name} tiba-tiba mati dan gerah banget_',
    say: 'ACnya mati, gerah banget, bentar buka jendela dulu ya',
    exit: '_{name} berdiri kipas-kipas jalan ke ruangan sebelah_',
    back: '_{name} balik masih kipas-kipas dikit, duduk, menatap {mention}_',
  },
  {
    enter: '_sinyal HP {name} tiba-tiba ilang total_',
    say: 'sinyal ilang, bentar cari sinyal dulu ya kak',
    exit: '_{name} berdiri megang HP tinggi-tinggi jalan keluar_',
    back: '_{name} balik dengan HP yang udah ada sinyal lagi, duduk, ngeliat {mention}_',
  },
  {
    enter: '_tenggorokan {name} tiba-tiba gatel dan batuk-batuk_',
    say: 'batuk-batuk nih, ambil permen tenggorokan dulu ya',
    exit: '_{name} berdiri sambil dehem-dehem jalan keluar_',
    back: '_{name} balik sambil ngulum permen, duduk, menatap {mention}_',
  },
  {
    enter: '_HP {name} berdering, ada telpon penting dari keluarga_',
    say: 'ada telpon penting dari keluarga, bentar ya kak',
    exit: '_{name} berdiri dan buru-buru keluar sambil angkat telponnya_',
    back: '_{name} balik masukin HP ke saku, duduk lagi, ngeliat {mention}_',
  },
  {
    enter: '_laptop {name} tiba-tiba lowbat parah_',
    say: 'laptop lowbat, bentar cari charger dulu ya',
    exit: '_{name} berdiri bawa laptop ke ruangan sebelah_',
    back: '_{name} balik bawa laptop yang udah nyolok charger, duduk, menatap {mention}_',
  },
  {
    enter: '_{name} tiba-tiba dipanggil buat rapat dadakan_',
    say: 'waduh ada rapat dadakan, bentar ya kak, sabar',
    exit: '_{name} berdiri dan jalan cepat ke ruang rapat_',
    back: '_{name} balik dari rapat, duduk, langsung ngeliat ke {mention}_',
  },
  {
    enter: '_{name} baru sadar ada map yang salah taruh di rak arsip_',
    say: 'eh ini map salah taruh, bentar benerin dulu ya',
    exit: '_{name} berdiri bawa map ke rak arsip_',
    back: '_{name} balik abis benerin arsipnya, duduk, ngeliat {mention}_',
  },
  {
    enter: '_perut {name} mules lagi, kayaknya masuk angin_',
    say: 'duh mules lagi nih, ke wc bentar ya',
    exit: '_{name} berdiri buru-buru dan keluar ruangan_',
    back: '_{name} balik dari wc sambil masih pegangin perut dikit, duduk, menatap {mention}_',
  },
  {
    enter: '_mie instan {name} yang lagi direbus di pantry udah mateng_',
    say: 'eh mie-nya udah mateng, bentar diangkat dulu ya',
    exit: '_{name} berdiri buru-buru ke arah pantry_',
    back: '_{name} balik bawa mangkok mie anget, duduk, ngeliat {mention}_',
  },
  {
    enter: '_{name} baru inget lupa ngunci pintu ruangan tadi_',
    say: 'eh lupa kunci pintu, bentar cek dulu ya',
    exit: '_{name} berdiri dan jalan ke arah pintu_',
    back: '_{name} balik abis ngecek pintunya udah aman, duduk, menatap {mention}_',
  },
  {
    enter: '_kedengeran suara aneh dari lorong deket ruangan {name}_',
    say: 'eh ada suara aneh, bentar cek dulu ya',
    exit: '_{name} berdiri waspada dan jalan ke arah lorong_',
    back: '_{name} balik dengan wajah lega ternyata bukan apa-apa, duduk, ngeliat {mention}_',
  },
  {
    enter: '_ada dokumen approval yang perlu diprint segera_',
    say: 'bentar print dokumen dulu ya, penting nih',
    exit: '_{name} berdiri bawa laptop ke arah printer_',
    back: '_{name} balik bawa kertas hasil print, duduk, menatap {mention}_',
  },
  {
    enter: '_listrik ruangan {name} sempet ngedip beberapa kali_',
    say: 'listriknya ngedip-ngedip, bentar cek genset dulu ya',
    exit: '_{name} berdiri dan jalan ke ruang genset_',
    back: '_{name} balik dengan lampu ruangan udah stabil lagi, duduk, ngeliat {mention}_',
  },
  {
    enter: '_{name} tiba-tiba dipanggil ikut meeting online mendadak_',
    say: 'ada meeting online dadakan, bentar ya kak',
    exit: '_{name} berdiri bawa laptop ke ruangan sebelah_',
    back: '_{name} balik dari meeting, duduk lagi, menatap {mention}_',
  },
  {
    enter: '_{name} ngantuk berat abis begadang semalam_',
    say: 'ngantuk banget nih abis begadang, cuci muka dulu bentar ya',
    exit: '_{name} berdiri sambil sempoyongan dikit, jalan ke wastafel_',
    back: '_{name} balik dengan wajah lebih seger dikit, duduk, ngeliat {mention}_',
  },
  {
    enter: '_{name} dipanggil buat tanda tangan dokumen penting_',
    say: 'bentar ya kak, diminta ttd dokumen dulu',
    exit: '_{name} berdiri dan jalan ke ruangan admin_',
    back: '_{name} balik abis ttd dokumen, duduk, menatap {mention}_',
  },
  {
    enter: '_HP {name} kepleset jatuh dari meja_',
    say: 'eh HP-nya jatuh, bentar ambil dulu ya',
    exit: '_{name} berdiri buru-buru ngambil HP yang jatuh_',
    back: '_{name} balik sambil ngecek layar HP-nya gak lecet, duduk, ngeliat {mention}_',
  },
  {
    enter: '_alarm latihan kebakaran tiba-tiba bunyi di gedung {name}_',
    say: 'eh alarm bunyi, bentar cek prosedur dulu ya, standby aja',
    exit: '_{name} berdiri waspada dan jalan keluar ruangan_',
    back: '_{name} balik dengan wajah lega ternyata cuma latihan, duduk, menatap {mention}_',
  },
  {
    enter: '_mie instan {name} di pantry udah mateng dan harus diangkat_',
    say: 'bentar ya, mie-nya udah mateng nih, sayang kalau lembek',
    exit: '_{name} berdiri buru-buru ke pantry_',
    back: '_{name} balik bawa mangkok mie, duduk, ngeliat {mention}_',
  },
  {
    enter: '_ada dokumen yang harus diantar ke ruangan Penghulu_',
    say: 'bentar ya, antar dokumen dulu ke ruangan penghulu',
    exit: '_{name} berdiri bawa map dan jalan keluar ruangan_',
    back: '_{name} balik abis nganterin dokumennya, duduk, menatap {mention}_',
  },
  {
    enter: '_badan {name} capek banget, butuh rebahan sebentar_',
    say: 'capek banget nih, duduk-duduk bentar di ruang belakang ya',
    exit: '_{name} berdiri pelan dan jalan ke ruang belakang_',
    back: '_{name} balik dengan badan lebih fresh, duduk, ngeliat {mention}_',
  },
  {
    enter: '_wifi kantor {name} down total, semua orang komplain_',
    say: 'wifinya down total, bentar lapor ke IT dulu ya',
    exit: '_{name} berdiri dan jalan ke ruangan IT_',
    back: '_{name} balik dengan wifi yang udah nyala lagi, duduk, menatap {mention}_',
  },
]

// Ambil template acak (dipakai pas AI PERTAMA KALI timeout buat 1 user).
export function pickRandomAwayTemplate() {
  const idx = Math.floor(Math.random() * LEAVE_TEMPLATES.length)
  return { index: idx, template: LEAVE_TEMPLATES[idx] }
}

export function getAwayTemplateByIndex(index) {
  return LEAVE_TEMPLATES[index] || LEAVE_TEMPLATES[0]
}

export function fillAwayTemplate(str, { name, mention }) {
  return str.replaceAll('{name}', name).replaceAll('{mention}', mention)
}

export { LEAVE_TEMPLATES }
