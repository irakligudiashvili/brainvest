"""Run with:  pytest -q        (the fused test needs open3d and takes ~1 min)"""
import json
from collections import Counter

import numpy as np
import pytest

from avegeany import ransac, synthetic
from avegeany.pipeline import Params, segment_room
from avegeany.layout import apply_layout


def test_ransac_finds_plane_in_noise():
    rng = np.random.default_rng(1)
    plane = np.c_[rng.uniform(-1, 1, (3000, 2)), rng.normal(0, 0.003, 3000)]
    noise = rng.uniform(-1, 1, (1000, 3))
    n, d, mask = ransac.ransac_plane(np.vstack([plane, noise]), 0.01, 500, rng)
    assert abs(abs(n[2]) - 1) < 1e-3
    assert mask[:3000].mean() > 0.98


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_clean_room_any_orientation(tmp_path, seed):
    mesh = synthetic.make(tmp_path, "clean", pose=True, seed=seed)
    m = segment_room(mesh, tmp_path / "out", Params(verbose=False))
    cats = Counter(o["category"] for o in m["objects"])
    assert cats == {"chair": 4, "drawers": 2, "table": 1}
    assert abs(m["room"]["height"] - 2.7) < 0.03
    assert len(m["room"]["walls"]) == 4


def test_fused_photogrammetry_like_mesh(tmp_path):
    pytest.importorskip("open3d")
    mesh = synthetic.make(tmp_path, "fused", pose=True, seed=3, n_points=600_000)
    out = tmp_path / "out"
    m = segment_room(mesh, out, Params(verbose=False))
    cats = Counter(o["category"] for o in m["objects"])
    assert cats == {"chair": 4, "drawers": 2, "table": 1}
    # sizes match the ground truth within a few centimetres
    sizes = sorted(tuple(sorted(o["size"])) for o in m["objects"] if o["category"] == "table")
    assert np.allclose(sizes[0], (0.75, 0.9, 1.6), atol=0.06)

    # moving a chair and baking the layout works
    first = m["objects"][0]
    layout = {"objects": {first["name"]: {"position": [0, 0, 0], "rotation_y": 1.0}}}
    (tmp_path / "layout.json").write_text(json.dumps(layout))
    assert apply_layout(out, tmp_path / "layout.json").exists()


def test_layout_v2_imports_hide_delete(tmp_path):
    """Editor layout with full rotations, hidden/deleted objects and an imported
    millimetre Z-up STL is baked with the same rules the editor uses."""
    import trimesh
    mesh = synthetic.make(tmp_path, "clean", pose=False)
    out = tmp_path / "out"
    m = segment_room(mesh, out, Params(verbose=False))
    names = [o["name"] for o in m["objects"]]
    (out / "imports").mkdir()
    trimesh.creation.cylinder(200, 450).apply_translation([0, 0, 225]).export(out / "imports/stool.stl")
    q90 = [0, 0.7071068, 0, 0.7071068]
    layout = {"version": 2,
              "objects": {names[0]: {"position": [1, 0.5, 1], "quaternion": q90, "visible": True},
                          names[1]: {"position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "visible": False},
                          names[2]: {"position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "deleted": True}},
              "imports": [{"name": "stool", "file": "imports/stool.stl", "ext": "stl", "up": "z",
                           "unit_scale": 0.001, "position": [0.5, 0, 0.5], "quaternion": [0, 0, 0, 1]}]}
    (out / "layout.json").write_text(json.dumps(layout))
    s = trimesh.load(apply_layout(out, out / "layout.json"))
    nodes = set(s.graph.nodes_geometry)
    assert f"furniture__{names[0]}" in nodes
    assert f"furniture__{names[1]}" not in nodes and f"furniture__{names[2]}" not in nodes
    T, g = s.graph["import__stool"]
    pts = trimesh.transform_points(s.geometry[g].vertices, T)
    assert np.allclose(np.ptp(pts, 0), [0.4, 0.45, 0.4], atol=0.01)   # original size, Y up
    assert abs(pts[:, 1].min()) < 1e-6                                 # standing on the floor
    T, _ = s.graph[f"furniture__{names[0]}"]
    assert np.allclose(T[:3, 3], [1, 0.5, 1])


def test_server_endpoints(tmp_path):
    import threading, urllib.request, http.server
    from avegeany.server import make_handler
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), make_handler(tmp_path))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    assert json.load(urllib.request.urlopen(base + "/api/ping"))["ok"]
    r = urllib.request.urlopen(urllib.request.Request(base + "/api/layout", method="POST",
                               data=json.dumps({"version": 2, "objects": {}}).encode()))
    assert json.load(r)["file"] == "layout.json" and (tmp_path / "layout.json").exists()
    r = urllib.request.urlopen(urllib.request.Request(base + "/api/import?name=../../evil%20lamp.glb",
                               method="POST", data=b"glTF"))
    assert json.load(r)["file"] == "imports/evil_lamp.glb"          # path traversal stripped
    try:
        urllib.request.urlopen(urllib.request.Request(base + "/api/import?name=x.exe", method="POST", data=b"x"))
        assert False, "should reject"
    except urllib.error.HTTPError as e:
        assert e.code == 400
    httpd.shutdown()


# ------------------------------------------------------------------ .avjp --
def _seg_clean(tmp_path):
    mesh = synthetic.make(tmp_path, "clean", pose=False)
    out = tmp_path / "out"
    m = segment_room(mesh, out, Params(verbose=False))
    return mesh, out, m


def test_avjp_roundtrip_and_zip_slip(tmp_path):
    import zipfile
    from avegeany import avjp
    from avegeany.server import install_viewer
    _, out, m = _seg_clean(tmp_path)
    install_viewer(out)                                   # editor files must not be packed
    (out / "imports").mkdir()
    (out / "imports/lamp.glb").write_bytes(b"glTF-fake")
    layout = {"version": 2, "objects": {m["objects"][0]["name"]: {"position": [1, 0, 1]}}, "imports": []}
    (out / "layout.json").write_text(json.dumps(layout))
    dest = avjp.pack(out, tmp_path / "room.avjp", name="My room")
    names = zipfile.ZipFile(dest).namelist()
    assert "avjp.json" in names and "scene.glb" in names and "imports/lamp.glb" in names
    assert not any(n in ("index.html", "app.js") or n.startswith("vendor/") for n in names)
    assert avjp.inspect(dest)["name"] == "My room"

    work = tmp_path / "work"
    avjp.unpack(dest, work)
    assert json.loads((work / "layout.json").read_text()) == layout
    assert json.loads((work / "scene.json").read_text())["objects"] == m["objects"]
    assert (work / "imports/lamp.glb").read_bytes() == b"glTF-fake"

    evil = tmp_path / "evil.avjp"
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("avjp.json", json.dumps({"format": "avjp", "version": 1}))
        z.writestr("scene.glb", b"x")
        z.writestr("../escaped.txt", b"x")
    with pytest.raises(avjp.AvjpError):
        avjp.unpack(evil, tmp_path / "w2")
    assert not (tmp_path / "escaped.txt").exists()
    with pytest.raises(avjp.AvjpError):
        avjp.inspect(tmp_path / "out" / "scene.json")      # not a zip


def _server(session):
    import threading, http.server
    from avegeany.server import make_handler
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), make_handler(session))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def _post(url, data, json_body=True):
    import urllib.request
    body = json.dumps(data).encode() if json_body else data
    return json.load(urllib.request.urlopen(urllib.request.Request(url, method="POST", data=body)))


