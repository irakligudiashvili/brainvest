"""Split any object into pieces with vertical cuts.

Segmentation only separates objects where there is empty space between them,
so things that touch (seats sharing armrests, a table pushed against a bench,
a desk with its drawers ...) come out as one object. This module cuts an object
with vertical planes, for whatever it is:

  suggest(geom)          -> automatic guess: main direction, piece count, cut positions
  split_object(...)      -> cut objects/<name>.glb into objects/<name>_1.glb, _2 ...,
                            fill the cut openings, update scene.json (+ "splits" record)
  merge_back(...)        -> undo a split

Everything works in the object's own local frame (glTF Y-up, pivot = footprint
centre at the bottom). A cut is the vertical plane  (p_xz - origin) . axis = t.
scene.glb is never rewritten: the editor reconciles it with scene.json on load,
and apply-layout reads every object from scene.json anyway.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import trimesh

from .textures import export_glb, load as load_shared

REPEAT_MIN, REPEAT_MAX = 0.40, 1.2    # searched widths of repeating parts (metres)
MIN_CONFIDENCE = 0.3


# ------------------------------------------------------------------ load --
def load_object(path: str | Path):
    g = load_shared(path, process=False)          # finds textures shared via textures/
    if isinstance(g, trimesh.Scene):
        geoms = list(g.geometry.values())
        if len(geoms) == 1:
            g = geoms[0]
        else:
            g = trimesh.util.concatenate([x for x in geoms if isinstance(x, trimesh.Trimesh)])
    return g


def _points(geom, n=40_000):
    if isinstance(geom, trimesh.Trimesh) and len(geom.faces):
        pts, _ = trimesh.sample.sample_surface(geom, n, seed=0)
        return pts
    v = np.asarray(geom.vertices)
    if len(v) > n:
        v = v[np.random.default_rng(0).choice(len(v), n, replace=False)]
    return v


# --------------------------------------------------------------- suggest --
def suggest(geom, fallback_pitch: float | None = None) -> dict:
    """Guess where to cut an object. All values in the object's local frame.

    Looks for a repeating pattern along the object's main direction (a row of
    seats, a bank of lockers ...). Without one it uses `fallback_pitch` (the
    width found on similar objects in the same room) or, failing that, proposes
    two pieces cut at the emptiest spot near the middle."""
    pts = _points(geom)
    xz = pts[:, [0, 2]]
    origin = xz.mean(0)
    # main direction of the footprint
    w, vecs = np.linalg.eigh(np.cov((xz - origin).T))
    axis = vecs[:, np.argmax(w)]
    if abs(axis[0]) >= abs(axis[1]):
        axis = axis * np.sign(axis[0])
    else:
        axis = axis * np.sign(axis[1])
    t = (xz - origin) @ axis
    tmin, tmax = float(t.min()), float(t.max())
    length = tmax - tmin

    y = pts[:, 1]
    h = float(np.ptp(y)) or 1.0
    band = (y > y.min() + 0.25 * h) & (y < y.min() + 0.9 * h)
    if band.sum() < 100:
        band[:] = True
    step = 0.01
    edges = np.arange(tmin, tmax + step, step)
    hist, _ = np.histogram(t[band], edges)
    dens = np.convolve(hist, np.ones(5) / 5, mode="same")           # 5 cm smoothing
    centres = edges[:-1] + step / 2

    pitch, conf = None, 0.0
    lag_lo, lag_hi = int(REPEAT_MIN / step), int(REPEAT_MAX / step)
    if len(dens) > 2 * lag_lo:
        d = dens - dens.mean()
        ac = np.correlate(d, d, "full")[len(d) - 1:]
        if ac[0] > 0:
            ac = ac / ac[0]
            hi = min(lag_hi, len(ac) // 3)                 # at least three repeats must fit
            if hi > lag_lo:
                k = lag_lo + int(np.argmax(ac[lag_lo:hi + 1]))
                conf = float(max(ac[k], 0.0))
                if conf >= MIN_CONFIDENCE:
                    pitch = k * step
                    # a width shared by similar objects wins when it fits this one
                    # almost as well (avoids locking onto half / double repeats)
                    if fallback_pitch:
                        kf = int(round(fallback_pitch / step))
                        win = ac[max(kf - 3, 0):kf + 4]
                        if kf < len(ac) and len(win) and win.max() >= 0.8 * ac[k]:
                            pitch = None
    source = "own pattern"
    if pitch is None and fallback_pitch and length >= 1.5 * fallback_pitch:
        pitch, source = fallback_pitch, "similar objects in this room"

    def emptiest(nominal, win_half):
        win = np.abs(centres - nominal) <= win_half
        # cut where the profile is emptiest: gaps, thin connecting parts
        return float(centres[win][np.argmin(dens[win])]) if win.any() else nominal

    cuts = []
    if pitch is None:
        source, count = "no repeating pattern: cut in two at the emptiest spot near the middle", 2
        cuts = [round(emptiest((tmin + tmax) / 2, 0.25 * length), 4)]
    else:
        count = max(2, int(round(length / pitch)))
        p = length / count
        for i in range(1, count):
            nominal = tmin + i * p
            c = emptiest(nominal, p / 3)
            if cuts and c - cuts[-1] < 0.2 * p:
                c = nominal
            cuts.append(round(c, 4))
    return {
        "axis": [round(float(axis[0]), 6), round(float(axis[1]), 6)],
        "origin": [round(float(origin[0]), 5), round(float(origin[1]), 5)],
        "tmin": round(tmin, 4), "tmax": round(tmax, 4), "length": round(length, 4),
        "height": round(float(pts[:, 1].max()), 4), "ymin": round(float(pts[:, 1].min()), 4),
        "count": count, "pitch": round(length / count, 4),
        "confidence": round(conf, 3), "low_confidence": conf < MIN_CONFIDENCE,
        "pitch_source": source,
        "cuts": cuts,
    }


def row_like(size) -> bool:
    """Long, low objects (canonical size x, y footprint, z height): rows of seats,
    benches, lockers ... - the ones that can share a repeat width."""
    sx, sy, sz = size
    return max(sx, sy) >= 1.2 and min(sx, sy) <= 1.2 and 0.3 < sz < 2.2


def room_profile(project_dir: str | Path) -> dict | None:
    """What the clearly repeating row-like objects of a room have in common:
    {"pitch": median repeat width, "depth": median depth, "height": median height}."""
    project = Path(project_dir)
    scene = _read(project)
    found = []
    for o in scene["objects"]:
        if not row_like(o["size"]):
            continue
        try:
            s = suggest(load_object(project / o["file"]))
        except Exception:  # noqa: BLE001
            continue
        if not s["low_confidence"] and s["pitch_source"] == "own pattern":
            found.append((s["pitch"], min(o["size"][:2]), o["size"][2]))
    if len(found) < 2:
        return None
    a = np.median(np.array(found), 0)
    return {"pitch": float(a[0]), "depth": float(a[1]), "height": float(a[2]), "rows": len(found)}


def room_pitch(project_dir: str | Path) -> float | None:
    p = room_profile(project_dir)
    return p["pitch"] if p else None


def pitch_hint_for(size, profile: dict | None) -> float | None:
    """The room's repeat width, for objects shaped like the rows that defined it
    (depth and height within 35 %)."""
    if not profile or not row_like(size):
        return None
    depth, height = min(size[:2]), size[2]
    if abs(depth - profile["depth"]) > 0.35 * profile["depth"] or abs(height - profile["height"]) > 0.35 * profile["height"]:
        return None
    return profile["pitch"]


# --------------------------------------------------------- triangle cutting --
class _Soup:
    """Triangle soup (no shared vertices) with per-corner UVs / colours, so a
    plane can cut triangles exactly and the attributes are interpolated."""

    def __init__(self, tri, uv=None, col=None, material=None):
        self.tri, self.uv, self.col, self.material = tri, uv, col, material

    @classmethod
    def from_mesh(cls, m: trimesh.Trimesh):
        f = m.faces
        uv = col = mat = None
        vis = m.visual
        if getattr(vis, "kind", None) == "texture" and getattr(vis, "uv", None) is not None \
                and len(vis.uv) == len(m.vertices):
            uv, mat = np.asarray(vis.uv, float)[f], vis.material
        elif getattr(vis, "kind", None) == "vertex":
            col = np.asarray(vis.vertex_colors, float)[f]
        return cls(np.asarray(m.vertices, float)[f], uv, col, mat)

    def _take(self, sel):
        return _Soup(self.tri[sel], None if self.uv is None else self.uv[sel],
                     None if self.col is None else self.col[sel], self.material)

    @staticmethod
    def _cat(parts):
        parts = [p for p in parts if len(p.tri)]
        if not parts:
            return None
        cat = lambda k: None if getattr(parts[0], k) is None else np.concatenate([getattr(p, k) for p in parts])
        return _Soup(np.concatenate([p.tri for p in parts]), cat("uv"), cat("col"), parts[0].material)

    def cut(self, dist):
        """Split by a plane given as dist(points (...,3)) -> signed distance.
        Returns (negative side, positive side, cut segments). The segments are
        where the surface crosses the plane: {"p": (S,2,3), "uv", "col"}."""
        d = dist(self.tri)                                    # (F, 3)
        pos = d >= 0
        n_pos = pos.sum(1)
        neg_all, pos_all, mixed = n_pos == 0, n_pos == 3, (n_pos == 1) | (n_pos == 2)
        lo, hi = [self._take(neg_all)], [self._take(pos_all)]
        seg = {"p": np.zeros((0, 2, 3)), "uv": None, "col": None}
        mi = np.nonzero(mixed)[0]
        if len(mi):
            # rotate each triangle so the lone vertex (alone on its side) is corner 0
            lone_is_pos = n_pos[mi] == 1
            lone = np.where(lone_is_pos, np.argmax(pos[mi], 1), np.argmin(pos[mi], 1))
            order = (lone[:, None] + np.arange(3)) % 3       # cyclic: keeps the winding
            rows = mi[:, None]

            def g(a):
                return None if a is None else a[rows, order]
            T, U, C, D = g(self.tri), g(self.uv), g(self.col), d[rows, order]
            tab = (D[:, 0] / (D[:, 0] - D[:, 1]))[:, None]
            tac = (D[:, 0] / (D[:, 0] - D[:, 2]))[:, None]

            def lerp(A):
                if A is None:
                    return None
                a, b, c = A[:, 0], A[:, 1], A[:, 2]
                pab, pac = a + (b - a) * tab, a + (c - a) * tac
                one = np.stack([a, pab, pac], 1)                                  # lone side
                two = np.concatenate([np.stack([pab, b, c], 1), np.stack([pab, c, pac], 1)])
                return one, two, np.stack([pab, pac], 1)
            (t1, t2, sp), uvp, colp = lerp(T), lerp(U), lerp(C)
            seg = {"p": sp, "uv": uvp and uvp[2], "col": colp and colp[2]}
            one = _Soup(t1, uvp and uvp[0], colp and colp[0], self.material)
            two = _Soup(t2, uvp and uvp[1], colp and colp[1], self.material)
            # split by which side the lone vertex was on
            lp = np.concatenate([lone_is_pos]), np.concatenate([lone_is_pos, lone_is_pos])
            hi += [one._take(lp[0]), two._take(~lp[1])]
            lo += [one._take(~lp[0]), two._take(lp[1])]
        return self._cat(lo), self._cat(hi), seg

    def to_mesh(self) -> trimesh.Trimesh:
        n = len(self.tri)
        faces = np.arange(n * 3).reshape(n, 3)
        verts = self.tri.reshape(-1, 3)
        if self.uv is not None:
            vis = trimesh.visual.TextureVisuals(uv=self.uv.reshape(-1, 2), material=self.material)
        elif self.col is not None:
            vis = trimesh.visual.ColorVisuals(vertex_colors=np.clip(self.col.reshape(-1, 4), 0, 255).astype(np.uint8))
        else:
            vis = None
        m = trimesh.Trimesh(verts, faces, visual=vis, process=False)
        m.merge_vertices()                                  # keeps UV seams (different UVs stay apart)
        return m


JOIN_GAP = 0.03       # open outline ends closer than this are joined (metres)


def _signed_area(P, poly):
    x, y = P[poly, 0], P[poly, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def _inside(P, poly, q):
    """even-odd point-in-polygon for points q (N, 2)"""
    a, b = P[poly], P[np.roll(poly, -1)]
    cross = (a[:, 1][None] > q[:, 1:2]) != (b[:, 1][None] > q[:, 1:2])
    with np.errstate(divide="ignore", invalid="ignore"):
        xint = a[:, 0][None] + (q[:, 1:2] - a[:, 1][None]) * (b[:, 0] - a[:, 0])[None] / (b[:, 1] - a[:, 1])[None]
    return (cross & (q[:, 0:1] < xint)).sum(1) % 2 == 1


def _segments_cross(p, q, A, B):
    """does segment p-q properly cross any of the segments A[i]-B[i]?"""
    def orient(a, b, c):
        return (b[..., 0] - a[..., 0]) * (c[..., 1] - a[..., 1]) - (b[..., 1] - a[..., 1]) * (c[..., 0] - a[..., 0])
    d1, d2 = orient(A, B, p), orient(A, B, q)
    d3, d4 = orient(p, q, A), orient(p, q, B)
    return bool(np.any((d1 * d2 < 0) & (d3 * d4 < 0)))


def _bridge(P, outer: list, holes: list) -> list:
    """Join holes (clockwise) into the outer polygon (counter-clockwise) with
    zero-width bridges, giving one polygon that ear clipping can fill."""
    poly = list(outer)
    for h in sorted(holes, key=lambda h: -P[h, 0].max()):
        h = list(h)
        m = max(range(len(h)), key=lambda i: P[h[i], 0])
        M = P[h[m]]
        edges_a = np.array([P[i] for i in poly] + [P[i] for hh in holes for i in hh])
        edges_b = np.array([P[poly[(i + 1) % len(poly)]] for i in range(len(poly))]
                           + [P[hh[(i + 1) % len(hh)]] for hh in holes for i in range(len(hh))])
        order = np.argsort(np.linalg.norm(P[poly] - M, axis=1))
        j = int(order[0])
        for cand in order:                              # nearest outer vertex M can "see"
            if not _segments_cross(M, P[poly[cand]], edges_a, edges_b):
                j = int(cand)
                break
        ring = h[m:] + h[:m] + [h[m]]
        poly = poly[:j + 1] + ring + poly[j:]
    return poly


def _earclip(P, poly: list) -> list:
    """Triangulate a simple counter-clockwise polygon (may contain bridges) using
    only its own vertices, so the fill meets the cut edge exactly."""
    idx, tris = list(poly), []
    k, stall = 0, 0
    while len(idx) > 3 and stall <= len(idx):
        n = len(idx)
        k %= n
        a, b, c = idx[k - 1], idx[k], idx[(k + 1) % n]
        A, B, C = P[a], P[b], P[c]
        cr = (B[0] - A[0]) * (C[1] - B[1]) - (B[1] - A[1]) * (C[0] - B[0])
        ok = cr > 1e-14 or (stall == n and cr >= -1e-14)       # collinear only when stuck
        if ok:
            others = np.array([i for i in idx if i not in (a, b, c)])
            if len(others):
                Q = P[others]
                d1 = (B[0] - A[0]) * (Q[:, 1] - A[1]) - (B[1] - A[1]) * (Q[:, 0] - A[0])
                d2 = (C[0] - B[0]) * (Q[:, 1] - B[1]) - (C[1] - B[1]) * (Q[:, 0] - B[0])
                d3 = (A[0] - C[0]) * (Q[:, 1] - C[1]) - (A[1] - C[1]) * (Q[:, 0] - C[0])
                # points strictly inside block the ear; duplicates of a/b/c (bridges) do not
                same = (np.abs(Q - A).sum(1) < 1e-12) | (np.abs(Q - B).sum(1) < 1e-12) | (np.abs(Q - C).sum(1) < 1e-12)
                ok = not np.any((d1 > 1e-14) & (d2 > 1e-14) & (d3 > 1e-14) & ~same)
        if ok:
            tris.append((a, b, c))
            idx.pop(k)
            stall = 0
        else:
            k += 1
            stall += 1
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


def _chain_loops(e: np.ndarray, pts: np.ndarray) -> list:
    """Chain edges (pairs of point indices) into closed outlines. Open chains
    (scans are rarely closed surfaces) are joined to nearby ends (< JOIN_GAP)
    and finally closed with a straight edge. `pts` may be 2-D or 3-D."""
    # ---- 1. chain segments into polylines
    adj: dict[int, list[int]] = {}
    for a, b in e:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    used: set[tuple[int, int]] = set()

    def walk(start, nxt):
        line = [start]
        prev, cur = start, nxt
        while True:
            used.add((min(prev, cur), max(prev, cur)))
            if cur == start:
                return line, True
            line.append(cur)
            cand = [x for x in adj[cur] if (min(cur, x), max(cur, x)) not in used]
            if len(adj[cur]) != 2 or not cand:
                return line, False
            prev, cur = cur, cand[0]

    lines = []
    for s in sorted(adj, key=lambda k: len(adj[k]) == 2):     # start at chain ends first
        for x in adj[s]:
            if (min(s, x), max(s, x)) not in used:
                lines.append(walk(s, x))

    # ---- 2. join open polylines whose ends are close, then close everything
    open_ = [ln for ln, closed in lines if not closed and len(ln) >= 2]
    loops = [ln for ln, closed in lines if closed and len(ln) >= 3]
    while open_:
        cur = open_.pop()
        joined = True
        while joined and open_:
            joined = False
            best, bd = None, JOIN_GAP
            for i, o in enumerate(open_):
                for flip_cur in (False, True):
                    for flip_o in (False, True):
                        a = cur[0] if flip_cur else cur[-1]
                        b = o[-1] if flip_o else o[0]
                        d = np.linalg.norm(pts[a] - pts[b])
                        if d < bd:
                            best, bd = (i, flip_cur, flip_o), d
            if best:
                i, fc, fo = best
                o = open_.pop(i)
                cur = (cur[::-1] if fc else cur) + (o[::-1] if fo else o)
                joined = True
        if len(cur) >= 3:
            loops.append(cur)
    return loops


def _cap(seg: dict, axis, origin, t: float, material) -> _Soup | None:
    """Fill the opening a cut leaves, as triangles lying on the cut plane and
    facing +axis. Works on messy scan meshes:
      1. the cut segments are chained into outlines,
      2. open outlines (scans are rarely closed surfaces) are joined to nearby
         ends and finally closed with a straight edge,
      3. outlines inside an odd number of others are holes (a hollow tube stays
         hollow); each outer outline gets its holes bridged in and is ear-clipped.
    Only the outline's own points are used, so the fill meets the cut edge exactly,
    and its UVs / colours come from that edge, so the texture continues."""
    P = seg["p"]
    if len(P) < 3:
        return None
    n = np.array([-axis[1], axis[0]])                        # horizontal direction on the plane
    u = (P[..., 0] - origin[0]) * n[0] + (P[..., 2] - origin[1]) * n[1]
    q2 = np.stack([u, P[..., 1]], -1).reshape(-1, 2)          # (2S, 2) plane coordinates
    attrs = [a.reshape(len(q2), -1) for a in (seg["uv"], seg["col"]) if a is not None]
    key = np.round(q2 / 1e-5).astype(np.int64)
    _, idx, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    pts = q2[idx]
    att = [a[idx] for a in attrs]
    e = inv.reshape(-1, 2)
    e = e[e[:, 0] != e[:, 1]]
    e = np.unique(np.sort(e, 1), axis=0)
    if len(e) < 3:
        return None

    loops = _chain_loops(e, pts)
    if not loops:
        return None

    # ---- 3. holes, bridges, ear clipping
    loops = [lp for lp in loops if abs(_signed_area(pts, lp)) > 1e-8]
    if not loops:
        return None
    firsts = np.array([pts[lp].mean(0) if len(lp) < 3 else pts[lp[0]] for lp in loops])
    depth = np.zeros(len(loops), int)
    for i, lp in enumerate(loops):
        ins = _inside(pts, np.array(lp), firsts)
        ins[i] = False
        depth += ins
    tris = []
    for i, lp in enumerate(loops):
        if depth[i] % 2:
            continue                                            # a hole: filled with its outer
        outer = lp if _signed_area(pts, lp) > 0 else lp[::-1]
        holes = []
        for j, hp in enumerate(loops):
            if depth[j] == depth[i] + 1 and _inside(pts, np.array(outer), pts[hp[:1]])[0]:
                holes.append(hp if _signed_area(pts, hp) < 0 else hp[::-1])
        tris += _earclip(pts, _bridge(pts, outer, holes) if holes else outer)
    if not tris:
        return None
    tri = np.array(tris)

    xyz = P.reshape(-1, 3)[idx]                                 # the exact cut points
    T = xyz[tri]
    # all cap triangles face +axis
    nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    flip = nrm @ np.array([axis[0], 0, axis[1]]) < 0
    tri[flip] = tri[flip][:, ::-1]
    uv = att[0][tri] if seg["uv"] is not None else None
    col = att[-1][tri] if seg["col"] is not None else None
    return _Soup(xyz[tri], uv, col, material)


def _flipped(s: _Soup) -> _Soup:
    r = lambda a: None if a is None else a[:, ::-1]
    return _Soup(s.tri[:, ::-1], r(s.uv), r(s.col), s.material)


def _planes_from(axis, origin, cuts) -> list:
    """parallel cuts along a row -> [(origin_xz, normal_xz), ...]"""
    axis = np.asarray(axis, float) / (np.linalg.norm(axis) or 1.0)
    origin = np.asarray(origin, float)
    return [(origin + axis * float(t), axis) for t in sorted(cuts)]


def _norm_planes(planes) -> list:
    out = []
    for pl in planes:
        o = np.asarray(pl["origin"] if isinstance(pl, dict) else pl[0], float)
        n = np.asarray(pl["normal"] if isinstance(pl, dict) else pl[1], float)
        if o.shape != (2,) or n.shape != (2,) or not np.linalg.norm(n):
            raise ValueError("a plane needs origin [x, z] and normal [nx, nz]")
        out.append((o, n / np.linalg.norm(n)))
    if not out:
        raise ValueError("no cuts given")
    return out


def _cut_mesh(geom: trimesh.Trimesh, planes, cap: bool = True) -> list:
    """Pieces of `geom` cut by vertical planes [(origin_xz, normal_xz), ...], in
    order: piece k is what lies behind plane k (against its normal) and was not
    taken by an earlier plane. Planes may be turned individually. Cuts are exact
    (textured) and, with `cap`, the opening each cut leaves is filled on both sides."""
    rest, out = _Soup.from_mesh(geom), []
    for o, n in planes:
        if rest is None:
            out.append(None)
            continue
        dist = lambda p, o=o, n=n: (p[..., 0] - o[0]) * n[0] + (p[..., 2] - o[1]) * n[1]
        left, rest, seg = rest.cut(dist)
        c = _cap(seg, n, o, 0.0, (left or rest).material) if cap and (left and rest) else None
        if c is not None:
            left = _Soup._cat([left, c])                     # left piece: opening faces +normal
            rest = _Soup._cat([rest, _flipped(c)])
        out.append(left)
    out.append(rest)
    return [None if s is None or len(s.tri) == 0 else s.to_mesh() for s in out]


# ----------------------------------------------------------------- helpers --
def _quat_rotate(q, v):
    x, y, z, w = q
    u = np.array([x, y, z])
    v = np.asarray(v, float)
    return v + 2 * np.cross(u, np.cross(u, v) + w * v)


def _gltf_to_canonical(p):
    x, y, z = p
    return [x, -z, y]


def _read(project: Path):
    return json.loads((project / "scene.json").read_text())


def _write(project: Path, scene: dict):
    tmp = project / "scene.json.tmp"
    tmp.write_text(json.dumps(scene, indent=2))
    tmp.replace(project / "scene.json")


def _taken_names(project: Path, scene: dict) -> set:
    names = {o["name"] for o in scene["objects"]}
    for sp in scene.get("splits", []):
        names.update(sp["pieces"])
        names.add(sp["parent"]["name"])
    names.update(f.stem for f in (project / "objects").rglob("*")
                 if f.is_file() and "_preview" not in f.parts)
    return names


def _piece_name(parent: str, k: int, taken: set) -> str:
    """Pieces are named after what they were cut from: object_09 -> object_09_1, _2 ...
    (a piece split again: object_09_2 -> object_09_2_1 ...)."""
    name, extra = f"{parent}_{k}", 2
    while name in taken:
        name = f"{parent}_{k}_{extra}"
        extra += 1
    taken.add(name)
    return name


def _object_files(project: Path, name: str):
    return [f for f in (project / "objects").glob(f"{name}.*") if f.is_file()]


# ------------------------------------------------------------------ split --
def _find(scene: dict, name: str):
    idx = next((i for i, o in enumerate(scene["objects"]) if o["name"] == name), None)
    if idx is None:
        raise ValueError(f"unknown object {name!r}")
    return idx, scene["objects"][idx]


def _piece_records(parent_record, pieces, offsets) -> dict:
    records = {}
    if parent_record:
        q = parent_record.get("quaternion") or [0, 0, 0, 1]
        P = np.asarray(parent_record["position"], float)
        for p in pieces:
            records[p] = {"position": (P + _quat_rotate(q, offsets[p])).round(5).tolist(),
                          "quaternion": list(q),
                          "visible": parent_record.get("visible", True) is not False,
                          "deleted": bool(parent_record.get("deleted"))}
    return records


def _write_pieces(project: Path, scene: dict, name: str, parts: list, info: dict,
                  parent_record: dict | None = None, preview: bool = False) -> dict:
    """Shared by plane split and shape separation: give every part its own pivot,
    write objects/<name>_N.glb (+ .obj), and - unless `preview` - replace the
    parent in scene.json with the pieces and keep the parent for merge_back."""
    idx, entry = _find(scene, name)
    is_mesh = any(isinstance(x, trimesh.Trimesh) for x in parts if x is not None)
    H = float(scene.get("room", {}).get("height") or 2.5)
    base_y = float(entry["position_gltf"][1])
    taken = _taken_names(project, scene)
    out_dir = project / "objects" / ("_preview" if preview else "")
    if preview:
        shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    pieces, offsets, out_entries = [], {}, []
    for part in parts:
        if part is None or (len(part.faces) < 4 if is_mesh else len(part.vertices) < 20):
            continue
        lo, hi = part.bounds
        py = 0.0 if base_y + lo[1] < 0.1 * H else float(lo[1])
        pivot = np.array([(lo[0] + hi[0]) / 2, py, (lo[2] + hi[2]) / 2])
        part.apply_translation(-pivot)
        pname = _piece_name(name, len(pieces) + 1, taken)
        export_glb(part, out_dir / f"{pname}.glb", project)
        if is_mesh and not preview:
            part.export(out_dir / f"{pname}.obj")
        pos_gltf = (np.asarray(entry["position_gltf"], float) + pivot).round(4).tolist()
        ext = (hi - lo)
        out_entries.append(dict(
            name=pname, category=entry.get("category", "object"), index=entry.get("index"),
            position=np.round(_gltf_to_canonical(pos_gltf), 4).tolist(),
            position_gltf=pos_gltf,
            size=[round(float(ext[0]), 4), round(float(ext[2]), 4), round(float(ext[1]), 4)],
            faces=int(len(part.faces)) if is_mesh else 0,
            points=int(len(part.vertices)),
            file=f"objects/{'_preview/' if preview else ''}{pname}.glb",
            split_from=name,
        ))
        pieces.append(pname)
        offsets[pname] = pivot.round(5).tolist()
    if len(pieces) < 2:
        for e in out_entries:
            for f in out_dir.glob(f"{e['name']}.*"):
                f.unlink()
        raise ValueError("that leaves fewer than two pieces")
    records = _piece_records(parent_record, pieces, offsets)
    if preview:
        return {"objects": out_entries, "records": records, "split": None, **info}

    keep = project / "objects" / "_split"                 # keep the original for merge_back
    keep.mkdir(exist_ok=True)
    for f in _object_files(project, name):
        shutil.move(str(f), keep / f.name)
    record = {"parent": entry, "pieces": pieces, "offsets": offsets,
              "original": f"objects/_split/{Path(entry['file']).name}", **info}
    scene["objects"][idx:idx + 1] = out_entries
    scene.setdefault("splits", []).append(record)
    _write(project, scene)
    return {"objects": out_entries, "records": records, "split": record, **info}


def split_object(project_dir: str | Path, name: str, axis=None, origin=None, cuts=None,
                 parent_record: dict | None = None, planes=None) -> dict:
    """Cut `name` with vertical planes: either parallel `cuts` along `axis` from
    `origin`, or `planes` = [{"origin": [x, z], "normal": [nx, nz]}, ...] that can
    each be turned (in order along the object). Returns {"objects": [scene.json
    entries], "records": {piece: layout record}, "split": split record}."""
    project = Path(project_dir)
    scene = _read(project)
    _, entry = _find(scene, name)
    if planes is None:
        if not cuts:
            raise ValueError("no cuts given")
        planes = _planes_from(axis, origin, cuts)
    planes = _norm_planes(planes)

    geom = load_object(project / entry["file"])
    if isinstance(geom, trimesh.Trimesh) and len(geom.faces) > 0:
        # triangles crossing a cut are cut in two (so a long triangle can't drag a
        # whole rail into one piece) and the openings are filled
        parts = _cut_mesh(geom, planes)
    else:
        v = np.asarray(geom.vertices)[:, [0, 2]]
        which = np.full(len(v), len(planes))
        for k in range(len(planes) - 1, -1, -1):           # earliest plane wins
            o, n = planes[k]
            which[(v - o) @ n < 0] = k
        parts = [_points_part(geom, np.nonzero(which == k)[0]) for k in range(len(planes) + 1)]
    info = {"method": "planes",
            "planes": [{"origin": o.round(5).tolist(), "normal": n.round(6).tolist()} for o, n in planes]}
    return _write_pieces(project, scene, name, parts, info, parent_record)


def split_parts(project_dir: str | Path, name: str, labels, parent_record: dict | None = None) -> dict:
    """Pieces chosen by hand in the editor: `labels` = piece number per triangle
    (or per point). Pieces keep the original triangles; openings are filled."""
    project = Path(project_dir)
    scene = _read(project)
    _, entry = _find(scene, name)
    geom = load_object(project / entry["file"])
    n = len(geom.faces) if isinstance(geom, trimesh.Trimesh) and len(geom.faces) else len(geom.vertices)
    labels = np.asarray(labels, int)
    if labels.shape != (n,):
        raise ValueError(f"expected {n} labels, got {labels.size}")
    _, labels = np.unique(labels, return_inverse=True)
    if labels.max() < 1:
        raise ValueError("assign the triangles to at least two pieces")
    parts = separate_parts(geom, labels)
    return _write_pieces(project, scene, name, parts, {"method": "picked by hand", "k": int(labels.max() + 1)},
                         parent_record)


def _points_part(geom, sel):
    if not len(sel):
        return None
    cols = getattr(geom, "colors", None)
    return trimesh.PointCloud(np.asarray(geom.vertices)[sel],
                              colors=cols[sel] if cols is not None and len(cols) else None)


# ------------------------------------------------------- shape separation --
def _fill_seams(geom: trimesh.Trimesh, welded: trimesh.Trimesh, rep: np.ndarray,
                labels: np.ndarray, i: int, soup: _Soup) -> _Soup:
    """Close the openings piece `i` got where it was attached to other pieces:
    the seam edges are chained into loops, each loop is projected on its best-fit
    plane and ear-clipped. Loops that are far from flat are left open."""
    adj, edges = welded.face_adjacency, welded.face_adjacency_edges
    a, b = labels[adj[:, 0]] == i, labels[adj[:, 1]] == i
    seam = edges[a ^ b]
    if len(seam) < 3:
        return soup
    V = welded.vertices
    loops = _chain_loops(np.unique(np.sort(seam, 1), axis=0), V)
    piece_c = welded.triangles_center[labels == i].mean(0)
    uv_all = getattr(geom.visual, "uv", None) if getattr(geom.visual, "kind", None) == "texture" else None
    add = []
    for lp in loops:
        P3 = V[lp]
        c = P3.mean(0)
        _, sv, vt = np.linalg.svd(P3 - c, full_matrices=False)
        span = sv[0] / np.sqrt(len(lp)) * 2
        if span <= 0 or sv[2] / np.sqrt(len(lp)) > 0.25 * span:        # not flat enough
            continue
        P2 = np.c_[(P3 - c) @ vt[0], (P3 - c) @ vt[1]]
        loc = list(range(len(lp)))
        if _signed_area(P2, loc) < 0:
            loc = loc[::-1]
        tris = _earclip(P2, loc)
        if not tris:
            continue
        T = np.array(lp)[np.array(tris)]
        tri = V[T]
        nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        if (nrm.sum(0) @ (c - piece_c)) < 0:             # face away from the piece
            T, tri = T[:, ::-1], tri[:, ::-1]
        uv = None
        if soup.uv is not None and uv_all is not None and len(uv_all) == len(geom.vertices):
            uv = np.asarray(uv_all, float)[rep[T]]
        elif soup.uv is not None:
            uv = np.zeros((len(T), 3, 2))
        col = None
        if soup.col is not None:
            col = np.asarray(geom.visual.vertex_colors, float)[rep[T]]
        add.append(_Soup(tri, uv, col, soup.material))
    return _Soup._cat([soup] + add) if add else soup


def separate_parts(geom, labels: np.ndarray, fill: bool = True) -> list:
    """Pieces of `geom` for per-face (mesh) / per-point (cloud) labels."""
    k = int(labels.max()) + 1
    if not (isinstance(geom, trimesh.Trimesh) and len(geom.faces) > 0):
        return [_points_part(geom, np.nonzero(labels == i)[0]) for i in range(k)]
    welded = trimesh.Trimesh(np.asarray(geom.vertices), np.asarray(geom.faces), process=False)
    welded.merge_vertices()
    rep = np.zeros(len(welded.vertices), int)
    rep[welded.faces.ravel()] = np.asarray(geom.faces).ravel()     # welded vertex -> an original one
    parts = []
    for i in range(k):
        fi = np.nonzero(labels == i)[0]
        if not len(fi):
            parts.append(None)
            continue
        soup = _Soup.from_mesh(geom)._take(fi)
        if fill:
            soup = _fill_seams(geom, welded, rep, labels, i, soup)
        parts.append(soup.to_mesh())
    return parts


def separate_object(project_dir: str | Path, name: str, k: int | None = None,
                    parent_record: dict | None = None, profile: dict | None = None,
                    preview: bool = False, auto: bool = False, result: dict | None = None) -> dict:
    """Shape-based separation (separate.py) of object `name`. With `preview` the
    pieces go to objects/_preview/ and scene.json is not touched. `result` (the
    "_result" of an earlier preview) makes accept give exactly the previewed pieces."""
    from .separate import separate
    project = Path(project_dir)
    scene = _read(project)
    _, entry = _find(scene, name)
    geom = load_object(project / entry["file"])
    r = result or separate(geom, k=k, pitch_hint=pitch_hint_for(entry["size"], profile), auto=auto)
    if r["k"] < 2:
        raise ValueError("no separate parts found")
    parts = separate_parts(geom, r["labels"])
    info = {"method": r["method"], "confidence": r["confidence"], "k": r["k"]}
    out = _write_pieces(project, scene, name, parts, info, parent_record, preview=preview)
    out["_result"] = r
    return out


def cancel_preview(project_dir: str | Path):
    shutil.rmtree(Path(project_dir) / "objects" / "_preview", ignore_errors=True)


def auto_separate(project_dir: str | Path, min_confidence: float | None = None, log=print) -> list:
    """Pipeline step: separate the merged-looking objects (row-like, or long compared
    with the room's repeat width) when the result is confident. Returns split records."""
    from .separate import AUTO_CONFIDENCE, separate
    project = Path(project_dir)
    min_confidence = AUTO_CONFIDENCE if min_confidence is None else min_confidence
    profile = room_profile(project)
    done = []
    for o in list(_read(project)["objects"]):
        long_ = profile and max(o["size"][:2]) > 1.5 * profile["pitch"] and o["size"][2] < 2.2
        if not (row_like(o["size"]) or long_):
            continue
        try:
            geom = load_object(project / o["file"])
            r = separate(geom, pitch_hint=pitch_hint_for(o["size"], profile), auto=True)
        except Exception as e:  # noqa: BLE001
            log(f"[separate] {o['name']}: skipped ({e})")
            continue
        if r["k"] < 2 or r["confidence"] < min_confidence:
            continue
        scene = _read(project)
        res = _write_pieces(project, scene, o["name"], separate_parts(geom, r["labels"]),
                            {"method": r["method"], "confidence": r["confidence"], "k": r["k"], "auto": True})
        log(f"[separate] {o['name']} -> {len(res['objects'])} pieces ({r['method']}, {r['confidence']:.2f})")
        done.append(res["split"])
    return done


def merge_back(project_dir: str | Path, parent: str, piece_record: dict | None = None,
               piece_name: str | None = None) -> dict:
    """Undo a split. `piece_record` (layout of one piece, `piece_name`) places the
    restored object where that piece is now. Returns {"object", "record", "removed"}."""
    project = Path(project_dir)
    scene = _read(project)
    splits = scene.get("splits", [])
    si = next((i for i, s in enumerate(splits) if s["parent"]["name"] == parent), None)
    if si is None:
        raise ValueError(f"{parent!r} was not split")
    s = splits[si]
    names = [o["name"] for o in scene["objects"]]
    missing = [p for p in s["pieces"] if p not in names]
    if missing:
        raise ValueError(f"merge back the split of {missing[0]} first")
    keep = project / "objects" / "_split"
    for f in keep.glob(f"{parent}.*"):
        shutil.move(str(f), project / "objects" / f.name)
    for p in s["pieces"]:
        for f in _object_files(project, p):
            f.unlink()
    at = min(names.index(p) for p in s["pieces"])
    scene["objects"] = [o for o in scene["objects"] if o["name"] not in s["pieces"]]
    scene["objects"].insert(at, s["parent"])
    splits.pop(si)
    if not splits:
        scene.pop("splits", None)
    _write(project, scene)

    record = None
    if piece_record and piece_name in s["offsets"]:
        q = piece_record.get("quaternion") or [0, 0, 0, 1]
        P = np.asarray(piece_record["position"], float) - _quat_rotate(q, s["offsets"][piece_name])
        record = {"position": P.round(5).tolist(), "quaternion": list(q),
                  "visible": piece_record.get("visible", True) is not False,
                  "deleted": bool(piece_record.get("deleted"))}
    return {"object": s["parent"], "record": record, "removed": s["pieces"]}
