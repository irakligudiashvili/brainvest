"""Remove room structure from the mesh and split what is left into islands.

Every island that survives the clean-up filters is one furniture object.
"""
from __future__ import annotations

import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from .ransac import Plane

STRUCT_LABELS = ("floor", "ceiling", "wall", "floor_part", "ceiling_part", "wall_part")


def structural_faces(mesh: trimesh.Trimesh, planes: list[Plane], thr: float) -> np.ndarray:
    """Boolean mask of faces lying on a floor / wall / ceiling plane."""
    v = mesh.vertices
    f = mesh.faces
    struct = [p for p in planes if p.label in STRUCT_LABELS]
    mask = np.zeros(len(f), bool)
    cen = mesh.triangles_center
    fn = mesh.face_normals
    for pl in struct:
        dv = np.abs(pl.distance(v))
        near_v = dv < thr
        all_near = near_v[f].all(axis=1)
        # flat faces sitting slightly off the plane (scan noise / Poisson bulge)
        flat_near = (np.abs(pl.distance(cen)) < 2 * thr) & (np.abs(fn @ pl.normal) > 0.9)
        mask |= all_near | flat_near
    return mask


def outside_faces(mesh: trimesh.Trimesh, info: dict, thr: float) -> np.ndarray:
    """Faces entirely outside the room box (seen through doors / windows)."""
    v = mesh.vertices
    out_v = np.zeros(len(v), bool)
    out_v |= v[:, 2] < info["floor_h"] - 3 * thr
    if info.get("ceiling") is not None:
        out_v |= v[:, 2] > info["ceiling_h"] + 3 * thr
    for w in info["walls"]:
        out_v |= w.distance(v) < -3 * thr
    return out_v[mesh.faces].all(axis=1)


def face_components(mesh: trimesh.Trimesh, face_mask: np.ndarray, merge_tol: float) -> np.ndarray:
    """Connected components of the selected faces (-1 for unselected faces).

    Vertices are welded by position first so UV seams of textured
    photogrammetry meshes do not cut objects into pieces.
    """
    v = mesh.vertices
    key = np.round(v / merge_tol).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    fidx = np.nonzero(face_mask)[0]
    labels = -np.ones(len(mesh.faces), int)
    if len(fidx) == 0:
        return labels
    fv = weld[mesh.faces[fidx]]              # (F, 3) welded vertex ids
    n_f, n_v = len(fidx), weld.max() + 1
    # bipartite face–vertex graph -> components
    rows = np.repeat(np.arange(n_f), 3)
    cols = n_f + fv.ravel()
    g = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n_f + n_v, n_f + n_v))
    _, lab = connected_components(g, directed=False)
    face_lab = lab[:n_f]
    _, face_lab = np.unique(face_lab, return_inverse=True)
    labels[fidx] = face_lab
    return labels


def clean_islands(mesh: trimesh.Trimesh, labels: np.ndarray, planes: list[Plane], info: dict,
                  thr: float, min_height: float, min_area: float, merge_dist: float,
                  verbose: bool = False) -> np.ndarray:
    """Turn raw mesh islands into furniture objects.

    1. islands closer than ``merge_dist`` are joined (photogrammetry often
       breaks one chair into several pieces - a leg, the back ...),
    2. thin slabs hugging a structural plane are dropped (floor / wall
       leftovers, rugs, posters),
    3. islands lower than ``min_height`` or smaller than ``min_area`` are
       treated as noise.
    """
    struct = [p for p in planes if p.label in STRUCT_LABELS]
    ids = np.unique(labels[labels >= 0])
    out = -np.ones_like(labels)
    if len(ids) == 0:
        return out

    # --- 1. proximity merge (single linkage over surface samples) ---------
    sel = np.nonzero(labels >= 0)[0]
    sub = mesh.submesh([sel], append=True)
    sub_lab = labels[sel]
    n_s = int(min(400_000, max(20_000, sub.area / (0.5 * merge_dist) ** 2)))
    sp, sf = trimesh.sample.sample_surface(sub, n_s, seed=0)
    sp = np.vstack([sp, sub.triangles_center])
    sl = np.r_[sub_lab[sf], sub_lab]
    pairs = cKDTree(sp).query_pairs(merge_dist, output_type="ndarray")
    a, b = sl[pairs[:, 0]], sl[pairs[:, 1]]
    diff = a != b
    n = labels.max() + 1
    g = coo_matrix((np.ones(diff.sum()), (a[diff], b[diff])), shape=(n, n))
    _, group = connected_components(g, directed=False)
    merged = -np.ones_like(labels)
    merged[sel] = group[labels[sel]]

    # --- 2./3. filters -----------------------------------------------------
    tri = mesh.triangles
    areas = mesh.area_faces
    keep, n_hug, n_small = [], 0, 0
    for gid in np.unique(merged[sel]):
        fi = np.nonzero(merged == gid)[0]
        pts = tri[fi].reshape(-1, 3)
        height = np.ptp(pts[:, 2])
        hug = any(np.percentile(np.abs(pl.distance(pts)), 95) < 4 * thr for pl in struct)
        if hug:
            n_hug += 1
        elif height < min_height or areas[fi].sum() < min_area:
            n_small += 1
        else:
            keep.append(fi)
    # stable order: by x then y of the centroid
    keep.sort(key=lambda fi: tuple(np.round(tri[fi].reshape(-1, 3).mean(0)[:2], 1)))
    for new, fi in enumerate(keep):
        out[fi] = new
    if verbose:
        print(f"  islands: {len(ids)} raw -> {len(np.unique(group[ids]))} after merge -> "
              f"{len(keep)} objects ({n_hug} structure leftovers, {n_small} noise)")
    return out


def cluster_points(pts: np.ndarray, eps: float, min_points: int) -> np.ndarray:
    """Euclidean clustering (DBSCAN with min_samples=1 + size filter) for point clouds."""
    tree = cKDTree(pts)
    pairs = tree.query_pairs(eps, output_type="ndarray")
    n = len(pts)
    g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    _, lab = connected_components(g, directed=False)
    counts = np.bincount(lab)
    good = np.nonzero(counts >= min_points)[0]
    remap = -np.ones(lab.max() + 1, int)
    remap[good] = np.arange(len(good))
    return remap[lab]
