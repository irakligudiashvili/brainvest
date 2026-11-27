"""Shape-based separation of merged objects (no slicing).

Segmentation only separates objects where there is empty space between them,
so seats sharing armrests, a table touching a cabinet ... come out as one
object. `separate()` splits such an object along its own shape:

1. Surface graph: triangles (vertices welded by position, so UV seams don't cut
   the surface) connected to their edge neighbours, plus short "proximity" links
   between nearby triangles of different shells (scans are rarely one surface).
2. Thickness field: the surface is voxelised (~2 cm), gaps are closed and the
   distance transform gives how thick the object is around every triangle.
3. Seeds, one per piece, from the first source that works:
   - "shape":   peel the volume at increasing depths; if it falls apart into the
                same number (>= 2) of big blobs for >= 2 depths in a row, each
                blob is a piece (e.g. seat cushions once thin armrests are gone)
   - "parts":   (editor only) several sizeable separate shells
   - "pattern": a repeating pattern along the main direction (split.suggest),
                seeds at the middle of each repeat
4. Growing: every triangle joins the seed it reaches most cheaply over the graph
   (multi-source Dijkstra). Steps across inward creases and thin necks are
   expensive, so boundaries settle where the parts actually meet.
5. Clean-up: tiny label islands join the neighbour they touch most.

Returns per-triangle (or per-point) labels; split.separate_object writes pieces.
"""
from __future__ import annotations

import numpy as np
import trimesh
from scipy import ndimage as ndi
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

CREASE_COST = 8.0      # extra cost for crossing a fully concave (inward) crease
NECK_COST = 4.0        # extra cost for passing through a thin neck
LINK_COST = 3.0        # extra cost for jumping between separate shells
MIN_BLOB = 0.15        # a "big" blob is >= this fraction of the largest one
AUTO_CONFIDENCE = 0.6  # pipeline auto-separation threshold


# ------------------------------------------------------------- utilities --
def _welded(geom: trimesh.Trimesh) -> trimesh.Trimesh:
    m = trimesh.Trimesh(np.asarray(geom.vertices), np.asarray(geom.faces), process=False)
    m.merge_vertices()
    return m


def _voxel_size(pts: np.ndarray) -> float:
    ext = float(np.ptp(pts, 0).max())
    return float(np.clip(ext / 150, 0.015, 0.03))


def _volume(pts: np.ndarray, vs: float):
    """closed, hole-filled occupancy grid + its distance transform (metres)"""
    lo = pts.min(0) - 3 * vs
    ijk = np.floor((pts - lo) / vs).astype(int)
    occ = np.zeros(ijk.max(0) + 4, bool)
    occ[tuple(ijk.T)] = True
    occ = ndi.binary_closing(occ, iterations=2)
    occ = ndi.binary_fill_holes(occ)
    return occ, ndi.distance_transform_edt(occ) * vs, lo


def _to_ijk(p, lo, vs, shape):
    return np.clip(np.floor((p - lo) / vs).astype(int), 0, np.array(shape) - 1)


# ----------------------------------------------------------------- seeds --
def _shape_seeds(edt, lo, vs, centres, k):
    """Peel the volume deeper and deeper; a blob count that holds for two depths
    in a row gives one seed per blob. Returns (seed label per element or -1, n, stability)."""
    depths = np.arange(max(vs, 0.02), 0.085, 0.01)
    counts, labs = [], []
    for r in depths:
        lab, n = ndi.label(edt > r)
        if n == 0:
            counts.append(0)
            labs.append(None)
            continue
        sizes = np.bincount(lab.ravel())[1:]
        big = np.nonzero((sizes >= MIN_BLOB * sizes.max()) & (sizes >= 8))[0] + 1
        counts.append(len(big))
        keep = np.zeros(n + 1, int)
        keep[big] = np.arange(1, len(big) + 1)
        labs.append((keep[lab], r))
    best = None
    i = 0
    while i < len(counts):
        j = i
        while j + 1 < len(counts) and counts[j + 1] == counts[i]:
            j += 1
        run, c = j - i + 1, counts[i]
        if c >= 2 and run >= 2 and (k is None or c == k):
            if best is None or run > best[1] or (run == best[1] and c > best[2]):
                best = (i, run, c)
        i = j + 1
    if best is None:
        return None, 0, 0
    lab, r = labs[best[0]]
    # elements near a blob core take that blob as their seed
    dist, (ii, jj, kk) = ndi.distance_transform_edt(lab == 0, return_indices=True)
    q = _to_ijk(centres, lo, vs, lab.shape)
    near = dist[tuple(q.T)] * vs <= r + 1.5 * vs
    seed = np.where(near, lab[ii[tuple(q.T)], jj[tuple(q.T)], kk[tuple(q.T)]] - 1, -1)
    return seed, best[2], best[1]


