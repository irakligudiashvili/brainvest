"""Photos / video -> textured room mesh.

Backends
--------
apple   Apple Object Capture (RealityKit).  Best choice on an Apple-Silicon
        Mac: fast, textured, roughly metric, Y up.  Needs Xcode command line
        tools (``xcode-select --install``) to compile tools/object_capture.swift.
colmap  COLMAP structure-from-motion.  Dense + Poisson mesh with COLMAP when
        it was built with CUDA, otherwise COLMAP sparse + OpenMVS
        (DensifyPointCloud / ReconstructMesh / TextureMesh) - works on macOS.

Tips for capturing a room: walk slowly along the walls, keep 60-80 % overlap
between photos, take 150-400 photos (or a slow video), avoid moving people,
switch on all lights, and shoot the floor around furniture too.
"""
from __future__ import annotations

import platform
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff"}


def _run(cmd: list[str], cwd: Path | None = None):
    print("$", " ".join(map(str, cmd)), flush=True)
    subprocess.run([str(c) for c in cmd], cwd=cwd, check=True)


def _need(tool: str, hint: str):
    if shutil.which(tool) is None:
        raise SystemExit(f"'{tool}' not found. {hint}")


def extract_frames(video: Path, out_dir: Path, fps: float = 2.0) -> Path:
    """Video -> JPEG frames (needs ffmpeg)."""
    _need("ffmpeg", "Install it with: brew install ffmpeg")
    out_dir.mkdir(parents=True, exist_ok=True)
    _run(["ffmpeg", "-loglevel", "error", "-i", video, "-vf", f"fps={fps}", "-qscale:v", "2",
          out_dir / "frame_%05d.jpg"])
    return out_dir


def default_backend() -> str:
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "apple"
    return "colmap"


def reconstruct(inp: str | Path, work: str | Path, backend: str | None = None,
                detail: str = "medium", fps: float = 2.0) -> Path:
    """Run photogrammetry. ``inp`` is a folder of images or a video file."""
    inp, work = Path(inp), Path(work)
    work.mkdir(parents=True, exist_ok=True)
    if inp.is_file():
        images = extract_frames(inp, work / "frames", fps)
    else:
        images = inp
    n = sum(1 for f in images.iterdir() if f.suffix.lower() in IMAGE_EXT)
    print(f"[photogrammetry] {n} images in {images}")
    if n < 10:
        raise SystemExit("Need at least ~10 overlapping photos (100+ recommended for a room).")
    backend = backend or default_backend()
    if backend == "apple":
        return _apple(images, work, detail)
    if backend == "colmap":
        return _colmap(images, work)
    raise SystemExit(f"unknown backend {backend}")


def _apple(images: Path, work: Path, detail: str) -> Path:
    if platform.system() != "Darwin":
        raise SystemExit("The apple backend needs macOS 12+.")
    exe = ROOT / "tools" / "object_capture"
    src = ROOT / "tools" / "object_capture.swift"
    if not exe.exists() or exe.stat().st_mtime < src.stat().st_mtime:
        _need("swiftc", "Install the Xcode command line tools: xcode-select --install")
        _run(["swiftc", "-O", src, "-o", exe])
    out = work / "apple_model"
    _run([exe, images, out, detail])
    objs = sorted(out.rglob("*.obj")) or sorted(out.rglob("*.usd*"))
    if not objs:
        raise SystemExit(f"Object Capture produced no model in {out}")
    if objs[0].suffix != ".obj":
        raise SystemExit(f"Got {objs[0]} - convert it to OBJ/GLB (e.g. in Reality Composer or Blender).")
    print(f"[photogrammetry] mesh: {objs[0]}")
    return objs[0]


def _colmap_has_cuda() -> bool:
    try:
        r = subprocess.run(["colmap", "-h"], capture_output=True, text=True)
        txt = (r.stdout + r.stderr).lower()
        return "with cuda" in txt
    except FileNotFoundError:
        return False


def _colmap(images: Path, work: Path) -> Path:
    _need("colmap", "Install it with: brew install colmap  (or see colmap.github.io)")
    ws = work / "colmap"
    ws.mkdir(exist_ok=True)
    if _colmap_has_cuda():
        _run(["colmap", "automatic_reconstructor", "--workspace_path", ws, "--image_path", images,
              "--dense", "1", "--quality", "high", "--data_type", "individual"])
        for name in ("meshed-poisson.ply", "meshed-delaunay.ply", "fused.ply"):
            hits = sorted(ws.rglob(name))
            if hits:
                return hits[0]
        raise SystemExit("COLMAP finished but no mesh was found.")

    # --- sparse with COLMAP, dense + mesh + texture with OpenMVS -----------
    _need("DensifyPointCloud", "No CUDA COLMAP: install OpenMVS (github.com/cdcseacave/openMVS) "
                               "and put its binaries on PATH.")
    _run(["colmap", "automatic_reconstructor", "--workspace_path", ws, "--image_path", images,
          "--dense", "0", "--data_type", "individual"])
    sparse = sorted((ws / "sparse").iterdir())[0]
    dense = ws / "undistorted"
    _run(["colmap", "image_undistorter", "--image_path", images, "--input_path", sparse,
          "--output_path", dense, "--output_type", "COLMAP"])
    mvs = work / "openmvs"
    mvs.mkdir(exist_ok=True)
    _run(["InterfaceCOLMAP", "-i", dense, "-o", mvs / "scene.mvs", "--image-folder", dense / "images"], cwd=mvs)
    _run(["DensifyPointCloud", "scene.mvs"], cwd=mvs)
    _run(["ReconstructMesh", "scene_dense.mvs", "-o", "scene_mesh.ply"], cwd=mvs)
    _run(["TextureMesh", "scene_dense.mvs", "--mesh-file", "scene_mesh.ply",
          "--export-type", "obj", "-o", "scene_textured.mvs"], cwd=mvs)
    hits = sorted(mvs.glob("scene_textured*.obj")) or sorted(mvs.glob("scene_mesh*.ply"))
    if not hits:
        raise SystemExit("OpenMVS finished but no mesh was found.")
    return hits[0]
