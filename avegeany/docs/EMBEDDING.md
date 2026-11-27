# Embedding the avegeany editor in a website

This guide explains how to put the room editor on a web page, usually inside an
`<iframe>`. It is split into what **works today** and what is **planned**. The
planned parts are a specification for later work, not features you can use yet.

---

## 1. Two ways to run the editor

| | **Static** (any web host) | **Server** (`python -m avegeany`) |
|---|---|---|
| What you deploy | a folder of files (HTML, JS, GLB, JSON) | the Python server |
| View, move, turn, hide, delete objects | ✅ | ✅ |
| Collisions, gizmo, undo, Export GLB, Load layout | ✅ | ✅ |
| Save | downloads `layout.json` to the visitor's computer | saves into the project's `.avjp` |
| Import a model | ✅ for the visit, **not kept** after reload | ✅ kept in the project |
| Catalog tab, Split tab, New from scan, Open `.avjp` | ❌ (the tabs say they need the server) | ✅ |
| Several visitors at once | ✅ (each one is independent) | ❌ one shared session, see §4 |
| Network | public | **127.0.0.1 only** (local machine) |

For a public website, **static** is the option that works today. Server mode is
for one person on their own machine or a trusted local network.

---

## 2. Static embed (works today)

### 2.1 Build the folder

```bash
python -m avegeany segment data/my_scan.obj -o site/room
```

`segment` with a **folder** as `-o` (not a `.avjp` file) writes everything a
browser needs:

```
site/room/
  index.html  *.js  vendor/                    the editor (app.js, sidebar.js, catalog.js, splittab.js,
                                               gizmo.js; three.js r170 included, no CDN)
  scene.glb   scene.json                       the room and its objects
  objects/*.glb   textures/tex_*.jpg           separated objects + the shared texture atlas
  room_shell.glb  room_structure.glb
  layout.json                                  optional: the arrangement to show (see 2.4)
```

To publish a project you only have as an `.avjp` file, extract it first. An
`.avjp` is a zip archive:

```bash
python -c "from avegeany import avjp; from avegeany.server import install_viewer
avjp.unpack('projects/room.avjp', 'site/room'); install_viewer('site/room')"
```

`install_viewer()` copies `viewer/index.html`, every `viewer/*.js` / `*.css` and
`viewer/vendor/` into the folder. Run it again after updating avegeany to
refresh the editor in a published folder.

### 2.2 Host it

Any static host works: nginx, Apache, Netlify, GitHub Pages, S3 and so on.
Requirements:

- **Serve it over `http(s)://`**, not `file://`. The editor uses ES modules and `fetch`.
- **MIME types:** `.js` as `text/javascript`. `.glb` as `model/gltf-binary` is recommended; `application/octet-stream` also works.
- **Caching:** files in `textures/` are named by a content fingerprint and can be cached for good (`Cache-Control: public, max-age=31536000, immutable`). Keep `scene.json` and `layout.json` short-lived or uncached if you replace them.
- **Size:** a phone-scanned room is typically **30–60 MB** (one texture atlas of about 9 MB plus the objects). Turn on gzip or brotli for `.json`, `.glb` and `.js`; `.jpg` is already compressed.

### 2.3 Put it on a page

```html
<iframe
  src="https://example.com/room/index.html"
  title="Room editor"
  style="width:100%; height:80vh; border:0; border-radius:12px"
  allow="fullscreen"
  loading="lazy"></iframe>
```

Layout notes:

- The editor fills its frame (`html, body { height:100% }`). **Give the iframe a real height**: a fixed size or `vh`, not `auto`.
- It has a 310 px panel on the right and a floating sidebar on the left (300 px, collapsible). **Below about 900 px wide** the 3D view gets cramped. On narrow pages, make the iframe full-width, or plan for the planned "minimal UI" mode (§5.2).
- The help line at the bottom hides automatically below 1180 px window width while the sidebar is open.
- Keyboard shortcuts (Q/E, arrows, ⌘Z, S, C, `[`…) only work while the iframe has focus. Visitors click into the 3D view first.
- WebGL is required. It works in current Chrome, Edge, Safari and Firefox on desktop. Touch devices can orbit and select, but the editor is designed for mouse and keyboard.

### 2.4 Choosing what visitors see

- On start the editor loads `scene.glb` and `scene.json`, then `layout.json` **if it exists** next to them. To show a rearranged room, export a layout from the editor (Save in static mode, or `layout.json` from the project) and put it in the folder.
- A 404 for `layout.json` is normal when there isn't one.
- Visitors' changes stay in their browser tab. **Save** downloads a `layout.json`, and reloading the page shows the published layout again.
- Visitors can **Export GLB** (the visible objects only), which is useful for "download your arrangement".

