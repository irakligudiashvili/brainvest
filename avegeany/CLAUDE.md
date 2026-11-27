# CLAUDE.md — avegeany

Room scan → RANSAC structure detection → furniture separated into individual
objects → browser editor to move / rotate / hide / delete them and import new
objects at their real size.

Owner works on **macOS, Apple Silicon, fish shell**, Python 3.12 (Homebrew).

---

## Quick commands

```fish
cd ~/Documents/avegeany
source .venv/bin/activate.fish          # fish! (bash/zsh: source .venv/bin/activate)
pip install -r requirements.txt         # numpy scipy trimesh pillow pytest  (+ optional open3d)

python -m avegeany                                      # editor welcome screen: open .avjp / New from scan (= studio)
python -m avegeany open projects/room.avjp              # open a project, no re-processing (also: python -m avegeany room.avjp)
python -m avegeany segment SCAN.obj -o room.avjp --view # scan -> .avjp project (-o FOLDER still writes a folder)
python -m avegeany pack my_room -o projects/room.avjp   # existing output folder -> .avjp
python -m avegeany view my_room                         # editor on a folder or .avjp (port 8765)
python -m avegeany apply-layout room.avjp               # bake the layout -> room_rearranged.glb
python -m avegeany run PHOTOS_DIR_or_VIDEO -o my_room   # photogrammetry + segment + editor
python -m avegeany synth --mode clean|fused             # synthetic test room (2 drawers, 4 chairs, 1 table)
pytest -q                                               # 20 tests (fused test needs open3d; crashes on open3d 0.20, see below)
```

Useful `segment` flags: `--up y|z|-y…` (gravity axis if auto fails), `--room-height 2.6`
(rescale arbitrary-scale scans to metres), `--threshold` (plane tolerance, input units),
`--merge` (join islands closer than merge×threshold; lower if two pieces fuse, raise if one
piece splits), `--min-height` (fraction of room height).

---

## Repository map

