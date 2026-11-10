import json, math, sys
import numpy as np, cv2
from scipy.spatial import Delaunay, cKDTree
from scipy import ndimage as ndi
from glbwriter import Glb

import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = HERE + 'out/'; os.makedirs(OUT, exist_ok=True)
d = json.load(open(OUT + 'layout_px.json'))
M = d['meta']
X0, Y0, PXKM = M['X0'], M['Y0'], M['PXKM']
IW, IH = M['W'], M['H']
M_PER_KM = float(__import__("os").environ.get("MPK", "150"))   # meter dunia per km peta referensi
K = M_PER_KM / PXKM              # meter per piksel
LAND_H = 1.2                      # tinggi daratan di atas permukaan air (m); tepi daratan = tebing
PAD = 60.0                       # tepi laut di sekeliling pulau (m)
rng = np.random.default_rng(7)

# ------------------------------------------------------------------ topeng daratan
islands = [np.array(p, np.float32) for p in d['islands']]
lakes = [np.array(p, np.float32) for p in d['lakes'] if cv2.contourArea(np.array(p, np.float32)) > 4000]
land_u8 = np.zeros((IH, IW), np.uint8)
for p in islands: cv2.fillPoly(land_u8, [np.round(p).astype(np.int32)], 1)
for p in lakes: cv2.fillPoly(land_u8, [np.round(p).astype(np.int32)], 0)
# sungai/kanal yang tadinya terputus oleh jalan penyeberang dibuka lagi (jalan jadi jembatan kecil)
for p in d.get('river_gaps', []): cv2.fillPoly(land_u8, [np.round(np.array(p)).astype(np.int32)], 0)
land = land_u8.astype(bool)
# haluskan garis pantai, sungai & danau (hilangkan gerigi piksel), buang serpihan kecil
land = cv2.GaussianBlur(land.astype(np.float32), (0, 0), 3.5) > 0.5
_n, _lab, _st, _ = cv2.connectedComponentsWithStats(land.astype(np.uint8), connectivity=8)
for _i in range(1, _n):
    if _st[_i, cv2.CC_STAT_AREA] < 1500: land[_lab == _i] = False
allx = np.concatenate([p[:, 0] for p in islands]); ally = np.concatenate([p[:, 1] for p in islands])
rx0 = max(0.0, allx.min() - PAD / K); rx1 = min(IW - 1.0, allx.max() + PAD / K)
ry0 = max(0.0, ally.min() - PAD / K); ry1 = min(IH - 1.0, ally.max() + PAD / K)
WM = float((rx1 - rx0) * K); HM = float((ry1 - ry0) * K)
print('peta %.0f x %.0f m' % (WM, HM))

def to_local(px, py):  # piksel -> meter (x timur, y utara)
    return (np.asarray(px) - rx0) * K, (ry1 - np.asarray(py)) * K
def to_px(x, y):
    return np.asarray(x) / K + rx0, ry1 - np.asarray(y) / K

rect = np.zeros((IH, IW), bool); rect[int(ry0):int(ry1) + 1, int(rx0):int(rx1) + 1] = True
water = rect & ~land
def dil(m, r): return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0
def ero(m, r): return cv2.erode(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0
land_d, water_d = dil(land, 2), dil(water, 2)
edt_land = cv2.distanceTransform(land.astype(np.uint8), cv2.DIST_L2, 5)        # jarak ke pantai (di darat)
edt_water = cv2.distanceTransform((~land).astype(np.uint8), cv2.DIST_L2, 5)    # jarak ke darat (di air)

# ------------------------------------------------------------------ kontur -> titik
def resample(c, step):
    c = c.astype(np.float64)
    if len(c) < 4: return c
    closed = np.vstack([c, c[:1]])
    seg = np.hypot(*np.diff(closed, axis=0).T); cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1]; m = max(8, int(L / step))
    ts = np.linspace(0, L, m, endpoint=False)
    return np.stack([np.interp(ts, cum, closed[:, 0]), np.interp(ts, cum, closed[:, 1])], 1)

def contour_pts(mask, step, smooth=True):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cs:
        c = c[:, 0, :]
        if len(c) < 20: continue
        p = resample(c, 3.0)
        if smooth and len(p) > 12:
            k = 5
            ext = np.vstack([p[-k:], p, p[:k]])
            ker = np.ones(2 * k + 1) / (2 * k + 1)
            p = np.stack([np.convolve(ext[:, 0], ker, 'valid')[:len(p)], np.convolve(ext[:, 1], ker, 'valid')[:len(p)]], 1) if False else \
                np.stack([np.convolve(ext[:, 0], ker, 'same')[k:k + len(p)], np.convolve(ext[:, 1], ker, 'same')[k:k + len(p)]], 1)
        out.append(resample(p, step))
    return out

coast = contour_pts(land, 9.0)
coast_pts = np.vstack(coast)
print('titik pantai', len(coast_pts))

def at(mask, pts):
    x = np.clip(np.round(pts[:, 0]).astype(int), 0, IW - 1); y = np.clip(np.round(pts[:, 1]).astype(int), 0, IH - 1)
    return mask[y, x]

def tri_filter(P, simplex, strict, loose):
    a, b, c = P[simplex[:, 0]], P[simplex[:, 1]], P[simplex[:, 2]]
    cen = (a + b + c) / 3
    ok = at(strict, cen) & at(loose, (a + b) / 2) & at(loose, (b + c) / 2) & at(loose, (c + a) / 2)
    return simplex[ok]

def jitter(P): return P + rng.normal(0, 0.05, P.shape)

# ---- mesh daratan (warna vertex: pasir di tepi -> hijau ke dalam)
SAND = np.array([232, 216, 168]) / 255.0
GREEN = np.array([156, 196, 112]) / 255.0     # rumput segar (#9CC470); dulu 200,224,176 terlalu pucat/krem di dalam game
BASE = np.array([237, 237, 184]) / 255.0
ring = contour_pts(ero(land, 22), 20.0)
ring_pts = np.vstack(ring) if ring else np.zeros((0, 2))
gx, gy = np.meshgrid(np.arange(int(rx0), int(rx1), 40), np.arange(int(ry0), int(ry1), 40))
grid = np.stack([gx.ravel(), gy.ravel()], 1).astype(float)
grid = grid[edt_land[grid[:, 1].astype(int), grid[:, 0].astype(int)] > 34]
ring8 = contour_pts(ero(land, 8), 12.0)
ring8_pts = np.vstack(ring8) if ring8 else np.zeros((0, 2))
LP = np.vstack([coast_pts, ring8_pts, ring_pts, grid])
tri = Delaunay(jitter(LP))
ls = tri_filter(LP, tri.simplices, land, land_d)
dpt = edt_land[np.clip(LP[:, 1].astype(int), 0, IH - 1), np.clip(LP[:, 0].astype(int), 0, IW - 1)]
t = np.clip(dpt / 22.0, 0, 1)[:, None]
col = (SAND * (1 - t) + GREEN * t) / BASE
chk = np.zeros((IH, IW), np.uint8)
for s in ls: cv2.fillConvexPoly(chk, np.round(LP[s]).astype(np.int32), 1)
chk = chk.astype(bool)
print('daratan: segitiga %d, salah %.2f%% (kurang %.2f%%, lebih %.2f%%)' % (
    len(ls), 100 * (chk ^ land).sum() / land.sum(), 100 * (land & ~chk).sum() / land.sum(), 100 * (chk & ~land).sum() / land.sum()))

# ---- mesh air (laut + danau), pakai titik pantai yang sama
bx = np.arange(rx0, rx1 + 1, 80.0); by = np.arange(ry0, ry1 + 1, 80.0)
edge = np.vstack([np.stack([bx, np.full_like(bx, ry0)], 1), np.stack([bx, np.full_like(bx, ry1)], 1),
                  np.stack([np.full_like(by, rx0), by], 1), np.stack([np.full_like(by, rx1), by], 1),
                  [[rx0, ry0], [rx1, ry0], [rx0, ry1], [rx1, ry1]]])