def _pattern_seeds(geom, centres, k, pitch_hint):
    from .split import suggest
    s = suggest(geom, pitch_hint)
    ax, o = np.array(s["axis"]), np.array(s["origin"])
    if k and k != s["count"]:
        b = list(np.linspace(s["tmin"], s["tmax"], k + 1))
        conf, src = 0.5, "pattern (count set by you)"
    else:
        b = [s["tmin"]] + s["cuts"] + [s["tmax"]]
        conf = {"own pattern": float(np.clip(0.5 + (s["confidence"] - 0.3) * 1.7, 0.5, 0.95)),
                "similar objects in this room": 0.65}.get(s["pitch_source"], 0.2)
        src = "pattern" if s["pitch_source"] != "no repeating pattern: cut in two at the emptiest spot near the middle" \
            else "middle (no pattern)"
    mids = [(b[i] + b[i + 1]) / 2 for i in range(len(b) - 1)]
    width = min(0.08, 0.15 * (b[1] - b[0]))
    t = (centres[:, [0, 2]] - o) @ ax
    y = centres[:, 1]
    lo_y, h = y.min(), np.ptp(y) or 1.0
    band = (y > lo_y + 0.3 * h) & (y < lo_y + 0.7 * h)
    seed = np.full(len(centres), -1)
    for i, c in enumerate(mids):
        sel = np.nonzero((np.abs(t - c) < width) & band)[0]
        if not len(sel):
            sel = np.array([np.argmin(np.abs(t - c) + np.abs(y - (lo_y + h / 2)))])
        seed[sel] = i
    return seed, len(mids), conf, src


def _parts_seeds(comp, area, k):
    total = area.sum()
    per = np.bincount(comp, weights=area)
    big = np.nonzero(per >= 0.1 * total)[0]
    if not 2 <= len(big) <= 12 or (k and len(big) != k):
        return None, 0
    remap = np.full(len(per), -1)
    remap[big] = np.arange(len(big))
    return remap[comp], len(big)


# ---------------------------------------------------------------- growing --
def _grow(n, ei, ej, w, seed, centres):
    G = coo_matrix((np.r_[w, w], (np.r_[ei, ej], np.r_[ej, ei])), shape=(n, n)).tocsr()
    src = np.nonzero(seed >= 0)[0]
    _, _, sources = dijkstra(G, indices=src, min_only=True, return_predecessors=True)
    lab = np.full(n, -1)
    ok = sources >= 0
    lab[ok] = seed[sources[ok]]
    if (~ok).any():                                     # cut off from every seed
        k = seed.max() + 1
        sc = np.array([centres[seed == i].mean(0) for i in range(k)])
        lab[~ok] = np.argmin(np.linalg.norm(centres[~ok, None] - sc[None], axis=2), 1)
    return lab


def _clean(lab, ei, ej, n, frac=0.02, rounds=2):
    """label islands smaller than `frac` of their label join the neighbour they touch most"""
    for _ in range(rounds):
        same = lab[ei] == lab[ej]
        g = coo_matrix((np.ones(same.sum()), (ei[same], ej[same])), shape=(n, n))
        _, comp = connected_components(g, directed=False)
        size_lab = np.bincount(lab, minlength=lab.max() + 1)
        size_comp = np.bincount(comp)
        changed = False
        for c in np.nonzero(size_comp < frac * size_lab[lab[np.unique(comp, return_index=True)[1]]].min() + 1)[0]:
            members = comp == c
            if members.sum() == size_lab[lab[members][0]]:
                continue                                 # the whole label - keep
            border = (members[ei] & ~members[ej])
            border2 = (members[ej] & ~members[ei])
            nb = np.r_[lab[ej[border]], lab[ei[border2]]]
            if len(nb):
                lab[members] = np.bincount(nb).argmax()
                changed = True
        if not changed:
            break
    return lab


