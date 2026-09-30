// ============================================================
// Data 39 varian HP "batangan" (bar/slab, gak lipat) -- ini beda file
// dari phoneVariants.js (yang isinya 15 HP LIPAT prosedural, dibikin
// dari primitif RoundedBox). 39 HP di sini modelnya .glb low-poly asli
// (bukan digambar prosedural), makanya butuh loader sendiri, lihat
// BarPhone.jsx.
//
// SUMBER: 40 file .glb dari riset user (hp_rp_town_colored.zip),
// nomor 40 (Razr 60 Ultra) DIBUANG dari sini karena bentuknya HP lipat
// beneran -- kalau mau dipakai, masukin ke phoneVariants.js/FOLD_TYPES,
// bukan ke sini.
//
// RARITY: ditentuin dari riset harga & generasi rilis tiap HP per
// 30 Sep 2026 (lihat percakapan) -- makin baru & makin mahal/ikonik
// brand-nya, makin langka. 4 Legendary, 8 Epic, 14 Rare, 13 Common.
//
// KENAPA NAMANYA DIGANTI JADI GENERIK (bukan "iPhone 18 Pro Max" dkk):
// sama persis alasannya kayak 15 HP lipat di phoneVariants.js -- aset
// ini niru bentuk & warna HP komersial asli biar user bisa "kenalin",
// itu masuk area trade dress/trademark, bukan cuma hak cipta teks.
// `sourceFile` di bawah CUMA buat traceability internal (file .glb
// asli yang dipakai), BUKAN nama brand -- aman ditinggal di kode,
// gak pernah ditampilkan ke user.
//
// `colors.body` diambil dari RATA-RATA vertex color asli file .glb-nya
// (dihitung sekali dari data COLOR_0), jadi swatch di UI beneran
// merepresentasikan warna modelnya, bukan tebakan.
//
// Taruh file .glb aslinya (nama file boleh sama kayak sekarang) di:
//   miniapp/public/models/phones/bar/<sourceFile>
// ============================================================

export const PHONE_FORM_FACTOR_BAR = 'bar'

export const RARITY = {
  COMMON: 'common',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
}

// Peluang drop per rarity buat box gatcha nanti (total = 100). Boleh
// diubah kapan aja tanpa nyentuh array di bawah -- box gatcha nge-roll
// rarity dulu pakai angka ini, baru pilih 1 HP acak dari rarity itu.
export const RARITY_DROP_WEIGHT = {
  [RARITY.COMMON]: 55,
  [RARITY.RARE]: 30,
  [RARITY.EPIC]: 12,
  [RARITY.LEGENDARY]: 3,
}

// basePrice = harga acuan buat Juno (satuan `coins`, sama kayak
// citizens.coins di schema.sql) -- PLACEHOLDER kasar berdasarkan
// rarity doang, gampang banget diubah/ditimpa pas kita desain ekonomi
// Juno beneran nanti. Belum final, jangan dianggap harga tetap.
const BASE_PRICE_BY_RARITY = {
  [RARITY.COMMON]: 300,
  [RARITY.RARE]: 800,
  [RARITY.EPIC]: 2000,
  [RARITY.LEGENDARY]: 5000,
}

// dims dari bbox asli file .glb (meter, sebelum discale) -- SEMUA 39
// HP bar ini ukurannya nyaris sama (HP modern emang gitu, beda tipis
// doang), jadi dipukul rata satu angka scale (lihat BarPhone.jsx) alih-alih
// dims per-varian kayak FOLD_TYPES.
export const BAR_RAW_DIMS = { w: 0.253, h: 0.523, d: 0.042 }