gx, gy = np.meshgrid(np.arange(int(rx0) + 30, int(rx1) - 20, 60), np.arange(int(ry0) + 30, int(ry1) - 20, 60))
sg = np.stack([gx.ravel(), gy.ravel()], 1).astype(float)
sg = sg[(edt_water[sg[:, 1].astype(int), sg[:, 0].astype(int)] > 35) & water[sg[:, 1].astype(int), sg[:, 0].astype(int)]]
lgx, lgy = np.meshgrid(np.arange(0, IW, 28), np.arange(0, IH, 28))
lg = np.stack([lgx.ravel(), lgy.ravel()], 1).astype(float)
ix, iy = lg[:, 0].astype(int), lg[:, 1].astype(int)
lake_mask = ndi.binary_fill_holes(land | (np.zeros_like(land))) & ~land
lg = lg[lake_mask[iy, ix] & (edt_water[iy, ix] > 14)]
wr1 = contour_pts(ero(water, 7), 12.0); wr2 = contour_pts(ero(water, 18), 20.0)
wr_pts = np.vstack([p for p in (wr1 + wr2) if len(p)]) if (wr1 or wr2) else np.zeros((0, 2))
wr_pts = wr_pts[at(water, wr_pts) & (edt_water[np.clip(wr_pts[:, 1].astype(int), 0, IH - 1), np.clip(wr_pts[:, 0].astype(int), 0, IW - 1)] > 5)]
WP = np.vstack([coast_pts, wr_pts, edge, sg, lg])
tri = Delaunay(jitter(WP))
ws_ = tri_filter(WP, tri.simplices, water, water_d)
chk = np.zeros((IH, IW), np.uint8)
for s in ws_: cv2.fillConvexPoly(chk, np.round(WP[s]).astype(np.int32), 1)
chk = chk.astype(bool)
print('air: segitiga %d, salah %.2f%% (kurang %.2f%%, lebih %.2f%%)' % (
    len(ws_), 100 * (chk ^ water).sum() / water.sum(), 100 * (water & ~chk).sum() / water.sum(), 100 * (chk & ~water).sum() / water.sum()))

# ------------------------------------------------------------------ jalan
def chaikin(p, it=2):
    for _ in range(it):
        if len(p) < 3: break
        q = [p[0]]
        for i in range(len(p) - 1):
            a, b = p[i], p[i + 1]
            q += [0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b]
        q.append(p[-1]); p = np.array(q)
    return p

def resample_open(p, step):
    seg = np.hypot(*np.diff(p, axis=0).T); cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1]; m = max(2, int(L / step) + 1)
    ts = np.linspace(0, L, m)
    return np.stack([np.interp(ts, cum, p[:, 0]), np.interp(ts, cum, p[:, 1])], 1)

roads = []
for r in d['roads']:
    if r['len'] < 14: continue
    p = np.array(r['pts'], float)
    p = resample_open(chaikin(p, 2), 5.0)
    fw = (~at(land_d, p)).mean()
    if fw > 0.35: kind = 'bridge'
    elif r['col'][0] < 130: kind = 'main'
    else: kind = 'minor'
    if kind == 'bridge':   # jembatan: sederhanakan (rel pagar bikin skeleton zig-zag)
        q = cv2.approxPolyDP(np.array(r['pts'], np.float32).reshape(-1, 1, 2), 18.0, False)[:, 0, :].astype(float)
        if len(q) >= 2: p = resample_open(chaikin(q, 2), 5.0)
    roads.append({'pts': p, 'kind': kind, 'w': r['w']})
# 8 jembatan antar-pulau, digambar dari peta referensi (koordinat tampilan 2000 px lebar; x1.8 = piksel asli).
# Hasil deteksi otomatis memutus jembatan jadi potongan-potongan (pagar -> skeleton zig-zag) dan
# membuat Pulau Wisata & Industri terputus, jadi jalur jembatan ditetapkan di sini.
DISP = 1.8
BRIDGES = [
    ('Wisata-Olahraga',      [(322, 386), (430, 361), (535, 343), (815, 252), (850, 245)]),
    ('Wisata-Pemukiman',     [(293, 480), (268, 518), (228, 590), (192, 650), (180, 670)]),
    ('Pemukiman-Terlarang',  [(303, 1165), (306, 1195), (307, 1220), (306, 1245)]),
    ('Pemukiman-PusatKota',  [(585, 934), (690, 897), (770, 868), (822, 853), (860, 848)]),
    ('Olahraga-PusatKota',   [(1052, 295), (1040, 352), (1033, 395), (1034, 430), (1042, 458)]),
    ('Olahraga-Industri',    [(1215, 190), (1260, 205), (1340, 240), (1425, 300), (1450, 355), (1448, 420), (1445, 497)]),
    ('Industri-PusatKota',   [(1445, 497), (1427, 512), (1379, 549), (1330, 590), (1296, 622)]),
    ('PusatKota-Pelabuhan',  [(1290, 828), (1340, 858), (1404, 915), (1430, 945), (1440, 970), (1440, 990)]),
]
roads = [r for r in roads if r['kind'] != 'bridge']
bridge_lines = []
for name, pl in BRIDGES:
    q = np.array(pl, float) * DISP
    p = resample_open(chaikin(q, 2), 5.0)
    roads.append({'pts': p, 'kind': 'bridge', 'w': 0})
    bridge_lines.append((name, p))
WIDTH_M = {'minor': 4.0, 'main': 6.0, 'bridge': 9.0}
SIDEWALK_W = float(os.environ.get("SW", "1.6"))   # lebar trotoar tiap sisi (m), jalan biasa & utama; 0 = tanpa trotoar

# ---- sambung jalan yang terputus -------------------------------------------------
# Ekstraksi memecah jaringan jalan jadi puluhan potongan (celah di bawah ikon marker bernomor, di
# persimpangan, garis kuning putus-putus). Ujung jalan yang menggantung disambung ke titik jalan terdekat
# di komponen LAIN (selama garisnya tetap di daratan & tidak jauh) sampai tidak ada lagi yang bisa disambung.
STITCH_R = 90.0   # px (~80 m) jarak maksimum satu sambungan
def _road_labels():
    m = np.zeros((IH, IW), np.uint8)
    for r in roads:
        th = max(2, int(round(WIDTH_M[r['kind']] / K)))
        cv2.polylines(m, [np.round(r['pts']).astype(np.int32)], False, 1, th)
    n_, lab_ = cv2.connectedComponents(m, connectivity=8)
    ids = []
    for r in roads:
        c = 0
        for q in r['pts']:
            c = int(lab_[int(round(q[1])), int(round(q[0]))])
            if c: break
        ids.append(c)
    return ids
_gapzone = np.zeros((IH, IW), np.uint8)
for p in d.get('river_gaps', []): cv2.fillPoly(_gapzone, [np.round(np.array(p)).astype(np.int32)], 1)
_gapzone = (cv2.dilate(_gapzone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))) > 0) | land_d   # penyeberangan sungai dianggap boleh dilewati
def _line_on_land(a, b):
    t = np.linspace(0, 1, max(3, int(np.hypot(*(b - a)) / 3)))
    P = a[None, :] * (1 - t[:, None]) + b[None, :] * t[:, None]
    return at(_gapzone, P).mean() > 0.97
n_before = len(set(_road_labels()))
stitched = 0
for _ in range(400):
    ids = _road_labels()
    allp = np.vstack([r['pts'] for r in roads]); owner = np.concatenate([[i] * len(r['pts']) for i, r in enumerate(roads)])
    tree = cKDTree(allp); best = None
    for i, r in enumerate(roads):
        for e in (r['pts'][0], r['pts'][-1]):
            cand = tree.query_ball_point(e, STITCH_R)
            cand = sorted(cand, key=lambda j: np.hypot(*(allp[j] - e)))
            for j_ in cand:
                d_ = float(np.hypot(*(allp[j_] - e)))
                if ids[owner[j_]] == ids[i]: continue
                if roads[i]['kind'] != 'bridge' and not _line_on_land(np.asarray(e, float), allp[j_]): continue
                if best is None or d_ < best[0]: best = (d_, np.asarray(e, float), allp[j_].copy(), i, owner[j_])
                break
    if best is None: break
    _, a_, b_, i_, j_ = best
    kind_ = 'main' if 'main' in (roads[i_]['kind'], roads[j_]['kind']) else 'minor'
    if not _line_on_land(a_, b_): kind_ = 'bridge'   # ujung jembatan yang berhenti di laut sebelum pantai
    roads.append({'pts': resample_open(np.array([a_, b_]), 5.0), 'kind': kind_, 'w': 0}); stitched += 1
