"""Command line interface:  python -m avegeany <command> ...

  studio        open the editor (welcome screen: open .avjp / new project from a scan)
                - this is also what plain `python -m avegeany` does
  open          open an .avjp project in the editor (no re-processing)
  run           photos/video -> mesh -> segmented room -> viewer
  reconstruct   photos/video -> textured mesh (photogrammetry)
  segment       mesh/point cloud -> walls/floor/ceiling + separate furniture
                (-o ROOM.avjp writes a project file instead of a folder)
  view          open the furniture editor for a segmented room folder or .avjp
  pack          turn a segmented output folder into an .avjp project file
  apply-layout  bake a layout.json saved in the viewer into one mesh
  synth         make the synthetic test room (2 drawers, 4 chairs, 1 table)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _seg_args(p: argparse.ArgumentParser):
    g = p.add_argument_group("segmentation")
    g.add_argument("--up", choices=["x", "y", "z", "-x", "-y", "-z"],
                   help="gravity axis of the input (default: auto-detect)")
    g.add_argument("--threshold", type=float,
                   help="RANSAC plane distance threshold in input units (default: 0.4%% of scene size)")
    g.add_argument("--room-height", type=float,
                   help="real floor-to-ceiling height in metres; rescales the output to metric")
    g.add_argument("--max-planes", type=int, default=25)
    g.add_argument("--samples", type=int, default=200_000, help="surface samples used for RANSAC")
    g.add_argument("--min-height", type=float, default=0.04,
                   help="min furniture height as a fraction of room height (default 0.04)")
    g.add_argument("--merge", type=float, default=1.5,
                   help="join islands closer than MERGE x threshold (default 1.5)")
    g.add_argument("--eps", type=float, help="clustering radius for point-cloud input")
    g.add_argument("--no-separate", action="store_true",
                   help="don't split merged objects (e.g. seat rows) into parts by shape")
    g.add_argument("--quiet", action="store_true")


def _params(a):
    from .pipeline import Params
    return Params(up=a.up, threshold=a.threshold, room_height=a.room_height, samples=a.samples,
                  max_planes=a.max_planes, min_height_frac=a.min_height, merge_factor=a.merge,
                  point_eps=a.eps, separate=not a.no_separate, verbose=not a.quiet)


from .server import Session, install_viewer, serve  # noqa: E402
from . import avjp  # noqa: E402


def _segment_to(a, mesh, out: str):
    """Segment into a folder, or into an .avjp when OUT ends with .avjp.
    Returns what `serve` should open (folder or .avjp path)."""
    from dataclasses import asdict
    from .pipeline import segment_room
    p = _params(a)
    source = {"file": Path(mesh).name,
              "params": {k: v for k, v in asdict(p).items() if k != "verbose"}}
    if out.lower().endswith(".avjp"):
        work = avjp.temp_dir()
        segment_room(mesh, work, p)
        avjp.write_manifest(work, name=Path(out).stem, source=source)
        dest = avjp.pack(work, out)
        avjp.add_recent(dest, Path(out).stem)
        print(f"[avjp] project saved as {dest}")
        return dest
    segment_room(mesh, out, p)
    avjp.write_manifest(out, name=Path(out).name, source=source)
    install_viewer(Path(out))
    return Path(out)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        argv = ["studio"]
    elif len(argv) == 1 and argv[0].lower().endswith(".avjp"):
        argv = ["open", argv[0]]                       # python -m avegeany room.avjp
    ap = argparse.ArgumentParser(prog="avegeany", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    st = sub.add_parser("studio", help="open the editor without a project (welcome screen)")
    st.add_argument("--workspace", default="projects", help="folder for new .avjp files (default ./projects)")
    st.add_argument("--port", type=int, default=8765)
    st.add_argument("--no-browser", action="store_true")

    op = sub.add_parser("open", help="open an .avjp project in the editor")
    op.add_argument("project", help="ROOM.avjp")
    op.add_argument("--port", type=int, default=8765)
    op.add_argument("--no-browser", action="store_true")

    pk = sub.add_parser("pack", help="segmented output folder -> .avjp project file")
    pk.add_argument("out", help="output folder written by `segment`")
    pk.add_argument("-o", "--dest", help="ROOM.avjp (default: <folder>.avjp next to the folder)")
    pk.add_argument("--name", help="project name shown in the editor")

    r = sub.add_parser("run", help="photos/video -> segmented room -> viewer")
    r.add_argument("input", help="folder of photos or a video file")
    r.add_argument("-o", "--out", default="output")
    r.add_argument("--backend", choices=["apple", "colmap"])
    r.add_argument("--detail", default="medium", help="apple backend: preview|reduced|medium|full|raw")
    r.add_argument("--fps", type=float, default=2.0, help="frames per second taken from a video")
    r.add_argument("--no-view", action="store_true")
    _seg_args(r)

    rc = sub.add_parser("reconstruct", help="photos/video -> mesh")
    rc.add_argument("input")
    rc.add_argument("-o", "--out", default="work")
    rc.add_argument("--backend", choices=["apple", "colmap"])
    rc.add_argument("--detail", default="medium")
    rc.add_argument("--fps", type=float, default=2.0)

    s = sub.add_parser("segment", help="mesh -> structure + furniture objects")
    s.add_argument("mesh", help=".obj / .ply / .glb / .gltf / .off / .stl (mesh or point cloud)")
    s.add_argument("-o", "--out", default="output", help="output folder, or ROOM.avjp for a project file")
    s.add_argument("--view", action="store_true", help="open the viewer afterwards")
    _seg_args(s)

    v = sub.add_parser("view", help="open the furniture editor")
    v.add_argument("out", nargs="?", default="output", help="segmented folder or .avjp")
    v.add_argument("--port", type=int, default=8765)
    v.add_argument("--no-browser", action="store_true")

    la = sub.add_parser("apply-layout", help="bake layout.json into one mesh")
    la.add_argument("out", help="segmented folder or .avjp")
    la.add_argument("layout", nargs="?", help="layout.json (default: the project's own layout)")
    la.add_argument("-o", "--dest")
    la.add_argument("--shell", action="store_true", help="use the clean shell instead of the scan")

    sy = sub.add_parser("synth", help="make the synthetic test room")
    sy.add_argument("-o", "--out", default="data/synthetic")
    sy.add_argument("--mode", choices=["fused", "clean"], default="fused")
    sy.add_argument("--no-pose", action="store_true", help="keep Z up / axis aligned")
    sy.add_argument("--seed", type=int, default=0)

    a = ap.parse_args(argv)

    if a.cmd in ("run", "reconstruct"):
        from .photogrammetry import reconstruct, default_backend
        backend = a.backend or default_backend()
        work = Path(a.out) / "work" if a.cmd == "run" else Path(a.out)
        mesh = reconstruct(a.input, work, backend, a.detail, a.fps)
        print(f"[reconstruct] mesh: {mesh}")
        if a.cmd == "reconstruct":
            return
        if a.up is None and backend == "apple":
            a.up = "y"                     # Object Capture output is gravity aligned, Y up
        target = _segment_to(a, mesh, a.out)
        if not a.no_view:
            serve(target)
    elif a.cmd == "segment":
        target = _segment_to(a, a.mesh, a.out)
        if a.view:
            serve(target)
    elif a.cmd == "studio":
        serve(Session(workspace=Path(a.workspace)), a.port, not a.no_browser)
    elif a.cmd in ("open", "view"):
        target = Path(a.project if a.cmd == "open" else a.out)
        if target.suffix.lower() == ".avjp":
            if not target.is_file():
                sys.exit(f"{target} not found")
            try:
                avjp.inspect(target)
            except avjp.AvjpError as e:
                sys.exit(str(e))
        elif a.cmd == "open":
            sys.exit(f"{target} is not an .avjp file (use `view` for a folder)")
        elif not (target / "scene.glb").exists():
            sys.exit(f"{target}/scene.glb not found - run 'segment' first")
        serve(target, a.port, not a.no_browser)
    elif a.cmd == "pack":
        out = Path(a.out)
        dest = Path(a.dest) if a.dest else out.parent / f"{out.name}.avjp"
        try:
            dest = avjp.pack(out, dest, a.name)
        except avjp.AvjpError as e:
            sys.exit(str(e))
        avjp.add_recent(dest, a.name or dest.stem)
        print(f"[avjp] wrote {dest} ({dest.stat().st_size / 1e6:.1f} MB)")
    elif a.cmd == "apply-layout":
        from .layout import apply_layout
        out = Path(a.out)
        if out.suffix.lower() == ".avjp":
            work = avjp.temp_dir()
            avjp.unpack(out, work)
            dest = a.dest or out.with_name(f"{out.stem}_rearranged.glb")
            apply_layout(work, a.layout or work / "layout.json", dest, a.shell)
        else:
            apply_layout(out, a.layout or out / "layout.json", a.dest, a.shell)
    elif a.cmd == "synth":
        from .synthetic import make
        p = make(a.out, a.mode, pose=not a.no_pose, seed=a.seed)
        print(f"[synth] wrote {p}")


if __name__ == "__main__":
    main()