```
avegeany/
  cli.py            argparse entry (python -m avegeany …); subcommands run/reconstruct/segment/view/apply-layout/synth
  pipeline.py       segment_room(): load → sample → RANSAC → frame → classify → cut → islands → export. Params dataclass
  ransac.py         vectorised sequential RANSAC (pure NumPy), LSQ refine, largest-connected-patch per plane
  structure.py      gravity/Manhattan frame (Frame: p' = s·R·p + t), plane labelling, convex room footprint
  segmentation.py   structural/outside face masks, welded face components, island merge + filters, point clustering
  categorize.py     geometry heuristics → table / chair / drawers / wardrobe / object (names only)
  separate.py       shape-based separation of merged objects: seeds (shape/pattern/parts) + crease-aware growing
  split.py          writes pieces for plane split + separation, fills openings, merge_back(), auto_separate()
  textures.py       one shared texture atlas per project (textures/), export_glb() / load() (project-limited URIs)
  catalog.py        furniture catalog: pack (ROOT/catalog) + My library (~/.avegeany/catalog), place into imports/
  layout.py         apply_layout(): bake layout.json (v1+v2, imports) into one GLB; load_import() pivot rule
  avjp.py           .avjp project files: pack / unpack / inspect (zip), temp working dirs, recent list
  server.py         local HTTP server: Session (open project, workspace, scan jobs) + /api endpoints
  photogrammetry.py photos/video → mesh: Apple Object Capture (default on arm64 Mac) or COLMAP(+OpenMVS)
  synthetic.py      synthetic room generator; "fused" = Poisson-welded single mesh like real photogrammetry
viewer/
  index.html        editor markup + CSS + importmap (three.js r170 vendored locally, NO CDN)
  app.js            editor logic (loading, selection, collisions, hide/delete/undo, import, layout I/O)
  sidebar.js        left floating sidebar (Catalog | Split tabs, collapsible, `[`)
  catalog.js        Catalog tab: cards + thumbnails, drag onto the floor (ghost), My library add/remove
  splittab.js       Split tab: focus mode, Pick parts (paint islands), Cut with planes (turnable)
  gizmo.js          TransformGizmo: move (X/Y/Z arrows + floor square) and turn (one Y ring = yaw only), no scale
  vendor/three/     three.module.js + OrbitControls, GLTFLoader/Exporter, OBJ/PLY/STL loaders, BufferGeometryUtils
tools/object_capture.swift   RealityKit PhotogrammetrySession CLI (compiled on first `run --backend apple`)
tests/test_pipeline.py       RANSAC, clean rooms ×3 poses, fused room, layout v2 + imports, server endpoints,
                             .avjp round trip + zip-slip, server scan job → save → reopen
data/               user scans live here (e.g. data/aud/*.obj from Scaniverse, data/aud.ply) — not in git
my_room/, output/   segmentation outputs — not in git
catalog/            the furniture pack: put models here (sub-folders = categories, optional <name>.json)
projects/           default workspace for .avjp files made in the editor — not in git
```

---

## Coordinate frames (most common source of bugs)

| where | frame |
|---|---|
| input scan | anything (Y-up for Apple/Scaniverse/glTF, arbitrary for COLMAP) |
| pipeline internals, `scene.json` `position`, `footprint`, `walls` | **canonical Z-up**, floor at z=0, walls aligned to X/Y, room centred |
| every exported mesh (`scene.glb`, `objects/*`, `room_*.glb`), `scene.json` `position_gltf`, `layout.json`, the editor | **glTF Y-up** |

* Z-up → Y-up is `pipeline.Z2Y`: (x, y, z) → (x, z, −y). In the editor, footprint `[x, y]` maps to three.js `(x, −y)` on the XZ plane.
* `scene.json.input_to_canonical` is the 4×4 from the raw scan to canonical (includes scale if `--room-height`).
* **Pivot rule** (shared by Python and JS — keep them identical): object origin = footprint centre
  (bbox centre in X/Z) at the bottom (min Y). Scanned furniture standing within 10 % of room
  height of the floor gets pivot y = 0. Imports: same rule after up-axis fix and unit scale
  (`app.js buildImport` ⇔ `layout.py load_import`).

---

## Segmentation pipeline (pipeline.segment_room)

1. **Load** with trimesh (`process=False`; scenes concatenated). No faces → point-cloud path.
   Textured meshes need **Pillow**. Mesh is transformed in place (no `.copy()` – deep-copying big textures is slow).
2. **Sample** 200k area-uniform surface points (tessellation independent). Threshold default = 0.4 % of scene diagonal.
3. **RANSAC** (`ransac.detect_planes`): up to 25 planes, min support 1 % of samples, each plane cut to
   its largest connected patch (radius 4·thr) so coplanar but separate surfaces don't merge.
4. **Gravity**: hint (`--up`) snapped to nearest dominant normal; else thinnest Manhattan axis;
   sign = side where non-planar (furniture) mass sits (furniture is near the floor).
5. **Canonical frame**: up→Z, biggest wall normal→X, floor (lowest horizontal plane) → z=0.
6. **Labels** (`classify_planes`): floor/ceiling = horizontal planes within 8 % of the height
   extremes; wall = vertical, inlier height span ≥ 50 % room height, ≤ 5 % of points behind it;
   duplicates coplanar with structure → `*_part`. Table tops / drawer fronts stay `other` (= furniture).
7. **Cut**: faces with all vertices within thr of a structural plane (or flat & within 2·thr) removed;
   faces entirely outside walls/floor/ceiling dropped.
8. **Islands**: vertices welded by position (UV seams!), face–vertex graph components, then
   single-linkage merge of islands closer than `merge×thr`, drop slabs hugging a structural plane
   (95 % within 4·thr: rugs, posters, wall leftovers), drop height < 4 % room height or area < 1 % H².
9. **Export** (`export`): `scene.glb` nodes `room_scan`, `room_shell`, `furniture__<name>`;
   `objects/<name>.glb|.obj` (Y-up, pivot at origin); `room_structure.glb`; `room_shell.glb`
   (clean planar room from the wall planes, convex footprint, normals face inward); `scene.json`.

Point clouds: structure points removed by plane distance, rest clustered with Euclidean
clustering (`--eps`, default 2.5·thr), objects exported as point clouds.

---

## .avjp project files (avjp.py)

Proprietary project file = zip archive of an already-segmented working folder, so opening never
re-runs RANSAC. Root `avjp.json` `{"format":"avjp","version":1,"name","created","modified",
"source":{"file","params"}}` + `scene.glb scene.json room_shell.glb room_structure.* objects/* layout.json imports/*`.
Editor files (`index.html app.js gizmo.js vendor/`) are never packed. Raw scans are **not** stored.
* `pack()` writes `dest.tmp` then `os.replace` (atomic). `unpack()` rejects absolute / `..` members (zip slip).
  Bump `VERSION` on breaking changes; `inspect()` refuses files from a newer version.
* Opening extracts into a fresh `tempfile.mkdtemp(prefix="avjp-")` working dir, deleted at exit;
  **Save re-packs that working dir into the .avjp**. Recent list: `~/.avegeany/recent.json`.

## Separating merged objects (separate.py, split.py)

Segmentation separates objects only where there is **empty space**, so touching things (seats sharing
armrests, a table against a cabinet …) come out as one object. Two tools split them; both write pieces
`object_09_1 … _N` (parent category kept, own pivot) through `split._write_pieces`, keep the parent in
`objects/_split/` + a `splits` record in scene.json, so **Merge back** undoes either.

**Shape-based separation** (`separate.separate`, default + automatic):
1. Surface graph of the welded mesh (triangle adjacency) + proximity links between separate shells
   (cost grows fast with the gap: touching parts link, 2.5 cm apart barely).
2. Thickness: voxels (~2 cm, closed, hole-filled) → distance transform → thin-neck value per triangle.
3. Seeds: **shape** blobs (peel 2–8 cm deep; a blob count stable for ≥ 2 depths) are used only when they
   agree with the **pattern** count (or there is no pattern); otherwise pattern seeds at the middle of
   each repeat (`split.suggest`, with the room's width via `room_profile`/`pitch_hint_for` only for
   objects shaped like the rows that defined it). Editor-only: sizeable separate shells ("separate parts").
4. Multi-source Dijkstra; step cost = distance × (1 + 8·inward crease) × (1 + 4·thin neck).
5. Clean-up: tiny label islands → neighbour; small shells (legs, handles) go whole to one piece;
   pieces < 3 % of the surface merge away. Confidence from pattern strength / agreement / balance.
* Pieces are original triangles (`separate_parts`, textures kept); openings where pieces met are
  chained into loops, projected on their best-fit plane and ear-clipped (non-flat loops stay open).
* **Automatic** at the end of `segment_room` (`Params.separate`, `--no-separate`, New-from-scan
  checkbox): `split.auto_separate` on row-like / long objects with confidence ≥ 0.6. On the
  auditorium: all 15 seat rows → seats, nothing else touched, ~4 s.
* `separate.islands(geom, size)`: over-segmentation for picking by hand — farthest-point seeds ~size apart per
  shell, grown with the same crease/neck costs, so patches follow creases; shells never share an island.
* `GET /api/separate/preview` / `POST /api/separate` (+cancel) still exist (tests), the editor now uses
  `GET /api/islands?name=&size=&start=auto|one&k=` (islands + starting pieces, base64 uint32 per triangle)
  and `POST /api/split/parts {name, labels, record}` (`split.split_parts`).

**Plane split** (`split.suggest` + `split_object`): vertical cut planes from the repeat guess (0.40–1.2 m,
≥ 3 repeats, peak ≥ 0.3; no pattern → 2 pieces at the emptiest middle spot). `split_object` takes either
parallel `cuts` along `axis` or `planes=[{origin:[x,z], normal:[nx,nz]}]` (each turned on its own; piece k
= behind plane k and not taken earlier); meshes cut exactly (`_Soup.cut`, UVs interpolated) and caps ear-clipped
(`_cap`, holes by even-odd + bridging → closed boxes stay watertight).

**Shared textures** (textures.py): scans have one big atlas (Scaniverse 8192²). Objects reference
`textures/tex_<fingerprint>.jpg` by URI instead of embedding a copy (was ~5 MB per object: 521 MB vs
53 MB for the auditorium). `load()` resolves URIs only inside the project folder and tags images so
re-exports reuse the same file. Server sends `textures/` cacheable; the editor enables `THREE.Cache`
and `shareTextures()` so the atlas is fetched/uploaded once (84 objects load in ~1–2 s). Build a fresh
material when stripping an image — a shallow copy shares trimesh's storage (bug seen: only the first
piece stayed textured). Files parked in `objects/_split/` have a broken relative URI until merged back.

