"""Synthetic test room: 2 drawer cabinets, 4 chairs and 1 table.

``clean``  - furniture parts as separate meshes (easy case)
``fused``  - the whole room is sampled into a noisy point cloud and rebuilt
             with Poisson surface reconstruction (needs open3d).  Like a real
             photogrammetry mesh, furniture is welded to the floor and walls
             in ONE connected surface, so the RANSAC stage is what separates it.

The scene is optionally put into a random orientation (Y up, random yaw,
offset) the way photogrammetry tools output it.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import trimesh

ROOM = (5.0, 4.0, 2.7)  # x, y, height (metres)

COLORS = {
    "room": [200, 196, 186, 255], "table": [139, 90, 43, 255],
    "chair": [70, 110, 160, 255], "drawers": [190, 150, 90, 255],
}


def _box(ext, center, color):
    b = trimesh.creation.box(extents=ext)
    b.apply_translation(center)
    b.visual.vertex_colors = np.tile(color, (len(b.vertices), 1))
    return b


def table(cx, cy, w=1.6, d=0.9, h=0.75):
    c = COLORS["table"]
    parts = [_box([w, d, 0.04], [cx, cy, h - 0.02], c)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_box([0.06, 0.06, h - 0.04],
                              [cx + sx * (w / 2 - 0.08), cy + sy * (d / 2 - 0.08), (h - 0.04) / 2], c))
    return trimesh.util.concatenate(parts)


def chair(cx, cy, facing):
    """facing: +1 back is on -y side (faces +y), -1 the opposite."""
    c = COLORS["chair"]
    s, seat_h = 0.45, 0.46
    parts = [_box([s, s, 0.04], [cx, cy, seat_h - 0.02], c)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_box([0.04, 0.04, seat_h - 0.04],
                              [cx + sx * (s / 2 - 0.03), cy + sy * (s / 2 - 0.03), (seat_h - 0.04) / 2], c))
    by = cy - facing * (s / 2 - 0.02)
    parts.append(_box([s, 0.04, 0.5], [cx, by, seat_h + 0.25], c))
    return trimesh.util.concatenate(parts)


def drawers(cx, wall_y, w=0.8, d=0.5, h=0.9):
    c = COLORS["drawers"]
    cy = wall_y - d / 2
    parts = [_box([w, d, h - 0.08], [cx, cy, 0.08 + (h - 0.08) / 2], c),
             _box([w - 0.06, d - 0.06, 0.08], [cx, cy, 0.04], c)]           # plinth
    for k in range(3):                                                          # handles
        z = 0.08 + (k + 0.5) * (h - 0.08) / 3
        parts.append(_box([0.2, 0.03, 0.03], [cx, cy - d / 2 - 0.015, z], c))
    return trimesh.util.concatenate(parts)


def room_shell(subdiv=0.25):
    """Inside-facing floor / ceiling / walls, subdivided like a real scan."""
    X, Y, Z = ROOM
    b = trimesh.creation.box(extents=[X, Y, Z])
    b.apply_translation([0, 0, Z / 2])
    b.invert()                                    # normals point into the room
    b = b.subdivide_to_size(subdiv)
    b.visual.vertex_colors = np.tile(COLORS["room"], (len(b.vertices), 1))
    return b


def build_scene():
    X, Y, _ = ROOM
    objs = {"table_1": table(0.6, -0.2)}
    # chairs: two on each long side, 8 cm gap to the table edge
    for i, x in enumerate((0.25, 0.95)):
        objs[f"chair_{2*i+1}"] = chair(x, -0.2 - 0.45 - 0.08 - 0.225, +1)
        objs[f"chair_{2*i+2}"] = chair(x, -0.2 + 0.45 + 0.08 + 0.225, -1)
    # drawers flush against the back wall (y = +Y/2)
    objs["drawers_1"] = drawers(-1.7, Y / 2)
    objs["drawers_2"] = drawers(-0.75, Y / 2)
    return room_shell(), objs


def _random_pose(rng):
    yaw = rng.uniform(0, 2 * np.pi)
    Rz = trimesh.transformations.rotation_matrix(yaw, [0, 0, 1])
    # Z-up -> Y-up (like glTF / Apple Object Capture / many SfM outputs)
    zy = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)
    T = trimesh.transformations.translation_matrix(rng.uniform(-3, 3, 3))
    return T @ zy @ Rz


def make(out_dir: str | Path, mode: str = "fused", pose: bool = True, seed: int = 0,
         n_points: int = 900_000, noise: float = 0.003, depth: int = 9) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    shell, objs = build_scene()

    gt = {k: dict(bounds=m.bounds.round(3).tolist(), size=np.ptp(m.bounds, 0).round(3).tolist())
          for k, m in objs.items()}

    if mode == "clean":
        mesh = trimesh.util.concatenate([shell, *objs.values()])
    elif mode == "fused":
        import open3d as o3d
        allm = trimesh.util.concatenate([shell, *objs.values()])
        pts, fi = trimesh.sample.sample_surface(allm, n_points, seed=seed)
        nrm = allm.face_normals[fi]
        pts = pts + rng.normal(0, noise, pts.shape)
        cols = allm.visual.face_colors[fi][:, :3] / 255.0
        pc = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(pts))
        pc.normals = o3d.utility.Vector3dVector(nrm)
        pc.colors = o3d.utility.Vector3dVector(cols)
        m, dens = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pc, depth=depth)
        dens = np.asarray(dens)
        m.remove_vertices_by_mask(dens < np.quantile(dens, 0.02))
        mesh = trimesh.Trimesh(np.asarray(m.vertices), np.asarray(m.triangles),
                               vertex_colors=(np.asarray(m.vertex_colors) * 255).astype(np.uint8))
        # Poisson closes the volume outside the room: keep only the room box
        X, Y, Z = ROOM
        v = mesh.vertices
        inside = (np.abs(v[:, 0]) < X / 2 + 0.05) & (np.abs(v[:, 1]) < Y / 2 + 0.05) & \
                 (v[:, 2] > -0.05) & (v[:, 2] < Z + 0.05)
        mesh.update_faces(inside[mesh.faces].all(axis=1))
        mesh.remove_unreferenced_vertices()
    else:
        raise ValueError(mode)

    M = _random_pose(rng) if pose else np.eye(4)
    mesh.apply_transform(M)
    path = out / f"synthetic_room_{mode}.ply"
    mesh.export(path)
    (out / f"synthetic_room_{mode}_truth.json").write_text(json.dumps(
        dict(room=ROOM, objects=gt, pose=M.round(6).tolist(),
             expected=dict(table=1, chair=4, drawers=2)), indent=2))
    return path
