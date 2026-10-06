// ============================================================
// phoneThemes.js -- tema UI layar HP per BRAND (12 brand + 'generic').
//
// Brand diambil dari `variant.sourceFile` (nama file .glb, mis.
// '06_samsung_galaxy_s26_ultra.glb' -> 'samsung'). HP lipat (flip/book)
// gak punya sourceFile -> tema 'generic'.
//
// KONSISTEN SAMA KEPUTUSAN LAMA DI barPhoneVariants.js: nama brand asli &
// logo gak pernah ditampilkan ke user (trade dress/trademark). Jadi di
// sini yang ditiru cuma BAHASA DESAINNYA (bentuk ikon, posisi jam, status
// bar, gaya navigasi, palet warna), sedangkan `osName` yang tampil di
// layar adalah nama generik/fiksi. `key` brand cuma dipakai internal.
//
// Field penting:
//  mode    : 'dark' | 'light'  -> permukaan aplikasi (kontak, sosmed, dst)
//  status  : 'island' | 'punch' | 'bar'          bentuk status bar
//  widget  : 'none'|'center'|'left'|'glance'|'dot'|'cards'|'xmode'
//  dock    : 'floating' (app cuma di dock) | 'search' | 'bar' | 'none'
//  nav     : 'gesture' (garis bawah) | 'buttons' (3 tombol)
//  header  : 'large' (judul besar kiri) | 'material' | 'collapse' | 'plain'
//  icon    : { shape: squircle|circle|round|chamfer, style: gradient|flat|glass|mono|outline }
//  vars    : CSS variable --ph-* (lihat phone.css)
// ============================================================

const DEFAULT_APP_COLORS = {
  contacts: ['#4cd964', '#2fb34a'],
  camera: ['#6b7280', '#374151'],
  social: ['#ff5f8f', '#d63384'],
  market: ['#ffb02e', '#f06b00'],
}

