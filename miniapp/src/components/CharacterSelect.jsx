import { useState } from 'react'
import CharacterPreview from './CharacterPreview'
import { CHARACTERS } from '../lib/characters'
import { hapticSelect, hapticSuccess } from '../lib/telegram'

// Layar full-screen, blocking -- gak ada tombol "skip"/tutup, karena ini
// setara "registrasi" (pilih karakter dulu baru bisa masuk ke RP Town).
// Ditampilkan App.jsx cuma kalau citizen.character_id masih null.
export default function CharacterSelect({ citizen, onConfirm }) {
  const [selectedId, setSelectedId] = useState(CHARACTERS[0].id)
  const [saving, setSaving] = useState(false)

  const selected = CHARACTERS.find((c) => c.id === selectedId) || CHARACTERS[0]

  async function handleConfirm() {
    hapticSuccess()
    setSaving(true)
    try {
      await onConfirm(selectedId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="charselect">
      <div className="charselect-header">
        <p className="charselect-eyebrow">Selamat datang di RP Town</p>
        <h1 className="charselect-title">
          Halo, {citizen?.display_name || citizen?.username || 'Warga'}! Pilih karaktermu
        </h1>
        <p className="charselect-sub">Ini bakal jadi wujud kamu di RP Town. Bisa diganti lagi nanti.</p>
      </div>

      <div className="charselect-stage">
        <CharacterPreview
          key={selected.id}
          modelUrl={selected.modelUrl}
          className="charselect-stage-canvas"
        />
        <p className="charselect-stage-name">{selected.name}</p>
      </div>

      <div className="charselect-grid">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`charselect-item${c.id === selectedId ? ' is-active' : ''}`}
            onClick={() => {
              if (c.id === selectedId) return
              hapticSelect()
              setSelectedId(c.id)
            }}
          >
            <span className="charselect-item-name">{c.name}</span>
          </button>
        ))}
      </div>

      <button type="button" className="charselect-confirm" onClick={handleConfirm} disabled={saving}>
        {saving ? 'Menyimpan...' : `Pilih ${selected.name}`}
      </button>
    </div>
  )
}
