import numpy as np, json
from PIL import Image
import cv2
from scipy import ndimage as ndi
from skimage import morphology

import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
SRC = HERE + 'reference-map.png'
OUT = HERE + 'out/'; os.makedirs(OUT, exist_ok=True)
X0, Y0, PXKM = 111.0, 99.0, 281.4   # kalibrasi grid: px penuh -> km

rgb = np.array(Image.open(SRC).convert('RGB'))
im = rgb.astype(np.int16)
H, W, _ = im.shape
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mx = im.max(axis=2); mn = im.min(axis=2)

def ell(rad): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rad + 1, 2 * rad + 1))
def mopen(m, rad): return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, ell(rad)) > 0
def mclose(m, rad): return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, ell(rad)) > 0
def mdil(m, rad): return cv2.dilate(m.astype(np.uint8), ell(rad)) > 0

def comps(m, min_area=0):
    n, lab, st, cen = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    out = []
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= min_area:
            out.append((i, st[i], cen[i]))
    return n, lab, out

# ---------------------------------------------------------------- marker (warna) -- dibutuhkan lebih awal
mk = {
    'teal':   (g > 120) & (b > 110) & (r < 70) & (abs(g - b) < 45),
    'purple': (r > 90) & (r < 150) & (g < 90) & (b > 130),
    'red':    (r > 180) & (g < 70) & (b < 70),
    'brown':  (r > 110) & (r < 160) & (g > 60) & (g < 110) & (b < 70),
    'orange': (r > 160) & (r < 215) & (g > 90) & (g < 140) & (b < 50),
    'blue':   (r < 70) & (g > 90) & (g < 140) & (b > 160),
}
mk_clean = {k: mclose(mopen(v, 3), 6) for k, v in mk.items()}
markerzone = mdil(np.any(list(mk_clean.values()), axis=0), 30)

# ---------------------------------------------------------------- daratan
water = (b - r) >= 40
water[2625:, :] = True      # panel skala
water[:70, :] = True        # label sumbu
# teks putih (label pulau / grid putus-putus) di atas air -> anggap air
nearwhite = mn >= 226
tw = (nearwhite & mdil(water, 16))
tw = (tw | mdil(tw, 3)) & ~markerzone
water = water | tw
land_raw = ~water
land = mopen(land_raw, 7)
_, lab, cl = comps(land, 30000)
land = np.isin(lab, [c[0] for c in cl])
land = mclose(land, 5)

# pisahkan jembatan (pita tipis) dari pulau
core = mopen(land, 20)
isl = mdil(core, 20) & land
isl = mopen(isl, 3)
_, lab, cl = comps(isl, 30000)
isl = np.isin(lab, [c[0] for c in cl])
bridgeish = land & ~mdil(isl, 2)

# danau = lubang di dalam pulau
filled = ndi.binary_fill_holes(isl)
lakes = filled & ~isl
_, lab_l, cl_l = comps(lakes, 3000)
lakes = np.isin(lab_l, [c[0] for c in cl_l])

def contours(mask, eps=1.6, min_area=0):
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    res = []
    for c in cs:
        if cv2.contourArea(c) < min_area: continue
        a = cv2.approxPolyDP(c, eps, True)[:, 0, :]
        res.append(a.astype(float).tolist())
    return res

islands = contours(isl, 1.6, 30000)
lake_polys = contours(lakes, 1.4, 3000)
print('islands', len(islands), 'lakes', len(lake_polys))

# ---------------------------------------------------------------- jalan
gray = ((mx - mn) <= 30) & (r >= 85) & (r <= 170) & ~((g - r) > 14)
gray = mopen(gray, 2)
roadmask = mclose(gray, 3)
_, lab, cl = comps(roadmask, 400)
roadmask = np.isin(lab, [c[0] for c in cl])
dist = cv2.distanceTransform(roadmask.astype(np.uint8), cv2.DIST_L2, 5)
skel = morphology.skeletonize(roadmask)
nb = cv2.filter2D(skel.astype(np.uint8), -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT) - skel.astype(np.uint8)
junc = skel & (nb >= 3)
junc_d = mdil(junc, 3)
nj, labj, stj, cenj = cv2.connectedComponentsWithStats(junc_d.astype(np.uint8), connectivity=8)
junctions = [(float(cenj[i][0]), float(cenj[i][1])) for i in range(1, nj)]
segs_mask = skel & ~junc_d
ns, labs, sts, _ = cv2.connectedComponentsWithStats(segs_mask.astype(np.uint8), connectivity=8)

def order_pixels(ys, xs):
    pts = set(zip(ys.tolist(), xs.tolist()))
    def nbrs(p):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    q = (p[0] + dy, p[1] + dx)
                    if q in pts: yield q
    ends = [p for p in pts if sum(1 for _ in nbrs(p)) == 1]
    start = ends[0] if ends else next(iter(pts))
    seen = {start}; path = [start]; cur = start
    while True:
        nxt = [q for q in nbrs(cur) if q not in seen]
        if not nxt: break
        # prefer 4-neighbour
        nxt.sort(key=lambda q: abs(q[0] - cur[0]) + abs(q[1] - cur[1]))
        cur = nxt[0]; seen.add(cur); path.append(cur)
    return path

