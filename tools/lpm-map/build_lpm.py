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
PAD = 60.0                       # tepi laut di sekeliling pulau (m)
rng = np.random.default_rng(7)

# ------------------------------------------------------------------ topeng daratan
islands = [np.array(p, np.float32) for p in d['islands']]
lakes = [np.array(p, np.float32) for p in d['lakes'] if cv2.contourArea(np.array(p, np.float32)) > 4000]
land_u8 = np.zeros((IH, IW), np.uint8)
for p in islands: cv2.fillPoly(land_u8, [np.round(p).astype(np.int32)], 1)
for p in lakes: cv2.fillPoly(land_u8, [np.round(p).astype(np.int32)], 0)
land = land_u8.astype(bool)
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
GREEN = np.array([200, 224, 176]) / 255.0
BASE = np.array([237, 237, 184]) / 255.0
ring = contour_pts(ero(land, 22), 20.0)
ring_pts = np.vstack(ring) if ring else np.zeros((0, 2))
gx, gy = np.meshgrid(np.arange(int(rx0), int(rx1), 40), np.arange(int(ry0), int(ry1), 40))
grid = np.stack([gx.ravel(), gy.ravel()], 1).astype(float)
grid = grid[edt_land[grid[:, 1].astype(int), grid[:, 0].astype(int)] > 34]
LP = np.vstack([coast_pts, ring_pts, grid])
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
WP = np.vstack([coast_pts, edge, sg, lg])
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
WIDTH_M = {'minor': 4.0, 'main': 6.0, 'bridge': 8.0}
print('jalan', {k: sum(1 for r in roads if r['kind'] == k) for k in WIDTH_M})

road_mask = np.zeros((IH, IW), np.uint8)
road_only = np.zeros((IH, IW), np.uint8)
for r in roads:
    th = max(2, int(round(WIDTH_M[r['kind']] / K)))
    cv2.polylines(road_only, [np.round(r['pts']).astype(np.int32)], False, 1, th)
road_mask = road_only.copy()

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

obs = (road_only > 0) | (fac_mask > 0)
edt_obs = cv2.distanceTransform((~obs).astype(np.uint8), cv2.DIST_L2, 5)

# ------------------------------------------------------------------ rumah warga (titik kecil)
KH = 0.65                                   # skala rumah (lihat lpmHouses.js)
HOUSE_W, HOUSE_D = 12.9 * KH, (10 + 1.2 + 0.9) * KH
RHO = 5.8                                   # jari-jari lingkaran pengaman rumah (m): > setengah diagonal tapak (5,8 m)
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
    if moved / len(H) < 0.02: break
print('relaksasi selesai iterasi', it, 'rata-rata geser terakhir %.3f px' % (moved / len(H)))
tree = cKDTree(H); dd, _ = tree.query(H, k=2)
bad_pair = int((dd[:, 1] < 2 * rho_px * 0.92).sum())
ixs, iys = np.round(H[:, 0]).astype(int), np.round(H[:, 1]).astype(int)
bad_obs = int((edt_obs[iys, ixs] < rho_px * 0.9).sum()); bad_land = int((edt_land[iys, ixs] < rho_px * 0.9).sum())
print('pelanggaran: antar rumah %d, jalan/kotak %d, pantai %d' % (bad_pair, bad_obs, bad_land))

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
    if htree.query(np.array([x, y]))[0] * K < 6.6: continue   # di rumah
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
pos = np.column_stack([LP2[used], np.zeros(len(used))])
m_green = g.material('Material_LpmGround', BASE)
mi = g.mesh('TPX_GreenAreas_0', pos, remap[S], m_green, colors=col[used])
green_node = g.node('TPX_GreenAreas_0', mesh=mi)
green_root = g.node('TPX_GreenAreas', children=[green_node])
# air
WP2 = L(WP); S = ccw_fix(WP2, ws_)
used = np.unique(S); remap = -np.ones(len(WP), int); remap[used] = np.arange(len(used))
pos = np.column_stack([WP2[used], np.zeros(len(used))])
mi = g.mesh('TPX_Waterways_0', pos, remap[S], g.material('Material_0x98DCFF', [0.596, 0.863, 1.0]))
water_root = g.node('TPX_Waterways', children=[g.node('TPX_Waterways_0', mesh=mi)])

# jalan
ROAD_Z = 0.02
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
roads_root = g.node('TPX_RoadsOutlines', children=road_children)

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
    tree_nodes.append(g.node('TPX_Trees_tree_%d' % i, t=[lx, ly, s - 1.0], s=[s, s, s], children=[tn_, cn]))
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
    b_children.append(g.node('TPX_Buildings_%d' % n, mesh=house_mesh, t=[lx, ly, 0.0], r=quat_z(phi),
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
    b_children.append(g.node('TPX_Buildings_F%d' % b['n'], mesh=fm, t=[lx, ly, 0.0], r=quat_z(-b['ang']),
                             extras={'facility': b['n'], 'kind': b['c'], 'big': bool(b['big'])}))
    mx, my = to_local(b['x'], b['y'])
    fac_records.append({'n': b['n'], 'x': float(lx), 'y': float(ly), 'side': side, 'h': h, 'kind': b['c'], 'big': bool(b['big']),
                        'marker_x': float(mx), 'marker_y': float(my)})
buildings_root = g.node('TPX_Buildings', children=b_children)
flag = g.node('LpmFixedLayout', extras={'version': 1, 'width': WM, 'height': HM, 'houseScale': KH})
for n_ in (buildings_root, roads_root, water_root, trees_root, green_root, flag): g.root(n_)
size = g.write(OUT + 'lpm_new.glb')
print('GLB %.2f MB' % (size / 1e6), 'node', len(g.nodes))
json.dump({'width': WM, 'height': HM, 'houses': house_records, 'facilities': fac_records,
           'billboards': [{'x': x, 'z': -y} for x, y in bills], 'houseScale': KH,
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
