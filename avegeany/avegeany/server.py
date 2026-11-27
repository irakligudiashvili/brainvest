"""Tiny local web server for the editor.

The editor code is always served from viewer/ and the project data from the
session's working folder (an output folder, or an extracted .avjp), so the
session can switch projects without restarting.

  GET  /api/ping                  -> {"ok": true, ...}   (editor detects "server mode")
  GET  /api/project               -> {"loaded", "name", "avjp", "workspace"}
  GET  /api/recent                -> recently used .avjp files
  GET  /api/download              -> the current project packed as .avjp
  GET  /api/job?id=ID             -> {"state": running|done|error, "log": [...], "avjp"}
  POST /api/layout                body = layout JSON    -> PROJECT/layout.json
  POST /api/import?name=foo.glb   body = file bytes     -> PROJECT/imports/foo.glb
  POST /api/save[?name=N]         body = layout JSON    -> layout.json + pack to the .avjp
  POST /api/autosave              body = layout JSON    -> layout.json only (marks unsaved work for recovery)
  POST /api/recovery/restore|discard                    -> use / drop <project>.recovered.avjp
  POST /api/open                  body = {"path": ".../room.avjp"}
  POST /api/open-upload?name=f    body = .avjp bytes    -> copied into the workspace, opened
  POST /api/scan/upload?job=ID&name=f   body = scan file (several per job: .obj + .mtl + .jpg)
  POST /api/scan/process          body = {"job", "main", "name", "up", "room_height", "merge"}
  GET  /api/split/suggest?name=N  -> automatic guess for cutting object N into seats
  POST /api/split                 body = {"name", "axis", "origin", "cuts", "record"}
  POST /api/unsplit               body = {"parent", "piece", "record"}
  GET  /api/separate/preview?name=N[&k=K]  -> shape-based pieces written to objects/_preview/
  POST /api/separate              body = {"name", "k", "record"}   -> accept (same pieces, for real)
  POST /api/separate/cancel       body = {}                         -> drop the preview
  GET  /api/islands?name=&size=&start=auto|one  -> per-triangle islands + starting pieces (base64 uint32)
                                  + "borders" between touching islands (pairs, length, bend angle) for the bucket fill
  POST /api/split/parts           body = {"name", "labels" (base64 uint32 per triangle), "record"}
  (POST /api/split also takes "planes": [{"origin": [x, z], "normal": [nx, nz]}, ...] for turned planes)
  GET  /api/catalog               -> catalog items (pack = ROOT/catalog, lib = ~/.avegeany/catalog)
  GET  /api/catalog/file?id=      -> the model file;  GET/POST /api/catalog/thumb?id= -> PNG preview
  POST /api/catalog/add?filename=&name=&category=&up=&unit=   body = model -> My library
  POST /api/catalog/remove        body = {"id"}   (library items only)
  POST /api/catalog/place         body = {"id"}   -> copied into PROJECT/imports/ (a .gltf with its files
                                  into imports/<name>/);  GET /api/catalog/asset?id=&path= -> its .bin / textures
  POST /api/import-bundle?dir=&path=   body = one file of a multi-file .gltf -> PROJECT/imports/<dir>/<path>

Binds to 127.0.0.1 only.
"""
from __future__ import annotations

import http.server
import json
import re
import shutil
import sys
import signal
import threading
import time
import traceback
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import avjp

ROOT = Path(__file__).resolve().parent.parent
VIEWER = ROOT / "viewer"
VIEWER_FILES = {"/index.html", "/app.js", "/gizmo.js"}
IMPORT_EXT = {".glb", ".gltf", ".obj", ".ply", ".stl"}
SCAN_EXT = IMPORT_EXT | {".mtl", ".jpg", ".jpeg", ".png", ".off"}
SCAN_MAIN_EXT = {".obj", ".ply", ".glb", ".gltf", ".stl", ".off"}
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB


def install_viewer(out_dir: Path):
    """Copy the editor (and its bundled three.js) next to scene.glb (for static hosting)."""
    out_dir = Path(out_dir)
    # every top-level editor file (app.js imports sidebar.js, catalog.js, splittab.js, ...),
    # so a new module can't be forgotten here
    for f in [VIEWER / "index.html", *sorted(VIEWER.glob("*.js")), *sorted(VIEWER.glob("*.css"))]:
        shutil.copy(f, out_dir / f.name)
    shutil.copytree(VIEWER / "vendor", out_dir / "vendor", dirs_exist_ok=True)


