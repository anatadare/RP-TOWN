// ============================================================
// Data 15 varian HP lipat, low-poly.
//
// SUMBER: diturunkan dari 3 CSV riset (lowpoly characteristics,
// detailed colors, open/close logic) yang isinya spek 15 HP lipat
// ASLI (Samsung Z Flip/Fold, Motorola Razr, Xiaomi MIX Flip, HONOR
// Magic V, vivo X Flip/Fold, OPPO Find N5, Huawei Mate X7, Google
// Pixel Fold).
//
// KENAPA NAMANYA DIGANTI (bukan lagi nama brand asli): CSV-nya
// eksplisit minta silhouette, posisi kamera, hinge, dan warna
// PERSIS niru produk komersial nyata biar user bisa "kenalin" HP
// aslinya -- itu udah masuk area trade dress/trademark brand-brand
// itu, bukan cuma soal hak cipta teks. Karena aset ini bakal dipakai
// banyak orang di RP-TOWN, tiap varian di bawah tetap mewarisi SEMUA
// karakteristik teknis dari CSV (tipe lipatan, tata letak kamera,
// warna, ketebalan relatif, tipe hinge) TAPI dikasih nama & label
// generik/fiksi, bukan klaim jadi produk brand tertentu.
//
// `csvRow` cuma buat traceability internal (row mana di CSV asal
// datanya), BUKAN nama brand -- aman ditinggal di komentar/kode.
//
// Satuan ukuran = satuan model karakter (sama kayak PHONE_OFFSET_POS
// di PhonePose.jsx). Body HP biasa (LowPolyPhone lama) itu skalanya
// 0.038 x 0.078 x 0.007 -- semua angka di bawah dikalibrasi relatif
// ke itu supaya "kerasa" proporsional di tangan yang sama.
// ============================================================

export const FOLD_TYPES = {
  FLIP: 'flip', // clamshell, hinge horizontal, lipat atas-bawah
  BOOK: 'book', // buku, hinge vertikal, lipat kiri-kanan
}

// Dimensi dasar (state TERBUKA/flat) sebelum dikali `thinness` per varian.
// - FLIP: closed = tinggi dibelah 2 (ditumpuk), tebal x2
// - BOOK: closed = lebar dibelah 2 (ditumpuk), tebal x2
const BASE = {
  flip: { openW: 0.04, openH: 0.086, shellT: 0.0042, hingeGap: 0.0016 },
  book: { openW: 0.078, openH: 0.08, shellT: 0.0034, hingeGap: 0.0014 },
}

// Beberapa "arketipe" tata letak kamera belakang, dipakai ulang lintas
// varian (persis kayak di dunia nyata beberapa produk berbagi gaya
// modul kamera yang mirip). Koordinat relatif ke pojok kiri-atas modul
// kamera pada shell yang jadi tempat kamera (local space shell itu).
const CAMERA_LAYOUTS = {
  dualVertical: {
    housing: 'rect',
    housingSize: [0.013, 0.024],
    lenses: [
      { x: 0, y: 0.007, r: 0.0042 },
      { x: 0, y: -0.007, r: 0.0042 },
    ],
  },
  dualCompact: {
    housing: 'rect',
    housingSize: [0.016, 0.016],
    lenses: [
      { x: -0.0035, y: 0.0035, r: 0.0038 },
      { x: 0.0035, y: -0.0035, r: 0.0038 },
    ],
  },
  dualBeside: {
    housing: 'rect',
    housingSize: [0.022, 0.012],
    lenses: [
      { x: -0.005, y: 0, r: 0.004 },
      { x: 0.005, y: 0, r: 0.004 },
    ],
  },
  ringDual: {
    housing: 'ring',
    ringR: 0.011,
    lenses: [
      { x: 0, y: 0.0038, r: 0.0046 },
      { x: 0, y: -0.0038, r: 0.0046 },
    ],
  },
  verticalCluster3: {
    housing: 'rect',
    housingSize: [0.014, 0.032],
    lenses: [
      { x: 0, y: 0.011, r: 0.0042 },
      { x: 0, y: 0, r: 0.0042 },
      { x: 0, y: -0.011, r: 0.0042 },
    ],
  },
  diagonalCluster3: {
    housing: 'rect',
    housingSize: [0.024, 0.024],
    lenses: [
      { x: -0.006, y: 0.008, r: 0.0044 },
      { x: 0.007, y: 0.001, r: 0.0044 },
      { x: -0.002, y: -0.009, r: 0.0044 },
    ],
  },
  ringTriple: {
    housing: 'ring',
    ringR: 0.015,
    lenses: [
      { x: -0.005, y: 0.006, r: 0.0044 },
      { x: 0.006, y: 0.005, r: 0.0044 },
      { x: 0, y: -0.007, r: 0.0044 },
    ],
  },
  organicRing: {
    housing: 'ring',
    ringR: 0.016,
    lenses: [
      { x: -0.006, y: 0.005, r: 0.0044 },
      { x: 0.006, y: 0.005, r: 0.0044 },
      { x: 0, y: -0.007, r: 0.005 },
    ],
  },
  cosmosRing: {
    housing: 'ring',
    ringR: 0.017,
    lenses: [
      { x: -0.0065, y: 0.0065, r: 0.0046 },
      { x: 0.0065, y: 0.0065, r: 0.0046 },
      { x: 0, y: -0.008, r: 0.0052 },
    ],
    hasFlash: true,
  },
  cameraBar: {
    housing: 'bar',
    housingSize: [0.036, 0.011],
    lenses: [
      { x: -0.009, y: 0, r: 0.0044 },
      { x: 0.006, y: 0, r: 0.0036 },
    ],
  },
  hybridModule: {
    housing: 'rect',
    housingSize: [0.018, 0.016],
    lenses: [
      { x: -0.004, y: 0.003, r: 0.0042 },
      { x: 0.0045, y: -0.003, r: 0.0036 },
    ],
  },
}

