"""Shared textures for exported objects.

A photogrammetry scan has one big texture atlas (Scaniverse: 8192 x 8192) that
every piece of the room uses. Exported naively, each objects/<name>.glb carries
its own copy (~5 MB each), so a room with 80 objects becomes 500 MB and loads
slowly. `export_glb` instead writes the atlas once to PROJECT/textures/ and lets
the .glb reference it by URI (standard glTF), so the browser downloads it once.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
from pathlib import Path

import trimesh

_saved: dict[int, str] = {}       # id(PIL image) -> file name, within this process


def _image_of(geom):
    vis = getattr(geom, "visual", None)
    if getattr(vis, "kind", None) != "texture" or getattr(vis, "uv", None) is None:
        return None, None
    mat = vis.material
    img = getattr(mat, "baseColorTexture", None) or getattr(mat, "image", None)
    return mat, img


def _atlas_file(img, project: Path) -> str:
    key = id(img)
    if key in _saved and (project / "textures" / _saved[key]).exists():
        return _saved[key]
    known = getattr(img, "info", {}).get("avegeany_texture")      # loaded from textures/ (see load)
    if known and (project / "textures" / known).exists():
        _saved[key] = known
        return known
    thumb = img.convert("RGB").resize((64, 64))
    name = "tex_" + hashlib.sha1(thumb.tobytes() + repr(img.size).encode()).hexdigest()[:12] + ".jpg"
    dest = project / "textures" / name
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".jpg.tmp")
        img.convert("RGB").save(tmp, "JPEG", quality=90)
        tmp.replace(dest)
    _saved[key] = name
    return name


def _patch_glb(data: bytes, uri: str) -> bytes:
    """add an external base-colour texture (uri) to the first material of a GLB"""
    magic, version, _ = struct.unpack("<III", data[:12])
    jlen, jtype = struct.unpack("<II", data[12:20])
    doc = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    doc["images"] = [{"uri": uri}]
    doc["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    doc["textures"] = [{"source": 0, "sampler": 0}]
    mats = doc.setdefault("materials", [{"pbrMetallicRoughness": {}}])
    for m in mats:
        m.setdefault("pbrMetallicRoughness", {})["baseColorTexture"] = {"index": 0}
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<II", len(js), jtype) + js + rest
    return struct.pack("<III", magic, version, 12 + len(out)) + out


class _ProjectResolver(trimesh.resolvers.Resolver):
    """Resolves a .glb's relative URIs (e.g. ../textures/tex_x.jpg) but only to
    files inside its project folder, so a crafted .avjp can't read other files."""

    def __init__(self, glb: Path, root: Path):
        self.dir, self.root = glb.parent.resolve(), root.resolve()
        self.textures: set[str] = set()

    def get(self, name):
        p = (self.dir / name).resolve()
        if p != self.root and self.root not in p.parents:
            raise ValueError(f"{name!r} is outside the project")
        if p.parent == self.root / "textures":
            self.textures.add(p.name)
        return p.read_bytes()

    def namespaced(self, namespace):
        return _ProjectResolver(self.dir / namespace / "x", self.root)

    def keys(self):
        return []

    def write(self, name, data):
        raise NotImplementedError


def project_root(path: Path) -> Path:
    """the project folder of a file inside it (the nearest folder with scene.json)"""
    for d in [path.parent, *path.parent.parents]:
        if (d / "scene.json").exists():
            return d
    return path.parent


def load(path: str | Path, **kw):
    """trimesh.load that also finds textures shared via textures/ (see export_glb).
    Images loaded from there are tagged, so re-exporting reuses the same file
    instead of saving a (JPEG-shifted) second copy."""
    path = Path(path)
    res = _ProjectResolver(path, project_root(path))
    g = trimesh.load(str(path), resolver=res, **kw)
    if len(res.textures) == 1:
        name = next(iter(res.textures))
        geoms = g.geometry.values() if isinstance(g, trimesh.Scene) else [g]
        for m in geoms:
            _, img = _image_of(m)
            if img is not None:
                img.info["avegeany_texture"] = name
    return g


def export_glb(geom, path: str | Path, project: str | Path):
    """geom.export(path) for .glb, but a texture atlas is written once to
    PROJECT/textures/ and referenced instead of embedded."""
    path, project = Path(path), Path(project)
    mat, img = _image_of(geom)
    if img is None:
        geom.export(path)
        return
    name = _atlas_file(img, project)
    # a fresh material without the image (a shallow copy would share trimesh's
    # internal storage, and clearing its image would strip the texture from every
    # other mesh using the same material)
    if isinstance(mat, trimesh.visual.material.PBRMaterial):
        bare = trimesh.visual.material.PBRMaterial(
            name=mat.name, baseColorFactor=mat.baseColorFactor, metallicFactor=mat.metallicFactor,
            roughnessFactor=mat.roughnessFactor, doubleSided=mat.doubleSided)
    else:
        bare = trimesh.visual.material.PBRMaterial(name=getattr(mat, "name", None))
    g = geom.copy()
    g.visual = trimesh.visual.TextureVisuals(uv=geom.visual.uv, material=bare)
    data = g.export(file_type="glb")
    uri = Path(os.path.relpath(project / "textures" / name, path.parent)).as_posix()
    path.write_bytes(_patch_glb(data, uri))