def test_server_save_open_and_scan_job(tmp_path, monkeypatch):
    import time, urllib.request, zipfile
    from avegeany import avjp
    from avegeany.server import Session
    monkeypatch.setattr(avjp, "RECENT", tmp_path / "recent.json")
    ws = tmp_path / "projects"
    s = Session(workspace=ws)
    httpd, base = _server(s)
    try:
        assert json.load(urllib.request.urlopen(base + "/api/project"))["loaded"] is False
        assert b"importmap" in urllib.request.urlopen(base + "/index.html").read()   # viewer served from viewer/

        # new project from a scan: upload, process, poll
        ply = synthetic.make(tmp_path, "clean", pose=True, seed=1)
        _post(f"{base}/api/scan/upload?job=abc123def&name={ply.name}", ply.read_bytes(), False)
        _post(base + "/api/scan/process", {"job": "abc123def", "name": "Test room"})
        for _ in range(600):
            j = json.load(urllib.request.urlopen(base + "/api/job?id=abc123def"))
            if j["state"] != "running":
                break
            time.sleep(0.2)
        assert j["state"] == "done", j
        dest = ws / "Test room.avjp"
        assert j["avjp"] == str(dest.resolve()) and dest.exists()
        info = json.load(urllib.request.urlopen(base + "/api/project"))
        assert info["loaded"] and info["name"] == "Test room"
        cats = Counter(o["category"] for o in json.loads(urllib.request.urlopen(base + "/scene.json").read())["objects"])
        assert cats == {"chair": 4, "drawers": 2, "table": 1}
        assert avjp.recent()[0]["path"] == str(dest.resolve())

        # save writes the layout into the .avjp
        layout = {"version": 2, "objects": {"chair_01": {"position": [0.5, 0, 0.5], "quaternion": [0, 0, 0, 1]}}, "imports": []}
        r = _post(base + "/api/save", layout)
        assert r["avjp"] == str(dest.resolve())
        assert json.loads(zipfile.ZipFile(dest).read("layout.json")) == layout

        # reopen from disk: same layout, no processing
        _post(base + "/api/open", {"path": str(dest)})
        assert json.loads(urllib.request.urlopen(base + "/layout.json").read()) == layout

        # cross-site POSTs are refused
        req = urllib.request.Request(base + "/api/save", method="POST", data=json.dumps(layout).encode(),
                                     headers={"Origin": "http://evil.example"})
        try:
            urllib.request.urlopen(req)
            assert False, "should refuse"
        except urllib.error.HTTPError as e:
            assert e.code == 403
        # bad scan file names are refused
        try:
            _post(f"{base}/api/scan/upload?job=abc123def&name=run.sh", b"x", False)
            assert False, "should refuse"
        except urllib.error.HTTPError as e:
            assert e.code == 400
    finally:
        httpd.shutdown()