roads = []
for i in range(1, ns):
    if sts[i, cv2.CC_STAT_AREA] < 8: continue
    ys, xs = np.where(labs == i)
    path = order_pixels(ys, xs)
    pl = np.array([[p[1], p[0]] for p in path], dtype=np.float32)
    # sambungkan ujung ke pusat persimpangan terdekat
    for end in (0, -1):
        pe = pl[end]
        best = None
        for jx, jy in junctions:
            d = np.hypot(jx - pe[0], jy - pe[1])
            if d < 14 and (best is None or d < best[0]): best = (d, jx, jy)
        if best:
            if end == 0: pl = np.vstack([[best[1], best[2]], pl])
            else: pl = np.vstack([pl, [best[1], best[2]]])
    pl = pl.astype(np.float32)
    simp = cv2.approxPolyDP(pl.reshape(-1, 1, 2), 2.0, False)[:, 0, :]
    if len(simp) < 2: continue
    w = float(np.median([dist[int(y), int(x)] for x, y in pl[::3]])) * 2
    # warna rata-rata jalur (tanpa garis kuning)
    cols = np.array([rgb[int(y), int(x)] for x, y in pl[::4]]).astype(float)
    cols = cols[(cols[:, 2] > 60)]  # buang kuning (b rendah)
    col = cols.mean(axis=0).tolist() if len(cols) else [120, 128, 128]
    length = float(np.sum(np.hypot(*np.diff(pl, axis=0).T)))
    roads.append({'pts': simp.astype(float).tolist(), 'w': w, 'col': col, 'len': length})
print('roads', len(roads), 'junctions', len(junctions))

# ---------------------------------------------------------------- rumah (titik kecil berwarna)
def blobs(mask, amin, amax, maxar=1.8):
    mask = mask.astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = []
    for i in range(1, n):
        a = st[i, cv2.CC_STAT_AREA]
        w, h = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
        if amin <= a <= amax and max(w, h) / max(1, min(w, h)) <= maxar:
            out.append((float(cen[i][0]), float(cen[i][1]), int(a), int(w), int(h)))
    return out

landfull = ndi.binary_fill_holes(isl) | isl
hk = {
    'blue':   (b > 170) & (r < 140) & (g > 110) & (g < 190) & (b - r > 60),
    'red':    (r > 195) & (g < 135) & (b < 115) & ((g - b) < 50),
    'orange': (r > 225) & (g > 120) & (g < 185) & (b < 90),
    'cream':  (r > 235) & (g > 205) & (g < 235) & (b > 150) & (b < 205),
    'white':  (r > 236) & (g > 226) & (b > 185) & ((r - b) >= 4) & ((r - b) < 60),
}
houses = []
for name, m in hk.items():
    m = mopen(m & landfull, 2)
    for x, y, a, w, h in blobs(m, 40 if name == 'white' else 60, 420):
        houses.append({'x': x, 'y': y, 'c': name, 'a': a})
print('houses', len(houses), {k: sum(1 for h in houses if h['c'] == k) for k in hk})

# ---------------------------------------------------------------- marker bernomor
markers = []
for name, m in mk_clean.items():
    n, lab, st, cen = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    for i in range(1, n):
        a = st[i, cv2.CC_STAT_AREA]
        if a >= 1200:
            markers.append({'x': float(cen[i][0]), 'y': float(cen[i][1]), 'c': name, 'a': int(a), 'w': int(st[i, 2]), 'h': int(st[i, 3])})
print('markers', len(markers))

# ---------------------------------------------------------------- pohon
tf = ((g > 140) & (g < 200) & (r > 70) & (r < 135) & (b > 70) & (b < 125) & (g - r > 40))
tf = mopen(tf & landfull, 3)
td = cv2.distanceTransform(tf.astype(np.uint8), cv2.DIST_L2, 5)
mxf = ndi.maximum_filter(td, footprint=morphology.disk(7))
pk = (td == mxf) & (td >= 6)
ys, xs = np.where(pk)
trees = []
for y, x in zip(ys, xs):
    trees.append({'x': float(x), 'y': float(y), 'r': float(td[y, x]) + 2.5})
# buang duplikat dekat
trees.sort(key=lambda t: -t['r'])
kept = []
for t in trees:
    if all(np.hypot(t['x'] - k['x'], t['y'] - k['y']) > 0.6 * max(t['r'], k['r']) for k in kept):
        kept.append(t)
trees = kept
print('trees', len(trees))

# ---------------------------------------------------------------- simpan
def km(p): return [(p[0] - X0) / PXKM, (p[1] - Y0) / PXKM]
data = {
    'meta': {'W': W, 'H': H, 'X0': X0, 'Y0': Y0, 'PXKM': PXKM},
    'islands': islands, 'lakes': lake_polys, 'roads': roads, 'houses': houses,
    'markers': markers, 'trees': trees, 'junctions': junctions,
}
json.dump(data, open(OUT + 'layout_px.json', 'w'))

# overlay debug
ov = rgb.copy()
for p in islands: cv2.polylines(ov, [np.array(p, np.int32)], True, (255, 0, 255), 3)
for p in lake_polys: cv2.polylines(ov, [np.array(p, np.int32)], True, (0, 0, 255), 3)
for rd in roads:
    col = (255, 0, 0) if rd['w'] < 11 else ((0, 160, 0) if rd['w'] < 17 else (255, 128, 0))
    cv2.polylines(ov, [np.array(rd['pts'], np.int32)], False, col, 3)
for h in houses: cv2.circle(ov, (int(h['x']), int(h['y'])), 10, (0, 0, 0), 2)
for m_ in markers: cv2.circle(ov, (int(m_['x']), int(m_['y'])), 40, (0, 0, 0), 4)
for t in trees: cv2.circle(ov, (int(t['x']), int(t['y'])), int(t['r']), (255, 255, 0), 1)
Image.fromarray(ov).resize((W // 2, H // 2)).save(OUT + 'overlay.png')
Image.fromarray((isl * 255).astype(np.uint8)).resize((W // 4, H // 4)).save(OUT + 'mask_isl.png')
Image.fromarray((roadmask * 255).astype(np.uint8)).resize((W // 2, H // 2)).save(OUT + 'mask_road.png')