# ------------------------------------------------------------------- main --
def separate(geom, k: int | None = None, pitch_hint: float | None = None, auto: bool = False) -> dict:
    """Split labels for `geom` (Trimesh or PointCloud, in its local Y-up frame).
    `k` forces the piece count; `auto` (pipeline) skips the "parts" seeds."""
    is_mesh = isinstance(geom, trimesh.Trimesh) and len(geom.faces) > 0
    if is_mesh:
        m = _welded(geom)
        centres = m.triangles_center
        area = m.area_faces
        pts, _ = trimesh.sample.sample_surface(m, int(min(400_000, max(50_000, m.area / 1e-4))), seed=0)
    else:
        centres = np.asarray(geom.vertices, float)
        area = np.ones(len(centres))
        pts = centres
    n = len(centres)
    vs = _voxel_size(pts)
    occ, edt, lo = _volume(pts, vs)
    th = edt[tuple(_to_ijk(centres, lo, vs, edt.shape).T)]
    th_ref = max(np.percentile(th, 75), vs)
    neck = np.clip(1 - th / th_ref, 0, 1)

    # ---- graph
    if is_mesh:
        adj = m.face_adjacency
        ei, ej = adj[:, 0], adj[:, 1]
        concave = (~m.face_adjacency_convex) * (m.face_adjacency_angles / np.pi)
        d = np.linalg.norm(centres[ei] - centres[ej], axis=1)
        w = d * (1 + CREASE_COST * concave) * (1 + NECK_COST * (neck[ei] + neck[ej]) / 2)
        g = coo_matrix((np.ones(len(ei)), (ei, ej)), shape=(n, n))
        ncomp, comp = connected_components(g, directed=False)
        if ncomp > 1:                                   # link separate shells that nearly touch
            pairs = cKDTree(centres).query_pairs(2.5 * vs, output_type="ndarray")
            pairs = pairs[comp[pairs[:, 0]] != comp[pairs[:, 1]]]
            if len(pairs):
                dl = np.linalg.norm(centres[pairs[:, 0]] - centres[pairs[:, 1]], axis=1)
                ei, ej = np.r_[ei, pairs[:, 0]], np.r_[ej, pairs[:, 1]]
                # touching shells link cheaply; the cost climbs fast with the gap
                w = np.r_[w, (dl + vs) * (1 + LINK_COST + 20 * (dl / (2.5 * vs)) ** 2)]
    else:
        dd, nn = cKDTree(centres).query(centres, k=9)
        ei = np.repeat(np.arange(n), 8)
        ej = nn[:, 1:].ravel()
        d = dd[:, 1:].ravel()
        w = d * (1 + NECK_COST * (neck[ei] + neck[ej]) / 2)
        comp = np.zeros(n, int)
    w = np.maximum(w, 1e-9)

    # ---- seeds: shape blobs are trusted when the repeat pattern agrees (or there is
    # no pattern at all); otherwise the pattern decides where pieces are
    p_seed, p_count, p_conf, p_method = _pattern_seeds(geom, centres, k, pitch_hint)
    has_pattern = p_method.startswith("pattern")
    s_seed, s_count, stab = _shape_seeds(edt, lo, vs, centres, k)
    s_ok = s_seed is not None and len(np.unique(s_seed[s_seed >= 0])) == s_count
    if s_ok and has_pattern and s_count == p_count:
        seed, method = s_seed, "shape + pattern agree"
        conf = min(0.95, max(p_conf, 0.65) + 0.15)
    elif s_ok and not has_pattern:
        seed, method = s_seed, "shape"
        conf = min(0.9, 0.55 + 0.1 * (stab - 2))
    else:
        seed = None
        if not auto and is_mesh and not has_pattern:
            seed, count = _parts_seeds(comp, area, k)
            method, conf = "separate parts", 0.5
        if seed is None:
            seed, method, conf = p_seed, p_method, p_conf

    lab = _grow(n, ei, ej, w, seed, centres)
    lab = _clean(lab, ei, ej, n)
    # a small separate surface (a leg, a handle ...) goes whole to the piece most of it chose
    if is_mesh and comp.max() > 0:
        per_piece = np.bincount(lab, weights=area)
        shell_area = np.bincount(comp, weights=area)
        for c in np.nonzero(shell_area < 0.25 * per_piece.min())[0]:
            members = comp == c
            lab[members] = np.bincount(lab[members], weights=area[members]).argmax()
    # pieces with under 3 % of the surface are not real parts: join a neighbour
    while lab.max() > 0:
        _, lab = np.unique(lab, return_inverse=True)
        per = np.bincount(lab, weights=area)
        small = int(np.argmin(per))
        if per[small] >= 0.03 * per.sum():
            break
        a, b = lab[ei] == small, lab[ej] == small
        nb = np.r_[lab[ej[a & ~b]], lab[ei[b & ~a]]]
        if len(nb):
            lab[lab == small] = np.bincount(nb).argmax()
        else:                                           # isolated: nearest other piece
            others = lab != small
            tree = cKDTree(centres[others])
            _, ix = tree.query(centres[lab == small])
            lab[lab == small] = np.bincount(lab[others][ix]).argmax()
    _, lab = np.unique(lab, return_inverse=True)
    sizes = np.bincount(lab, weights=area)
    balance = float(sizes.min() / max(np.median(sizes), 1e-12))
    conf *= 0.6 + 0.4 * min(1.0, balance / 0.5)
    return {"labels": lab, "k": int(lab.max() + 1), "method": method,
            "confidence": round(float(conf), 3), "voxel": round(vs, 4)}