# ----------------------------------------------------------------- split --
def _seat_row(project):
    """5 chairs, 0.6 m apart, welded together by a bar: one object like an auditorium row."""
    import trimesh
    parts = []
    for i in range(5):
        x = -1.2 + 0.6 * i
        for dx in (-0.21, 0.21):
            for dz in (-0.21, 0.21):
                parts.append(trimesh.creation.box([0.04, 0.45, 0.04]).apply_translation([x + dx, 0.225, dz]))
        parts.append(trimesh.creation.box([0.48, 0.05, 0.48]).apply_translation([x, 0.47, 0]))
        parts.append(trimesh.creation.box([0.48, 0.45, 0.05]).apply_translation([x, 0.72, -0.22]))
    parts.append(trimesh.creation.box([3.0, 0.04, 0.04]).apply_translation([0, 0.3, -0.2]))
    row = trimesh.util.concatenate(parts)
    (project / "objects").mkdir(parents=True)
    row.export(project / "objects/object_01.glb")
    scene = {"room": {"height": 2.7}, "objects": [
        {"name": "object_01", "category": "object", "index": 0, "position": [0.5, -2.0, 0.0],
         "position_gltf": [0.5, 0.0, 2.0], "size": [3.0, 0.48, 0.95], "faces": len(row.faces),
         "points": len(row.vertices), "file": "objects/object_01.glb"}]}
    (project / "scene.json").write_text(json.dumps(scene))
    return row


def test_split_seat_row_and_merge_back(tmp_path):
    import trimesh
    from avegeany import split
    project = tmp_path / "p"
    row = _seat_row(project)
    s = split.suggest(split.load_object(project / "objects/object_01.glb"))
    assert s["count"] == 5 and not s["low_confidence"]
    assert abs(s["pitch"] - 0.6) < 0.03
    # cuts land in the gaps between chairs (row direction may come out as +x or -x)
    centres = sorted(abs(c * s["axis"][0] + s["origin"][0]) for c in s["cuts"])
    assert np.allclose(sorted(centres), [0.3, 0.3, 0.9, 0.9], atol=0.07)

    # the row was moved and turned 90° in the editor before splitting
    q90 = [0, 0.7071068, 0, 0.7071068]
    parent = {"position": [1.0, 0.0, 1.0], "quaternion": q90, "visible": True}
    r = split.split_object(project, "object_01", s["axis"], s["origin"], s["cuts"], parent)
    names = r["split"]["pieces"]
    assert names == [f"object_01_{i}" for i in range(1, 6)]
    scene = json.loads((project / "scene.json").read_text())
    assert [o["name"] for o in scene["objects"]] == names
    assert not (project / "objects/object_01.glb").exists() and (project / "objects/_split/object_01.glb").exists()
    pieces = [split.load_object(project / f"objects/{n}.glb") for n in names]
    # cut openings are filled: every piece is closed again and no volume is lost
    assert all(p.is_watertight for p in pieces)
    assert abs(sum(p.volume for p in pieces) - row.volume) < 1e-4 * row.volume

    # every seat stays exactly where it was inside the moved + turned row
    M = trimesh.transformations.quaternion_matrix([q90[3], *q90[:3]])
    M[:3, 3] = parent["position"]
    world_row = trimesh.transform_points(row.vertices, M)
    world_seats = []
    for n, p in zip(names, pieces):
        rec = r["records"][n]
        P = trimesh.transformations.quaternion_matrix([rec["quaternion"][3], *rec["quaternion"][:3]])
        P[:3, 3] = rec["position"]
        world_seats.append(trimesh.transform_points(p.vertices, P))
    world_seats = np.vstack(world_seats)
    assert np.allclose(world_seats.min(0), world_row.min(0), atol=1e-4)
    assert np.allclose(world_seats.max(0), world_row.max(0), atol=1e-4)
    for n, p in zip(names, pieces):                                    # each piece ~ one chair wide
        assert np.ptp(p.vertices[:, 0]) < 0.75

    # merge back, placing the row from where seat_03 is now
    m = split.merge_back(project, "object_01", r["records"]["object_01_3"], "object_01_3")
    assert m["removed"] == names
    assert np.allclose(m["record"]["position"], parent["position"], atol=1e-4)
    scene = json.loads((project / "scene.json").read_text())
    assert [o["name"] for o in scene["objects"]] == ["object_01"] and "splits" not in scene
    assert (project / "objects/object_01.glb").exists()
    assert not any((project / "objects").glob("object_01_*"))