ids = _road_labels()
from collections import Counter
cnt = Counter(ids)
for c_, n_ in cnt.most_common()[1:]:
    pp = np.vstack([r['pts'] for r, i_ in zip(roads, ids) if i_ == c_]); print('  komponen kecil', c_, n_, 'jalan; pusat disp', (pp.mean(0) / 1.8).round().tolist(), 'bbox disp', (pp.min(0) / 1.8).round().tolist(), (pp.max(0) / 1.8).round().tolist())
print('sambungan jalan', stitched, '| komponen jalan', n_before, '->', len(cnt), '| ukuran', sorted(cnt.values(), reverse=True)[:12])
print('jalan', {k: sum(1 for r in roads if r['kind'] == k) for k in WIDTH_M})

road_mask = np.zeros((IH, IW), np.uint8)
road_only = np.zeros((IH, IW), np.uint8)
for r in roads:
    th = max(2, int(round(WIDTH_M[r['kind']] / K)))
    cv2.polylines(road_only, [np.round(r['pts']).astype(np.int32)], False, 1, th)
road_mask = road_only.copy()
# jalan + trotoar: penghalang buat rumah/pohon/billboard (supaya halaman & pagar tidak menimpa trotoar)
road_sw = road_only.copy()
for r in roads:
    if r['kind'] == 'bridge' or SIDEWALK_W <= 0: continue
    th = max(2, int(round((WIDTH_M[r['kind']] + 2 * SIDEWALK_W) / K)))
    cv2.polylines(road_sw, [np.round(r['pts']).astype(np.int32)], False, 1, th)

# ------------------------------------------------------------------ marker -> kotak fasilitas
APPROX = {1: (1890, 864), 2: (2124, 1192), 3: (1836, 1436), 4: (1688, 1075), 5: (472, 2552), 6: (2309, 1489),
          7: (2376, 1161), 8: (2061, 1508), 9: (1634, 1544), 10: (3024, 419), 11: (443, 2302), 12: (758, 2338),
          13: (3092, 756), 14: (2907, 614), 15: (2855, 851), 16: (3321, 509), 17: (3298, 697), 18: (1746, 472),
          19: (1910, 1100), 20: (499, 470), 21: (592, 810), 22: (416, 342), 23: (2918, 1854), 24: (2153, 328),
          25: (1980, 542), 26: (373, 533), 27: (3208, 1967), 28: (2590, 1782), 29: (212, 533), 30: (3062, 1663)}
markers = []
for n, (ax, ay) in APPROX.items():
    best = min(d['markers'], key=lambda m: math.hypot(m['x'] - ax, m['y'] - ay))
    assert math.hypot(best['x'] - ax, best['y'] - ay) < 40, n
    markers.append({'n': n, 'x': best['x'], 'y': best['y'], 'c': best['c'], 'big': best['a'] > 3000})
assert len({(m['x'], m['y']) for m in markers}) == 30

FAC_SMALL, FAC_BIG = 24.0, 38.0   # sisi kotak (m)
FAC_H = {False: 10.0, True: 14.0}
placed_boxes = []
fac_mask = np.zeros((IH, IW), np.uint8)

def box_poly(cx, cy, side_px, ang):
    c, s = math.cos(ang), math.sin(ang); h = side_px / 2
    return np.array([[cx + c * x - s * y, cy + s * x + c * y] for x, y in [(-h, -h), (h, -h), (h, h), (-h, h)]])

road_edt, road_idx = ndi.distance_transform_edt(road_only == 0, return_indices=True)
for m in sorted(markers, key=lambda m: not m['big']):
    side = (FAC_BIG if m['big'] else FAC_SMALL) / K
    best = None
    # sudut jalan terdekat (supaya kotak sejajar jalan)
    ix, iy = int(m['x']), int(m['y'])
    ny_, nx_ = road_idx[0][iy, ix], road_idx[1][iy, ix]
    for dist_m in [side * K * 0.5 + 5 + k for k in (0, 3, 6, 10, 15, 22)]:
        for a in np.linspace(0, 2 * math.pi, 24, endpoint=False):
            cx = m['x'] + math.cos(a) * dist_m / K; cy = m['y'] + math.sin(a) * dist_m / K
            ang = math.atan2(m['y'] - cy, m['x'] - cx) + math.pi / 2   # muka kotak menghadap titik marker
            poly = box_poly(cx, cy, side, ang)
            tmp = np.zeros((IH, IW), np.uint8); cv2.fillPoly(tmp, [np.round(poly).astype(np.int32)], 1)
            tmpb = tmp.astype(bool)
            over_road = (tmpb & (dil(road_only, 3) > 0)).sum() / tmpb.sum()
            off_land = (tmpb & ~ero(land, 6)).sum() / tmpb.sum()
            over_box = (tmpb & (fac_mask > 0)).sum() / tmpb.sum()
            score = over_road * 10 + off_land * 10 + over_box * 10 + dist_m * 0.002
            if best is None or score < best[0]:
                best = (score, cx, cy, ang, poly)
        if best and best[0] < 0.2: break
    if best[0] > 0.5:   # marker di tepi pantai/air: taruh di titik darat terdekat yang cukup lega
        ys_, xs_ = np.where(ero(land, int(side / 2 + 3)) & (dil(road_only, 3) == 0) & (fac_mask == 0))
        k_ = np.argmin((xs_ - m['x']) ** 2 + (ys_ - m['y']) ** 2)
        cx, cy = float(xs_[k_]), float(ys_[k_])
        ang = math.atan2(m['y'] - cy, m['x'] - cx) + math.pi / 2
        best = (0.0, cx, cy, ang, box_poly(cx, cy, side, ang))
    sc, cx, cy, ang, poly = best
    cv2.fillPoly(fac_mask, [np.round(poly).astype(np.int32)], 1)
    placed_boxes.append({**m, 'cx': cx, 'cy': cy, 'ang': ang, 'side': side * K, 'score': sc, 'poly': poly})
print('kotak fasilitas', len(placed_boxes), 'skor buruk:', [(b['n'], round(b['score'], 2)) for b in placed_boxes if b['score'] > 0.2])

obs = (road_sw > 0) | (fac_mask > 0)
edt_obs = cv2.distanceTransform((~obs).astype(np.uint8), cv2.DIST_L2, 5)

# ------------------------------------------------------------------ rumah warga (titik kecil)
KH = float(os.environ.get("KH", "1.0"))     # skala rumah (harus sama dengan FIXED_K di lpmHouses.js); 1.0 = ukuran asli interior
HOUSE_W, HOUSE_D = 12.9 * KH, (10 + 1.2 + 0.9) * KH
RHO = math.hypot(HOUSE_W, HOUSE_D) / 2 + 0.05   # jari-jari lingkaran pengaman rumah (m): setengah diagonal tapak + 5 cm (KH 0,65 -> 5,8 m)
H = np.array([[h['x'], h['y']] for h in d['houses']], float)
hcol = [h['c'] for h in d['houses']]
# buang titik rumah yang jatuh di air
keep = at(land, H); H = H[keep]; hcol = [c for c, k in zip(hcol, keep) if k]
print('rumah', len(H))
rho_px = RHO / K
gxo = cv2.Sobel(cv2.GaussianBlur(edt_obs, (0, 0), 2), cv2.CV_32F, 1, 0, ksize=5)
gyo = cv2.Sobel(cv2.GaussianBlur(edt_obs, (0, 0), 2), cv2.CV_32F, 0, 1, ksize=5)
gxl = cv2.Sobel(cv2.GaussianBlur(edt_land, (0, 0), 2), cv2.CV_32F, 1, 0, ksize=5)
gyl = cv2.Sobel(cv2.GaussianBlur(edt_land, (0, 0), 2), cv2.CV_32F, 0, 1, ksize=5)

