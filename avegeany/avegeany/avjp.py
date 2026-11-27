""".avjp project files.

An .avjp file is a zip archive holding an already processed room, so opening
it never re-runs RANSAC / segmentation:

    avjp.json           {"format": "avjp", "version": 1, "name", "created",
                         "modified", "source": {"file", "params"}}
    scene.glb, scene.json, room_shell.glb, room_structure.glb|.ply
    objects/<name>.glb|.obj
    layout.json         editor layout (v2), optional
    imports/<file>      objects imported in the editor, optional

Editor files (index.html, app.js, gizmo.js, vendor/) are never stored; the
server serves them from viewer/.
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath

FORMAT = "avjp"
VERSION = 1
MANIFEST = "avjp.json"
SKIP = {"index.html", "app.js", "gizmo.js", "vendor", "room_rearranged.glb", MANIFEST}
# already compressed formats are stored as-is (faster save/open, same size)
STORED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".zip", ".avjp"}


class AvjpError(ValueError):
    pass


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def read_manifest(project_dir: str | Path) -> dict:
    f = Path(project_dir) / MANIFEST
    if f.exists():
        try:
            return json.loads(f.read_text())
        except json.JSONDecodeError:
            pass
    return {}


def write_manifest(project_dir: str | Path, **fields) -> dict:
    """Create / update avjp.json in a working folder."""
    d = Path(project_dir)
    m = read_manifest(d)
    m.setdefault("format", FORMAT)
    m.setdefault("version", VERSION)
    m.setdefault("name", d.name)
    m.setdefault("created", _now())
    m.update({k: v for k, v in fields.items() if v is not None})
    (d / MANIFEST).write_text(json.dumps(m, indent=2))
    return m


def pack(project_dir: str | Path, dest: str | Path, name: str | None = None) -> Path:
    """Write the processed project in `project_dir` to `dest` (.avjp), atomically."""
    src = Path(project_dir)
    if not (src / "scene.glb").exists():
        raise AvjpError(f"{src} has no scene.glb - not a segmented project")
    dest = Path(dest)
    if dest.suffix.lower() != ".avjp":
        dest = dest.with_suffix(".avjp")
    dest.parent.mkdir(parents=True, exist_ok=True)
    m = write_manifest(src, name=name, modified=_now())
    tmp = dest.with_name(dest.name + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr(MANIFEST, json.dumps(m, indent=2))
        for f in sorted(src.rglob("*")):
            rel = f.relative_to(src)
            if rel.parts[0] in SKIP or "_preview" in rel.parts or not f.is_file() or f.name.endswith(".tmp"):
                continue
            comp = zipfile.ZIP_STORED if f.suffix.lower() in STORED_EXT else zipfile.ZIP_DEFLATED
            z.write(f, rel.as_posix(), compress_type=comp)
    os.replace(tmp, dest)
    return dest


def _check_member(name: str) -> PurePosixPath:
    p = PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts or ":" in name or name.startswith("\\"):
        raise AvjpError(f"unsafe path in archive: {name!r}")
    return p


def inspect(path: str | Path) -> dict:
    """Read and validate avjp.json without extracting anything."""
    try:
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
            if MANIFEST not in names:
                raise AvjpError(f"{path} is not an .avjp project (no {MANIFEST})")
            m = json.loads(z.read(MANIFEST))
    except zipfile.BadZipFile as e:
        raise AvjpError(f"{path} is not an .avjp project ({e})") from e
    if m.get("format") != FORMAT:
        raise AvjpError(f"{path}: unknown format {m.get('format')!r}")
    if int(m.get("version", 0)) > VERSION:
        raise AvjpError(f"{path} was saved by a newer avegeany (format v{m['version']})")
    if "scene.glb" not in names:
        raise AvjpError(f"{path} has no scene.glb")
    return m


def unpack(path: str | Path, work_dir: str | Path) -> dict:
    """Extract an .avjp into `work_dir` (must be empty or missing)."""
    m = inspect(path)
    out = Path(work_dir)
    out.mkdir(parents=True, exist_ok=True)
    root = out.resolve()
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            rel = _check_member(info.filename)
            target = (root / rel).resolve()
            if root not in target.parents and target != root:
                raise AvjpError(f"unsafe path in archive: {info.filename!r}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as s, open(target, "wb") as d:
                shutil.copyfileobj(s, d)
    return m


_temp_dirs: list[Path] = []


def _cleanup():
    for d in _temp_dirs:
        shutil.rmtree(d, ignore_errors=True)


atexit.register(_cleanup)


def temp_dir(prefix: str = "avjp-") -> Path:
    """A working folder deleted when the process exits."""
    d = Path(tempfile.mkdtemp(prefix=prefix))
    _temp_dirs.append(d)
    return d


def open_project(path: str | Path) -> tuple[Path, dict]:
    """Extract an .avjp to a fresh temporary working folder."""
    work = temp_dir()
    try:
        m = unpack(path, work)
    except Exception:
        shutil.rmtree(work, ignore_errors=True)
        raise
    return work, m


# ------------------------------------------------------------ recent list --
RECENT = Path.home() / ".avegeany" / "recent.json"


def recent(limit: int = 12) -> list[dict]:
    try:
        items = json.loads(RECENT.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    out = []
    for it in items:
        p = Path(it.get("path", ""))
        if p.suffix == ".avjp" and p.is_file():
            out.append({"path": str(p), "name": it.get("name") or p.stem,
                        "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(p.stat().st_mtime))})
    return out[:limit]


def add_recent(path: str | Path, name: str | None = None):
    p = str(Path(path).resolve())
    items = [it for it in recent(50) if it["path"] != p]
    items.insert(0, {"path": p, "name": name or Path(p).stem})
    try:
        RECENT.parent.mkdir(parents=True, exist_ok=True)
        RECENT.write_text(json.dumps([{"path": i["path"], "name": i["name"]} for i in items[:50]], indent=2))
    except OSError:
        pass