# ---------------------------------------------------------------- islands --
def islands(geom, size: float = 0.15) -> np.ndarray:
    """Over-segment an object into small natural patches ("islands") for picking
    by hand in the editor's Split tab: seeds spread ~`size` apart (farthest-point),
    grown with the same crease- and neck-aware costs as `separate`, so patch
    borders follow creases and seams. Separate shells never share an island.
    Returns an island id per triangle (mesh) or per point (point cloud)."""
    size = float(np.clip(size, 0.03, 1.0))
    is_mesh = isinstance(geom, trimesh.Trimesh) and len(geom.faces) > 0
    if is_mesh:
        m = _welded(geom)
        centres = m.triangles_center
        pts, _ = trimesh.sample.sample_surface(m, int(min(300_000, max(30_000, m.area / 1e-4))), seed=0)
        adj = m.face_adjacency
        ei, ej = adj[:, 0], adj[:, 1]
        concave = (~m.face_adjacency_convex) * (m.face_adjacency_angles / np.pi)
    else:
        centres = np.asarray(geom.vertices, float)
        pts = centres
        _, nn = cKDTree(centres).query(centres, k=min(9, len(centres)))
        ei = np.repeat(np.arange(len(centres)), nn.shape[1] - 1)
        ej = nn[:, 1:].ravel()
        concave = np.zeros(len(ei))
    n = len(centres)
    vs = _voxel_size(pts)
    _, edt, lo = _volume(pts, vs)
    th = edt[tuple(_to_ijk(centres, lo, vs, edt.shape).T)]
    neck = np.clip(1 - th / max(np.percentile(th, 75), vs), 0, 1)
    d = np.linalg.norm(centres[ei] - centres[ej], axis=1)
    w = np.maximum(d * (1 + CREASE_COST * concave) * (1 + NECK_COST * (neck[ei] + neck[ej]) / 2), 1e-9)
    g = coo_matrix((np.ones(len(ei)), (ei, ej)), shape=(n, n))
    _, comp = connected_components(g, directed=False)

    # farthest-point seeds inside every shell, about `size` apart
    seed = np.full(n, -1)
    k = 0
    for c in np.unique(comp):
        idx = np.nonzero(comp == c)[0]
        P = centres[idx]
        first = int(np.argmin(np.linalg.norm(P - P.mean(0), axis=1)))
        dmin = np.linalg.norm(P - P[first], axis=1)
        seed[idx[first]] = k
        k += 1
        while dmin.max() > 0.75 * size:
            j = int(np.argmax(dmin))
            seed[idx[j]] = k
            k += 1
            dmin = np.minimum(dmin, np.linalg.norm(P - P[j], axis=1))
    lab = _grow(n, ei, ej, w, seed, centres)
    _, lab = np.unique(lab, return_inverse=True)
    return lab


def island_borders(geom, isl: np.ndarray) -> dict:
    """Which islands touch along the surface, for the editor's bucket fill:
    {"a", "b": island pairs (a < b), "length": shared border length (m),
     "angle": length-weighted mean bend across that border (degrees, 0 = flat)}.
    Islands that only sit near each other (separate shells, "floating") have no
    border, so a fill never jumps to them."""
    if not (isinstance(geom, trimesh.Trimesh) and len(geom.faces)):
        z = np.zeros(0)
        return {"a": z.astype(int), "b": z.astype(int), "length": z, "angle": z}
    m = _welded(geom)
    adj, edges = m.face_adjacency, m.face_adjacency_edges
    ia, ib = isl[adj[:, 0]], isl[adj[:, 1]]
    cross = ia != ib
    a, b = np.minimum(ia, ib)[cross], np.maximum(ia, ib)[cross]
    e = edges[cross]
    length = np.linalg.norm(m.vertices[e[:, 0]] - m.vertices[e[:, 1]], axis=1)
    ang = np.degrees(m.face_adjacency_angles[cross])
    key = a.astype(np.int64) * (int(isl.max()) + 1) + b
    uk, inv = np.unique(key, return_inverse=True)
    L = np.bincount(inv, weights=length)
    A = np.bincount(inv, weights=length * ang) / np.maximum(L, 1e-12)
    n = int(isl.max()) + 1
    return {"a": (uk // n).astype(int), "b": (uk % n).astype(int), "length": L, "angle": A}
