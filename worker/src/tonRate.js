// Harga TON live (dalam Rupiah) dari CoinGecko. Dipakai buat kurs tarik nanti,
// dan bisa dijawab teller kalau warga nanya "harga TON berapa?".
//
// - Endpoint: GET https://api.coingecko.com/api/v3/simple/price
// - Key opsional (COINGECKO_API_KEY = Demo key gratis dari dashboard CoinGecko,
//   dikirim lewat header x-cg-demo-api-key). Tanpa key masih bisa tapi
//   rate-limit-nya sangat ketat, jadi isi key kalau sudah dipakai beneran.
// - Di-cache 60 detik di edge Cloudflare (cf.cacheTtl) biar hemat kuota.
// - COINGECKO_TON_ID default 'the-open-network'. Karena TON sudah di-rename
//   jadi GRAM (Juni 2026), cek dulu id-nya masih valid di browser:
//   https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=idr

export async function getTonRateIdr(env) {
  const id = env.COINGECKO_TON_ID || 'the-open-network'
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=idr&include_last_updated_at=true`

  const headers = { Accept: 'application/json' }
  if (env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY

  const res = await fetch(url, { headers, cf: { cacheTtl: 60, cacheEverything: true } })
  if (!res.ok) throw new Error(`CoinGecko gagal (${res.status})`)

  const json = await res.json()
  const idr = json?.[id]?.idr
  if (!Number.isFinite(idr) || idr <= 0) {
    throw new Error(`CoinGecko tidak mengembalikan harga untuk id "${id}"`)
  }

  const updatedAt = json[id].last_updated_at ? new Date(json[id].last_updated_at * 1000).toISOString() : null
  return { idrPerTon: idr, updatedAt, source: 'coingecko' }
}
