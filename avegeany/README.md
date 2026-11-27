# avegeany — scan a room, pull the furniture out, move it around

Photos (or a video) of a room → photogrammetry mesh → **RANSAC** finds the big
planes (floor, walls, ceiling) → everything that is *not* structure is cut out →
the remaining **islands** become separate furniture objects → a browser editor
lets you drag / rotate each piece inside the room.

```
photos / video ─► photogrammetry ─► room mesh
                                      │
                    RANSAC planes ◄───┘   (sequential RANSAC on 200k surface samples)
                         │
      gravity + Manhattan frame (Z up, floor z=0, walls on X/Y axes)
                         │
      label planes: floor · ceiling · wall · other (table tops, drawer fronts…)
                         │
      remove faces lying on floor/wall/ceiling planes + anything outside the room
                         │
      connected islands → merge nearby fragments → drop leftovers & noise
                         │
      table_01, chair_01…04, drawers_01…02  →  scene.glb + objects/*.glb|obj
                         │
                  web editor (three.js) → layout.json → room_rearranged.glb
```

## Install (macOS, Apple Silicon)

```bash
cd ~/Documents/avegeany
python3 -m venv .venv
source .venv/bin/activate.fish             # fish shell  (bash/zsh: source .venv/bin/activate)
pip install -r requirements.txt            # numpy, scipy, trimesh
pip install open3d                         # optional: only for `synth --mode fused`
xcode-select --install                     # for the Apple Object Capture backend (once)
brew install ffmpeg                        # only if you start from a video
```

Python 3.10–3.12 is safest (open3d wheels). open3d is only needed for the
synthetic *fused* test room; the pipeline itself is NumPy/SciPy/trimesh.

## Quick try — the synthetic room (2 drawers, 4 chairs, 1 table)

```bash
python -m avegeany synth --mode fused            # photogrammetry-like: ONE welded mesh, random pose
python -m avegeany segment data/synthetic/synthetic_room_fused.ply -o output --view
```

Expected:

```
[structure] up=[0. 1. 0.]  room height 2.699  floor=yes  ceiling=yes  walls=4  other planes=2
  islands: 165 raw -> 45 after merge -> 7 objects (38 structure leftovers, 0 noise)
[done] 7 furniture objects
   chair_01 … chair_04   0.46 x 0.46 x 0.93
   table_01              0.91 x 1.61 x 0.72
   drawers_01, 02        0.51 x 0.81 x 0.87
```

(`--mode clean` builds a light version with no open3d needed.)

## Your own room

```bash
# photos folder or a video; on Apple Silicon the default backend is Apple Object Capture
python -m avegeany run ~/Pictures/my_room/ -o my_room
python -m avegeany run room.mov -o my_room --fps 2

# already have a mesh (Polycam, Scaniverse, RealityScan, Metashape, Meshroom…)?
python -m avegeany segment scan.obj -o my_room --view
python -m avegeany view my_room                    # reopen the editor later
```

Capture tips: 150–400 photos with 60–80 % overlap, walk along the walls,
lights on, nobody moving, include the floor around each piece of furniture.

Photogrammetry backends (`--backend`):

| backend | how | notes |
|---|---|---|
| `apple` (default on M-series) | RealityKit `PhotogrammetrySession` via `tools/object_capture.swift` (compiled automatically) | fast, textured, ~metric, Y-up → `--up y` is set for you |
| `colmap` | COLMAP SfM, then COLMAP dense (CUDA) or OpenMVS (no CUDA, works on macOS) | `brew install colmap`, OpenMVS binaries on PATH |

## The editor

`segment --view` / `view` start a local server and open the editor
(three.js is bundled in `viewer/vendor`, works offline).

* **Gizmo** on the selected object: red / green / blue **arrows** move left-right / up-down /
  front-back, the yellow **square** slides it on the floor, the three **rings** rotate it.
  `L` switches world axes ↔ local axes (move along the direction the object faces).
  Hold **Shift** to snap to 5 cm / 15°.
* drag the object itself → slides on the floor · **Q / E** turn 15° (Shift = 90°) ·
  arrows / PgUp / PgDn nudge · type exact x / y / z and rotations in the side panel
* **Hide** (`H`, or the eye icon in the list) and **Delete** (`⌫`) — ⌘/Ctrl+Z undoes either
* **Import object**: button or drag a `.glb / .obj / .ply / .stl` onto the view. It keeps its
  original size (choose cm / mm / inches if the file isn't in metres) and lands on a free spot
  on the floor. Imports are copied into `OUT/imports/`.
* collisions with other furniture, walls, floor and ceiling are blocked (toggle in View)
* **Save layout** writes `OUT/layout.json` (restored next time you open the editor);
  **Export GLB** downloads the rearranged room
* bake it in Python: `python -m avegeany apply-layout my_room`

**Putting the editor on a website** (iframe, static hosting, what works today and the
planned embed API): see [docs/EMBEDDING.md](docs/EMBEDDING.md).

## Outputs (`-o DIR`)

| file | content |
|---|---|
| `scene.glb` | room scan + clean shell + one node per furniture (`furniture__chair_01` …), each with its pivot on the floor |
| `objects/*.glb`, `objects/*.obj` | each piece on its own, origin at footprint centre on the floor |
| `room_structure.glb` | scan with furniture removed (floor / walls / ceiling) |
| `room_shell.glb` | clean planar room from the detected planes |
| `layout.json`, `imports/` | written by the editor (Save layout / Import) |
| `scene.json` | room height, wall planes, footprint, transform input→canonical, object list (category guess, size, position) |

All meshes are glTF-style **Y-up**. Positions in `scene.json` use the canonical Z-up frame.

## Tuning

| flag | when |
|---|---|
| `--up y` | auto gravity guesses wrong (it assumes the room is wider than it is tall) |
| `--room-height 2.6` | SfM output has arbitrary scale → rescale to metres (also improves category names) |
| `--threshold T` | plane tolerance in input units (default 0.4 % of scene diagonal). Raise for noisy scans |
| `--merge 1.5` | islands closer than merge×threshold are joined. Lower if two chairs fuse; raise if one chair splits |
| `--min-height 0.04` | smallest object height (fraction of room height) |

## How it works (code map)

* `avegeany/ransac.py` — vectorised sequential RANSAC + least-squares refinement; each
  plane keeps only its largest connected patch.
* `avegeany/structure.py` — gravity (thinnest Manhattan axis, sign from where the furniture
  mass sits), canonical frame, labelling: floor/ceiling = horizontal planes at the
  extremes; wall = vertical plane spanning ≥ 50 % of the height with ≤ 5 % of the scene
  behind it. Table tops / drawer fronts fail those tests and stay "other".
* `avegeany/segmentation.py` — removes structural faces, welds vertices (UV seams),
  finds face islands, single-linkage merge of nearby islands, drops slabs that hug a
  structural plane and noise.
* `avegeany/categorize.py` — size/shape heuristics: table / chair / drawers / object.
* `avegeany/pipeline.py`, `cli.py`, `layout.py`, `photogrammetry.py`, `synthetic.py`.
* `tests/` — `pytest -q` (synthetic rooms in 3 random orientations + fused Poisson mesh).

## Known limits

* Furniture physically touching other furniture (a chair pushed hard against a table)
  stays one island — lower `--merge`, or split it in Blender.
* Rugs, posters, things flush on a wall are treated as structure.
* The clean shell assumes a convex footprint (L-shaped rooms get their convex envelope;
  the scanned structure is still exact).
* Under/behind furniture the scan has no data; the shell fills the hole with plain colour.