def unit(gx_, gy_):
    n = math.hypot(gx_, gy_) or 1.0
    return gx_ / n, gy_ / n

need_obs = rho_px + 0.8 / K
need_land = rho_px + 2.0 / K
for it in range(80):
    moved = 0.0
    tree = cKDTree(H)
    for i in range(len(H)):
        x, y = H[i]
        ix, iy = int(round(x)), int(round(y))
        dx_ = dy_ = 0.0
        for j in tree.query_ball_point(H[i], 2 * rho_px):
            if j == i: continue
            vx, vy = x - H[j][0], y - H[j][1]; dd = math.hypot(vx, vy) or 1e-3
            push = (2 * rho_px - dd) * 0.5
            dx_ += vx / dd * push; dy_ += vy / dd * push
        if edt_obs[iy, ix] < need_obs:
            ux, uy = unit(gxo[iy, ix], gyo[iy, ix]); push = need_obs - edt_obs[iy, ix]
            dx_ += ux * push; dy_ += uy * push
        if edt_land[iy, ix] < need_land:
            ux, uy = unit(gxl[iy, ix], gyl[iy, ix]); push = need_land - edt_land[iy, ix]
            dx_ += ux * push; dy_ += uy * push
        H[i, 0] += dx_ * 0.6; H[i, 1] += dy_ * 0.6
        H[i, 0] = min(max(H[i, 0], 1), IW - 2); H[i, 1] = min(max(H[i, 1], 1), IH - 2)
        moved += math.hypot(dx_, dy_)
    if it >= 8 and moved / len(H) < 0.002: break
print('relaksasi selesai iterasi', it, 'rata-rata geser terakhir %.3f px' % (moved / len(H)))
tree = cKDTree(H); dd, _ = tree.query(H, k=2)
bad_pair = int((dd[:, 1] < 2 * rho_px * 0.92).sum())
ixs, iys = np.round(H[:, 0]).astype(int), np.round(H[:, 1]).astype(int)
bad_obs = int((edt_obs[iys, ixs] < rho_px * 0.9).sum()); bad_land = int((edt_land[iys, ixs] < rho_px * 0.9).sum())
print('pelanggaran: antar rumah %d, jalan/kotak %d, pantai %d' % (bad_pair, bad_obs, bad_land))
# pagar & carport depan menjorok 4,8 m dari fasad (denah) -> dari pusat rumah ke tepi pagar = HOUSE_D/2 + (4,8 - 1,25) * KH
FENCE_REACH = HOUSE_D / 2 + (4.8 - 1.25) * KH
clear_m = edt_obs[iys, ixs] * K
print('jarak pusat rumah ke tepi jalan/kotak: min %.1f m, p5 %.1f m | jangkauan pagar depan %.1f m | pagar kena jalan: %d rumah' % (
    clear_m.min(), np.percentile(clear_m, 5), FENCE_REACH, int((clear_m < FENCE_REACH).sum())))

# arah hadap: ke titik jalan terdekat (px) -> vektor lokal (y dibalik)
face = []
for (x, y) in H:
    ny_, nx_ = road_idx[0][int(round(y)), int(round(x))], road_idx[1][int(round(y)), int(round(x))]
    vx, vy = (nx_ - x), -(ny_ - y)
    n = math.hypot(vx, vy) or 1.0
    face.append((vx / n, vy / n))

# ------------------------------------------------------------------ penomoran rumah (per pulau, rantai tetangga terdekat)
ISL_CENTERS = [('Pusat Kota', (2027, 1214)), ('Pemukiman', (765, 1662)), ('Olahraga', (1940, 382)), ('Industri', (3024, 625)),
               ('Pelabuhan', (3011, 1920)), ('Wisata', (590, 584)), ('Terlarang', (518, 2378))]
# penentuan pulau lewat poligon
poly_isl = {}
for k, (nm, (cx, cy)) in enumerate(ISL_CENTERS):
    for j, p in enumerate(islands):
        if cv2.pointPolygonTest(p, (float(cx), float(cy)), False) >= 0:
            poly_isl[j] = k
isl_of = []
for (x, y) in H:
    r = -1
    for j, p in enumerate(islands):
        if cv2.pointPolygonTest(p, (float(x), float(y)), False) >= 0 and j in poly_isl:
            r = poly_isl[j]; break
    isl_of.append(r)
isl_of = np.array(isl_of)
print('rumah per pulau', {ISL_CENTERS[k][0]: int((isl_of == k).sum()) for k in range(7)}, 'tanpa pulau', int((isl_of < 0).sum()))
order = []
for k in range(7):
    ids = [i for i in range(len(H)) if isl_of[i] == k]
    if not ids: continue
    cur = min(ids, key=lambda i: H[i][0] + H[i][1]); chain = [cur]; left = set(ids) - {cur}
    while left:
        cur = min(left, key=lambda i: math.hypot(H[i][0] - H[cur][0], H[i][1] - H[cur][1])); chain.append(cur); left.remove(cur)
    order += chain
order += [i for i in range(len(H)) if isl_of[i] < 0]
house_no = {i: n + 1 for n, i in enumerate(order)}

# ------------------------------------------------------------------ pohon
T = sorted(d['trees'], key=lambda t: -t['r'])
htree = cKDTree(H)
tr = []
for t_ in T:
    x, y = t_['x'], t_['y']; ix, iy = int(round(x)), int(round(y))
    if not (0 <= ix < IW and 0 <= iy < IH) or not land[iy, ix] or edt_land[iy, ix] < 3: continue
    if edt_obs[iy, ix] * K < 1.6: continue                    # di jalan / kotak fasilitas
    if htree.query(np.array([x, y]))[0] * K < RHO + 0.8: continue   # di rumah (6,6 m pada KH 0,65)
    R = min(9.0, max(2.2, t_['r'] * K * 0.55))
    tr.append((x, y, R))
print('pohon', len(T), '->', len(tr))

# ------------------------------------------------------------------ billboard jalan-jalan
def pick_billboard(mk_n):
    m = next(m for m in markers if m['n'] == mk_n)
    best = None
    for rad in (40, 55, 70, 90, 120, 160, 220):
        for a in np.linspace(0, 2 * math.pi, 36, endpoint=False):
            x = m['x'] + math.cos(a) * rad / K; y = m['y'] + math.sin(a) * rad / K
            ix, iy = int(x), int(y)
            if not land[iy, ix] or edt_land[iy, ix] * K < 12: continue
            if edt_obs[iy, ix] * K < 6: continue
            if htree.query(np.array([x, y]))[0] * K < 14: continue
            if any(math.hypot(x - tx, y - ty) * K < tR + 3.5 for tx, ty, tR in tr[:0]): continue
            tt = [math.hypot(x - tx, y - ty) * K - 1.0 for tx, ty, tR in tr]
            if tt and min(tt) < 4.0: continue
            best = (x, y); break
        if best: break
    return best
bills = []
for mk_n in (19, 28, 25, 18, 2):
    b = pick_billboard(mk_n)
    if b:
        lx, ly = to_local(*b); bills.append((float(lx), float(ly)))
print('billboard', [(round(x), round(-y)) for x, y in bills])

# ------------------------------------------------------------------ rakit GLB
g = Glb()
def L(P):
    x, y = to_local(P[:, 0], P[:, 1]); return np.stack([x, y], 1)

def ccw_fix(P2, S):
    a, b, c = P2[S[:, 0]], P2[S[:, 1]], P2[S[:, 2]]
    cr = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    S = S.copy(); neg = cr < 0
    S[neg] = S[neg][:, [0, 2, 1]]
    return S[np.abs(cr) > 1e-6]

# daratan
LP2 = L(LP); S = ccw_fix(LP2, ls)
used = np.unique(S); remap = -np.ones(len(LP), int); remap[used] = np.arange(len(used))
pos = np.column_stack([LP2[used], np.full(len(used), LAND_H)])
m_green = g.material('Material_LpmGround', BASE)
mi = g.mesh('TPX_GreenAreas_0', pos, remap[S], m_green, colors=col[used])
green_node = g.node('TPX_GreenAreas_0', mesh=mi)
green_root = g.node('TPX_GreenAreas', children=[green_node])