def test_server_split_endpoints(tmp_path):
    import urllib.request
    from avegeany.server import Session
    project = tmp_path / "p"
    _seat_row(project)
    import trimesh
    trimesh.creation.box([1, 1, 1]).export(project / "scene.glb")      # makes the project "loaded"
    s = Session(project_dir=project, workspace=tmp_path / "ws")
    httpd, base = _server(s)
    try:
        sug = json.load(urllib.request.urlopen(base + "/api/split/suggest?name=object_01"))
        assert sug["count"] == 5
        r = _post(base + "/api/split", {"name": "object_01", "axis": sug["axis"], "origin": sug["origin"],
                                        "cuts": sug["cuts"]})
        assert len(r["objects"]) == 5
        assert json.load(urllib.request.urlopen(base + "/api/project"))["unsaved"] is True
        assert urllib.request.urlopen(base + "/objects/object_01_1.glb").status == 200
        try:
            _post(base + "/api/split", {"name": "nope", "axis": [1, 0], "origin": [0, 0], "cuts": [0]})
            assert False, "should refuse"
        except urllib.error.HTTPError as e:
            assert e.code == 400
        _post(base + "/api/unsplit", {"parent": "object_01"})
        names = [o["name"] for o in json.loads(urllib.request.urlopen(base + "/scene.json").read())["objects"]]
        assert names == ["object_01"]
    finally:
        httpd.shutdown()


def test_split_plain_object_in_two(tmp_path):
    """No repeating pattern: the guess is two pieces, cut at the emptiest spot near
    the middle; pieces are closed and keep their category; names stay unique."""
    import trimesh
    from avegeany import split
    project = tmp_path / "p"
    (project / "objects").mkdir(parents=True)
    # a table (top + 4 legs) welded to a low cabinet at one end
    parts = [trimesh.creation.box([1.6, 0.05, 0.8]).apply_translation([0, 0.725, 0])]
    for x in (-0.75, 0.75):
        for z in (-0.35, 0.35):
            parts.append(trimesh.creation.box([0.05, 0.7, 0.05]).apply_translation([x, 0.35, z]))
    parts.append(trimesh.creation.box([0.5, 0.6, 0.8]).apply_translation([1.05, 0.3, 0]))
    obj = trimesh.util.concatenate(parts)
    obj.export(project / "objects/table_01.glb")
    (project / "objects/table_01_1.glb").write_bytes(b"taken")          # name clash must be avoided
    (project / "scene.json").write_text(json.dumps({"room": {"height": 2.6}, "objects": [
        {"name": "table_01", "category": "table", "index": 0, "position": [0, 0, 0],
         "position_gltf": [0, 0, 0], "size": [2.1, 0.8, 0.75], "faces": len(obj.faces),
         "points": len(obj.vertices), "file": "objects/table_01.glb"}]}))
    s = split.suggest(split.load_object(project / "objects/table_01.glb"))
    assert s["count"] == 2 and s["pitch_source"].startswith("no repeating pattern")
    r = split.split_object(project, "table_01", s["axis"], s["origin"], s["cuts"])
    assert len(r["objects"]) == 2 and all(o["category"] == "table" for o in r["objects"])
    assert "table_01_1" not in r["split"]["pieces"]
    pieces = [split.load_object(project / o["file"]) for o in r["objects"]]
    assert all(p.is_watertight for p in pieces)
    assert abs(sum(p.volume for p in pieces) - obj.volume) < 1e-4 * obj.volume


# ------------------------------------------------------- shape separation --
def _scanlike(box):
    """subdivide to ~4 cm triangles like a real scan"""
    import trimesh
    v, f = trimesh.remesh.subdivide_to_size(box.vertices, box.faces, 0.04)
    return trimesh.Trimesh(v, f)


def _fine_row(with_ranges=False):
    """5 chairs joined by a bar, all with scan-sized triangles. With `with_ranges`
    also returns the triangle index range of every chair."""
    import trimesh
    parts, ranges, n = [], [], 0
    for i in range(5):
        x = -1.2 + 0.6 * i
        chair = []
        for dx in (-0.21, 0.21):
            for dz in (-0.21, 0.21):
                chair.append(trimesh.creation.box([0.04, 0.45, 0.04]).apply_translation([x + dx, 0.225, dz]))
        chair.append(trimesh.creation.box([0.48, 0.05, 0.48]).apply_translation([x, 0.47, 0]))
        chair.append(trimesh.creation.box([0.48, 0.45, 0.05]).apply_translation([x, 0.72, -0.22]))
        chair = [_scanlike(c) for c in chair]
        k = sum(len(c.faces) for c in chair)
        ranges.append((n, n + k))
        n += k
        parts += chair
    parts.append(_scanlike(trimesh.creation.box([3.0, 0.04, 0.04]).apply_translation([0, 0.3, -0.2])))
    row = trimesh.util.concatenate(parts)
    return (row, ranges, n) if with_ranges else row