### 2.5 Controlling the editor from the page (same origin only)

If the page and the editor are on the **same origin** (same scheme, host and port), the host page can reach the editor's JavaScript:

```js
const frame = document.querySelector('iframe');
frame.addEventListener('load', async () => {
  const w = frame.contentWindow;
  // the editor finishes loading the room a moment after "load"
  while (!w.__avegeany) await new Promise(r => setTimeout(r, 100));
  const A = w.__avegeany;
  console.log(A.items.map(o => o.userData.label));          // object names
  const layout = A.layoutJson();                            // current arrangement (layout.json v2)
  A.select(A.items.find(o => o.userData.label === 'chair_01'));
});
```

`window.__avegeany` exposes `items, scene, camera, controls, gizmo, select, tryMove, layoutJson, importFile, undo, deleteObj, toggleHidden, saveProject, showNewScan, showOpen, editor, dirty`.

> ⚠️ This is an **internal testing hook**, not a stable API. Names and
> behaviour can change between versions, and browsers block it across
> origins. Use it for prototypes. The supported replacement is the message
> API in §5.1.

The arrangement format is `layout.json` v2 (glTF Y-up, metres), described in `CLAUDE.md`:

```json
{"version": 2,
 "objects": {"chair_01": {"position": [x, y, z], "quaternion": [x, y, z, w], "rotation_y": r,
                          "visible": true, "deleted": false}},
 "imports": [{"name": "lamp", "file": "imports/lamp.glb", "ext": "glb", "up": "y", "unit_scale": 1.0,
              "position": [...], "quaternion": [...], "visible": true, "deleted": false}]}
```

---

## 3. Server mode on your own machine (works today)

```bash
python -m avegeany open projects/room.avjp --port 8765 --no-browser
```

Then embed `http://127.0.0.1:8765/index.html` in a page you open **on the same
computer** (a local dashboard, a kiosk, an intranet tool running on that machine).
Everything works, including Catalog, Split, New from scan, Save and the
automatic recovery copy.

- The server listens on **127.0.0.1 only**. Other computers can't reach it, which is deliberate.
- **Writes** (Save, import, split …) are refused when the request comes from a page on a different origin (`Origin` header ≠ `http://<Host>`). This stops other websites from changing your projects. Reading works from anywhere the server is reachable.
- `--workspace DIR` (with `studio`) sets where new `.avjp` files go.

---

## 4. Why server mode is not for public websites yet

These are gaps in the current code, not configuration problems:

1. **One shared session.** The server has one "open project" for everyone. Two visitors would edit and save the same project and switch it under each other.
2. **No sign-in or permissions.** Anyone who can reach the server can save, delete pieces, upload files (up to 1 GB) and open any `.avjp` path on the machine via `/api/open`.
3. **Fixed to 127.0.0.1.** There is no `--host` option.
4. **HTTPS behind a proxy is refused.** The write check compares the browser's `Origin` with `http://<Host>`. Behind an HTTPS reverse proxy the origin is `https://…`, so every Save is rejected with 403.
5. **Heavy work runs on request.** Processing a scan takes from a few seconds to minutes of CPU per upload, one job at a time.

Until those are addressed (see §5.3), publish **static** folders (§2) and do the
editing, splitting and catalog work in server mode on your own machine.

---

## 5. Planned integration features (specification — mostly not built yet)

Apart from the URL options and messages marked **built** in 5.1 and 5.2, nothing in this section exists in the code yet. It describes the intended design
so the website and the editor can be built against the same contract.

### 5.1 Message API (`postMessage`)

This works across origins, so the editor can live on its own domain (e.g. `editor.example.com`) and be embedded anywhere.

Host → editor:

| message | effect |
|---|---|
| `{type: "avegeany:load", project: "https://…/room/"}` | load a published room folder (`scene.json` + files) |
| `{type: "avegeany:setLayout", layout: {...}}` | apply a `layout.json` v2 object |
| `{type: "avegeany:getLayout", id}` | reply `avegeany:layout` with the current layout |
| `{type: "avegeany:select", name: "chair_01"}` | select (and frame) an object; `name: null` deselects |
| `{type: "avegeany:setOptions", readonly, ui, collisions, sidebar}` | change options at run time (see 5.2) |
| `{type: "avegeany:exportGlb", id}` | reply `avegeany:glb` with an `ArrayBuffer` of the visible scene |
| `{type: "avegeany:placeItem", url, name, up, unit}` | place a model from the host's own catalogue |

Editor → host:

| message | when |
|---|---|
| `{type: "avegeany:ready", version, objects: [names]}` | the room is loaded |
| `{type: "avegeany:changed", layout}` | after each edit (debounced about 500 ms) |
| `{type: "avegeany:selection", name, size: [w, d, h]}` | the selection changes |
| `{type: "avegeany:saveRequested", layout}` | the visitor pressed Save (the host decides where it goes) |
| `{type: "avegeany:error", message}` | loading or an action failed |

Rules: the editor only accepts messages from origins listed in `allowOrigins`
(an embed option), never `*`, and it ignores anything without the `avegeany:`
prefix. Replies carry the request's `id`.

### 5.2 URL options

`index.html?project=<url>&readonly=1&ui=minimal&sidebar=0&lang=en&allowOrigins=https://shop.example.com`

| option | meaning |
|---|---|
| `project` | **built** · room folder to load instead of the files next to `index.html` (`scene.glb`, `scene.json`, `layout.json`, `objects/…` are read from it) |
| `place=<url>` | **built** · a model (`.glb .gltf .obj .ply .stl`) placed in the room after it loads, at the nearest free spot around the centre, and selected. It counts as part of the starting scene (no undo step, not "unsaved") |
| `name`, `unit`, `up` | **built** · for `place`: the name in the object list (default: file name), file unit in metres (`1`, `0.01`, `0.001`, `0.0254`), up axis `y`/`z` (default: glb/gltf/obj Y, stl/ply Z) |
| `readonly=1` | view only: orbit and select, no moving, no Save |
| `ui=full` (default) / `minimal` / `none` | `minimal` hides the right panel and shows a small floating toolbar; `none` shows only the 3D view (for host-driven UIs). **`none` is built**: no right panel, sidebar, legend, key help or selection outline; Save, sidebar toggle and file drops are off and leaving never asks about unsaved changes. `minimal` is not built |
| `lock=room` | **built** · only the `place`d model can be selected and moved; it stays selected (gizmo always shown) and can't be hidden or deleted. The room's own furniture is scenery (still collides). `place` then looks for a spot where the model can also turn all the way round |
| `roomLight=<x>` | **built** · brightness of the scan (room + its furniture), default `1`, range 0.2–4 |
| `sidebar=0` | **built** · start with the left sidebar collapsed (until the visitor opens it) |
| `catalog=<url>` | a JSON list of catalogue items served by the host (same fields as `GET /api/catalog`) |
| `allowOrigins` | **built** for editor → host: extra origins (comma-separated) that receive the messages below. Receiving host messages (5.1) is not built |

**Built today, editor → host:** when the editor runs in an iframe it posts
`{type: "avegeany:ready", objects}` once the room is loaded,
`{type: "avegeany:placed", name, size: [w, d, h]}` after `place` worked and
`{type: "avegeany:error", message}` when the room or the model failed. They go to the
editor's own origin plus `allowOrigins` only (never `*`). A missing `place` file gives
`message` starting with `no model at` (a 404, or the HTML page a single-page host sends instead).

Example (the Hearth & Oak store uses this, see `src/view3d.js` there):
`/avegeany/index.html?project=/rooms/auditorium/&place=/models/product.glb&name=Sofa&ui=none&lock=room`

Scans are always shown **matte** (metalness 0): the pipeline's GLBs don't write `metallicFactor`, and
glTF's default of 1 made photo-textured scans render almost black. Imported models keep their own materials.

### 5.3 Hosted server mode

For editing on a public site:

- a session per visitor or per project, with the project chosen by an id or a signed URL rather than a file path
- authentication through a token from the host site (`Authorization: Bearer …`), plus per-project permissions
- `--host 0.0.0.0` (or a socket) to run behind a reverse proxy, with the write check comparing against the forwarded scheme and host, or an `--allowed-origin` list
- `/api/open` limited to the workspace, with upload limits and a scan-processing queue
- recovery copies kept per session

### 5.4 Drop-in script

```html
<script type="module" src="https://editor.example.com/embed.js"></script>
<avegeany-editor project="https://cdn.example.com/rooms/living/" ui="minimal" style="height:70vh"></avegeany-editor>
```

This would be a small web component that creates the iframe, applies the URL
options and turns the messages of §5.1 into DOM events (`ready`, `change`,
`select`, `save`).

---

## 6. Checklist for a static embed

- [ ] Room folder built (`segment … -o folder`, or an extracted `.avjp` + `install_viewer`)
- [ ] Served over `http(s)://` with correct `.js` MIME type, and compression on
- [ ] iframe has an explicit height and enough width (900 px or more recommended)
- [ ] Optional `layout.json` placed next to `scene.json` for the arrangement to show
- [ ] Visitors know that Save downloads a file and that Catalog and Split aren't available in static mode
