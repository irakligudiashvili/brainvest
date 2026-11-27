"""Plane detection with RANSAC (pure NumPy).

The detector runs *sequential* RANSAC: find the plane with the most inliers,
refine it with least squares, take its inliers out of the pool and repeat
until no plane with enough support is left.  Each detected plane is reported
with its inlier indices so later stages can decide whether it is part of the
room structure (floor / walls / ceiling) or just a flat furniture surface
(table top, drawer front ...).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree


@dataclass
class Plane:
    normal: np.ndarray          # unit normal (3,)
    d: float                    # plane: normal . x + d = 0
    inliers: np.ndarray         # indices into the original point array
    label: str = "unknown"      # floor / ceiling / wall / other
    meta: dict = field(default_factory=dict)

    def distance(self, pts: np.ndarray) -> np.ndarray:
        """Signed distance of points to the plane."""
        return pts @ self.normal + self.d

    def flipped(self) -> "Plane":
        return Plane(-self.normal, -self.d, self.inliers, self.label, dict(self.meta))


def fit_plane_lsq(pts: np.ndarray) -> tuple[np.ndarray, float]:
    """Least-squares plane through points (SVD of the centred points)."""
    c = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
    n = vt[-1]
    n = n / np.linalg.norm(n)
    return n, float(-n @ c)


def _largest_connected_subset(pts: np.ndarray, idx: np.ndarray, radius: float) -> np.ndarray:
    """Keep only the largest spatially connected group of inliers.

    A RANSAC plane is infinite, so it also collects coplanar points that are
    far apart (e.g. the tops of two separate drawers).  Restricting the inliers
    to the biggest connected patch keeps one physical surface per plane.
    """
    if len(idx) < 3:
        return idx
    sub = pts[idx]
    # Work on a voxel-downsampled copy for speed, then map back.
    vox = np.floor(sub / radius).astype(np.int64)
    _, inv = np.unique(vox, axis=0, return_inverse=True)
    inv = inv.ravel()
    centers = np.zeros((inv.max() + 1, 3))
    np.add.at(centers, inv, sub)
    centers /= np.bincount(inv)[:, None]
    tree = cKDTree(centers)
    pairs = tree.query_pairs(r=radius * 1.75, output_type="ndarray")
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    n = len(centers)
    if len(pairs):
        g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
        _, lab = connected_components(g, directed=False)
    else:
        lab = np.arange(n)
    counts = np.bincount(lab[inv])
    best = np.argmax(counts)
    return idx[lab[inv] == best]


def ransac_plane(
    pts: np.ndarray,
    threshold: float,
    iterations: int = 1000,
    rng: np.random.Generator | None = None,
    batch: int = 64,
) -> tuple[np.ndarray, float, np.ndarray]:
    """Single RANSAC plane fit. Returns (normal, d, inlier_mask)."""
    rng = rng or np.random.default_rng(0)
    n_pts = len(pts)
    # Score hypotheses on a random subset for speed, verify on all points.
    eval_idx = rng.choice(n_pts, size=min(n_pts, 20000), replace=False)
    eval_pts = pts[eval_idx]

    best_score, best = -1, None
    for _ in range(0, iterations, batch):
        s = rng.integers(0, n_pts, size=(batch, 3))
        p0, p1, p2 = pts[s[:, 0]], pts[s[:, 1]], pts[s[:, 2]]
        nrm = np.cross(p1 - p0, p2 - p0)
        ln = np.linalg.norm(nrm, axis=1)
        ok = ln > 1e-12
        if not ok.any():
            continue
        nrm = nrm[ok] / ln[ok, None]
        d = -np.einsum("ij,ij->i", nrm, p0[ok])
        dist = np.abs(eval_pts @ nrm.T + d)          # (E, B)
        score = (dist < threshold).sum(axis=0)
        k = int(np.argmax(score))
        if score[k] > best_score:
            best_score, best = score[k], (nrm[k], d[k])

    n, d = best
    mask = np.abs(pts @ n + d) < threshold
    # Two rounds of least-squares refinement on the inliers.
    for _ in range(2):
        if mask.sum() < 3:
            break
        n, d = fit_plane_lsq(pts[mask])
        mask = np.abs(pts @ n + d) < threshold
    return n, d, mask


def detect_planes(
    pts: np.ndarray,
    threshold: float,
    min_inliers: int,
    max_planes: int = 30,
    iterations: int = 1000,
    connect_radius: float | None = None,
    seed: int = 0,
    verbose: bool = False,
) -> list[Plane]:
    """Sequential RANSAC: repeatedly extract the dominant plane."""
    rng = np.random.default_rng(seed)
    remaining = np.arange(len(pts))
    planes: list[Plane] = []
    misses = 0
    while len(planes) < max_planes and len(remaining) >= min_inliers and misses < 3:
        n, d, mask = ransac_plane(pts[remaining], threshold, iterations, rng)
        idx = remaining[mask]
        if connect_radius:
            idx = _largest_connected_subset(pts, idx, connect_radius)
        if len(idx) < min_inliers:
            misses += 1
            # Remove the weak patch anyway so the search can move on.
            remaining = np.setdiff1d(remaining, idx, assume_unique=True)
            continue
        n, d = fit_plane_lsq(pts[idx])
        planes.append(Plane(n, d, idx))
        remaining = np.setdiff1d(remaining, idx, assume_unique=True)
        if verbose:
            print(f"  plane {len(planes):2d}: n={np.round(n, 3)}  inliers={len(idx)}")
    return planes