def _safe_name(name: str, allowed=IMPORT_EXT) -> str:
    p = Path(name or "object.glb").name
    stem, ext = Path(p).stem, Path(p).suffix.lower()
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem)[:60] or "object"
    if ext not in allowed:
        raise ValueError(f"unsupported file type {ext}")
    return stem + ext


def project_name(name: str | None, fallback: str = "room") -> str:
    n = re.sub(r"[^A-Za-z0-9 _-]+", "_", (name or "").strip()).strip(" _")[:60]
    return n or fallback


def unique_path(p: Path) -> Path:
    dest, i = p, 2
    while dest.exists():
        dest = p.with_name(f"{p.stem}_{i}{p.suffix}")
        i += 1
    return dest


class _Tee:
    """stdout replacement used while a scan is processed: keeps printing to the
    terminal and collects the lines for the editor's progress log."""

    def __init__(self, real, sink: list):
        self.real, self.sink, self.buf = real, sink, ""

    def write(self, s):
        self.real.write(s)
        self.buf += s
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            self.sink.append(line)
        return len(s)

    def flush(self):
        self.real.flush()


class Session:
    """What the server is currently editing."""

    def __init__(self, project_dir: Path | None = None, avjp_path: Path | None = None,
                 workspace: Path | None = None):
        self.lock = threading.RLock()
        self.project_dir = Path(project_dir).resolve() if project_dir else None
        self.avjp_path = Path(avjp_path).resolve() if avjp_path else None
        self.workspace = Path(workspace or Path.cwd() / "projects").resolve()
        self.jobs: dict[str, dict] = {}
        self.stages: dict[str, Path] = {}
        self.unsaved = False               # split / merge-back since the last Save
        # recovery: any change since the last Save (layout autosaves, splits, imports) makes the
        # session "dirty"; a stopped / crashed server leaves <project>.recovered.avjp behind
        self.dirty = False
        self.edits = 0
        self._recovered_edits = 0
        self.recovery: Path | None = None   # a recovery copy newer than the project file
        self.preview: dict | None = None   # last shape-separation preview (accepted as-is)
        self._pitch: dict[str, dict | None] = {}

    @property
    def loaded(self) -> bool:
        return bool(self.project_dir and (self.project_dir / "scene.glb").exists())

    @property
    def name(self) -> str | None:
        if not self.project_dir:
            return None
        m = avjp.read_manifest(self.project_dir)
        return m.get("name") or (self.avjp_path.stem if self.avjp_path else self.project_dir.name)

    def info(self) -> dict:
        rec = None
        if self.recovery and self.recovery.is_file():
            rec = {"path": str(self.recovery),
                   "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(self.recovery.stat().st_mtime))}
        return {"loaded": self.loaded, "name": self.name,
                "avjp": str(self.avjp_path) if self.avjp_path else None,
                "dir": str(self.project_dir) if self.project_dir else None,
                "workspace": str(self.workspace), "unsaved": self.unsaved, "recovery": rec}

    # ----------------------------------------------------------- recovery --
    def touch(self):
        """something changed in the open project since the last Save"""
        self.dirty = True
        self.edits += 1

    @property
    def recovery_path(self) -> Path | None:
        if self.avjp_path:
            return self.avjp_path.with_name(f"{self.avjp_path.stem}.recovered.avjp")
        if self.project_dir:
            return self.workspace / f"{project_name(self.name)}.recovered.avjp"
        return None

    def write_recovery(self, why: str = "") -> Path | None:
        """pack unsaved work next to the project (only if something changed since the last copy)"""
        with self.lock:
            if not (self.dirty and self.loaded) or self.edits == self._recovered_edits:
                return None
            dest = self.recovery_path
            try:
                avjp.pack(self.project_dir, dest)
            except Exception as e:  # noqa: BLE001
                print(f"[recovery] could not write {dest}: {e}")
                return None
            self._recovered_edits = self.edits
        print(f"[recovery] unsaved changes kept in {dest}{f' ({why})' if why else ''}")
        return dest

    def restore_recovery(self):
        with self.lock:
            if not (self.recovery and self.recovery.is_file()):
                raise ValueError("no recovery copy for this project")
            work = avjp.temp_dir()
            avjp.unpack(self.recovery, work)
            self.project_dir = work
            self.unsaved = self.dirty = True
            self.edits += 1
            self._recovered_edits = self.edits          # identical to the copy on disk
            print(f"[recovery] restored unsaved changes from {self.recovery}")
            self.recovery = None                        # (file stays until the next Save)

    def discard_recovery(self):
        with self.lock:
            p = self.recovery or self.recovery_path
            if p and p.is_file():
                p.unlink()
                print(f"[recovery] discarded {p}")
            self.recovery = None

    def room_profile(self) -> dict | None:
        """repeat width / size shared by the room's clear rows (cached per project)"""
        from .split import room_profile
        key = str(self.project_dir)
        if key not in self._pitch:
            self._pitch[key] = room_profile(self.project_dir)
        return self._pitch[key]

    def open(self, path: Path):
        path = Path(path).expanduser().resolve()
        work, m = avjp.open_project(path)
        with self.lock:
            self.project_dir, self.avjp_path, self.unsaved = work, path, False
            self.dirty, self.edits, self._recovered_edits = False, 0, 0
            rec = self.recovery_path
            self.recovery = rec if rec and rec.is_file() and rec.stat().st_mtime > path.stat().st_mtime else None
        avjp.add_recent(path, m.get("name"))
        print(f"[view] opened {path}")
        if self.recovery:
            print(f"[recovery] unsaved changes from a previous session are in {self.recovery} - "
                  "the editor offers to restore them")
        return m

    def save(self, layout: dict | None = None, name: str | None = None) -> Path:
        with self.lock:
            if not self.loaded:
                raise ValueError("no project is open")
            if layout is not None:
                (self.project_dir / "layout.json").write_text(json.dumps(layout, indent=2))
            if name:
                avjp.write_manifest(self.project_dir, name=project_name(name))
            if self.avjp_path is None:
                self.avjp_path = unique_path(self.workspace / f"{project_name(self.name)}.avjp")
            dest = avjp.pack(self.project_dir, self.avjp_path)
            self.unsaved = self.dirty = False
            self._recovered_edits = self.edits
            rec = self.recovery_path
            if rec and rec.is_file():
                rec.unlink()                                 # saved for real: the copy is stale
            self.recovery = None
        avjp.add_recent(dest, self.name)
        print(f"[view] saved {dest}")
        return dest

    # ----------------------------------------------------- scan processing --
    def stage_file(self, job: str, name: str, body: bytes) -> str:
        if not re.fullmatch(r"[A-Za-z0-9]{6,40}", job or ""):
            raise ValueError("bad job id")
        # keep the original file name so .obj -> .mtl -> texture references still resolve
        raw = Path(name or "").name
        ext = Path(raw).suffix.lower()
        if ext not in SCAN_EXT:
            raise ValueError(f"unsupported scan file type {ext or '(none)'}")
        if not raw or raw.startswith(".") or "/" in raw or "\\" in raw:
            raise ValueError("bad file name")
        with self.lock:
            d = self.stages.get(job)
            if d is None:
                d = self.stages[job] = avjp.temp_dir("avjp-scan-")
        (d / raw).write_bytes(body)
        return raw

    def process(self, req: dict) -> str:
        job = req.get("job", "")
        d = self.stages.get(job)
        if d is None:
            raise ValueError("upload the scan files first")
        if any(j["state"] == "running" for j in self.jobs.values()):
            raise ValueError("another scan is still being processed")
        main = req.get("main")
        if not main:
            mains = sorted(p.name for p in d.iterdir() if p.suffix.lower() in SCAN_MAIN_EXT)
            if not mains:
                raise ValueError("no mesh / point cloud among the uploaded files")
            main = mains[0]
        src = d / Path(main).name
        if not src.is_file() or src.suffix.lower() not in SCAN_MAIN_EXT:
            raise ValueError(f"{main} is not an uploaded mesh / point cloud")
        name = project_name(req.get("name"), src.stem)

        from .pipeline import Params
        kw = {}
        if req.get("up"):
            if req["up"] not in ("x", "y", "z", "-x", "-y", "-z"):
                raise ValueError("up must be x, y, z, -x, -y or -z")
            kw["up"] = req["up"]
        for key, field in (("room_height", "room_height"), ("merge", "merge_factor")):
            if req.get(key) not in (None, ""):
                v = float(req[key])
                if not 0 < v < 100:
                    raise ValueError(f"{key} out of range")
                kw[field] = v
        kw["separate"] = req.get("separate", True) is not False
        params = Params(**kw)
        state = {"state": "running", "log": [], "avjp": None, "error": None, "name": name}
        self.jobs[job] = state
        threading.Thread(target=self._run, args=(job, src, name, params), daemon=True).start()
        return job

    def _run(self, job: str, src: Path, name: str, params):
        from dataclasses import asdict
        from .pipeline import segment_room
        st = self.jobs[job]
        real = sys.stdout
        sys.stdout = _Tee(real, st["log"])
        try:
            work = avjp.temp_dir()
            segment_room(src, work, params)
            avjp.write_manifest(work, name=name, source={
                "file": src.name, "params": {k: v for k, v in asdict(params).items() if k != "verbose"}})
            dest = unique_path(self.workspace / f"{name}.avjp")
            avjp.pack(work, dest)
            with self.lock:
                self.project_dir, self.avjp_path, self.unsaved = work.resolve(), dest.resolve(), False
                self.dirty, self.edits, self._recovered_edits, self.recovery = False, 0, 0, None
            avjp.add_recent(dest, name)
            print(f"[scan] project saved as {dest}")
            st.update(state="done", avjp=str(dest))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            st.update(state="error", error=str(e))
        finally:
            sys.stdout = real
            shutil.rmtree(self.stages.pop(job, src.parent), ignore_errors=True)


def make_handler(session: Session | str | Path):
    if not isinstance(session, Session):
        session = Session(project_dir=Path(session))
    S = session

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(VIEWER), **k)

        def log_message(self, *a):
            pass

        def end_headers(self):
            # textures/ names are content fingerprints (textures.py): safe to cache for good
            if urlparse(self.path).path.startswith("/textures/"):
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            else:
                self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def _json(self, code: int, obj: dict | list):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _bytes(self, data: bytes, ctype: str):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _route_static(self) -> bool:
            """Point SimpleHTTPRequestHandler at viewer/ or at the project folder."""
            path = unquote(urlparse(self.path).path)
            top = path.lstrip("/")
            if path in ("/", "") or path in VIEWER_FILES or path.startswith("/vendor/") \
                    or (re.fullmatch(r"[a-z]+\.(js|css)", top) and (VIEWER / top).is_file()):
                self.directory = str(VIEWER)
                return True
            if not S.project_dir:
                self.send_error(404, "no project open")
                return False
            self.directory = str(S.project_dir)
            return True

        def do_HEAD(self):
            if self._route_static():
                super().do_HEAD()

        def do_GET(self):
            url = urlparse(self.path)
            q = parse_qs(url.query)
            if url.path == "/api/ping":
                return self._json(200, {"ok": True, "out": str(S.project_dir), **S.info()})
            if url.path == "/api/project":
                return self._json(200, S.info())
            if url.path == "/api/recent":
                return self._json(200, avjp.recent())
            if url.path.startswith("/api/catalog"):
                from . import catalog
                try:
                    if url.path == "/api/catalog":
                        return self._json(200, {"items": catalog.list_items(),
                                                "pack": str(catalog.PACK), "library": str(catalog.LIBRARY)})
                    item = q.get("id", [""])[0]
                    if url.path == "/api/catalog/file":
                        return self._bytes(catalog.resolve(item).read_bytes(), "application/octet-stream")
                    if url.path == "/api/catalog/asset":            # .bin / textures of a .gltf
                        a = catalog.asset(item, q.get("path", [""])[0])
                        ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                                 ".webp": "image/webp"}.get(a.suffix.lower(), "application/octet-stream")
                        return self._bytes(a.read_bytes(), ctype)
                    if url.path == "/api/catalog/thumb":
                        png = catalog.get_thumb(item)
                        return self._bytes(png, "image/png") if png else self._json(404, {"error": "no thumbnail"})
                except ValueError as e:
                    return self._json(404, {"error": str(e)})
            if url.path == "/api/split/suggest":
                if not S.loaded:
                    return self._json(400, {"error": "no project is open"})
                from .split import load_object, pitch_hint_for, suggest
                name = q.get("name", [""])[0]
                entry = next((o for o in json.loads((S.project_dir / "scene.json").read_text())["objects"]
                              if o["name"] == name), None)
                if not entry:
                    return self._json(404, {"error": f"unknown object {name}"})
                try:
                    hint = pitch_hint_for(entry["size"], S.room_profile())
                    return self._json(200, suggest(load_object(S.project_dir / entry["file"]), hint))
                except Exception as e:  # noqa: BLE001
                    return self._json(400, {"error": str(e)})
            if url.path == "/api/islands":
                if not S.loaded:
                    return self._json(400, {"error": "no project is open"})
                import base64
                import numpy as np
                from . import split
                from .separate import island_borders, islands, separate
                try:
                    name = q.get("name", [""])[0]
                    entry = next((o for o in json.loads((S.project_dir / "scene.json").read_text())["objects"]
                                  if o["name"] == name), None)
                    if not entry:
                        raise ValueError(f"unknown object {name}")
                    geom = split.load_object(S.project_dir / entry["file"])
                    isl = islands(geom, float(q.get("size", ["0.15"])[0]))
                    start = q.get("start", ["auto"])[0]
                    k_req = q.get("k", [""])[0]
                    if start == "auto":
                        r = separate(geom, k=int(k_req) if k_req else None,
                                     pitch_hint=split.pitch_hint_for(entry["size"], S.room_profile()))
                        parts, k, method = r["labels"], r["k"], r["method"]
                    else:
                        parts, k, method = np.zeros(len(isl), int), 1, "one piece"
                    enc = lambda a: base64.b64encode(np.asarray(a, "<u4").tobytes()).decode()
                    encf = lambda a: base64.b64encode(np.asarray(a, "<f4").tobytes()).decode()
                    bd = island_borders(geom, isl)
                    return self._json(200, {"count": len(isl), "islands": enc(isl), "n": int(isl.max() + 1),
                                            "parts": enc(parts), "k": int(k), "method": method,
                                            "borders": {"a": enc(bd["a"]), "b": enc(bd["b"]),
                                                        "length": encf(bd["length"]), "angle": encf(bd["angle"])},
                                            "mesh": bool(getattr(geom, "faces", None) is not None and len(geom.faces))})
                except Exception as e:  # noqa: BLE001
                    return self._json(400, {"error": str(e)})
            if url.path == "/api/separate/preview":
                if not S.loaded:
                    return self._json(400, {"error": "no project is open"})
                from . import split
                k = q.get("k", [""])[0]
                try:
                    with S.lock:
                        name = q.get("name", [""])[0]
                        r = split.separate_object(S.project_dir, name, int(k) if k else None,
                                                  profile=S.room_profile(), preview=True)
                        S.preview = {"name": name, "k": r["k"], "result": r.pop("_result")}
                    return self._json(200, r)
                except Exception as e:  # noqa: BLE001
                    return self._json(400, {"error": str(e)})
            if url.path == "/api/job":
                j = S.jobs.get(q.get("id", [""])[0])
                if not j:
                    return self._json(404, {"error": "unknown job"})
                since = int(q.get("since", ["0"])[0] or 0)
                return self._json(200, {**j, "log": j["log"][since:], "lines": len(j["log"])})
            if url.path == "/api/download":
                if not S.loaded:
                    return self._json(400, {"error": "no project is open"})
                tmp = avjp.temp_dir("avjp-dl-") / f"{project_name(S.name)}.avjp"
                with S.lock:
                    avjp.pack(S.project_dir, tmp)
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Disposition", f'attachment; filename="{tmp.name}"')
                self.send_header("Content-Length", str(tmp.stat().st_size))
                self.end_headers()
                with open(tmp, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                shutil.rmtree(tmp.parent, ignore_errors=True)
                return
            if self._route_static():
                return super().do_GET()

        def do_POST(self):
            url = urlparse(self.path)
            q = parse_qs(url.query)
            # only the editor itself may write: block cross-site POSTs from other web pages
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{self.headers.get('Host')}":
                return self._json(403, {"error": "cross-origin request refused"})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_UPLOAD:
                return self._json(400, {"error": "empty or too large body"})
            body = self.rfile.read(n)
            try:
                if url.path == "/api/scan/upload":
                    f = S.stage_file(q.get("job", [""])[0], q.get("name", [""])[0], body)
                    return self._json(200, {"file": f})
                if url.path == "/api/scan/process":
                    return self._json(200, {"job": S.process(json.loads(body))})
                if url.path == "/api/open":
                    p = Path(json.loads(body).get("path", "")).expanduser()
                    if p.suffix.lower() != ".avjp" or not p.is_file():
                        raise ValueError(f"{p} is not an .avjp file")
                    S.open(p)
                    return self._json(200, S.info())
                if url.path == "/api/open-upload":
                    raw = Path(q.get("name", ["project.avjp"])[0]).name
                    if Path(raw).suffix.lower() != ".avjp":
                        raise ValueError("choose an .avjp file")
                    S.workspace.mkdir(parents=True, exist_ok=True)
                    dest = unique_path(S.workspace / f"{project_name(Path(raw).stem, 'project')}.avjp")
                    dest.write_bytes(body)
                    try:
                        S.open(dest)
                    except Exception:
                        dest.unlink(missing_ok=True)
                        raise
                    return self._json(200, S.info())

                if url.path in ("/api/catalog/add", "/api/catalog/remove", "/api/catalog/thumb"):
                    from . import catalog
                    if url.path == "/api/catalog/add":
                        g = lambda k: q.get(k, [None])[0]
                        return self._json(200, catalog.add(body, g("filename") or "", g("name"), g("category"),
                                                           g("up"), g("unit")))
                    if url.path == "/api/catalog/remove":
                        catalog.remove(json.loads(body).get("id", ""))
                        return self._json(200, {"ok": True})
                    size = q.get("size", [""])[0]
                    catalog.put_thumb(q.get("id", [""])[0], body, size.split(",") if size else None)
                    return self._json(200, {"ok": True})

                # everything below edits the open project
                if not S.project_dir:
                    return self._json(400, {"error": "no project is open"})
                if url.path == "/api/autosave":
                    data = json.loads(body)
                    if not isinstance(data, dict) or "objects" not in data:
                        raise ValueError("not a layout")
                    with S.lock:
                        (S.project_dir / "layout.json").write_text(json.dumps(data, indent=2))
                        S.touch()
                    return self._json(200, {"ok": True})
                if url.path in ("/api/recovery/restore", "/api/recovery/discard"):
                    (S.restore_recovery if url.path.endswith("restore") else S.discard_recovery)()
                    return self._json(200, S.info())
                if url.path in ("/api/layout", "/api/save"):
                    data = json.loads(body)
                    if not isinstance(data, dict) or "objects" not in data:
                        raise ValueError("not a layout")
                    if url.path == "/api/layout":
                        (S.project_dir / "layout.json").write_text(json.dumps(data, indent=2))
                        print(f"[view] saved {S.project_dir / 'layout.json'}")
                        return self._json(200, {"file": "layout.json"})
                    dest = S.save(data, q.get("name", [None])[0])
                    return self._json(200, {**S.info(), "avjp": str(dest)})
                if url.path in ("/api/separate", "/api/separate/cancel"):
                    from . import split
                    req = json.loads(body)
                    with S.lock:
                        split.cancel_preview(S.project_dir)
                        if url.path == "/api/separate/cancel":
                            S.preview = None
                            return self._json(200, {"ok": True})
                        pv = getattr(S, "preview", None)
                        same = pv and pv["name"] == req["name"] and pv["k"] == req.get("k", pv["k"])
                        r = split.separate_object(S.project_dir, req["name"], req.get("k"), req.get("record"),
                                                  profile=S.room_profile(), result=pv["result"] if same else None)
                        r.pop("_result", None)
                        S.preview, S.unsaved = None, True
                        S.touch()
                    print(f"[separate] {req['name']} -> {', '.join(r['split']['pieces'])} ({r['method']})")
                    return self._json(200, r)
                if url.path == "/api/split/parts":
                    import base64
                    import numpy as np
                    from . import split
                    req = json.loads(body)
                    labels = np.frombuffer(base64.b64decode(req["labels"]), "<u4")
                    with S.lock:
                        r = split.split_parts(S.project_dir, req["name"], labels, req.get("record"))
                        S.unsaved = True
                        S.touch()
                    print(f"[split] {req['name']} -> {', '.join(r['split']['pieces'])} (picked by hand)")
                    return self._json(200, r)
                if url.path in ("/api/split", "/api/unsplit"):
                    from . import split
                    req = json.loads(body)
                    with S.lock:
                        if url.path == "/api/split":
                            r = split.split_object(S.project_dir, req["name"], req.get("axis"), req.get("origin"),
                                                   req.get("cuts"), req.get("record"), planes=req.get("planes"))
                            print(f"[split] {req['name']} -> {', '.join(r['split']['pieces'])}")
                        else:
                            r = split.merge_back(S.project_dir, req["parent"], req.get("record"),
                                                 req.get("piece"))
                            print(f"[split] merged back {req['parent']}")
                        S.unsaved = True
                        S.touch()
                    return self._json(200, r)
                if url.path == "/api/catalog/place":
                    from . import catalog
                    r = catalog.place(json.loads(body).get("id", ""), S.project_dir)
                    S.touch()
                    return self._json(200, r)
                if url.path == "/api/import-bundle":
                    # one file of a multi-file .gltf import -> imports/<dir>/<path>
                    from . import catalog
                    folder = re.sub(r"[^A-Za-z0-9_-]+", "_", q.get("dir", [""])[0])[:60]
                    rel = catalog._rel_ok(q.get("path", [""])[0])
                    if not folder or rel.suffix.lower() not in (catalog.ASSET_EXT | {".gltf"}):
                        raise ValueError("unsupported file in a .gltf bundle")
                    dest = S.project_dir / "imports" / folder / Path(*rel.parts)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(body)
                    S.touch()
                    return self._json(200, {"file": f"imports/{folder}/{rel.as_posix()}"})
                if url.path == "/api/import":
                    name = _safe_name(q.get("name", [""])[0])
                    d = S.project_dir / "imports"
                    d.mkdir(exist_ok=True)
                    dest = unique_path(d / name)
                    dest.write_bytes(body)
                    S.touch()
                    print(f"[view] imported {dest}")
                    return self._json(200, {"file": f"imports/{dest.name}"})
            except Exception as e:  # noqa: BLE001
                return self._json(400, {"error": str(e)})
            return self._json(404, {"error": "unknown endpoint"})

    return Handler


def serve(target: str | Path | Session | None = None, port: int = 8765, open_browser: bool = True):
    """Serve a project folder, an .avjp file, a Session, or nothing (welcome screen)."""
    if isinstance(target, Session):
        session = target
    elif target is None:
        session = Session()
    elif Path(target).suffix.lower() == ".avjp":
        session = Session(workspace=Path(target).resolve().parent)
        session.open(Path(target))
    else:
        session = Session(project_dir=Path(target))
    # an editor already running (often an old one in another terminal) holds the port:
    # take the next free one instead of crashing
    for p in range(port, port + 20):
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", p), make_handler(session))
            break
        except OSError as e:
            if e.errno != 48 and "in use" not in str(e):
                raise
    else:
        sys.exit(f"ports {port}-{port + 19} are all busy - stop old editors with Ctrl+C in their terminals")
    if p != port:
        print(f"[view] port {port} is busy (another editor still running? stop it with Ctrl+C in its "
              f"terminal) - using {p}")
    port = p
    url = f"http://127.0.0.1:{port}/index.html"
    print(f"[view] editor at {url}   (Ctrl+C to stop)")
    if not session.loaded:
        print(f"[view] no project open - new projects are saved in {session.workspace}")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    def stop(signum, _frame):
        raise KeyboardInterrupt
    for sig in (signal.SIGTERM, signal.SIGHUP):          # kill / terminal closed: same as Ctrl+C
        try:
            signal.signal(sig, stop)
        except (ValueError, OSError):                     # not the main thread (tests)
            pass

    def every_90s():
        while True:
            time.sleep(90)
            session.write_recovery("autosave")
    threading.Thread(target=every_90s, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        session.write_recovery("editor stopped")
        httpd.server_close()
        print("bye")
