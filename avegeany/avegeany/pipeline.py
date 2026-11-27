"""End-to-end segmentation: room mesh -> structure + separate furniture objects."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import trimesh

from . import ransac, structure, segmentation
from .categorize import guess_category
from .textures import export_glb

# canonical Z-up  ->  glTF Y-up
Z2Y = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)


@dataclass
class Params:
    up: str | None = None             # x|y|z|-x|-y|-z or None = auto
    threshold: float | None = None    # plane distance threshold (input units); None = auto
    room_height: float | None = None  # real floor->ceiling height in metres, rescales output
    samples: int = 200_000            # surface samples for RANSAC
    max_planes: int = 25
    min_plane_frac: float = 0.01      # min plane support (fraction of samples)
    iterations: int = 1000
    min_height_frac: float = 0.04     # min object height (fraction of room height)
    min_area_frac: float = 0.01       # min object surface area (fraction of height^2)
    merge_factor: float = 1.5         # fragment merge distance = merge_factor * threshold
    point_eps: float | None = None    # point-cloud clustering radius (point clouds only)
    seed: int = 0
    separate: bool = True             # split merged objects (seat rows ...) by shape when confident
    verbose: bool = True


def load_geometry(path: str | Path):
    g = trimesh.load(str(path), process=False)
    if isinstance(g, trimesh.Scene):
        geoms = list(g.dump()) if hasattr(g, "dump") else list(g.geometry.values())
        meshes = [m for m in geoms if isinstance(m, trimesh.Trimesh)]
        if meshes:
            g = trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
        else:
            pcs = [m for m in geoms if isinstance(m, trimesh.PointCloud)]
            g = trimesh.PointCloud(np.vstack([p.vertices for p in pcs]),
                                   colors=np.vstack([p.colors for p in pcs]) if pcs[0].colors is not None else None)
    if isinstance(g, trimesh.Trimesh) and len(g.faces) == 0:
        g = trimesh.PointCloud(g.vertices)
    return g


def _log(p: Params, *a):
    if p.verbose:
        print(*a, flush=True)


def segment_room(input_path: str | Path, out_dir: str | Path, params: Params | None = None) -> dict:
    p = params or Params()
    t0 = time.time()
    out = Path(out_dir)
    (out / "objects").mkdir(parents=True, exist_ok=True)

    geom = load_geometry(input_path)
    is_mesh = isinstance(geom, trimesh.Trimesh)
    _log(p, f"[load] {input_path}: " + (f"{len(geom.vertices)} vertices, {len(geom.faces)} faces"
                                        if is_mesh else f"{len(geom.vertices)} points (point cloud)"))

    # ---------- 1. sample surface points ---------------------------------
    if is_mesh:
        pts, _ = trimesh.sample.sample_surface(geom, p.samples, seed=p.seed)
    else:
        v = geom.vertices
        pts = v[np.random.default_rng(p.seed).choice(len(v), min(len(v), p.samples), replace=False)]
    diag = float(np.linalg.norm(np.ptp(np.percentile(pts, [1, 99], axis=0), axis=0)))
    thr = p.threshold or 0.004 * diag
    _log(p, f"[ransac] {len(pts)} samples, scene diagonal {diag:.3f}, threshold {thr:.4f}")

    # ---------- 2. RANSAC planes ----------------------------------------
    planes = ransac.detect_planes(pts, thr, int(p.min_plane_frac * len(pts)), p.max_planes,
                                  p.iterations, connect_radius=4 * thr, seed=p.seed,
                                  verbose=p.verbose)
    _log(p, f"[ransac] {len(planes)} planes")

    # ---------- 3. gravity + canonical frame -----------------------------
    up = structure.estimate_up(pts, planes, p.up)
    frame = structure.canonical_frame(pts, planes, up)
    pts_c = frame.apply(pts)
    planes_c = [frame.plane(pl) for pl in planes]
    info = structure.classify_planes(pts_c, planes_c, thr)

    # optional metric rescale from a known room height
    scale = 1.0
    if p.room_height and info["ceiling"] is not None and info["height"] > 0:
        scale = p.room_height / info["height"]
        frame = structure.Frame(frame.R, frame.t * scale, scale)
        pts_c = frame.apply(pts)
        planes_c = [frame.plane(pl) for pl in planes]
        thr *= scale
        info = structure.classify_planes(pts_c, planes_c, thr)
    H = info["height"]
    metric = bool(p.room_height) or (1.8 < H < 4.5)
    labels = [pl.label for pl in planes_c]
    _log(p, f"[structure] up={np.round(up, 3)}  room height {H:.3f}  "
            f"floor={'yes' if info['floor'] is not None else 'NO'}  "
            f"ceiling={'yes' if info['ceiling'] is not None else 'no'}  walls={len(info['walls'])}  "
            f"other planes={labels.count('other')}")
    if info["floor"] is None:
        _log(p, "  WARNING: no floor plane found - try --up to set the gravity axis")

    # ---------- 4. remove structure, find islands ------------------------
    if is_mesh:
        mesh = geom.copy()
        mesh.apply_transform(frame.matrix())
        s_mask = segmentation.structural_faces(mesh, planes_c, thr)
        o_mask = segmentation.outside_faces(mesh, info, thr)
        cand = ~s_mask & ~o_mask
        _log(p, f"[segment] structural faces {s_mask.sum()}, outside {o_mask.sum()}, "
                f"remaining {cand.sum()}")
        comp = segmentation.face_components(mesh, cand, merge_tol=thr * 0.05)
        obj_lab = segmentation.clean_islands(mesh, comp, planes_c, info, thr,
                                             min_height=p.min_height_frac * H,
                                             min_area=p.min_area_frac * H * H,
                                             merge_dist=p.merge_factor * thr,
                                             verbose=p.verbose)
        room_faces = np.nonzero((obj_lab < 0) & ~o_mask)[0]
        room = mesh.submesh([room_faces], append=True) if len(room_faces) else None
        objects = [mesh.submesh([np.nonzero(obj_lab == i)[0]], append=True)
                   for i in range(obj_lab.max() + 1)]
    else:
        v = frame.apply(geom.vertices)
        s = np.zeros(len(v), bool)
        for pl in planes_c:
            if pl.label in segmentation.STRUCT_LABELS:
                s |= np.abs(pl.distance(v)) < thr
        eps = p.point_eps or 2.5 * thr
        lab = -np.ones(len(v), int)
        lab[~s] = segmentation.cluster_points(v[~s], eps, min_points=200)
        cols = geom.colors if getattr(geom, "colors", None) is not None and len(geom.colors) else None
        objects = []
        for i in range(lab.max() + 1):
            sel = lab == i
            if np.ptp(v[sel][:, 2]) >= p.min_height_frac * H:
                objects.append(trimesh.PointCloud(v[sel], colors=cols[sel] if cols is not None else None))
        rest = lab < 0
        room = trimesh.PointCloud(v[rest], colors=cols[rest] if cols is not None else None)

    # ---------- 5. clean room shell (fills holes under furniture) --------
    shell, footprint = build_shell(pts_c, info, thr)

    # ---------- 6. export -------------------------------------------------
    manifest = export(out, room, shell, objects, frame, info, metric, is_mesh, p, footprint)
    manifest["seconds"] = round(time.time() - t0, 1)
    (out / "scene.json").write_text(json.dumps(manifest, indent=2))
    _log(p, f"[done] {len(objects)} furniture objects -> {out}  ({manifest['seconds']} s)")
    for o in manifest["objects"]:
        sz = " x ".join(f"{s:.2f}" for s in o["size"])
        _log(p, f"   {o['name']:<24} {sz}")

    # ---------- 7. separate merged objects by shape (seat rows -> seats) ----
    if p.separate and metric:
        from .split import auto_separate
        done = auto_separate(out, log=lambda *a: _log(p, *a))
        if done:
            manifest = json.loads((out / "scene.json").read_text())
            _log(p, f"[separate] {len(done)} merged objects separated -> {len(manifest['objects'])} objects "
                    "(undo any of them with Merge back in the editor)")
    return manifest


def build_shell(pts_c: np.ndarray, info: dict, thr: float) -> trimesh.Trimesh:
    """Clean planar floor / walls / ceiling from the detected planes."""
    poly = structure.room_polygon(info["walls"], pts_c)
    z0, z1 = info["floor_h"], info["ceiling_h"]
    n = len(poly)
    verts, faces, cols = [], [], []

    def add(vs, fs, c):
        base = len(verts)
        verts.extend(vs)
        faces.extend([[base + a, base + b, base + c_] for a, b, c_ in fs])
        cols.extend([c] * len(vs))

    floor_v = [[x, y, z0 - 0.5 * thr] for x, y in poly]
    add(floor_v, [[0, i, i + 1] for i in range(1, n - 1)], [176, 164, 148, 255])
    if info.get("ceiling") is not None:
        ceil_v = [[x, y, z1] for x, y in poly]
        add(ceil_v, [[0, i + 1, i] for i in range(1, n - 1)], [235, 235, 235, 255])
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        # wound so that normals face into the room (lets the viewer cull near walls)
        add([[*a, z0], [*b, z0], [*b, z1], [*a, z1]], [[0, 2, 1], [0, 3, 2]], [214, 210, 200, 255])
    m = trimesh.Trimesh(np.array(verts), np.array(faces), vertex_colors=np.array(cols), process=False)
    return m, poly


def _to_y_up(geom):
    g = geom.copy()
    g.apply_transform(Z2Y)
    return g


def export(out: Path, room, shell, objects, frame, info, metric, is_mesh, p: Params, footprint) -> dict:
    scene = trimesh.Scene()
    if room is not None:
        scene.add_geometry(_to_y_up(room), node_name="room_scan", geom_name="room_scan")
    scene.add_geometry(_to_y_up(shell), node_name="room_shell", geom_name="room_shell")

    objs = []
    counts: dict[str, int] = {}
    for i, g in enumerate(objects):
        lo, hi = g.bounds
        # pivot: footprint centre, on the floor for objects standing on it
        pz = 0.0 if lo[2] < 0.1 * info["height"] else lo[2]
        pivot = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, pz])
        local = g.copy()
        local.apply_translation(-pivot)
        cat = guess_category(local, metric) if is_mesh else "object"
        counts[cat] = counts.get(cat, 0) + 1
        name = f"{cat}_{counts[cat]:02d}"
        # local geometry in Y-up, node translation carries the position
        T = np.eye(4)
        T[:3, 3] = (Z2Y[:3, :3] @ pivot)
        local_y = _to_y_up(local)
        scene.add_geometry(local_y, node_name=f"furniture__{name}", geom_name=name, transform=T)
        export_glb(local_y, out / "objects" / f"{name}.glb", out)   # texture atlas shared via textures/
        if is_mesh:
            local_y.export(out / "objects" / f"{name}.obj")
        objs.append(dict(name=name, category=cat, index=i,
                         position=pivot.round(4).tolist(),            # canonical Z-up frame
                         position_gltf=(Z2Y[:3, :3] @ pivot).round(4).tolist(),
                         size=(hi - lo).round(4).tolist(),
                         faces=int(len(g.faces)) if is_mesh else 0,
                         points=int(len(g.vertices)),
                         file=f"objects/{name}.glb"))

    scene.export(out / "scene.glb")
    if room is not None:
        _to_y_up(room).export(out / ("room_structure.ply" if not is_mesh else "room_structure.glb"))
    _to_y_up(shell).export(out / "room_shell.glb")

    walls = [dict(normal=w.normal.round(4).tolist(), d=round(float(w.d), 4)) for w in info["walls"]]
    return dict(
        units="metres" if metric else "input units",
        up_axis_in_files="Y (glTF)",
        canonical_frame="Z up, floor at z=0; scene.json positions use this frame",
        input_to_canonical=frame.matrix().round(6).tolist(),
        room=dict(height=round(info["height"], 4), floor=info["floor"] is not None,
                  ceiling=info["ceiling"] is not None, walls=walls,
                  footprint=np.round(footprint, 4).tolist()),
        params={k: v for k, v in asdict(p).items() if k != "verbose"},
        objects=objs,
    )
