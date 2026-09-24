// Model karakter (Quaternius) punya skinned mesh + skeleton (tulang buat
// animasi jalan/lari/lompat). `Object3D.clone()` bawaan three.js nge-clone
// hierarki node-nya tapi TIDAK ngikutin ulang skeleton (bone) ke mesh yang
// baru -- semua clone bakal numpuk gerak di 1 skeleton yang sama (skeleton
// aslinya, gak ke-clone). Makanya perlu clone manual: clone tiap node satu-
// satu (barengan, node asli & node clone jalan bareng), baru abis itu tiap
// SkinnedMesh di-"pasang ulang" (bind) ke skeleton HASIL CLONE-nya sendiri.
//
// (Sengaja ditulis sendiri di sini, bukan import dari
// 'three/examples/jsm/utils/SkeletonUtils.js', soalnya path itu gampang gak
// ke-resolve pas `vite build` di beberapa versi three -- import dalem kayak
// gitu gak dijamin ada di 'exports' map package.json-nya, jadi bikin build
// production gagal walau di `npm run dev` lokal keliatan baik-baik saja.)
export function cloneSkinnedScene(source) {
  const cloneOf = new Map()
  const root = source.clone()

  // Jalan bareng: node asli ke-N ketemu node hasil clone ke-N (urutan children
  // dijamin sama persis karena baru aja di-clone dari source yang sama).
  ;(function walkTogether(a, b) {
    cloneOf.set(a, b)
    for (let i = 0; i < a.children.length; i++) walkTogether(a.children[i], b.children[i])
  })(source, root)

  source.traverse((node) => {
    if (!node.isSkinnedMesh) return
    const cloned = cloneOf.get(node)
    cloned.skeleton = node.skeleton.clone()
    cloned.skeleton.bones = node.skeleton.bones.map((bone) => cloneOf.get(bone))
    cloned.bind(cloned.skeleton, node.bindMatrix)
  })

  return root
}