def _project_with(tmp_path, objects):
    project = tmp_path / "p"
    (project / "objects").mkdir(parents=True)
    entries = []
    for name, cat, mesh in objects:
        mesh.export(project / f"objects/{name}.glb")
        lo, hi = mesh.bounds
        entries.append({"name": name, "category": cat, "index": len(entries), "position": [0, 0, 0],
                        "position_gltf": [0, 0, 0], "size": [float(hi[0] - lo[0]), float(hi[2] - lo[2]), float(hi[1] - lo[1])],
                        "faces": len(mesh.faces), "points": len(mesh.vertices), "file": f"objects/{name}.glb"})
    (project / "scene.json").write_text(json.dumps({"room": {"height": 2.7}, "objects": entries}))
    return project


def test_separate_by_shape_keeps_each_chair_whole(tmp_path):
    from avegeany.separate import separate
    from avegeany import split
    row, ranges, n_chairs = _fine_row(with_ranges=True)
    r = separate(row)
    lab = r["labels"]
    assert r["k"] == 5
    chair_labels = []
    for i, (a, b) in enumerate(ranges):
        li = np.unique(lab[a:b])
        assert len(li) == 1, f"chair {i} was cut apart: {li}"         # every chair stays whole
        chair_labels.append(int(li[0]))
    assert len(set(chair_labels)) == 5                                 # ... in its own piece
    assert len(np.unique(lab[n_chairs:])) == 5                         # the bar is shared out

    project = _project_with(tmp_path, [("object_01", "object", row)])
    res = split.separate_object(project, "object_01")
    assert [o["name"] for o in res["objects"]] == [f"object_01_{i}" for i in range(1, 6)]
    pieces = [split.load_object(project / o["file"]) for o in res["objects"]]
    assert abs(sum(p.volume for p in pieces) - row.volume) < 0.02 * row.volume   # seams are filled
    m = split.merge_back(project, "object_01")
    assert [o["name"] for o in json.loads((project / "scene.json").read_text())["objects"]] == ["object_01"]


def test_separate_table_from_cabinet_and_auto_mode(tmp_path):
    import trimesh
    from avegeany.separate import separate
    from avegeany import split
    table = [_scanlike(trimesh.creation.box([1.6, 0.05, 0.8]).apply_translation([0, 0.725, 0]))]
    for x in (-0.75, 0.75):
        for z in (-0.35, 0.35):
            table.append(_scanlike(trimesh.creation.box([0.05, 0.7, 0.05]).apply_translation([x, 0.35, z])))
    cabinet = _scanlike(trimesh.creation.box([0.5, 0.6, 0.8]).apply_translation([1.05, 0.3, 0]))
    obj = trimesh.util.concatenate(table + [cabinet])
    lab = separate(obj)["labels"]                                      # editor mode
    n_table = sum(len(t.faces) for t in table)
    assert len(np.unique(lab[n_table:])) == 1
    assert lab[0] != lab[n_table]                                      # top and cabinet apart
    assert len(np.unique(lab[:n_table])) == 1                          # legs stay with the top

    # automatic mode: the row is separated, the lone chair and the table are left alone
    chair = trimesh.util.concatenate([trimesh.creation.box([0.48, 0.05, 0.48]).apply_translation([0, 0.47, 0]),
                                      trimesh.creation.box([0.48, 0.45, 0.05]).apply_translation([0, 0.72, -0.22])])
    project = _project_with(tmp_path, [("object_01", "object", _fine_row()), ("chair_01", "chair", chair),
                                       ("table_01", "table", obj)])
    done = split.auto_separate(project, log=lambda *a: None)
    names = [o["name"] for o in json.loads((project / "scene.json").read_text())["objects"]]
    assert [d["parent"]["name"] for d in done] == ["object_01"]
    assert "chair_01" in names and "table_01" in names and "object_01_5" in names


def test_server_separate_preview_accept_cancel(tmp_path):
    import urllib.request, trimesh
    from avegeany.server import Session
    project = _project_with(tmp_path, [("object_01", "object", _fine_row())])
    trimesh.creation.box([1, 1, 1]).export(project / "scene.glb")
    s = Session(project_dir=project, workspace=tmp_path / "ws")
    httpd, base = _server(s)
    try:
        pv = json.load(urllib.request.urlopen(base + "/api/separate/preview?name=object_01"))
        assert pv["k"] == 5 and all(o["file"].startswith("objects/_preview/") for o in pv["objects"])
        names = [o["name"] for o in json.loads((project / "scene.json").read_text())["objects"]]
        assert names == ["object_01"]                                   # preview doesn't touch the project
        _post(base + "/api/separate/cancel", {})
        assert not (project / "objects/_preview").exists()
        pv = json.load(urllib.request.urlopen(base + "/api/separate/preview?name=object_01&k=3"))
        assert pv["k"] == 3
        r = _post(base + "/api/separate", {"name": "object_01", "k": 3,
                                           "record": {"position": [1, 0, 1], "quaternion": [0, 0, 0, 1]}})
        assert [o["name"] for o in r["objects"]] == ["object_01_1", "object_01_2", "object_01_3"]
        assert not (project / "objects/_preview").exists()
        assert json.load(urllib.request.urlopen(base + "/api/project"))["unsaved"] is True
    finally:
        httpd.shutdown()