# tebing tepi: dinding dari tepi daratan (LAND_H) turun ke bawah permukaan air -> batas air/daratan jelas
# (di luar grup TPX_* supaya tidak ikut jadi tanah/tabrakan di mode Jelajahi)
BANK_BOTTOM = -1.0
bank_V, bank_N, bank_C, bank_I = [], [], [], []
C_TOP = np.array([0.92, 0.85, 0.64]); C_BOT = np.array([0.50, 0.43, 0.30])
for ring_ in coast:
    P_ = np.asarray(ring_, float)
    if len(P_) < 4: continue
    Lp_ = L(P_); n_ = len(Lp_)
    tg_ = np.roll(Lp_, -1, axis=0) - np.roll(Lp_, 1, axis=0)
    tg_ /= (np.hypot(tg_[:, 0], tg_[:, 1])[:, None] + 1e-9)
    nm_ = np.stack([tg_[:, 1], -tg_[:, 0]], 1)
    probe = P_ + np.stack([nm_[:, 0], -nm_[:, 1]], 1) * 4.0 / K   # titik di sisi "luar" (arah normal lokal -> px)
    if at(land, probe).mean() > 0.5: nm_ = -nm_
    base = len(bank_V)
    for k_ in range(n_):
        bank_V.append((Lp_[k_, 0], Lp_[k_, 1], LAND_H)); bank_V.append((Lp_[k_, 0], Lp_[k_, 1], BANK_BOTTOM))
        for _ in range(2): bank_N.append((nm_[k_, 0], nm_[k_, 1], 0.0))
        bank_C.append(C_TOP); bank_C.append(C_BOT)
    for k_ in range(n_):
        a_, b_ = base + 2 * k_, base + 2 * ((k_ + 1) % n_)
        bank_I += [a_, a_ + 1, b_ + 1, a_, b_ + 1, b_]
bank_mesh = g.mesh('LpmBanks', np.array(bank_V, np.float32), np.array(bank_I, np.uint32), g.material('Bank_soil', [1.0, 1.0, 1.0]),
                   normals=np.array(bank_N, np.float32), colors=np.array(bank_C, np.float32))
banks_root = g.node('LpmBanks', mesh=bank_mesh)
# air
WP2 = L(WP); S = ccw_fix(WP2, ws_)
used = np.unique(S); remap = -np.ones(len(WP), int); remap[used] = np.arange(len(used))
pos = np.column_stack([WP2[used], np.zeros(len(used))])
mi = g.mesh('TPX_Waterways_0', pos, remap[S], g.material('Material_0x98DCFF', [0.596, 0.863, 1.0]))
water_root = g.node('TPX_Waterways', children=[g.node('TPX_Waterways_0', mesh=mi)])

# jalan
ROAD_Z = LAND_H + 0.02
def ribbon(pts_m, hw, z):
    p = np.asarray(pts_m, float)
    if len(p) < 2: return None
    tg = np.gradient(p, axis=0); n = np.hypot(tg[:, 0], tg[:, 1])[:, None]; n[n == 0] = 1; tg = tg / n
    nm = np.stack([-tg[:, 1], tg[:, 0]], 1)
    Lp = p + nm * hw; Rp = p - nm * hw
    V = np.zeros((2 * len(p), 3), np.float32); V[0::2, :2] = Lp; V[1::2, :2] = Rp; V[:, 2] = z
    I = []
    for i in range(len(p) - 1):
        a, b, c, e = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
        I += [a, b, e, a, e, c]
    return V, np.array(I, np.uint32)

def merge(parts):
    Vs, Is, off = [], [], 0
    for V, I in parts:
        Vs.append(V); Is.append(I + off); off += len(V)
    return np.vstack(Vs), np.concatenate(Is)

ROAD_COL = {'minor': [138 / 255, 146 / 255, 146 / 255], 'main': [104 / 255, 112 / 255, 112 / 255], 'bridge': [112 / 255, 114 / 255, 122 / 255]}
road_children = []
for kind in ('minor', 'main', 'bridge'):
    parts = []
    for r in roads:
        if r['kind'] != kind: continue
        rb = ribbon(L(r['pts']), WIDTH_M[kind] / 2, ROAD_Z)
        if rb: parts.append(rb)
    if parts:
        V, I = merge(parts)
        mi = g.mesh('TPX_RoadsOutlines_' + kind, V, I, g.material('Road_' + kind, ROAD_COL[kind]))
        road_children.append(g.node('TPX_RoadsOutlines_' + kind, mesh=mi))
# garis tengah putus-putus (jalan utama)
dash_parts = []
for r in roads:
    if r['kind'] != 'main': continue
    pm = L(r['pts']); seg = np.hypot(*np.diff(pm, axis=0).T); cum = np.concatenate([[0], np.cumsum(seg)])
    s = 1.0
    while s + 3.0 < cum[-1]:
        ts = np.linspace(s, s + 3.0, 4)
        pp = np.stack([np.interp(ts, cum, pm[:, 0]), np.interp(ts, cum, pm[:, 1])], 1)
        rb = ribbon(pp, 0.12, ROAD_Z + 0.012)
        if rb: dash_parts.append(rb)
        s += 6.0
if dash_parts:
    V, I = merge(dash_parts)
    mi = g.mesh('TPX_RoadsOutlines_Center', V, I, g.material('Road_dash', [232 / 255, 200 / 255, 80 / 255]))
    road_children.append(g.node('TPX_RoadsOutlines_Center', mesh=mi, extras={'noCollide': True}))
