"""Very light, geometry-only guess of what a furniture island is.

Only used for friendly names in the viewer; it is a heuristic, not a
classifier.  Expects metric units (metres), Z up, object origin on the floor.
"""
from __future__ import annotations

import numpy as np
import trimesh


def guess_category(mesh: trimesh.Trimesh, metric: bool = True) -> str:
    if not metric or len(mesh.faces) == 0:
        return "object"
    lo, hi = mesh.bounds
    w, d = sorted((hi - lo)[:2])[::-1]
    h = hi[2] - max(lo[2], 0.0)
    pts, fi = trimesh.sample.sample_surface(mesh, 4000, seed=1)
    nz = mesh.face_normals[fi][:, 2]
    z = pts[:, 2]
    rel = (z - lo[2]) / max(h, 1e-6)
    top_flat = ((np.abs(nz) > 0.9) & (rel > 0.85)).mean()
    mid = ((rel > 0.15) & (rel < 0.7)).mean()

    # how much of the surface lies on the bounding box (box-like furniture)
    # (robust box: percentiles ignore handles / knobs sticking out)
    blo, bhi = np.percentile(pts, 3, axis=0), np.percentile(pts, 97, axis=0)
    m = 0.06 * min(w, d, h) + 1e-3
    on_box = ((np.abs(pts - blo) < m) | (np.abs(pts - bhi) < m)).any(axis=1).mean()

    if 0.55 < h < 1.05 and w >= 0.7 and top_flat > 0.35 and mid < 0.35:
        return "table"
    if 0.6 < h < 1.3 and w <= 0.8 and d <= 0.8:
        return "chair"
    if h >= 0.3 and on_box > 0.6:
        return "drawers"
    if h > 1.3 and w > 0.8 and on_box > 0.5:
        return "wardrobe"
    return "object"