const RAW = [
  // [sourceFile, label, rarity, swatchHex]
  ['01_apple_iphone_18_pro_max.glb', 'Halo', RARITY.LEGENDARY, '#403336'],
  ['02_apple_iphone_17_pro_max.glb', 'Nova', RARITY.EPIC, '#524138'],
  ['03_apple_iphone_16_pro_max.glb', 'Comet', RARITY.RARE, '#443f38'],
  ['04_apple_iphone_15_pro_max.glb', 'Pulse', RARITY.COMMON, '#393938'],
  ['05_apple_iphone_14_pro_max.glb', 'Ion', RARITY.COMMON, '#3c3940'],
  ['06_samsung_galaxy_s26_ultra.glb', 'Vertex', RARITY.LEGENDARY, '#241e39'],
  ['07_samsung_galaxy_s25_ultra.glb', 'Quartz', RARITY.EPIC, '#24282c'],
  ['08_samsung_galaxy_s24_ultra.glb', 'Ember', RARITY.RARE, '#1e1e23'],
  ['09_samsung_galaxy_s23_ultra.glb', 'Zephyr', RARITY.COMMON, '#1a1d1d'],
  ['10_samsung_galaxy_s22_ultra.glb', 'Orbit', RARITY.COMMON, '#1d1317'],
  ['11_oppo_find_x9_ultra.glb', 'Lumen', RARITY.EPIC, '#543a22'],
  ['12_oppo_find_x8_ultra.glb', 'Cobalt', RARITY.RARE, '#373839'],
  ['13_oppo_find_x7_ultra.glb', 'Solace', RARITY.RARE, '#494746'],
  ['14_oppo_find_x6_pro.glb', 'Drift', RARITY.COMMON, '#474241'],
  ['15_oppo_find_x5_pro.glb', 'Mono', RARITY.COMMON, '#3d3d3d'],
  ['16_vivo_x300_ultra.glb', 'Crest', RARITY.LEGENDARY, '#38393a'],
  ['17_vivo_x200_ultra.glb', 'Flux', RARITY.EPIC, '#3d3e40'],
  ['18_vivo_x100_ultra.glb', 'Glide', RARITY.RARE, '#1b2a37'],
  ['19_vivo_x90_pro.glb', 'Prism', RARITY.COMMON, '#1c2b37'],
  ['20_vivo_x80_pro.glb', 'Nimbus', RARITY.COMMON, '#1f3144'],
  ['21_google_pixel_10_pro_xl.glb', 'Sable', RARITY.EPIC, '#393a39'],
  ['22_google_pixel_9_pro_xl.glb', 'Ridge', RARITY.RARE, '#423a3b'],
  ['23_google_pixel_8_pro.glb', 'Vale', RARITY.RARE, '#2c3238'],
  ['24_google_pixel_7_pro.glb', 'Slate', RARITY.COMMON, '#2c2c29'],
  ['25_xiaomi_xiaomi_17_ultra.glb', 'Frost', RARITY.LEGENDARY, '#404543'],
  ['26_xiaomi_xiaomi_15_ultra.glb', 'Ochre', RARITY.EPIC, '#5b5c5c'],
  ['27_xiaomi_xiaomi_14_ultra.glb', 'Rune', RARITY.RARE, '#3e3f41'],
  ['28_xiaomi_xiaomi_13_ultra.glb', 'Echo', RARITY.COMMON, '#444643'],
  ['29_huawei_pura_80_ultra.glb', 'Talon', RARITY.EPIC, '#79632c'],
  ['30_huawei_pura_70_ultra.glb', 'Brisk', RARITY.RARE, '#504820'],
  ['31_huawei_mate_70_pro.glb', 'Cove', RARITY.COMMON, '#3e4342'],
  ['32_honor_magic8_pro.glb', 'Amber', RARITY.EPIC, '#515c60'],
  ['33_honor_magic7_pro.glb', 'Pine', RARITY.RARE, '#434547'],
  ['34_sony_xperia_1_vii.glb', 'Reef', RARITY.RARE, '#444644'],
  ['35_sony_xperia_1_vi.glb', 'Storm', RARITY.COMMON, '#1e201e'],
  ['36_asus_rog_phone_9_pro.glb', 'Basalt', RARITY.RARE, '#27282a'],
  ['37_nothing_phone_3.glb', 'Willow', RARITY.RARE, '#797979'],
  ['38_oneplus_oneplus_13.glb', 'Rogue', RARITY.RARE, '#404549'],
  ['39_oneplus_oneplus_12.glb', 'Cinder', RARITY.COMMON, '#44524f'],
]

export const BAR_PHONE_VARIANTS = RAW.map(([sourceFile, label, rarity, swatch], i) => ({
  id: `bar-${String(i + 1).padStart(2, '0')}`,
  sourceFile, // traceability internal doang, jangan ditampilin ke user
  modelUrl: `/models/phones/bar/${sourceFile}`,
  label,
  foldType: PHONE_FORM_FACTOR_BAR, // dipakai buat switch render di TownWalk/PhoneInventory
  rarity,
  tradable: true,
  basePrice: BASE_PRICE_BY_RARITY[rarity],
  colors: { body: swatch }, // dipakai PhoneInventory buat swatch bulat di list
}))

export const BAR_PHONE_VARIANT_BY_ID = Object.fromEntries(BAR_PHONE_VARIANTS.map((v) => [v.id, v]))

export function getBarPhoneVariant(id) {
  return BAR_PHONE_VARIANT_BY_ID[id] || null
}