# ---- trotoar: SATU area utuh di sekeliling jaringan jalan (bukan potongan per ruas), supaya persimpangan mulus.
# Cara: rasterisasi halus (RES m/piksel) -> trotoar = pelebaran(jalan) - badan jalan -> haluskan -> kontur ->
# segitiga. Sudut persimpangan otomatis membulat; trotoar yang menabrak jalan lain terpotong rapi di tepi jalan itu.
# Penampang: bagian atas datar naik CURB_H dari aspal, tepi miring 12 cm (kaki) ke aspal / rumput. Gelap abu-abu.
sw_tris = 0
if SIDEWALK_W > 0:
    RES, CURB_H, SW_FOOT = 0.25, 0.12, 0.12
    SW_TOP, SW_EDGE = [0.31, 0.32, 0.34], [0.23, 0.24, 0.26]        # abu-abu gelap (aspal: 0,41-0,57)
    MAX_EDGE = float(os.environ.get("SWE", "10"))                    # jarak maks titik kontur (m)
    SW_EPS = float(os.environ.get("SWP", "0.7"))                     # toleransi penyederhanaan kontur (piksel halus = 0,25 m)
    SW_SMOOTH = int(os.environ.get("SWS", "9"))                      # jendela penghalus kontur (titik)
    z_sw = ROAD_Z + CURB_H
    Wf, Hf = int(WM / RES) + 2, int(HM / RES) + 2

    def fine_px(P):     # meter lokal -> piksel halus (float)
        return np.stack([P[:, 0] / RES, (HM - P[:, 1]) / RES], 1)

    def draw_roads(widths_minus):
        im = np.zeros((Hf, Wf), np.uint8)
        for r in roads:
            t = max(1, int(round(WIDTH_M[r['kind']] / RES)) - widths_minus)
            cv2.polylines(im, [np.round(fine_px(L(r['pts'])) * 16).astype(np.int32)], False, 1, t, cv2.LINE_8, shift=4)
        return im

    def warp_base(mask_u8, interp):   # topeng piksel peta dasar -> grid halus
        s = RES / K
        return cv2.warpAffine(mask_u8, np.array([[s, 0, rx0], [0, s, ry0]], np.float64), (Wf, Hf),
                              flags=interp | cv2.WARP_INVERSE_MAP, borderValue=0)

    def kern(r_m):
        r = max(1, int(round(r_m / RES))); return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

    R_true = draw_roads(0)                      # badan jalan sebenarnya
    R_nar = draw_roads(3)                       # dipersempit ~37 cm per sisi: tepi dalam trotoar menimpa ~25 cm aspal (kontur piksel menyusut 12 cm), tidak ada celah
    S = cv2.dilate(R_true, kern(SIDEWALK_W + 0.125)) & (1 - R_nar)   # +12 cm: kontur piksel menyusut setengah piksel di tepi luar
    land_f = warp_base((land.astype(np.float32) * 255), cv2.INTER_LINEAR) > 127
    S &= cv2.erode(land_f.astype(np.uint8), kern(1.0))                  # jangan di air / dekat pantai
    fac_f = cv2.dilate((warp_base((fac_mask > 0).astype(np.uint8) * 255, cv2.INTER_NEAREST) > 0).astype(np.uint8), kern(0.5))
    S &= (1 - fac_f).astype(np.uint8)
    del land_f, fac_f
    S = (cv2.GaussianBlur(S * 255, (0, 0), 1.3) > 127).astype(np.uint8)  # haluskan gerigi piksel
    Sd = cv2.dilate(S, np.ones((3, 3), np.uint8)) > 0                    # toleransi uji "di dalam"
    S_b = S > 0
    Rt_b = R_true > 0

    def sample(mask, P):
        q = np.round(fine_px(P)).astype(int)
        ok = (q[:, 0] >= 0) & (q[:, 0] < Wf) & (q[:, 1] >= 0) & (q[:, 1] < Hf)
        out = np.zeros(len(P), bool); out[ok] = mask[q[ok, 1], q[ok, 0]]
        return out

    cnts, hier = cv2.findContours(S, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    T_pts, T_ring, B_pts, B_z, rings = [], [], [], [], []
    nT = 0
    for ci_, c in enumerate(cnts):
        is_out = bool(hier[0][ci_][3] == -1)
        c = c[:, 0, :].astype(np.float64)
        if len(c) < 8: continue
        if len(c) > SW_SMOOTH: c = ndi.uniform_filter1d(c, size=SW_SMOOTH, axis=0, mode='wrap')   # buang gerigi piksel
        ap = cv2.approxPolyDP(c.astype(np.float32), SW_EPS, True)[:, 0, :].astype(np.float64)
        if len(ap) < 3: continue
        P = np.stack([ap[:, 0] * RES, HM - ap[:, 1] * RES], 1)           # -> meter lokal
        if abs(0.5 * np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1])) < 3.0: continue
        pts = []                                                          # titik tambahan di sisi panjang
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            n_ = max(1, int(math.ceil(math.hypot(*(b - a)) / MAX_EDGE)))
            for k_ in range(n_): pts.append(a + (b - a) * k_ / n_)
        P = np.array(pts); n = len(P)
        e = np.roll(P, -1, axis=0) - P; el = np.hypot(e[:, 0], e[:, 1]); el[el == 0] = 1e-9
        t = e / el[:, None]; ln = np.stack([-t[:, 1], t[:, 0]], 1)        # normal kiri tiap sisi
        vn = ln + np.roll(ln, 1, axis=0); vl = np.hypot(vn[:, 0], vn[:, 1]); vl[vl == 0] = 1e-9; vn = vn / vl[:, None]
        miter = 1.0 / np.clip((vn * ln).sum(1), 0.5, 1.0)
        s = 1.0 if sample(S_b, P + ln * 0.35).mean() > 0.5 else -1.0     # arah ke dalam trotoar
        inward = s * vn * miter[:, None]
        T = P + inward * SW_FOOT
        out_q = P - s * vn * 0.4
        bz = np.where(sample(Rt_b, out_q), ROAD_Z + 0.002, LAND_H)       # sisi jalan: dasar = aspal; sisi rumput: tanah
        T_pts.append(T); B_pts.append(P); B_z.append(bz)
        rings.append((nT, n, s, is_out)); nT += n
    TP = np.vstack(T_pts); BP = np.vstack(B_pts); BZ = np.concatenate(B_z)
    nTot = len(TP)

    # permukaan atas: Delaunay yang dipaksa memuat SEMUA sisi kontur. Sisi yang belum ada dibelah di tengah (titik baru
    # persis di garis kontur) sampai semuanya ada; lalu segitiga di dalam area dipilih eksak dengan menjalar dari luar dan
    # membalik status tiap melewati sisi kontur (tanpa tebak-tebakan titik tengah).
    ring_segs = []
    for (o, n, _s, _o) in rings:
        idx = np.arange(o, o + n); ring_segs.append(np.stack([idx, np.roll(idx, -1)], 1))
    segs = np.vstack(ring_segs).astype(np.int64)
    pts = TP.copy()
    ext = 200.0
    bbox = np.array([[-ext, -ext], [WM + ext, -ext], [WM + ext, HM + ext], [-ext, HM + ext]])
    for it in range(20):
        allp = np.vstack([pts, bbox]); Mn = len(allp)
        dl = Delaunay(allp); sim = dl.simplices.astype(np.int64)
        ed = np.concatenate([sim[:, [0, 1]], sim[:, [1, 2]], sim[:, [2, 0]]]); ed.sort(axis=1)
        have = np.unique(ed[:, 0] * Mn + ed[:, 1])
        skey = np.minimum(segs[:, 0], segs[:, 1]) * Mn + np.maximum(segs[:, 0], segs[:, 1])
        seglen = np.hypot(*(pts[segs[:, 0]] - pts[segs[:, 1]]).T)
        miss = ~np.isin(skey, have) & (seglen > 0.2)
        if not miss.any(): break
        mid = (pts[segs[miss, 0]] + pts[segs[miss, 1]]) / 2
        new_i = len(pts) + np.arange(len(mid)); pts = np.vstack([pts, mid])
        a_, b_ = segs[miss, 0], segs[miss, 1]
        segs = np.vstack([segs[~miss], np.stack([a_, new_i], 1), np.stack([new_i, b_], 1)])
    n_pts = len(pts)
    skey = np.minimum(segs[:, 0], segs[:, 1]) * Mn + np.maximum(segs[:, 0], segs[:, 1])
    nb = dl.neighbors
    ntri = len(sim)
    is_con = np.zeros((ntri, 3), bool)
    for k in range(3):
        u, v = sim[:, (k + 1) % 3], sim[:, (k + 2) % 3]
        is_con[:, k] = np.isin(np.minimum(u, v) * Mn + np.maximum(u, v), skey)
    state = np.full(ntri, -1, np.int8)
    start = int(np.where((sim >= n_pts).any(axis=1))[0][0])
    state[start] = 0
    stack = [start]
    nb_l, con_l = nb.tolist(), is_con.tolist()
    while stack:
        t = stack.pop(); st = state[t]
        for k in range(3):
            m_ = nb_l[t][k]
            if m_ >= 0 and state[m_] < 0:
                state[m_] = st ^ int(con_l[t][k]); stack.append(m_)
    # segitiga yang menyentuh titik kotak pembatas pasti di luar (status dari penjalaran bisa salah di sana -> paksa 0)
    inside = (state == 1) & ~(sim >= n_pts).any(axis=1)
    tri = sim[inside]
    A, B_, C_ = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    cr = (B_[:, 0] - A[:, 0]) * (C_[:, 1] - A[:, 1]) - (B_[:, 1] - A[:, 1]) * (C_[:, 0] - A[:, 0])
    tri[cr < 0] = tri[cr < 0][:, [0, 2, 1]]
    tri = tri[np.abs(cr) > 1e-7]
    tri_area = float(np.abs(cr).sum() / 2)
    poly_area = 0.0
    for (o, n, _s, is_o) in rings:
        Q = TP[o:o + n]
        ar = abs(0.5 * np.sum(Q[:, 0] * np.roll(Q[:, 1], -1) - np.roll(Q[:, 0], -1) * Q[:, 1]))
        poly_area += ar if is_o else -ar
    TPd = pts          # titik atas lengkap (titik kontur dulu, lalu titik tambahan di garis kontur)
    nTd = len(TPd)

    # tepi miring (skirt): dari kontur luar (dasar) ke kontur dalam (atas), satu-satu per titik
    sk = []
    for (o, n, s, _o) in rings:
        for i in range(n):
            j = (i + 1) % n
            b0, b1, t0, t1 = nTd + o + i, nTd + o + j, o + i, o + j
            # menghadap keluar dari trotoar: uji arah normal segitiga (b0,b1,t1) terhadap arah keluar
            pb0, pb1 = BP[o + i], BP[o + j]
            out_xy = -s * np.array([-(pb1 - pb0)[1], (pb1 - pb0)[0]])
            n3 = np.cross(np.array([*(pb1 - pb0), BZ[o + j] - BZ[o + i]]), np.array([*(TP[o + j] - pb0), z_sw - BZ[o + i]]))
            if n3[0] * out_xy[0] + n3[1] * out_xy[1] < 0:
                sk += [(b0, t1, b1), (b0, t0, t1)]
            else:
                sk += [(b0, b1, t1), (b0, t1, t0)]
    I = np.concatenate([tri.reshape(-1), np.array(sk, np.int64).reshape(-1)]).astype(np.uint32)
    V = np.zeros((nTd + nTot, 3), np.float32)
    V[:nTd, :2] = TPd; V[:nTd, 2] = z_sw
    V[nTd:, :2] = BP; V[nTd:, 2] = BZ
    COL = np.zeros((nTd + nTot, 3), np.float32); COL[:nTd] = SW_TOP; COL[nTd:] = SW_EDGE
    sw_tris = len(I) // 3
    mi = g.mesh('TPX_RoadsOutlines_sidewalk', V, I, g.material('Road_sidewalk', [1.0, 1.0, 1.0]), colors=COL)
    road_children.append(g.node('TPX_RoadsOutlines_sidewalk', mesh=mi))

    # ---- cek kualitas: luas permukaan atas harus sama dengan luas poligon kontur (selisih ~0 = tanpa lubang/luapan)
    print('trotoar: %d segitiga (%d atas, %d tepi), %d titik, %d kontur | luas atas %.0f m2 vs poligon %.0f m2 (selisih %.3f%%)' % (
        sw_tris, len(tri), len(sk), len(V), len(rings), tri_area, poly_area, 100.0 * abs(tri_area - poly_area) / max(1.0, poly_area)))
    del R_true, R_nar, S, Sd, S_b, Rt_b
