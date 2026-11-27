"""Furniture catalog for the editor.

Two sources, same layout (sub-folders = categories, optional <name>.json sidecar
with {"name", "category", "up": "y"|"z", "unit": 1|0.01|0.001|0.0254, "tags"}):

  pack   ROOT/catalog/            models you put there (the preinstalled pack)
  lib    ~/.avegeany/catalog/     "My library": models added from the editor,
                                  shared by every project

Item ids are "<source>/<relative path>", e.g. "pack/chairs/office_chair.glb".
Every path is checked to stay inside its own root. Placing an item copies the
file into the project's imports/, so .avjp files stay self-contained.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path, PurePosixPath

import os

ROOT = Path(__file__).resolve().parent.parent
# AVEGEANY_CATALOG / AVEGEANY_LIBRARY point the two sources elsewhere (tests, shared drives)
PACK = Path(os.environ.get("AVEGEANY_CATALOG") or ROOT / "catalog")
LIBRARY = Path(os.environ.get("AVEGEANY_LIBRARY") or Path.home() / ".avegeany" / "catalog")
THUMBS = LIBRARY.parent / "thumbs"
MODEL_EXT = {".glb", ".gltf", ".obj", ".ply", ".stl"}
UNITS = {1.0, 0.01, 0.001, 0.0254}
MAX_THUMB = 2 * 1024 * 1024


def roots() -> dict[str, Path]:
    return {"pack": PACK, "lib": LIBRARY}


def _default_up(ext: str) -> str:
    return "z" if ext in (".stl", ".ply") else "y"


def _pretty(stem: str) -> str:
    return re.sub(r"[_-]+", " ", stem).strip().capitalize() or "Item"


def _safe(part: str, fallback: str) -> str:
    s = re.sub(r"[^A-Za-z0-9 _-]+", "_", (part or "").strip()).strip(" _")[:60]
    return s or fallback


def resolve(item_id: str) -> Path:
    """id -> file path, refusing anything outside the catalog roots."""
    source, _, rel = (item_id or "").partition("/")
    root = roots().get(source)
    if root is None or not rel:
        raise ValueError(f"unknown catalog item {item_id!r}")
    p = PurePosixPath(rel)
    if p.is_absolute() or ".." in p.parts or "\\" in rel or ":" in rel:
        raise ValueError(f"bad catalog item {item_id!r}")
    path = (root / Path(*p.parts)).resolve()
    if root.resolve() not in path.parents:
        raise ValueError(f"bad catalog item {item_id!r}")
    if path.suffix.lower() not in MODEL_EXT or not path.is_file():
        raise ValueError(f"catalog item {item_id!r} not found")
    return path


def _sidecar(path: Path) -> dict:
    side = path.with_suffix(".json")
    if side.is_file():
        try:
            d = json.loads(side.read_text())
            return d if isinstance(d, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}
    return {}


def _item(source: str, root: Path, path: Path) -> dict:
    rel = path.relative_to(root)
    meta = _sidecar(path)
    ext = path.suffix.lower()
    category = meta.get("category") or (rel.parts[0] if len(rel.parts) > 1 else "other")
    unit = meta.get("unit", 1.0)
    try:
        unit = float(unit)
    except (TypeError, ValueError):
        unit = 1.0
    return {
        "id": f"{source}/{rel.as_posix()}",
        "name": str(meta.get("name") or _pretty(path.stem)),
        "category": str(category),
        "source": source,
        "ext": ext[1:],
        "up": meta.get("up") if meta.get("up") in ("y", "z") else _default_up(ext),
        "unit": unit if unit in UNITS else 1.0,
        "tags": [str(t) for t in meta.get("tags", [])][:20] if isinstance(meta.get("tags"), list) else [],
        "bytes": path.stat().st_size,
        "size": _cached_size(path),
        "thumb": _thumb_path(path).is_file(),
    }


def _cached_size(path: Path):
    j = _thumb_path(path).with_suffix(".json")
    try:
        return json.loads(j.read_text()).get("size") if j.is_file() else None
    except (OSError, json.JSONDecodeError):
        return None


def list_items() -> list[dict]:
    out = []
    for source, root in roots().items():
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            rel = path.relative_to(root)
            if any(part.startswith(".") for part in rel.parts):
                continue
            if path.is_file() and path.suffix.lower() in MODEL_EXT:
                out.append(_item(source, root, path))
    return out


def add(data: bytes, filename: str, name: str | None = None, category: str | None = None,
        up: str | None = None, unit: float | None = None) -> dict:
    """Save a model into My library (with its sidecar). Returns the new item."""
    ext = Path(filename or "").suffix.lower()
    if ext not in MODEL_EXT:
        raise ValueError(f"unsupported model type {ext or '(none)'} - use .glb, .obj, .ply or .stl")
    if not data:
        raise ValueError("empty file")
    cat = _safe(category or "", "other").lower()
    stem = _safe(Path(filename).stem, "item").replace(" ", "_")
    folder = LIBRARY / cat
    folder.mkdir(parents=True, exist_ok=True)
    dest, i = folder / f"{stem}{ext}", 2
    while dest.exists():
        dest = folder / f"{stem}_{i}{ext}"
        i += 1
    dest.write_bytes(data)
    try:
        deps = gltf_files(dest) if ext == ".gltf" else []
    except (ValueError, json.JSONDecodeError):
        dest.unlink()
        raise ValueError("that .gltf file could not be read")
    if deps:
        dest.unlink()
        raise ValueError(f"this .gltf needs {len(deps)} more files ({', '.join(deps[:3])}…): put the whole folder "
                         f"into the catalog/ folder, or export it as a single .glb")
    unit = float(unit) if unit not in (None, "") else 1.0
    meta = {"name": (name or "").strip()[:80] or _pretty(stem), "category": cat,
            "up": up if up in ("y", "z") else _default_up(ext), "unit": unit if unit in UNITS else 1.0}
    dest.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    return _item("lib", LIBRARY, dest)


def remove(item_id: str):
    if not item_id.startswith("lib/"):
        raise ValueError("only items in My library can be removed (pack items live in the catalog/ folder)")
    path = resolve(item_id)
    t = _thumb_path(path)
    path.unlink()
    path.with_suffix(".json").unlink(missing_ok=True)
    t.unlink(missing_ok=True)
    t.with_suffix(".json").unlink(missing_ok=True)


def _thumb_path(path: Path) -> Path:
    key = hashlib.sha1(f"{path}:{path.stat().st_mtime_ns}".encode()).hexdigest()[:16]
    return THUMBS / f"{key}.png"


def get_thumb(item_id: str) -> bytes | None:
    t = _thumb_path(resolve(item_id))
    return t.read_bytes() if t.is_file() else None


def put_thumb(item_id: str, png: bytes, size=None):
    """store the editor-rendered preview (+ the model's measured W x D x H in metres)"""
    if not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > MAX_THUMB:
        raise ValueError("thumbnail must be a PNG under 2 MB")
    t = _thumb_path(resolve(item_id))
    t.parent.mkdir(parents=True, exist_ok=True)
    t.write_bytes(png)
    if size:
        vals = [round(float(v), 3) for v in size][:3]
        if len(vals) == 3 and all(0 <= v < 1000 for v in vals):
            t.with_suffix(".json").write_text(json.dumps({"size": vals}))


# files a .gltf may refer to (buffers, textures)
ASSET_EXT = {".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".basis"}


def _rel_ok(rel: str) -> PurePosixPath:
    p = PurePosixPath(rel.replace("\\", "/"))
    if not rel or p.is_absolute() or ".." in p.parts or ":" in rel:
        raise ValueError(f"bad file reference {rel!r}")
    return p


def gltf_files(path: Path) -> list[str]:
    """relative paths of the external files (buffers, images) a .gltf refers to"""
    from urllib.parse import unquote
    doc = json.loads(Path(path).read_text())
    out = []
    for key in ("buffers", "images"):
        for e in doc.get(key, []):
            uri = e.get("uri")
            if uri and not uri.startswith("data:"):
                out.append(str(_rel_ok(unquote(uri))))
    return out


def asset(item_id: str, rel: str) -> Path:
    """A file referenced by a catalog .gltf (e.g. its .bin or textures/x.jpg),
    resolved next to the model and kept inside the same catalog root."""
    model = resolve(item_id)
    root = roots()[item_id.split("/", 1)[0]].resolve()
    path = (model.parent / Path(*_rel_ok(rel).parts)).resolve()
    if root not in path.parents or path.suffix.lower() not in ASSET_EXT or not path.is_file():
        raise ValueError(f"{rel!r} not found next to {item_id}")
    return path


def place(item_id: str, project_dir: Path) -> dict:
    """Copy an item into PROJECT/imports/; returns what the editor needs to load it.
    A .gltf with separate files (.bin, textures/) is copied with them into its own
    folder, imports/<name>/, keeping their relative paths."""
    src = resolve(item_id)
    item = _item(*next((s, r) for s, r in roots().items() if item_id.startswith(s + "/")), src)
    d = Path(project_dir) / "imports"
    d.mkdir(parents=True, exist_ok=True)
    stem = _safe(src.stem, "item").replace(" ", "_")
    deps = gltf_files(src) if src.suffix.lower() == ".gltf" else []
    if deps:
        folder, i = d / stem, 2
        while folder.exists():
            folder = d / f"{stem}_{i}"
            i += 1
        for rel in deps:                                   # check them all before copying anything
            asset(item_id, rel)
        folder.mkdir(parents=True)
        shutil.copyfile(src, folder / src.name)
        for rel in deps:
            dest = folder / Path(*PurePosixPath(rel).parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(asset(item_id, rel), dest)
        return {**item, "file": f"imports/{folder.name}/{src.name}"}
    dest, i = d / f"{stem}{src.suffix.lower()}", 2
    while dest.exists():
        dest = d / f"{stem}_{i}{src.suffix.lower()}"
        i += 1
    shutil.copyfile(src, dest)
    return {**item, "file": f"imports/{dest.name}"}