def test_shared_texture_export(tmp_path):
    """Objects reference one texture atlas in textures/ instead of embedding a copy each,
    and loading only follows references inside the project."""
    import trimesh
    from PIL import Image
    from avegeany.textures import export_glb, load
    img = Image.new("RGB", (512, 512), (200, 120, 40))
    box = trimesh.creation.box([1, 1, 1])
    uv = np.random.default_rng(0).random((len(box.vertices), 2))
    box.visual = trimesh.visual.TextureVisuals(uv=uv, material=trimesh.visual.material.PBRMaterial(baseColorTexture=img))
    (tmp_path / "scene.json").write_text("{}")
    (tmp_path / "objects").mkdir()
    export_glb(box, tmp_path / "objects/a.glb", tmp_path)
    export_glb(box, tmp_path / "objects/b.glb", tmp_path)
    assert len(list((tmp_path / "textures").iterdir())) == 1              # one shared atlas
    assert b"../textures/tex_" in (tmp_path / "objects/a.glb").read_bytes()
    assert b"../textures/tex_" in (tmp_path / "objects/b.glb").read_bytes()   # 2nd export kept it too
    assert box.visual.material.baseColorTexture is not None                   # source untouched
    m = list(load(tmp_path / "objects/a.glb", process=False).geometry.values())[0]
    assert m.visual.material.baseColorTexture.size == (512, 512)
    # a reference leaving the project folder is refused
    data = (tmp_path / "objects/a.glb").read_bytes().replace(b"../textures/tex_", b"../../../../tex_")
    (tmp_path / "objects/evil.glb").write_bytes(data)
    m = list(load(tmp_path / "objects/evil.glb", process=False).geometry.values())[0]
    assert getattr(m.visual.material, "baseColorTexture", None) is None


# ---------------------------------------------------------------- catalog --
@pytest.fixture
def cat(tmp_path, monkeypatch):
    from avegeany import catalog
    monkeypatch.setattr(catalog, "PACK", tmp_path / "pack")
    monkeypatch.setattr(catalog, "LIBRARY", tmp_path / "lib")
    monkeypatch.setattr(catalog, "THUMBS", tmp_path / "thumbs")
    return catalog


def test_catalog_pack_library_place(tmp_path, cat):
    import trimesh
    (tmp_path / "pack/chairs").mkdir(parents=True)
    trimesh.creation.box([0.5, 0.9, 0.5]).export(tmp_path / "pack/chairs/office_chair.glb")
    trimesh.creation.box([50, 40, 75]).export(tmp_path / "pack/side_table.stl")
    (tmp_path / "pack/side_table.json").write_text(json.dumps({"name": "Side table", "unit": 0.01}))
    items = {i["id"]: i for i in cat.list_items()}
    chair, table = items["pack/chairs/office_chair.glb"], items["pack/side_table.stl"]
    assert chair["category"] == "chairs" and chair["name"] == "Office chair" and chair["up"] == "y"
    assert table["category"] == "other" and table["name"] == "Side table" and table["unit"] == 0.01
    assert table["up"] == "z"                                            # stl default

    lib = cat.add(b"solid x\nendsolid x\n", "My Lamp.stl", "Lamp", "Lights", "z", "0.001")
    assert lib["id"].startswith("lib/lights/") and lib["unit"] == 0.001 and lib["name"] == "Lamp"
    assert lib["id"] in {i["id"] for i in cat.list_items()}
    with pytest.raises(ValueError):
        cat.remove("pack/chairs/office_chair.glb")                         # pack items stay
    for bad in ("pack/../secret.glb", "lib//etc/passwd.glb", "pack/chairs/../../x.glb", "nope/x.glb"):
        with pytest.raises(ValueError):
            cat.resolve(bad)
    with pytest.raises(ValueError):
        cat.add(b"x", "evil.exe")

    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    cat.put_thumb(chair["id"], png)
    assert cat.get_thumb(chair["id"]) == png
    with pytest.raises(ValueError):
        cat.put_thumb(chair["id"], b"not a png")

    project = tmp_path / "proj"
    project.mkdir()
    r = cat.place(chair["id"], project)
    assert r["file"] == "imports/office_chair.glb" and (project / r["file"]).exists()
    assert cat.place(chair["id"], project)["file"] == "imports/office_chair_2.glb"
    cat.remove(lib["id"])
    assert lib["id"] not in {i["id"] for i in cat.list_items()}