roads_root = g.node('TPX_RoadsOutlines', children=road_children)

# pagar & tiang jembatan (dekor: di luar grup TPX_* jadi tidak ikut tabrakan/jalan)
def wall_strip(p, off, z0, z1):
    tg = np.gradient(p, axis=0); n = np.hypot(tg[:, 0], tg[:, 1])[:, None]; n[n == 0] = 1; tg = tg / n
    nm = np.stack([-tg[:, 1], tg[:, 0]], 1); q = p + nm * off
    V = np.zeros((2 * len(q), 3), np.float32); V[0::2, :2] = q; V[1::2, :2] = q; V[0::2, 2] = z0; V[1::2, 2] = z1
    I = []
    for i in range(len(q) - 1):
        a, b, c, e = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
        I += [a, b, e, a, e, c]
    return V, np.array(I, np.uint32)

def box_tris(cx, cy, hx, hy, z0, z1, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    c = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
    V = []
    for zz in (z0, z1):
        for dx, dy in c: V.append((cx + dx * ca - dy * sa, cy + dx * sa + dy * ca, zz))
    I = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 4, 5, 6, 4, 6, 7]
    return np.array(V, np.float32), np.array(I, np.uint32)

# lintasan berdek: 8 jembatan antar-pulau + ruas jalan biasa yang melintasi sungai/kanal/danau
deck_lines = [(nm, pl, WIDTH_M['bridge'] / 2) for nm, pl in bridge_lines]
n_cross = 0
for r in roads:
    if r['kind'] == 'bridge': continue
    pt = np.asarray(r['pts']); wet = ~at(land, pt)
    i = 0
    while i < len(pt):
        if not wet[i]: i += 1; continue
        j = i
        while j + 1 < len(pt) and wet[j + 1]: j += 1
        if j - i + 1 >= 2:   # >= ~2 titik (10 px) di atas air
            lo, hi = max(0, i - 2), min(len(pt) - 1, j + 2)
            deck_lines.append(('Seberang-%d' % n_cross, pt[lo:hi + 1], WIDTH_M[r['kind']] / 2)); n_cross += 1
        i = j + 1
print('jalan menyeberangi air (bukan jembatan antar-pulau):', n_cross)

rail_parts, post_parts, pier_parts = [], [], []
for name, pl, HW in deck_lines:
    pm = L(pl)
    if len(pm) < 2: continue
    for sgn in (-1, 1):
        rail_parts.append(wall_strip(pm, sgn * (HW - 0.15), ROAD_Z, ROAD_Z + 1.1))
    seg = np.hypot(*np.diff(pm, axis=0).T); cum = np.concatenate([[0], np.cumsum(seg)])
    s_ = 0.0
    while s_ < cum[-1]:
        x = float(np.interp(s_, cum, pm[:, 0])); y = float(np.interp(s_, cum, pm[:, 1]))
        x2 = float(np.interp(min(s_ + 1, cum[-1]), cum, pm[:, 0])); y2 = float(np.interp(min(s_ + 1, cum[-1]), cum, pm[:, 1]))
        ang = math.atan2(y2 - y, x2 - x) if (x2 != x or y2 != y) else 0.0
        for sgn in (-1, 1):
            ox, oy = -math.sin(ang) * sgn * (HW - 0.15), math.cos(ang) * sgn * (HW - 0.15)
            post_parts.append(box_tris(x + ox, y + oy, 0.18, 0.18, ROAD_Z, ROAD_Z + 1.3, ang))
        if name in dict(bridge_lines) and (int(s_ / 24.0) != int((s_ + 6.0) / 24.0) or s_ == 0.0):
            pier_parts.append(box_tris(x, y, 0.9, HW - 0.8, -1.0, ROAD_Z - 0.05, ang))
        s_ += 6.0
bridge_children = []
if rail_parts:
    V, I = merge(rail_parts)
    bridge_children.append(g.node('LpmBridgeRails', mesh=g.mesh('LpmBridgeRails', V, I, g.material('Bridge_rail', [0.86, 0.86, 0.88]))))
if post_parts:
    V, I = merge(post_parts)
    bridge_children.append(g.node('LpmBridgePosts', mesh=g.mesh('LpmBridgePosts', V, I, g.material('Bridge_post', [0.55, 0.56, 0.60]))))
if pier_parts:
    V, I = merge(pier_parts)
    bridge_children.append(g.node('LpmBridgePiers', mesh=g.mesh('LpmBridgePiers', V, I, g.material('Bridge_pier', [0.45, 0.46, 0.50]))))
bridges_root = g.node('LpmBridges', children=bridge_children, extras={'count': len(bridge_lines), 'crossings': n_cross})

# pohon (batang 6 sisi ber-flat shading = 24 verts; tajuk ikosfer 240 verts; lihat TRUNK_MAX_VERTS di TownWalk.jsx)
def flat_mesh(tris):
    tris = np.asarray(tris, np.float32).reshape(-1, 3, 3)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]); n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
    return tris.reshape(-1, 3), np.repeat(n, 3, axis=0), np.arange(len(tris) * 3, dtype=np.uint32)

def trunk_tris():
    out = []; z0, z1, r0, r1 = -1.0, 7.0, 0.5, 0.35
    for i in range(6):
        a0, a1 = 2 * math.pi * i / 6, 2 * math.pi * (i + 1) / 6
        p0 = (r0 * math.cos(a0), r0 * math.sin(a0), z0); p1 = (r0 * math.cos(a1), r0 * math.sin(a1), z0)
        q0 = (r1 * math.cos(a0), r1 * math.sin(a0), z1); q1 = (r1 * math.cos(a1), r1 * math.sin(a1), z1)
        out += [[p0, p1, q1], [p0, q1, q0]]
    return out

