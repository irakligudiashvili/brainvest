"""Bake an editor layout (layout.json) into one rearranged mesh.

layout.json (written by the editor, glTF Y-up frame, metres):

    {"version": 2,
     "objects": {"chair_01": {"position": [x,y,z], "quaternion": [x,y,z,w],
                              "rotation_y": r, "visible": true, "deleted": false}, ...},
     "imports": [{"name": "lamp", "file": "imports/lamp.glb", "ext": "glb",
                  "up": "y", "unit_scale": 1.0, "position": [...], "quaternion": [...],
                  "visible": true}]}

Version 1 files (only "rotation_y") are still accepted.  Hidden and deleted
objects are left out of the baked mesh.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import trimesh

from .pipeline import Z2Y
from .textures import load as load_shared


def _matrix(rec: dict) -> np.ndarray:
    M = np.eye(4)
    if rec.get("quaternion") is not None:
        x, y, z, w = rec["quaternion"]
        M = trimesh.transformations.quaternion_matrix([w, x, y, z])
    else:
        M = trimesh.transformations.rotation_matrix(rec.get("rotation_y", 0.0), [0, 1, 0])
    M[:3, 3] = rec["position"]
    return M


def load_import(path: Path, up: str = "y", unit_scale: float = 1.0) -> trimesh.Trimesh:
    """Load an imported file exactly like the editor does:
    original scale (x unit_scale), Z-up files turned Y-up, pivot moved to the
    footprint centre at the bottom of the object."""
    g = trimesh.load(str(path), force="mesh", process=False)
    g = g.copy()
    if up == "z":
        g.apply_transform(Z2Y)
    g.apply_scale(unit_scale or 1.0)
    lo, hi = g.bounds
    g.apply_translation([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
    return g


def apply_layout(out_dir: str | Path, layout_path: str | Path, dest: str | Path | None = None,
                 use_shell: bool = False) -> Path:
    out = Path(out_dir)
    layout = json.loads(Path(layout_path).read_text())
    objs = layout.get("objects", {})
    manifest = json.loads((out / "scene.json").read_text())

    scene = trimesh.Scene()
    room_file = out / ("room_shell.glb" if use_shell else "room_structure.glb")
    if not room_file.exists():
        room_file = out / "room_shell.glb"
    scene.add_geometry(trimesh.load(room_file, force="mesh"), node_name="room", geom_name="room")
    if not use_shell and (out / "room_shell.glb").exists():
        # the clean shell fills the holes the furniture left in the scan
        scene.add_geometry(trimesh.load(out / "room_shell.glb", force="mesh"),
                           node_name="room_shell", geom_name="room_shell")

    n = 0
    for o in manifest["objects"]:
        name = o["name"]
        rec = objs.get(name)
        if rec and (rec.get("deleted") or rec.get("visible") is False):
            continue
        geom = load_shared(out / o["file"], force="mesh")
        M = _matrix(rec) if rec else _matrix({"position": o["position_gltf"], "rotation_y": 0.0})
        scene.add_geometry(geom, node_name=f"furniture__{name}", geom_name=name, transform=M)
        n += 1

    for im in layout.get("imports", []):
        if im.get("deleted") or im.get("visible") is False:
            continue
        if not im.get("file") or not (out / im["file"]).exists():
            print(f"[layout] skipping import {im.get('name')}: file not found")
            continue
        geom = load_import(out / im["file"], im.get("up", "y"), im.get("unit_scale", 1.0))
        scene.add_geometry(geom, node_name=f"import__{im['name']}", geom_name=im["name"],
                           transform=_matrix(im))
        n += 1

    dest = Path(dest) if dest else out / "room_rearranged.glb"
    scene.export(dest)
    print(f"[layout] {n} objects -> {dest}")
    return dest