// 7 varian FLIP (clamshell) -- csvRow 1..7
const FLIP_VARIANTS = [
  {
    id: 'flip-01',
    csvRow: 1,
    label: 'Flip Aurora',
    thinness: 1.0,
    colors: { body: '#1f3f8f', frame: '#14213f', lensRing: '#05060a', coverGlow: '#123a6e' },
    camera: CAMERA_LAYOUTS.dualVertical,
    coverDisplay: { w: 0.03, h: 0.05 }, // layar cover gede, khas seri ini
  },
  {
    id: 'flip-02',
    csvRow: 2,
    label: 'Flip Shadow',
    thinness: 0.95,
    colors: { body: '#3a5686', frame: '#243252', lensRing: '#05060a', coverGlow: '#1c3252' },
    camera: CAMERA_LAYOUTS.dualVertical,
    coverDisplay: { w: 0.032, h: 0.055 }, // cover display lebih luas lagi
  },
  {
    id: 'flip-03',
    csvRow: 3,
    label: 'Flip Verde',
    thinness: 1.1,
    colors: { body: '#204028', frame: '#16241c', lensRing: '#05060a', coverGlow: '#1a3322' },
    camera: CAMERA_LAYOUTS.dualCompact,
    coverDisplay: { w: 0.034, h: 0.058 }, // outer display paling lebar di grup flip
  },
  {
    id: 'flip-04',
    csvRow: 4,
    label: 'Flip Rosewood',
    thinness: 1.15,
    colors: { body: '#c48a90', frame: '#8a5a5a', lensRing: '#05060a', coverGlow: '#7a4a4a' },
    camera: CAMERA_LAYOUTS.dualCompact,
    coverDisplay: { w: 0.033, h: 0.056 },
  },
  {
    id: 'flip-05',
    csvRow: 5,
    label: 'Flip Lilac',
    thinness: 0.9,
    colors: { body: '#c6b3e0', frame: '#8f86a8', lensRing: '#05060a', coverGlow: '#4a4260' },
    camera: CAMERA_LAYOUTS.dualBeside,
    coverDisplay: { w: 0.026, h: 0.02 }, // cover display persegi ringkas
  },
  {
    id: 'flip-06',
    csvRow: 6,
    label: 'Flip Champagne',
    thinness: 0.92,
    colors: { body: '#d8c08a', frame: '#b9975c', lensRing: '#05060a', coverGlow: '#5a4a2a' },
    camera: CAMERA_LAYOUTS.dualBeside,
    coverDisplay: { w: 0.03, h: 0.052 },
  },
  {
    id: 'flip-07',
    csvRow: 7,
    label: 'Flip Marina',
    thinness: 1.0,
    colors: { body: '#3c6fd1', frame: '#7d93b8', lensRing: '#05060a', coverGlow: '#1c3a6a' },
    camera: CAMERA_LAYOUTS.ringDual, // modul kamera bulat besar, ciri khas grup ini
    coverDisplay: { w: 0.026, h: 0.05 },
  },
]