def icosphere(R, cz):
    t = (1 + 5 ** 0.5) / 2
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    v = [np.array(x) / np.linalg.norm(x) for x in v]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    out = []
    for a, b, c in f:
        out.append([v[a], v[b], v[c]])
    res = []
    # 1 kali subdivisi sudah > 40 verts; pakai ikosahedron murni (60 verts) cukup untuk tajuk lowpoly
    for tri_ in out:
        res.append([tuple(R * p * np.array([1, 1, 0.85]) + np.array([0, 0, cz])) for p in tri_])
    return res

tv, tn, ti = flat_mesh(trunk_tris())
trunk_mesh = g.mesh('tree_trunk', tv, ti, g.material('Material_0x6F4B3C', [0.435, 0.294, 0.235]), normals=tn)
cv_, cn_, ci_ = flat_mesh(icosphere(5.0, 9.0))
crown_cols = [[120 / 255, 184 / 255, 104 / 255], [104 / 255, 176 / 255, 96 / 255], [88 / 255, 168 / 255, 88 / 255]]
crown_meshes = [g.mesh('tree_crown_%d' % k, cv_, ci_, g.material('Crown_%d' % k, c), normals=cn_) for k, c in enumerate(crown_cols)]
tree_nodes = []
for i, (x, y, R) in enumerate(tr):
    lx, ly = to_local(x, y); s = R / 5.0
    tn_ = g.node('trunk', mesh=trunk_mesh); cn = g.node('crown', mesh=crown_meshes[0 if R < 3.6 else (1 if R < 5.8 else 2)])
    tree_nodes.append(g.node('TPX_Trees_tree_%d' % i, t=[lx, ly, s - 1.0 + LAND_H], s=[s, s, s], children=[tn_, cn]))
trees_root = g.node('TPX_Trees', children=tree_nodes)

# bangunan: rumah warga (penampung -> diganti Rumah LPM oleh lpmHouses.js) + kotak fasilitas
def box_tris(w, dd, h):
    x0, x1, y0, y1, z0, z1 = -w / 2, w / 2, -dd / 2, dd / 2, 0.0, h
    P = lambda x, y, z: (x, y, z)
    q = [  # tiap sisi 2 segitiga, CCW dari luar
        [P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)],  # bawah
        [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],  # atas
        [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],  # depan (-y)
        [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],  # kanan
        [P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)],  # belakang
        [P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)],  # kiri
    ]
    out = []
    for a, b, c, e in q: out += [[a, b, c], [a, c, e]]
    return out

def quat_z(phi): return [0.0, 0.0, math.sin(phi / 2), math.cos(phi / 2)]

hv, hn, hi_ = flat_mesh(box_tris(12.0, 10.0, 7.0))
house_mesh = g.mesh('house_placeholder', hv, hi_, g.material('House_placeholder', [0.78, 0.62, 0.45]), normals=hn)
b_children = []
house_records = []
for i in range(len(H)):
    lx, ly = to_local(H[i][0], H[i][1]); fx, fy = face[i]
    phi = math.atan2(-fx, fy)
    n = house_no[i]
    b_children.append(g.node('TPX_Buildings_%d' % n, mesh=house_mesh, t=[lx, ly, LAND_H], r=quat_z(phi),
                             extras={'house': n}))
    house_records.append({'n': n, 'x': float(lx), 'y': float(ly), 'phi': phi, 'color': hcol[i], 'island': ISL_CENTERS[isl_of[i]][0] if isl_of[i] >= 0 else None})
FAC_COL = {'teal': [0.15, 0.55, 0.52], 'purple': [0.49, 0.25, 0.64], 'red': [0.80, 0.20, 0.18], 'brown': [0.55, 0.35, 0.20],
           'orange': [0.72, 0.45, 0.10], 'blue': [0.18, 0.43, 0.75]}
fac_records = []
for b in sorted(placed_boxes, key=lambda b: b['n']):
    lx, ly = to_local(b['cx'], b['cy'])
    # kotak digambar di px (y ke bawah): sudut px -> sudut lokal (y ke atas) = -ang
    side = b['side']; h = FAC_H[b['big']]
    fv, fn_, fi_ = flat_mesh(box_tris(side, side, h))
    fm = g.mesh('facility_%d' % b['n'], fv, fi_, g.material('Facility_' + b['c'], FAC_COL[b['c']]), normals=fn_)
    b_children.append(g.node('TPX_Buildings_F%d' % b['n'], mesh=fm, t=[lx, ly, LAND_H], r=quat_z(-b['ang']),
                             extras={'facility': b['n'], 'kind': b['c'], 'big': bool(b['big'])}))
    mx, my = to_local(b['x'], b['y'])
    fac_records.append({'n': b['n'], 'x': float(lx), 'y': float(ly), 'side': side, 'h': h, 'kind': b['c'], 'big': bool(b['big']),
                        'marker_x': float(mx), 'marker_y': float(my)})
buildings_root = g.node('TPX_Buildings', children=b_children)
flag = g.node('LpmFixedLayout', extras={'version': 1, 'width': WM, 'height': HM, 'houseScale': KH})
for n_ in (buildings_root, roads_root, bridges_root, banks_root, water_root, trees_root, green_root, flag): g.root(n_)
size = g.write(OUT + 'lpm_new.glb')
print('GLB %.2f MB' % (size / 1e6), 'node', len(g.nodes))
json.dump({'width': WM, 'height': HM, 'houses': house_records, 'facilities': fac_records,
           'billboards': [{'x': x, 'z': -y} for x, y in bills], 'houseScale': KH,
           'bridges': [{'name': n_, 'pts': L(p_).round(2).tolist()} for n_, p_ in bridge_lines],
           'trees': len(tr), 'k_m_per_px': K}, open(OUT + 'lpm_layout_world.json', 'w'))

# ------------------------------------------------------------------ gambar debug (atas-ke-bawah)
S = 0.33
ov = np.zeros((int(IH * S), int(IW * S), 3), np.uint8); ov[:] = (224, 192, 136)  # BGR laut
def px2(p): return np.round(np.asarray(p) * S).astype(np.int32)
for s in ws_: pass
for s in ls: cv2.fillConvexPoly(ov, px2(LP[s]), (176, 224, 200))
for r in roads:
    c = {'minor': (146, 146, 138), 'main': (112, 112, 104), 'bridge': (122, 114, 112)}[r['kind']]
    cv2.polylines(ov, [px2(r['pts'])], False, c, max(1, int(WIDTH_M[r['kind']] / K * S)))
for (x, y, R) in tr:
    cv2.circle(ov, tuple(px2([x, y])), max(1, int(R / K * S * 0.9)), (88, 150, 88), -1)
for i in range(len(H)):
    fx, fy = face[i]; ang = math.atan2(-fy, fx) + 0  # px (y bawah)
    poly = box_poly(H[i][0], H[i][1], 1.0, 0)
    w, dd_ = HOUSE_W / K, HOUSE_D / K
    ca, sa = math.cos(math.atan2(-fy, fx) - math.pi / 2), math.sin(math.atan2(-fy, fx) - math.pi / 2)
    pts = [(H[i][0] + ca * x - sa * y, H[i][1] + sa * x + ca * y) for x, y in [(-w / 2, -dd_ / 2), (w / 2, -dd_ / 2), (w / 2, dd_ / 2), (-w / 2, dd_ / 2)]]
    cv2.fillPoly(ov, [px2(pts)], (60, 90, 200))
    fxp = H[i] + np.array([fx, -fy]) * dd_ / 2
    cv2.line(ov, tuple(px2(H[i])), tuple(px2(fxp)), (0, 255, 255), 1)
for b in placed_boxes:
    cv2.fillPoly(ov, [px2(b['poly'])], (200, 80, 160))
    cv2.putText(ov, str(b['n']), tuple(px2([b['cx'] - 10, b['cy'] + 8])), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
for x, y in bills:
    px_, py_ = to_px(x, y); cv2.circle(ov, tuple(px2([px_, py_])), 6, (0, 0, 255), -1)
cv2.imwrite(OUT + 'debug_layout.png', ov)
print('selesai')
