import { PHONE_VARIANTS } from './phoneVariants'
import { BAR_PHONE_VARIANTS, PHONE_FORM_FACTOR_BAR } from './barPhoneVariants'

// ============================================================
// phoneCatalog.js -- gabungan SEMUA HP yang bisa dipakai warga: 15
// varian lipat (phoneVariants.js, digambar prosedural) + 39 varian
// bar (barPhoneVariants.js, dari file .glb asli). Total 54 HP.
//
// KENAPA FILE BARU (bukan nambah ke phoneVariants.js langsung): biar
// phoneVariants.js gak kesenggol sama sekali (isinya udah dikalibrasi
// & baru aja di-tweak scale-nya ke 8x, riskan diubah lagi tanpa perlu)
// -- semua tempat yang tadinya import PHONE_VARIANTS/getPhoneVariant
// dari phoneVariants.js buat kebutuhan "semua HP yang ada" (inventory,
// render di tangan karakter) tinggal ganti importnya ke sini.
//
// CARA BEDAIN pas render: `variant.foldType === 'bar'` -> pakai
// <BarPhone>, selain itu (foldType 'flip'/'book') -> pakai
// <FoldablePhone> kayak sebelumnya. Lihat isBarPhone() di bawah.
// ============================================================

export const ALL_PHONE_VARIANTS = [...PHONE_VARIANTS, ...BAR_PHONE_VARIANTS]

export const ALL_PHONE_VARIANT_BY_ID = Object.fromEntries(ALL_PHONE_VARIANTS.map((v) => [v.id, v]))

export function getAnyPhoneVariant(id) {
  return ALL_PHONE_VARIANT_BY_ID[id] || ALL_PHONE_VARIANTS[0]
}

export function isBarPhone(variant) {
  return variant?.foldType === PHONE_FORM_FACTOR_BAR
}