## Catalog (catalog.py, viewer/catalog.js)

* Sources: **pack** = `ROOT/catalog/` (the owner drops models there), **lib** = `~/.avegeany/catalog/`
  (added from the editor, shared by all projects). Override with `AVEGEANY_CATALOG` / `AVEGEANY_LIBRARY`.
  Sub-folders = categories; optional `<name>.json` `{name, category, up, unit, tags}`; defaults like Import.
* Ids `pack/<rel>` / `lib/<rel>`; `catalog.resolve` refuses `..`/absolute/outside-root. Thumbnails are
  rendered by the editor (offscreen three.js) and cached in `~/.avegeany/thumbs/<sha>.png` (+ `.json`
  with the measured W×D×H), keyed by path + mtime.
* Endpoints: `GET /api/catalog`, `GET /api/catalog/file?id=`, `GET|POST /api/catalog/thumb?id=[&size=w,d,h]`,
  `POST /api/catalog/add?filename=&name=&category=&up=&unit=` (body = file), `POST /api/catalog/remove {id}`
  (lib only), `POST /api/catalog/place {id}` → copied to `imports/` (projects stay self-contained).
* **Multi-file .gltf** (e.g. Poly Haven: `x.gltf` + `x.bin` + `textures/*.jpg`): the editor loads its files through
  `GET /api/catalog/asset?id=&path=` (GLTFLoader base URL; only `.bin`/images next to the model, inside its
  root); `place` copies the .gltf **with** its files into `imports/<name>/` (relative paths kept), and
  restoring a layout uses that folder as the base. One-off import: select/drop the .gltf together with its
  files (`importFiles`; missing ones are named) → `POST /api/import-bundle?dir=&path=`. Adding a multi-file
  .gltf to My library is refused (one upload = one file) — put the folder in `catalog/` or use .glb.