export const BRAND_THEMES = {
  apple: {
    osName: 'Orchard',
    mode: 'light',
    status: 'island',
    widget: 'ios',
    dock: 'floating',
    nav: 'gesture',
    header: 'large',
    icon: { shape: 'squircle', style: 'gradient' },
    appColors: {
      contacts: ['#8e8e93', '#636366'],
      camera: ['#8e8e93', '#48484a'],
      social: ['#ff6a88', '#ff2d55'],
      market: ['#4facfe', '#0a84ff'],
    },
    vars: {
      '--ph-wall': 'linear-gradient(160deg,#5b7cff 0%,#9b5cff 45%,#ff7ab8 100%)',
      '--ph-font': "-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',sans-serif",
      '--ph-app-bg': '#f2f2f7',
      '--ph-surface': '#ffffff',
      '--ph-text': '#111114',
      '--ph-sub': '#6e6e73',
      '--ph-accent': '#0a84ff',
      '--ph-radius': '14px',
      '--ph-line': 'rgba(60,60,67,0.18)',
    },
  },
  samsung: {
    osName: 'Horizon UI',
    mode: 'light',
    status: 'punch',
    widget: 'left',
    dock: 'search',
    nav: 'gesture',
    header: 'collapse',
    icon: { shape: 'round', style: 'flat' },
    appColors: {
      contacts: ['#34c759', '#34c759'],
      camera: ['#3a3a3c', '#3a3a3c'],
      social: ['#ff4d6d', '#ff4d6d'],
      market: ['#3d7cff', '#3d7cff'],
    },
    vars: {
      '--ph-wall': 'linear-gradient(170deg,#1b2a4a 0%,#2b4a7a 50%,#6aa5d8 100%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#f4f5f7',
      '--ph-surface': '#ffffff',
      '--ph-text': '#101114',
      '--ph-sub': '#6b7078',
      '--ph-accent': '#3d7cff',
      '--ph-radius': '22px',
      '--ph-line': 'rgba(0,0,0,0.08)',
    },
  },
  oppo: {
    osName: 'ColorWave',
    mode: 'light',
    status: 'punch',
    widget: 'center',
    dock: 'floating',
    nav: 'gesture',
    header: 'large',
    icon: { shape: 'squircle', style: 'glass' },
    appColors: {
      contacts: ['#5de0a6', '#1fb58a'],
      camera: ['#a0a7b8', '#6a7285'],
      social: ['#ff9ab8', '#ff5f93'],
      market: ['#ffc46b', '#ff8a3d'],
    },
    vars: {
      '--ph-wall': 'linear-gradient(165deg,#ff9a76 0%,#ff6f9c 48%,#8b5cf6 100%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#f7f5fa',
      '--ph-surface': '#ffffff',
      '--ph-text': '#1a1523',
      '--ph-sub': '#7a7388',
      '--ph-accent': '#1fb58a',
      '--ph-radius': '20px',
      '--ph-line': 'rgba(26,21,35,0.08)',
    },
  },
  vivo: {
    osName: 'Origin Lite',
    mode: 'light',
    status: 'punch',
    widget: 'center',
    dock: 'bar',
    nav: 'gesture',
    header: 'material',
    icon: { shape: 'squircle', style: 'gradient' },
    appColors: {
      contacts: ['#4ade80', '#16a34a'],
      camera: ['#64748b', '#334155'],
      social: ['#fb7185', '#e11d48'],
      market: ['#60a5fa', '#2563eb'],
    },
    vars: {
      '--ph-wall': 'linear-gradient(170deg,#0f3b7a 0%,#2f80ed 55%,#9fd0ff 100%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#f5f7fb',
      '--ph-surface': '#ffffff',
      '--ph-text': '#0f172a',
      '--ph-sub': '#64748b',
      '--ph-accent': '#2563eb',
      '--ph-radius': '16px',
      '--ph-line': 'rgba(15,23,42,0.08)',
    },
  },
  xiaomi: {
    osName: 'Hyper Home',
    mode: 'light',
    status: 'punch',
    widget: 'center',
    dock: 'bar',
    nav: 'gesture',
    header: 'large',
    icon: { shape: 'squircle', style: 'gradient' },
    appColors: {
      contacts: ['#34d399', '#10b981'],
      camera: ['#9ca3af', '#4b5563'],
      social: ['#f472b6', '#ec4899'],
      market: ['#fb923c', '#ff6a00'],
    },
    vars: {
      '--ph-wall': 'linear-gradient(170deg,#14213d 0%,#3a2a7a 50%,#ff6a00 120%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#f6f6f8',
      '--ph-surface': '#ffffff',
      '--ph-text': '#18181b',
      '--ph-sub': '#71717a',
      '--ph-accent': '#ff6a00',
      '--ph-radius': '18px',
      '--ph-line': 'rgba(0,0,0,0.07)',
    },
  },
  google: {
    osName: 'Clear UI',
    mode: 'light',
    status: 'punch',
    widget: 'glance',
    dock: 'search',
    nav: 'gesture',
    header: 'material',
    icon: { shape: 'circle', style: 'flat' },
    appColors: {
      contacts: ['#c8f0d2', '#c8f0d2'],
      camera: ['#e1e3ea', '#e1e3ea'],
      social: ['#ffd9e2', '#ffd9e2'],
      market: ['#cfe3ff', '#cfe3ff'],
    },
    iconInk: '#1d2b24',
    vars: {
      '--ph-wall': 'linear-gradient(175deg,#d9ecff 0%,#e7f5e6 60%,#fff3d6 100%)',
      '--ph-font': "'Inter','Roboto','Google Sans',system-ui,sans-serif",
      '--ph-app-bg': '#f3f7f2',
      '--ph-surface': '#ffffff',
      '--ph-text': '#1b1f1c',
      '--ph-sub': '#5d655f',
      '--ph-accent': '#2e7d5b',
      '--ph-radius': '24px',
      '--ph-line': 'rgba(0,0,0,0.07)',
      '--ph-home-ink': '#1b1f1c',
    },
  },
  huawei: {
    osName: 'Harbor OS',
    mode: 'light',
    status: 'punch',
    widget: 'cards',
    dock: 'bar',
    nav: 'gesture',
    header: 'large',
    icon: { shape: 'squircle', style: 'glass' },
    appColors: {
      contacts: ['#34d3b0', '#0aa88a'],
      camera: ['#8896a8', '#52606f'],
      social: ['#ff7aa2', '#e8457a'],
      market: ['#5aa9ff', '#1d6fe0'],
    },
    vars: {
      '--ph-wall': 'linear-gradient(165deg,#0b3d5c 0%,#0e7c86 50%,#b8f0e0 100%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#f2f6f8',
      '--ph-surface': '#ffffff',
      '--ph-text': '#0e1a22',
      '--ph-sub': '#5b6b76',
      '--ph-accent': '#0e7c86',
      '--ph-radius': '18px',
      '--ph-line': 'rgba(14,26,34,0.08)',
    },
  },
  sony: {
    osName: 'Pure UI',
    mode: 'dark',
    status: 'bar',
    widget: 'left',
    dock: 'bar',
    nav: 'buttons',
    header: 'material',
    icon: { shape: 'circle', style: 'outline' },
    appColors: DEFAULT_APP_COLORS,
    vars: {
      '--ph-wall': 'linear-gradient(180deg,#05070a 0%,#10161f 60%,#1a2736 100%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#0b0e13',
      '--ph-surface': '#151a22',
      '--ph-text': '#eef2f7',
      '--ph-sub': '#8a95a5',
      '--ph-accent': '#4aa3ff',
      '--ph-radius': '10px',
      '--ph-line': 'rgba(255,255,255,0.09)',
    },
  },
  oneplus: {
    osName: 'Swift OS',
    mode: 'dark',
    status: 'punch',
    widget: 'left',
    dock: 'bar',
    nav: 'gesture',
    header: 'collapse',
    icon: { shape: 'round', style: 'flat' },
    appColors: {
      contacts: ['#2dd4a0', '#2dd4a0'],
      camera: ['#f5f5f5', '#f5f5f5'],
      social: ['#ff4b55', '#ff4b55'],
      market: ['#ffb020', '#ffb020'],
    },
    iconInk: '#101010',
    vars: {
      '--ph-wall': 'linear-gradient(170deg,#0a0a0a 0%,#2b0a10 55%,#eb0028 130%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#0d0d0f',
      '--ph-surface': '#18181b',
      '--ph-text': '#f5f5f5',
      '--ph-sub': '#9a9aa2',
      '--ph-accent': '#eb0028',
      '--ph-radius': '20px',
      '--ph-line': 'rgba(255,255,255,0.08)',
    },
  },
  honor: {
    osName: 'Magic Lite',
    mode: 'light',
    status: 'punch',
    widget: 'center',
    dock: 'floating',
    nav: 'gesture',
    header: 'large',
    icon: { shape: 'squircle', style: 'glass' },
    appColors: {
      contacts: ['#4ade80', '#22c55e'],
      camera: ['#94a3b8', '#64748b'],
      social: ['#f9a8d4', '#ec4899'],
      market: ['#7dd3fc', '#0ea5e9'],
    },
    vars: {
      '--ph-wall': 'linear-gradient(160deg,#0a1a3a 0%,#1d4ed8 50%,#7dd3fc 100%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#f3f6fc',
      '--ph-surface': '#ffffff',
      '--ph-text': '#0b1530',
      '--ph-sub': '#5c6a86',
      '--ph-accent': '#1d4ed8',
      '--ph-radius': '18px',
      '--ph-line': 'rgba(11,21,48,0.08)',
    },
  },
  nothing: {
    osName: 'Dot OS',
    mode: 'dark',
    status: 'bar',
    widget: 'dot',
    dock: 'none',
    nav: 'gesture',
    header: 'plain',
    icon: { shape: 'circle', style: 'mono' },
    appColors: DEFAULT_APP_COLORS,
    vars: {
      '--ph-wall': '#000000',
      '--ph-font': "'Space Mono','SF Mono',Consolas,monospace",
      '--ph-app-bg': '#000000',
      '--ph-surface': '#111111',
      '--ph-text': '#ffffff',
      '--ph-sub': '#8c8c8c',
      '--ph-accent': '#ff3b30',
      '--ph-radius': '14px',
      '--ph-line': 'rgba(255,255,255,0.16)',
    },
  },
  asus: {
    osName: 'Arena UI',
    mode: 'dark',
    status: 'bar',
    widget: 'xmode',
    dock: 'bar',
    nav: 'buttons',
    header: 'plain',
    icon: { shape: 'chamfer', style: 'outline' },
    appColors: DEFAULT_APP_COLORS,
    vars: {
      '--ph-wall': 'linear-gradient(160deg,#050507 0%,#14070b 55%,#4a0612 100%)',
      '--ph-font': "'Space Mono','Inter',system-ui,monospace",
      '--ph-app-bg': '#07070a',
      '--ph-surface': '#121218',
      '--ph-text': '#f4f4f6',
      '--ph-sub': '#9a8f94',
      '--ph-accent': '#ff1f3d',
      '--ph-radius': '4px',
      '--ph-line': 'rgba(255,31,61,0.28)',
    },
  },
  generic: {
    osName: 'Android',
    mode: 'dark',
    status: 'punch',
    widget: 'center',
    dock: 'search',
    nav: 'gesture',
    header: 'material',
    icon: { shape: 'circle', style: 'gradient' },
    appColors: DEFAULT_APP_COLORS,
    vars: {
      '--ph-wall': 'linear-gradient(170deg,#101830 0%,#2a2f6a 55%,#6a4fb8 100%)',
      '--ph-font': "'Inter','Roboto',system-ui,sans-serif",
      '--ph-app-bg': '#0f1220',
      '--ph-surface': '#1a1e33',
      '--ph-text': '#eef0fa',
      '--ph-sub': '#9096b3',
      '--ph-accent': '#7c8cff',
      '--ph-radius': '18px',
      '--ph-line': 'rgba(255,255,255,0.1)',
    },
  },
}

// '06_samsung_galaxy_s26_ultra.glb' -> 'samsung'; HP lipat / tak dikenal -> 'generic'
export function getBrandKey(variant) {
  const m = variant?.sourceFile?.match(/^\d+_([a-z]+)_/)
  const key = m?.[1]
  return key && BRAND_THEMES[key] ? key : 'generic'
}

export function getPhoneTheme(variant) {
  const key = getBrandKey(variant)
  return { key, ...BRAND_THEMES[key] }
}
