"""Room-structure reasoning on top of RANSAC planes.

* estimate the gravity ("up") direction and a Manhattan frame,
* move the scene into a canonical frame: Z up, floor at z = 0,
  walls aligned with the X / Y axes,
* label planes as floor / ceiling / wall / other.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .ransac import Plane

AXES = {
    "x": np.array([1.0, 0, 0]), "-x": np.array([-1.0, 0, 0]),
    "y": np.array([0, 1.0, 0]), "-y": np.array([0, -1.0, 0]),
    "z": np.array([0, 0, 1.0]), "-z": np.array([0, 0, -1.0]),
}


@dataclass
class Frame:
    """p_canonical = scale * (R @ p_original) + t"""
    R: np.ndarray
    t: np.ndarray
    scale: float = 1.0

    def apply(self, p: np.ndarray) -> np.ndarray:
        return self.scale * (p @ self.R.T) + self.t

    def plane(self, pl: Plane) -> Plane:
        n = self.R @ pl.normal
        # n.p + d = 0, p = R^T (p' - t)/s  ->  n'.p' - n'.t + s*d = 0
        d = self.scale * pl.d - n @ self.t
        return Plane(n, float(d), pl.inliers, pl.label, dict(pl.meta))

    def matrix(self) -> np.ndarray:
        m = np.eye(4)
        m[:3, :3] = self.scale * self.R
        m[:3, 3] = self.t
        return m


def _orthonormal_from(up: np.ndarray, x_hint: np.ndarray | None) -> np.ndarray:
    up = up / np.linalg.norm(up)
    if x_hint is None or abs(x_hint @ up) > 0.9:
        x_hint = np.array([1.0, 0, 0]) if abs(up[0]) < 0.9 else np.array([0, 1.0, 0])
    x = x_hint - (x_hint @ up) * up
    x /= np.linalg.norm(x)
    y = np.cross(up, x)
    return np.stack([x, y, up])  # rows


def manhattan_axes(planes: list[Plane]) -> list[np.ndarray]:
    """Up to 3 mutually ~orthogonal dominant directions, by plane support."""
    axes: list[np.ndarray] = []
    for pl in sorted(planes, key=lambda p: -len(p.inliers)):
        n = pl.normal
        if all(abs(n @ a) < 0.25 for a in axes):
            # Gram-Schmidt for numerical orthogonality
            for a in axes:
                n = n - (n @ a) * a
            axes.append(n / np.linalg.norm(n))
        if len(axes) == 2:
            axes.append(np.cross(axes[0], axes[1]))
            break
    return axes


def estimate_up(pts: np.ndarray, planes: list[Plane], up_hint: str | None = None) -> np.ndarray:
    """Gravity direction.

    With an explicit hint (e.g. "y" for Apple Object Capture / glTF output) the
    hint is snapped to the closest dominant plane normal.  Otherwise the up
    axis is the Manhattan axis along which the scene is the thinnest (rooms
    are usually wider than they are tall).  The sign is chosen so that the bulk
    of non-planar points (furniture) sits on the lower half: furniture stands
    on the floor.
    """
    axes = manhattan_axes(planes)
    if up_hint:
        h = AXES[up_hint.lower()]
        if axes:
            best = max(axes, key=lambda a: abs(a @ h))
            if abs(best @ h) > 0.8:
                return best * np.sign(best @ h)
        return h
    if len(axes) < 3:
        # fallback: PCA, smallest-variance axis
        c = pts - pts.mean(0)
        _, _, vt = np.linalg.svd(c[:: max(1, len(c) // 50000)], full_matrices=False)
        axes = list(vt)
    extents = [np.ptp(np.percentile(pts @ a, [1, 99])) for a in axes]
    up = axes[int(np.argmin(extents))]

    # Sign: furniture mass is closer to the floor than to the ceiling.
    on_plane = np.zeros(len(pts), bool)
    for pl in planes:
        on_plane[pl.inliers] = True
    rest = pts[~on_plane] if (~on_plane).sum() > 100 else pts
    h_all = pts @ up
    lo, hi = np.percentile(h_all, [1, 99])
    med = np.median(rest @ up)
    return up if (med - lo) < (hi - med) else -up


def canonical_frame(pts: np.ndarray, planes: list[Plane], up: np.ndarray) -> Frame:
    """Rotation so up -> +Z and the strongest wall normal -> +X; floor at z=0."""
    walls = [p for p in sorted(planes, key=lambda p: -len(p.inliers)) if abs(p.normal @ up) < 0.2]
    x_hint = walls[0].normal if walls else None
    R = _orthonormal_from(up, x_hint)
    q = pts @ R.T
    z0 = np.percentile(q[:, 2], 0.5)
    # refine floor height with the lowest horizontal plane, if any
    horiz = [p for p in planes if abs(p.normal @ up) > 0.95]
    if horiz:
        hs = [-(p.d) / (p.normal @ up) for p in horiz]   # height along up
        cand = [h for h in hs if abs(h - z0) < 0.1 * np.ptp(q[:, 2])]
        if cand:
            z0 = min(cand)
    lo, hi = np.percentile(q[:, :2], [1, 99], axis=0)
    cxy = (lo + hi) / 2
    t = np.array([-cxy[0], -cxy[1], -z0])
    return Frame(R, t, 1.0)


def classify_planes(pts_c: np.ndarray, planes_c: list[Plane], thr: float,
                    min_wall_span: float = 0.5, max_outside: float = 0.05) -> dict:
    """Label planes (already in canonical frame) as floor / ceiling / wall / other."""
    z = pts_c[:, 2]
    zlo, zhi = np.percentile(z, [0.5, 99.5])
    ext = zhi - zlo
    centre = np.r_[np.median(pts_c[:, :2], 0), (zlo + zhi) / 2]

    floor = ceiling = None
    for pl in planes_c:
        nz = pl.normal[2]
        if abs(nz) > 0.95:
            h = -pl.d / nz
            pl.meta["height"] = float(h)
            if abs(h - zlo) < 0.08 * ext and (floor is None or len(pl.inliers) > len(floor.inliers)):
                floor = pl
            elif abs(h - zhi) < 0.08 * ext and (ceiling is None or len(pl.inliers) > len(ceiling.inliers)):
                ceiling = pl

    for pl in planes_c:
        pl.label = "other"
    if floor is not None:
        floor.label = "floor"
    if ceiling is not None:
        ceiling.label = "ceiling"

    f_h = floor.meta["height"] if floor is not None else zlo
    c_h = ceiling.meta["height"] if ceiling is not None else zhi
    H = c_h - f_h

    walls = []
    for pl in planes_c:
        if abs(pl.normal[2]) > 0.15 or pl.label != "other":
            continue
        # orient the normal towards the room centre
        if pl.distance(centre[None])[0] < 0:
            pl.normal, pl.d = -pl.normal, -pl.d
        span = np.ptp(z[pl.inliers])
        outside = float((pl.distance(pts_c) < -3 * thr).mean())
        pl.meta.update(vertical_span=float(span), outside_frac=outside)
        if span >= min_wall_span * H and outside <= max_outside:
            pl.label = "wall"
            walls.append(pl)

    # Planes coplanar with the floor / ceiling / walls (duplicates split by RANSAC)
    struct = [p for p in planes_c if p.label in ("floor", "ceiling", "wall")]
    for pl in planes_c:
        if pl.label != "other":
            continue
        for s in struct:
            if abs(pl.normal @ s.normal) > 0.97:
                dist = np.abs(s.distance(pts_c[pl.inliers])).mean()
                if dist < 2 * thr:
                    pl.label = s.label + "_part"
                    break

    return dict(floor=floor, ceiling=ceiling, walls=walls, height=float(H),
                floor_h=float(f_h), ceiling_h=float(c_h))


def room_polygon(walls: list[Plane], pts_c: np.ndarray, margin: float = 0.0) -> np.ndarray:
    """Convex room footprint = intersection of the wall half-planes.

    Falls back to the 2-D convex hull of the points when fewer than 3 walls
    are known.  (Non-convex rooms, e.g. L-shapes, get their convex envelope.)
    """
    from scipy.spatial import ConvexHull

    xy = pts_c[:, :2]
    hull = xy[ConvexHull(xy[:: max(1, len(xy) // 20000)]).vertices]
    if len(walls) < 3:
        return hull
    lo, hi = xy.min(0) - 1, xy.max(0) + 1
    poly = np.array([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]])
    for w in walls:
        n2 = w.normal[:2] / np.linalg.norm(w.normal[:2])
        d2 = w.d / np.linalg.norm(w.normal[:2]) + margin
        poly = _clip(poly, n2, d2)
        if len(poly) < 3:
            return hull
    return poly


def _clip(poly: np.ndarray, n: np.ndarray, d: float) -> np.ndarray:
    """Sutherland–Hodgman: keep the side where n.p + d >= 0."""
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        da, db = a @ n + d, b @ n + d
        if da >= 0:
            out.append(a)
        if (da >= 0) != (db >= 0):
            out.append(a + (b - a) * (da / (da - db)))
    return np.array(out)
