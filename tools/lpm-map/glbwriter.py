import json, struct
import numpy as np


class Glb:
    """Penulis glTF 2.0 binary minimal (tanpa tekstur). Frame: Z ke atas, sama dengan lpm.glb lama."""

    def __init__(self):
        self.nodes, self.meshes, self.materials = [], [], []
        self.accessors, self.views = [], []
        self.bin = bytearray()
        self.roots = []
        self.mat_by_key = {}

    def _pad(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def _view(self, data: bytes, target=None):
        self._pad()
        off = len(self.bin)
        self.bin += data
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.views.append(v)
        return len(self.views) - 1

    def _acc(self, arr, ctype, atype, target, with_minmax=False):
        vi = self._view(arr.tobytes(), target)
        a = {'bufferView': vi, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': atype}
        if with_minmax:
            a['min'] = [float(x) for x in arr.min(axis=0)]
            a['max'] = [float(x) for x in arr.max(axis=0)]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def material(self, name, rgb, rough=0.85, metal=0.0, double=True):
        key = (name, tuple(rgb))
        if key in self.mat_by_key:
            return self.mat_by_key[key]
        self.materials.append({
            'name': name, 'doubleSided': double,
            'pbrMetallicRoughness': {'baseColorFactor': [float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0],
                                     'roughnessFactor': rough, 'metallicFactor': metal},
        })
        self.mat_by_key[key] = len(self.materials) - 1
        return self.mat_by_key[key]

    def mesh(self, name, pos, idx, material, normals=None, colors=None):
        pos = np.ascontiguousarray(pos, dtype=np.float32)
        idx = np.ascontiguousarray(idx, dtype=np.uint32).reshape(-1)
        if normals is None:
            normals = np.tile(np.array([0, 0, 1], np.float32), (len(pos), 1))
        normals = np.ascontiguousarray(normals, dtype=np.float32)
        attrs = {
            'POSITION': self._acc(pos, 5126, 'VEC3', 34962, True),
            'NORMAL': self._acc(normals, 5126, 'VEC3', 34962),
        }
        if colors is not None:
            attrs['COLOR_0'] = self._acc(np.ascontiguousarray(colors, dtype=np.float32), 5126, 'VEC3', 34962)
        ia = self._acc(idx.reshape(-1, 1), 5125, 'SCALAR', 34963)
        # SCALAR akses: count harus jumlah indeks
        self.accessors[ia]['count'] = int(len(idx))
        self.meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': ia, 'mode': 4, 'material': material}]})
        return len(self.meshes) - 1

    def node(self, name, mesh=None, t=None, r=None, s=None, children=None, extras=None):
        n = {'name': name}
        if mesh is not None: n['mesh'] = mesh
        if t is not None: n['translation'] = [float(x) for x in t]
        if r is not None: n['rotation'] = [float(x) for x in r]
        if s is not None: n['scale'] = [float(x) for x in s]
        if children: n['children'] = list(children)
        if extras: n['extras'] = extras
        self.nodes.append(n)
        return len(self.nodes) - 1

    def root(self, idx):
        self.roots.append(idx)

    def write(self, path):
        self._pad()
        j = {
            'asset': {'version': '2.0', 'generator': 'rp-town lpm layout builder'},
            'scene': 0, 'scenes': [{'name': 'DefaultScene', 'nodes': self.roots}],
            'nodes': self.nodes, 'meshes': self.meshes, 'materials': self.materials,
            'accessors': self.accessors, 'bufferViews': self.views,
            'buffers': [{'byteLength': len(self.bin)}],
        }
        js = json.dumps(j, separators=(',', ':')).encode()
        while len(js) % 4: js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942)); f.write(bytes(self.bin))
        return total