* Drag a card onto the view: HTML5 DnD with type `application/x-avegeany-item`; a ghost follows the floor
  hit and turns red when `isFree()` fails; drop places it (spiral `placeFree` if blocked) as a normal
  import (undo, save, layout, apply-layout). Click = place at the orbit target.

## Editor (viewer/)

Served by `server.py` (`studio`, `open`, `view`, `segment --view`, `run`). The server serves
`index.html app.js gizmo.js vendor/` **straight from `viewer/`** and everything else from the
session's project working dir, so it can switch projects without restarting and viewer edits are
live on reload. `install_viewer()` still copies the editor into output folders (static hosting).

Server endpoints (127.0.0.1 only; POSTs with a foreign `Origin` are refused):
* `GET /api/ping`, `GET /api/project` → `{loaded, name, avjp, dir, workspace}`; editor switches to server mode.
  `loaded: false` → welcome screen (Open / New from scan / recent).
* `POST /api/save` (layout JSON) → `layout.json` + pack to the session's .avjp
  (first save of a folder project → `workspace/<name>.avjp`). `GET /api/download` streams a packed copy.
* `POST /api/open {path}`, `POST /api/open-upload?name=x.avjp` (copied into the workspace), `GET /api/recent`.
* `POST /api/scan/upload?job=ID&name=f` (several files per job, original names kept so .obj→.mtl→.jpg
  resolve) then `POST /api/scan/process {job, main, name, up, room_height, merge}` → background thread runs
  `segment_room` (stdout tee'd into the job log), packs `workspace/<name>.avjp`, switches the session.
  `GET /api/job?id=&since=` for progress. One job at a time.
* `POST /api/layout` → `layout.json` only (used before Download). `POST /api/import?name=f.glb` →
  `imports/<sanitised name>` (only .glb .gltf .obj .ply .stl, ≤1 GB).
Without the server (static hosting) Save downloads layout.json and imports are not persisted.
Workspace default: `./projects` (`studio --workspace DIR`); for `open X.avjp` it is X's folder.

Layout: right panel (project, selection, gizmo, objects, view, layout) + **left floating sidebar**
(`sidebar.js`: Catalog | Split tabs, collapse with `‹` or `[`, state in localStorage). While it's open the
camera's view offset shifts the picture's centre into the visible area (`resize()`); the HUD hides on
narrow windows. Modules get an `editor` API object from app.js (no new globals); a module can take over
pointer + keys by setting `editor.tool = {pointerDown, pointerMove, pointerUp, keydown, update}`.

**Split tab** (`splittab.js`, `S` on a selected scanned object): focus mode fades every other object and
the room to 12 % opacity, lifts the object 25 cm (records sent to the server subtract the lift) and
orbits it. *Pick parts*: islands from `/api/islands` drawn as a non-indexed copy with per-triangle colours
(flat colours by default, "show texture" toggle); click/drag paints islands onto the active piece
(Shift = one triangle, Alt = eyedropper, ⌘Z undo, 1–9 pieces, N new piece, Auto −/+ count, island size
slider). **Bucket** (`B` toggles Brush/Bucket): flood fill over islands using `island_borders` from
`/api/islands` (pairs that share mesh edges + border length + length-weighted bend angle); it never jumps
to floating islands (separate shells have no border), stops at borders bent more than the limit
(default 30°), at thin joints (border < 15 % of the smaller island's border total) and, by default, at
other pieces. Hover previews the region. Triangle order must match the server's (checked by count). *Cut with planes*: drag a red plane to
slide it, drag its yellow ring left/right to turn it (±80°), row-direction angle, crossing warning.
Enter applies, Esc leaves; both end in a normal split record (Merge back).

Interaction:
* **Project panel**: Save (⌘/Ctrl+S), Download .avjp, Open…, New from scan…; orange dot = unsaved
  (layoutJson differs from the last save; checked every 0.7 s). Leaving with unsaved changes asks first.
  Dropping an .avjp anywhere opens it.
* **Gizmo** (`gizmo.js`): red/green/blue arrows = X left-right / Y up-down / Z front-back;
  yellow square = free move on floor plane; **one green ring = turn about the vertical axis** (furniture
  never tilts; the ring always uses world up, also in local space). `size` 0.12 of camera distance.
  `L` or the dropdown toggles **world** vs **local** arrows (local = move along the object's facing).
  Shift or "snap" checkbox: 5 cm / 15°. The gizmo never writes transforms itself — it calls
  `onDrag(obj, apply)` and the editor's `tryMove` accepts or reverts.
* Drag the object body = slide on its current floor plane. Keys: Q/E turn 15° (Shift 90°),
  arrows / PgUp / PgDn nudge 1 cm (Shift 5 cm), H hide, Delete/Backspace delete, ⌘/Ctrl+Z undo
  (200 steps; covers moves, hide, delete, import), F focus, Esc deselect.
* Selection panel: numeric x/y/z (m) and ry (deg), Hide/Show, Delete, Reset. Every rotation is
  pure yaw (`yawQuat`); layouts with tilts are flattened to their yaw on load (`recYaw`).
* **Collisions** (`collisions`/`tryMove`): **oriented** boxes — `localBox(f)` = tight box in the
  object's own frame (cached in a WeakMap), carried by `matrixWorld` → `obb()` (4 floor corners +
  y range) → 2-D separating-axis test `obbOverlap()`. The moving object is shrunk 3 cm; checked
  against other visible objects, room footprint polygon (all 4 corners inside = no wall hit),
  floor (min y < −2 cm), ceiling. Only **new** overlaps are blocked, so pieces that already touch
  in the scan can still move. Toggle: "Collisions: on/off" button or **C** (state in hidden `#collide`).
  The orange selection outline is the same oriented box (`makeSelBox`), and list sizes are local sizes.
* **Import**: button or drag-and-drop; .glb/.gltf(embedded only)/.obj/.ply/.stl; up axis
  auto (glb/obj → Y, stl/ply → Z) or forced; units metres (original scale, default)/cm/mm/in.
  Placed at the nearest free floor spot around the orbit target (spiral search).
* **Export GLB** exports only visible, non-deleted objects (`onlyVisible`).

### layout.json (v2, glTF Y-up, metres)
```json
{"version": 2,
 "objects": {"chair_01": {"position":[x,y,z], "quaternion":[x,y,z,w], "rotation_y": r,
                          "visible": true, "deleted": false}},
 "imports": [{"name":"lamp", "file":"imports/lamp.glb", "ext":"glb", "up":"y", "unit_scale":1.0,
              "position":[...], "quaternion":[...], "visible":true, "deleted":false}]}
```
v1 (only `rotation_y`) is still accepted by both the editor and `apply-layout`.

---

## Testing

* `pytest -q` must stay green. Known issue: `test_fused_photogrammetry_like_mesh` aborts the whole run
  with open3d 0.20 (Poisson "Failed to close loop"), independent of our code — deselect it with
  `--deselect tests/test_pipeline.py::test_fused_photogrammetry_like_mesh` until open3d is pinned/fixed.
  Expected synthetic result: exactly `{chair: 4, drawers: 2, table: 1}`,
  room height 2.70 ± 0.03, 4 walls, for any random pose.
* Editor changes: check in a real browser. Headless check that has worked:
  serve with `python -m avegeany view OUT --no-browser --port 8766`, drive with Playwright
  (Chrome flags `--use-gl=swiftshader --enable-unsafe-swiftshader`), use `window.__avegeany`
  (`items, gizmo, select, tryMove, layoutJson, importFile, undo, deleteObj, toggleHidden`).
  Project gizmo handle points with `gizmo.root.matrixWorld` + `camera` to get screen coords.
  A 404 for `layout.json` on first load is expected (no saved layout yet).

## Conventions & gotchas

* Keep the pipeline NumPy/SciPy/trimesh only; open3d is optional (synthetic fused room only;
  wheels exist for Python ≤ 3.12 on macOS).
* All tunables are relative to scene size / room height, so scans in any unit work; categories need metres.
* Objects are named `<category>_<NN>` sorted by centroid; names are the keys in layout.json — don't rename casually.
* `.usdz` is not readable by trimesh: re-export as OBJ/GLB (or add usd-core support — see roadmap).
* `photogrammetry.py` / `object_capture.swift` / COLMAP paths have **not** been run end-to-end yet.
* No CDN: three.js is vendored at r170. Adding a three addon = copy it into `viewer/vendor/three/examples/jsm/…`
  and check its own imports.
* Don't edit generated copies in `my_room/` or `output/`; edit `viewer/` and re-run `view`.

---

## Status & roadmap

Done
- [x] Segmentation pipeline + synthetic tests; works on the owner's Scaniverse scan (`data/aud`, an
      auditorium: rows of seats come out as ~2.9 m objects)
- [x] Editor: combined move/rotate gizmo (world/local), hide, delete, undo, numeric transform entry
- [x] Import extra objects at original scale (+ unit/up-axis options), persisted via server
- [x] layout.json v2 + `apply-layout` baking imports, hidden/deleted, full rotations
- [x] .avjp project files; editor welcome screen, Open / Save / Download, New project from a scan (server-side processing)
- [x] Yaw-only turning (single ring), smaller + thicker gizmo
- [x] Oriented collision boxes that turn with the object; collisions on/off toggle (C)

Next ideas
- [x] Plane split of any object (editor tool + automatic guess, filled cuts, merge back)
- [x] Shape-based separation of merged objects (automatic during processing + editor preview)
- [x] Furniture catalog (pack folder + My library), drag onto the floor
- [x] Split tab: focus mode, island picking, turnable cut planes
- [x] Shared texture atlas per project (projects ~10× smaller, editor loads in seconds)
- [ ] USDZ input (usd-core) for iPhone/RoomPlan exports
- [ ] Inpaint scan holes under moved furniture with texture from the surrounding floor
- [ ] Snap-to-wall / align-to-wall helper in the editor; redo (⇧⌘Z)