// 8 varian BOOK (buku) -- csvRow 8..15
const BOOK_VARIANTS = [
  {
    id: 'book-01',
    csvRow: 8,
    label: 'Fold Graphite',
    thinness: 1.0,
    colors: { body: '#9aa0a6', frame: '#6b7076', lensRing: '#05060a', coverGlow: '#3a3d42' },
    camera: CAMERA_LAYOUTS.verticalCluster3,
    innerRatio: '4:3', // rasio layar dalam, biar keliatan lebar
  },
  {
    id: 'book-02',
    csvRow: 9,
    label: 'Fold Titan',
    thinness: 1.12, // sedikit lebih tebal, "premium/Ultra"
    colors: { body: '#1c1c1e', frame: '#2a2a2c', lensRing: '#05060a', coverGlow: '#2a2a2c' },
    camera: CAMERA_LAYOUTS.verticalCluster3,
    innerRatio: '4:3',
  },
  {
    id: 'book-03',
    csvRow: 10,
    label: 'Fold Silverline',
    thinness: 0.85, // paling tipis di grupnya
    colors: { body: '#c7cbd1', frame: '#a7abb1', lensRing: '#05060a', coverGlow: '#5a5e64' },
    camera: CAMERA_LAYOUTS.diagonalCluster3,
    innerRatio: '4:3',
  },
  {
    id: 'book-04',
    csvRow: 11,
    label: 'Fold Titanium',
    thinness: 0.78, // paling tipis dari semua 15 varian
    colors: { body: '#5b5e63', frame: '#44464a', lensRing: '#05060a', coverGlow: '#2a2c2f' },
    camera: CAMERA_LAYOUTS.ringTriple,
    innerRatio: '16:10',
    // catatan: hinge aslinya "rotating-sliding" (2-stage). Di sini
    // disederhanakan jadi rotasi murni -- lihat catatan di FoldablePhone.jsx.
  },
  {
    id: 'book-05',
    csvRow: 12,
    label: 'Fold Onyx',
    thinness: 0.95,
    colors: { body: '#141416', frame: '#1e1e20', lensRing: '#05060a', coverGlow: '#1e1e20' },
    camera: CAMERA_LAYOUTS.organicRing,
    innerRatio: '4:3',
  },
  {
    id: 'book-06',
    csvRow: 13,
    label: 'Fold Cosmos',
    thinness: 0.8,
    colors: { body: '#101010', frame: '#1a1a1a', lensRing: '#05060a', coverGlow: '#1a1a1a' },
    camera: CAMERA_LAYOUTS.cosmosRing,
    innerRatio: '4:3',
    matte: true,
  },
  {
    id: 'book-07',
    csvRow: 14,
    label: 'Fold Obsidian',
    thinness: 0.97,
    colors: { body: '#17181a', frame: '#2b2c2f', lensRing: '#05060a', coverGlow: '#2b2c2f' },
    camera: CAMERA_LAYOUTS.cameraBar, // satu-satunya yang modul kameranya bar horizontal
    innerRatio: '4:3',
    barRaised: true, // bar kamera menonjol dikit, dirender lebih maju di Z
  },
  {
    id: 'book-08',
    csvRow: 15,
    label: 'Fold Noir',
    thinness: 0.9,
    colors: { body: '#161616', frame: '#232323', lensRing: '#05060a', coverGlow: '#232323' },
    camera: CAMERA_LAYOUTS.hybridModule,
    innerRatio: '4:3',
  },
]

export const PHONE_VARIANTS = [
  ...FLIP_VARIANTS.map((v) => ({ ...v, foldType: FOLD_TYPES.FLIP })),
  ...BOOK_VARIANTS.map((v) => ({ ...v, foldType: FOLD_TYPES.BOOK })),
]

export const PHONE_VARIANT_BY_ID = Object.fromEntries(PHONE_VARIANTS.map((v) => [v.id, v]))

export function getPhoneVariant(id) {
  return PHONE_VARIANT_BY_ID[id] || PHONE_VARIANTS[0]
}

export function dimsForVariant(variant) {
  const base = BASE[variant.foldType]
  const t = variant.thinness ?? 1
  return {
    openW: base.openW,
    openH: base.openH,
    shellT: base.shellT * t,
    hingeGap: base.hingeGap,
  }
}