# ------------------------------------------------- islands / parts / planes --
def test_islands_follow_parts(tmp_path):
    from avegeany.separate import islands
    row, ranges, n_chairs = _fine_row(with_ranges=True)
    lab = islands(row, 0.15)
    assert lab.shape == (len(row.faces),) and lab.min() == 0
    assert 50 < lab.max() + 1 < 2000
    for (a, b), (c, d) in zip(ranges, ranges[1:]):                      # no island spans two chairs
        assert not set(lab[a:b]) & set(lab[c:d])

    # bucket-fill borders: only between islands that share an edge, never across separate shells
    from avegeany.separate import island_borders
    bd = island_borders(row, lab)
    assert len(bd["a"]) > 0 and (bd["a"] < bd["b"]).all() and (bd["length"] > 0).all()
    assert ((bd["angle"] >= 0) & (bd["angle"] <= 180)).all()
    chair_of = {}
    for k, (a, b) in enumerate(ranges):
        for i in set(lab[a:b]):
            chair_of[i] = k
    for i, j in zip(bd["a"], bd["b"]):
        if i in chair_of and j in chair_of:
            assert chair_of[i] == chair_of[j]                               # chairs are separate shells


def test_split_parts_by_hand_and_turned_planes(tmp_path):
    from avegeany import split
    row, ranges, n_chairs = _fine_row(with_ranges=True)
    project = _project_with(tmp_path, [("object_01", "object", row)])
    labels = np.zeros(len(row.faces), int)
    a, b = ranges[0]
    labels[a:b] = 7                                                       # first chair by hand
    r = split.split_parts(project, "object_01", labels)
    assert len(r["objects"]) == 2 and r["split"]["method"] == "picked by hand"
    split.merge_back(project, "object_01")
    with pytest.raises(ValueError):
        split.split_parts(project, "object_01", labels[:-1])              # wrong length
    with pytest.raises(ValueError):
        split.split_parts(project, "object_01", np.zeros(len(row.faces), int))   # one piece only

    # two planes turned 10 degrees, between chairs 1|2 and 2|3
    ang = np.radians(10)
    n = [np.cos(ang), np.sin(ang)]
    planes = [{"origin": [-0.9, 0.0], "normal": n}, {"origin": [-0.3, 0.0], "normal": n}]
    r = split.split_object(project, "object_01", planes=planes)
    pieces = [split.load_object(project / o["file"]) for o in r["objects"]]
    assert len(pieces) == 3
    for o, p in zip(r["objects"], pieces):                                # back to the row frame
        p.apply_translation(np.array(o["position_gltf"]))
    first, middle = pieces[0], pieces[1]
    d0 = (first.vertices[:, [0, 2]] - [-0.9, 0]) @ n
    d1 = (middle.vertices[:, [0, 2]] - [-0.9, 0]) @ n
    assert d0.max() < 1e-3 and d1.min() > -1e-3        # cut follows the turned plane (positions kept to 0.1 mm)
    split.merge_back(project, "object_01")
    r = split.split_object(project, "object_01", [1, 0], [0, 0], [-0.9, -0.3])   # old format still works
    assert len(r["objects"]) == 3


def test_server_islands_parts_catalog(tmp_path, cat):
    import base64, urllib.request, trimesh
    from avegeany.server import Session
    row = _fine_row()
    project = _project_with(tmp_path, [("object_01", "object", row)])
    trimesh.creation.box([1, 1, 1]).export(project / "scene.glb")
    (tmp_path / "pack/tables").mkdir(parents=True)
    trimesh.creation.box([1.2, 0.75, 0.8]).export(tmp_path / "pack/tables/desk.glb")
    s = Session(project_dir=project, workspace=tmp_path / "ws")
    httpd, base = _server(s)
    try:
        r = json.load(urllib.request.urlopen(base + "/api/islands?name=object_01&size=0.2"))
        isl = np.frombuffer(base64.b64decode(r["islands"]), "<u4")
        parts = np.frombuffer(base64.b64decode(r["parts"]), "<u4")
        assert r["count"] == len(isl) == len(parts) == len(row.faces) and r["k"] == 5
        labels = (isl % 2).astype("<u4")                                  # any assignment by islands
        out = _post(base + "/api/split/parts", {"name": "object_01",
                                                "labels": base64.b64encode(labels.tobytes()).decode()})
        assert len(out["objects"]) == 2
        items = json.load(urllib.request.urlopen(base + "/api/catalog"))["items"]
        assert [i["id"] for i in items] == ["pack/tables/desk.glb"]
        got = urllib.request.urlopen(base + "/api/catalog/file?id=pack/tables/desk.glb").read()
        assert got == (tmp_path / "pack/tables/desk.glb").read_bytes()
        placed = _post(base + "/api/catalog/place", {"id": "pack/tables/desk.glb"})
        assert placed["file"] == "imports/desk.glb" and (project / "imports/desk.glb").exists()
        try:
            urllib.request.urlopen(base + "/api/catalog/file?id=pack/../../etc/passwd")
            assert False, "should refuse"
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        httpd.shutdown()


# --------------------------------------------------------------- recovery --
def test_recovery_after_stop(tmp_path):
    """Unsaved work survives a stopped editor: the server leaves ROOM.recovered.avjp,
    reopening offers it, restoring brings the work back, saving removes the copy."""
    import os, signal, socket, subprocess, sys, time, urllib.request, zipfile
    from avegeany import avjp
    from avegeany.server import Session
    mesh = synthetic.make(tmp_path, "clean", pose=False)
    work = tmp_path / "work"
    segment_room(mesh, work, Params(verbose=False, separate=False))
    room = avjp.pack(work, tmp_path / "room.avjp")
    time.sleep(0.05)

    with socket.socket() as sk:
        sk.bind(("127.0.0.1", 0))
        port = sk.getsockname()[1]
    env = {**os.environ, "HOME": str(tmp_path / "home")}
    proc = subprocess.Popen([sys.executable, "-m", "avegeany", "open", str(room), "--port", str(port), "--no-browser"],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/ping")
                break
            except OSError:
                time.sleep(0.1)
        layout = {"version": 2, "objects": {"chair_01": {"position": [9.0, 0, 9.0], "quaternion": [0, 0, 0, 1]}}}
        _post(base + "/api/autosave", layout)
        proc.send_signal(signal.SIGTERM)                                   # like closing the terminal
        out, _ = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    rec = tmp_path / "room.recovered.avjp"
    assert rec.exists(), out
    assert json.loads(zipfile.ZipFile(rec).read("layout.json")) == layout
    assert "layout.json" not in zipfile.ZipFile(room).namelist()          # the project itself untouched

    s = Session(workspace=tmp_path)
    s.open(room)
    assert s.info()["recovery"]["path"] == str(rec.resolve())
    s.restore_recovery()
    assert json.loads((s.project_dir / "layout.json").read_text()) == layout
    assert s.info()["unsaved"] is True and s.info()["recovery"] is None
    s.save(layout)
    assert not rec.exists()                                                # saved for real: copy removed
    s.open(room)
    assert s.info()["recovery"] is None

    # nothing changed -> no copy is written; discard removes one
    s.write_recovery()
    assert not rec.exists()
    s.touch()
    assert s.write_recovery() == rec.resolve() and rec.exists()
    s.recovery = rec
    s.discard_recovery()
    assert not rec.exists()


def test_catalog_multifile_gltf(tmp_path, cat):
    """A .gltf with a separate .bin and textures/ (Poly Haven style) is served,
    placed with all its files, and baked by apply-layout."""
    import base64, trimesh, urllib.request
    from PIL import Image
    from avegeany.layout import load_import
    pack = tmp_path / "pack"
    (pack / "textures").mkdir(parents=True)
    box = trimesh.creation.box([0.8, 0.5, 0.5])
    box.visual = trimesh.visual.TextureVisuals(
        uv=np.random.default_rng(0).random((len(box.vertices), 2)),
        material=trimesh.visual.material.PBRMaterial(baseColorTexture=Image.new("RGB", (16, 16), (200, 50, 50))))
    files = box.export(file_type="gltf")                       # {"model.gltf": ..., "gltf_buffer_0.bin": ..., "0.png"?}
    doc = json.loads(files["model.gltf"])
    for i, e in enumerate(doc["buffers"]):
        name = "table.bin" if i == 0 else f"table_{i}.bin"
        (pack / name).write_bytes(files[e["uri"]]); e["uri"] = name
    for i, e in enumerate(doc.get("images", [])):
        data = files[e["uri"]] if "uri" in e else None
        if data is not None:
            (pack / f"textures/diff_{i}.png").write_bytes(data); e["uri"] = f"textures/diff_{i}.png"
    (pack / "table_4k.gltf").write_text(json.dumps(doc))
    item = "pack/table_4k.gltf"
    assert cat.gltf_files(pack / "table_4k.gltf")[0] == "table.bin"
    assert cat.asset(item, "table.bin").read_bytes() == (pack / "table.bin").read_bytes()
    for bad in ("../secret.bin", "/etc/passwd", "table_4k.gltf", "nope.bin"):
        with pytest.raises(ValueError):
            cat.asset(item, bad)

    project = tmp_path / "proj"
    project.mkdir()
    r = cat.place(item, project)
    assert r["file"] == "imports/table_4k/table_4k.gltf"
    assert (project / "imports/table_4k/table.bin").exists()
    assert cat.place(item, project)["file"] == "imports/table_4k_2/table_4k.gltf"
    m = load_import(project / r["file"])                        # apply-layout can read it
    assert np.allclose(np.ptp(m.vertices, 0), [0.8, 0.5, 0.5], atol=1e-4)

    with pytest.raises(ValueError, match="more files"):           # can't go to the library as one file
        cat.add((pack / "table_4k.gltf").read_bytes(), "table_4k.gltf")


def test_static_copy_has_every_module(tmp_path):
    """install_viewer copies everything app.js imports, so a static folder can start."""
    import re
    from avegeany.server import VIEWER, install_viewer
    install_viewer(tmp_path)
    imports = set(re.findall(r"from '\./([a-z]+\.js)'", (VIEWER / "app.js").read_text()))
    assert imports >= {"sidebar.js", "catalog.js", "splittab.js", "gizmo.js"}
    for f in imports | {"index.html", "app.js"}:
        assert (tmp_path / f).is_file(), f
    assert (tmp_path / "vendor/three/build/three.module.js").is_file()
