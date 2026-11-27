// avegeany room furniture editor.
// Loads scene.glb + scene.json (written by `python -m avegeany segment`, or
// extracted from an .avjp project by the server), lets the user move / turn /
// hide / delete furniture and import extra objects at their original scale.
// In server mode "Save" writes layout.json and packs the whole project into its
// .avjp file; "New from scan" uploads a scan and the server processes it.
// Furniture only turns about the vertical axis (in the floor X–Z plane).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { TransformGizmo } from './gizmo.js';
import { initSidebar } from './sidebar.js';
import { initCatalog } from './catalog.js';
import { initSplitTab } from './splittab.js';

const $ = id => document.getElementById(id);
const view = $('view');

// ---------------------------------------------------------- embed options --
// URL options for putting the editor on a website (docs/EMBEDDING.md §5.2):
//   project=<url>    room folder to load (scene.glb, scene.json, layout.json, objects/…)
//                    instead of the files next to index.html
//   place=<url>      a model (.glb .gltf .obj .ply .stl) placed in the room once it has loaded
//   name=<label>     its name in the object list (default: the file name)
//   unit=<metres>    the model's file unit: 1 m (default) · 0.01 cm · 0.001 mm · 0.0254 in
//   up=y|z           the model's up axis (default: glb/gltf/obj Y, stl/ply Z)
//   sidebar=0        start with the left sidebar collapsed
//   ui=none          only the 3D view: no side panels, legend, key help or selection outline
//   lock=room        only the placed model can be selected and moved (it stays selected and
//                    can't be hidden or deleted); the room's own furniture is scenery
//   roomLight=<x>    brightness of the scan (room + its furniture), default 1; e.g. 1.4
//   allowOrigins=…   extra origins (comma-separated) that receive the avegeany:* messages
// When embedded in an <iframe>, the editor posts {type: 'avegeany:ready' | 'avegeany:placed' |
// 'avegeany:error', …} to the parent page (same origin + allowOrigins only).
const params = new URLSearchParams(location.search);
const projectBase = (p => (!p ? '' : p.endsWith('/') ? p : p + '/'))(params.get('project'));
const inProject = path => (!projectBase || /^([a-z][a-z0-9+.-]*:|\/)/i.test(path) ? path : projectBase + path);
const uiNone = params.get('ui') === 'none';
const lockRoom = params.get('lock') === 'room';
const roomLight = Math.min(4, Math.max(0.2, parseFloat(params.get('roomLight')) || 1));
if (uiNone) document.body.classList.add('ui-none');
const notifyOrigins = [location.origin, ...(params.get('allowOrigins') || '').split(',').map(s => s.trim()).filter(Boolean)];
function notify(type, data = {}) {
  if (window.parent === window) return;
  for (const o of notifyOrigins) { try { window.parent.postMessage({ type: `avegeany:${type}`, ...data }, o); } catch { /* bad origin */ } }
}
// Objects share one texture atlas (textures/ in the project): keep loaded images in
// memory so the atlas is fetched once, and reuse one Texture so it is uploaded once.
THREE.Cache.enabled = true;
const sharedMaps = new Map();
function shareTextures(root) {
  root.traverse(c => {
    if (!c.isMesh && !c.isPoints) return;
    for (const m of [].concat(c.material)) {
      const t = m?.map;
      const key = t?.source?.data;
      if (!key) continue;
      const s = sharedMaps.get(key);
      if (s && s !== t) { m.map = s; t.dispose(); } else sharedMaps.set(key, t);
    }
  });
}
// Scanned geometry (room + its furniture): an own copy of each material, drawn from both
// sides. The pipeline's GLBs don't write metallicFactor and glTF's default is 1 (= fully
// metallic), which renders a photo-textured scan almost black without reflections around
// it, so scans are made matte here; `roomLight` brightens them on top.
function scanMaterial(m) {
  m = m.clone();
  if (m.isMeshStandardMaterial && !m.metalnessMap) { m.metalness = 0; m.roughness = 1; }
  if (m.color && roomLight !== 1) m.color.multiplyScalar(roomLight);
  return m;
}
function prepareScan(root) {
  root.traverse(o => {
    if (!o.isMesh && !o.isPoints) return;
    o.material = Array.isArray(o.material) ? o.material.map(scanMaterial) : scanMaterial(o.material);
    if (o.isMesh) for (const m of [].concat(o.material)) m.side = THREE.DoubleSide;
  });
}
const DEG = THREE.MathUtils.radToDeg, RAD = THREE.MathUtils.degToRad;
const UP = new THREE.Vector3(0, 1, 0);
const yawOf = q => new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
const yawQuat = y => new THREE.Quaternion().setFromAxisAngle(UP, y);
// layout record -> pure yaw quaternion (older layouts may contain tilts: flattened)
const recYaw = r => (r.quaternion ? yawOf(new THREE.Quaternion().fromArray(r.quaternion)) : r.rotation_y || 0);

// ---------------------------------------------------------------- renderer --
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 300);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(3, 6, 2);
scene.add(sun);

const gizmo = new TransformGizmo(camera, renderer.domElement);
scene.add(gizmo.root);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h;
  // the open left sidebar covers part of the view: move the picture's centre into the visible part
  const shift = view.classList.contains('lb-open') ? Math.min(160, w * 0.25) : 0;
  if (shift) camera.setViewOffset(w, h, -shift, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ state --
const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.2);
const roomGroups = { scan: null, shell: null };
const items = [];                  // every movable object (scan furniture + imports)
const initial = new Map();         // name -> {pos, quat}
const undoStack = [];
let world = null;                  // gltf.scene: parent of everything exported
let meta = null, roomHeight = 2.5, footprint = null, hasServer = false;
let selected = null, selBox = null;
let project = null;                // /api/project: {loaded, name, avjp, workspace}
let lastSaved = null, dirty = false, leaving = false;
// a tool (the Split tab's focus mode) can take over the pointer and keyboard:
// {pointerDown(e), pointerMove(e), pointerUp(e), keydown(e) -> handled?, update(), owns(f)}
let tool = null;

function msg(html, bad = false, ms = 1800) {
  const m = $('msg');
  m.innerHTML = html; m.className = bad ? 'bad' : ''; m.style.display = 'block';
  clearTimeout(msg.t); msg.t = setTimeout(() => (m.style.display = 'none'), ms);
}
const live = () => items.filter(o => !o.userData.deleted);

// --------------------------------------------------------------- loading --
async function boot() {
  project = await fetch('api/project', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  hasServer = !!project;
  renderProject();
  resize();
  if (hasServer && !project.loaded) { $('roomInfo').textContent = 'No project open'; showWelcome(); return; }
  const [gltf, manifest] = await Promise.all([
    new GLTFLoader().loadAsync(inProject('scene.glb')),
    fetch(inProject('scene.json')).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  meta = manifest;
  world = gltf.scene;
  scene.add(world);
  if (meta) {
    roomHeight = meta.room.height || 2.5;
    if (meta.room.footprint?.length >= 3) footprint = meta.room.footprint.map(([x, y]) => new THREE.Vector2(x, -y));
  }
  prepareScan(world);
  // scene.json is the list of objects; scene.glb is only the original export.
  // Objects split (or merged back) since then are dropped / loaded from objects/<file>.
  const listed = meta ? new Map(meta.objects.map(o => [o.name, o])) : null;
  for (const child of [...world.children]) {
    if (child.name.startsWith('furniture__')) {
      const name = child.name.replace('furniture__', '');
      if (listed && !listed.has(name)) { world.remove(child); continue; }
      register(child, name, 'scan');
    } else if (child.name.startsWith('room_scan')) roomGroups.scan = child;
    else if (child.name.startsWith('room_shell')) roomGroups.shell = child;
  }
  if (listed) {
    // the first file brings the shared texture atlas into the cache; the rest load in parallel
    const missing = [...listed.values()].filter(o => !items.some(f => f.userData.label === o.name));
    const fetchOne = o => new GLTFLoader().loadAsync(`${inProject(o.file)}?v=${Date.now()}`).catch(e => { console.warn('could not load', o.file, e); return null; });
    const first = missing.length ? [await fetchOne(missing[0])] : [];
    const rest = await Promise.all(missing.slice(1).map(fetchOne));
    [...first, ...rest].forEach((g, i) => { if (g) loadObjectEntry(missing[i], g); });
  }
  for (const g of Object.values(roomGroups)) if (g) g.traverse(o => {
    if (o.material) { o.material.clippingPlanes = [cutPlane]; o.material.side = THREE.FrontSide; }
  });
  if (roomGroups.shell) roomGroups.shell.traverse(o => {
    if (o.material) Object.assign(o.material, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 });
  });

  const bb = new THREE.Box3().setFromObject(world);
  const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  controls.target.set(c.x, 0.4, c.z);
  camera.position.set(c.x + s.x * 0.55, Math.max(s.x, s.z) * 1.05, c.z + s.z * 0.9);
  resize();

  // restore a saved layout (served next to scene.glb)
  const saved = await fetch(inProject('layout.json'), { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (saved) { await applyLayout(saved); msg('Restored saved layout.json'); }
  undoStack.length = 0;
  lastSaved = lastAuto = JSON.stringify(layoutJson()); dirty = false;
  if (project?.recovery) showRecovery();
  renderList(); renderSel(); updateCut(); info(); renderProject();
  $('serverNote').textContent = hasServer
    ? ''
    : 'Static mode: Save downloads layout.json; imports are not kept between sessions.';
}

// a scanned object listed in scene.json but not baked into scene.glb (e.g. a split piece)
function loadObjectEntry(o, g) {
  if (!g) return new GLTFLoader().loadAsync(`${inProject(o.file)}?v=${Date.now()}`).then(gg => loadObjectEntry(o, gg));
  const wrap = new THREE.Group();
  wrap.name = `furniture__${o.name}`;
  wrap.add(...g.scene.children);
  prepareScan(wrap);
  shareTextures(wrap);
  wrap.position.fromArray(o.position_gltf);
  world.add(wrap);
  wrap.updateMatrixWorld(true);
  register(wrap, o.name, 'scan');
  return wrap;
}
function unregister(f) {
  world.remove(f);
  const i = items.indexOf(f);
  if (i >= 0) items.splice(i, 1);
  initial.delete(f.userData.label);
  for (let k = undoStack.length - 1; k >= 0; k--) if (undoStack[k].f === f) undoStack.splice(k, 1);
  if (selected === f) select(null);
}
function register(obj, label, kind, extra = {}) {
  obj.userData = { ...obj.userData, label, kind, deleted: false, ...extra };
  items.push(obj);
  initial.set(label, { pos: obj.position.clone(), quat: obj.quaternion.clone() });
}
function info() {
  const n = live().length;
  $('roomInfo').textContent = meta
    ? `${n} objects · room height ${roomHeight.toFixed(2)} ${meta.units === 'metres' ? 'm' : 'units'}`
    : `${n} objects`;
}

// ------------------------------------------------------------- importing --
// Imported files keep their original scale (1 unit = 1 metre unless a unit is
// chosen). Their pivot is moved to the footprint centre on the bottom, exactly
// like the scanned furniture, and the same rule is used by apply-layout.
function loaderFor(ext) {
  return { glb: GLTFLoader, gltf: GLTFLoader, obj: OBJLoader, ply: PLYLoader, stl: STLLoader }[ext];
}
// `base`: where a .gltf's own files (.bin, textures/) are found, as a URL prefix;
// `files`: alternatively a {relative path -> File} map (one-off import of several files)
async function parseModel(buffer, ext, base = '', files = null) {
  const L = loaderFor(ext);
  if (!L) throw new Error(`unsupported file type .${ext}`);
  if (ext === 'glb' || ext === 'gltf') {
    const manager = new THREE.LoadingManager();
    const blobs = [];
    if (files) manager.setURLModifier(url => {
      const f = files[decodeURIComponent(url)] || files[decodeURIComponent(url).split('/').pop()];
      if (!f) return url;
      const u = URL.createObjectURL(f); blobs.push(u); return u;
    });
    try {
      return await new Promise((res, rej) => new GLTFLoader(manager).parse(buffer, base, g => res(g.scene), rej));
    } finally { setTimeout(() => blobs.forEach(u => URL.revokeObjectURL(u)), 5000); }
  }
  if (ext === 'obj') return new OBJLoader().parse(new TextDecoder().decode(buffer));
  const geo = new L().parse(buffer);
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xb9b2a6, vertexColors: !!geo.getAttribute('color'), roughness: 0.8, side: THREE.DoubleSide,
  });
  if (ext === 'ply' && !geo.index) {                         // PLY without faces = point cloud
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!geo.getAttribute('color') }));
  }
  return new THREE.Mesh(geo, material);
}
// is `obj` (at its current transform) inside the room and clear of other objects?
function isFree(obj) {
  const b = obb(obj, 0.01);
  if (footprint && !b.quad.every(p => pointInPoly(p.x, p.y, footprint))) return false;
  return !live().some(o => o !== obj && o.visible && obbOverlap(b, obb(o)));
}
function placeFree(obj, x0, z0) {
  const free = () => isFree(obj);
  for (let r = 0; r <= 4; r += 0.2) {                       // spiral outwards in 20 cm rings
    const steps = Math.max(1, Math.round((2 * Math.PI * r) / 0.2));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      obj.position.set(x0 + r * Math.cos(a), 0, z0 + r * Math.sin(a));
      obj.updateMatrixWorld(true);
      if (free()) return true;
    }
  }
  obj.position.set(x0, 0, z0); obj.updateMatrixWorld(true);
  return false;
}
// Like placeFree, but only accepts a spot where the object can also turn all the way round
// in 15° steps (Q / E) without hitting anything: a long sofa dropped into a narrow aisle
// would otherwise be stuck facing one way. Falls back to placeFree.
function placeRoomy(obj, x0, z0, maxR = 8) {
  const others = live().filter(o => o !== obj && o.visible).map(o => obb(o));
  const yaws = Array.from({ length: 12 }, (_, i) => RAD(i * 15));     // a box repeats after 180°
  const fits = () => yaws.every(y => {
    obj.quaternion.copy(yawQuat(y)); obj.updateMatrixWorld(true);
    const b = obb(obj, 0.03);                                         // same tolerance as tryMove
    return (!footprint || b.quad.every(p => pointInPoly(p.x, p.y, footprint))) && !others.some(o => obbOverlap(b, o));
  });
  for (let r = 0; r <= maxR; r += 0.25) {
    const steps = Math.max(1, Math.round((2 * Math.PI * r) / 0.25));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      obj.position.set(x0 + r * Math.cos(a), 0, z0 + r * Math.sin(a));
      const ok = fits();
      obj.quaternion.identity(); obj.updateMatrixWorld(true);
      if (ok) return true;
    }
  }
  return placeFree(obj, x0, z0);
}
function defaultUp(ext) { return ext === 'stl' || ext === 'ply' ? 'z' : 'y'; }

async function buildImport(buffer, ext, opts) {
  const model = await parseModel(buffer, ext, opts.base || '', opts.files || null);
  model.traverse(o => { if (o.isMesh) { o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); } });
  const inner = new THREE.Group();
  inner.add(model);
  if (opts.up === 'z') inner.rotation.x = -Math.PI / 2;      // Z-up file -> Y-up
  inner.scale.setScalar(opts.unitScale || 1);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);              // pivot: footprint centre, bottom
  const wrap = new THREE.Group();
  wrap.name = `import__${opts.name}`;
  wrap.add(inner);
  return wrap;
}
function uniqueName(base) {
  base = base.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'object';
  let n = base, i = 2;
  while (items.some(o => o.userData.label === n)) n = `${base}_${i++}`;
  return n;
}
const MODEL_RE = /\.(glb|gltf|obj|ply|stl)$/i;
// Import files picked or dropped together. A .gltf uses the other files of the same
// selection as its .bin / textures; everything else is imported model by model.
async function importFiles(fileList) {
  const files = [...fileList];
  const gltfs = files.filter(f => /\.gltf$/i.test(f.name));
  const extras = files.filter(f => !MODEL_RE.test(f.name));
  for (const f of files) if (MODEL_RE.test(f.name)) await importFile(f, /\.gltf$/i.test(f.name) ? extras : []);
  if (!gltfs.length && extras.length) msg('Only .glb, .gltf, .obj, .ply and .stl files can be imported', true, 3000);
}
async function importFile(file, companions = []) {
  if (!world) return msg('Open a project or create one from a scan first', true, 3000);
  const ext = file.name.split('.').pop().toLowerCase();
  if (!loaderFor(ext)) return msg(`Can't import .${ext} — use .glb, .gltf, .obj, .ply or .stl`, true, 3000);
  const upSel = $('importUp').value, up = upSel === 'auto' ? defaultUp(ext) : upSel;
  const unitScale = parseFloat($('importUnit').value);
  const name = uniqueName(file.name.replace(/\.[^.]+$/, ''));
  const buffer = await file.arrayBuffer();

  // a .gltf that keeps its data in separate files: they must be in the same selection
  let needs = [], byPath = null;
  if (ext === 'gltf') {
    try {
      const doc = JSON.parse(new TextDecoder().decode(buffer));
      needs = [...(doc.buffers || []), ...(doc.images || [])].map(e => e.uri).filter(u => u && !u.startsWith('data:')).map(decodeURIComponent);
    } catch { return msg('That .gltf file could not be read', true, 3000); }
    byPath = {};
    for (const f of companions) byPath[f.webkitRelativePath || f.name] = byPath[f.name] = f;
    const missing = needs.filter(u => !byPath[u] && !byPath[u.split('/').pop()]);
    if (missing.length) {
      return msg(`<b>${esc(file.name)}</b> needs ${missing.length} more file${missing.length > 1 ? 's' : ''}
        (${missing.slice(0, 3).map(esc).join(', ')}${missing.length > 3 ? '…' : ''}). Select or drop the .gltf
        together with its .bin and texture files — or put the whole folder in the catalog/ folder.`, true, 7000);
    }
  }
  let obj;
  try { obj = await buildImport(buffer, ext, { up, unitScale, name, files: byPath }); }
  catch (e) { console.error(e); return msg(`Import failed: ${esc(e.message)}`, true, 4000); }

  let stored = null;
  if (hasServer) {
    if (needs.length) {                                   // keep the .gltf and its files together
      const put = (path, body) => fetch(`api/import-bundle?dir=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`,
        { method: 'POST', body }).then(r => (r.ok ? r.json() : null));
      for (const u of needs) await put(u, byPath[u] || byPath[u.split('/').pop()]);
      stored = (await put(file.name, buffer))?.file || null;
    } else {
      const r = await fetch(`api/import?name=${encodeURIComponent(name + '.' + ext)}`, { method: 'POST', body: buffer });
      if (r.ok) stored = (await r.json()).file;
    }
  }
  // place it on the floor where the camera is looking, at the nearest free spot
  world.add(obj);
  placeFree(obj, controls.target.x, controls.target.z);
  register(obj, name, 'import', { file: stored, ext, up, unitScale });
  pushUndo(obj, { created: true });
  select(obj); renderList(); info();
  const sz = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  msg(`Imported <b>${name}</b> — ${sz.x.toFixed(2)} × ${sz.z.toFixed(2)} × ${sz.y.toFixed(2)} m (original scale)`, false, 3000);
}

// A model given by URL (embed option `place=`): placed like an import, at the nearest free
// spot around the room's centre, and counted as part of the starting scene (no undo step,
// not "unsaved"). Throws with a readable message when the file is missing or unreadable.
async function placeFromUrl(url, { name, unit, up } = {}) {
  if (!world) throw new Error('the room did not load');
  const clean = url.split(/[?#]/)[0];
  const ext = clean.split('.').pop().toLowerCase();
  if (!loaderFor(ext)) throw new Error(`can't place .${ext} — use .glb, .gltf, .obj, .ply or .stl`);
  const r = await fetch(url, { cache: 'no-cache' });
  // a dev server or single-page host answers a missing file with its index.html
  if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) {
    throw new Error(`no model at ${clean}${r.ok ? '' : ` (HTTP ${r.status})`}`);
  }
  const buffer = await r.arrayBuffer();
  const label = uniqueName(name || clean.split('/').pop().replace(/\.[^.]+$/, ''));
  const upAxis = up === 'y' || up === 'z' ? up : defaultUp(ext);
  const unitScale = parseFloat(unit) > 0 ? parseFloat(unit) : 1;
  const obj = await buildImport(buffer, ext, { up: upAxis, unitScale, name: label, base: clean.slice(0, clean.lastIndexOf('/') + 1) });
  world.add(obj);
  placeRoomy(obj, controls.target.x, controls.target.z);
  register(obj, label, 'import', { file: url, ext, up: upAxis, unitScale });
  // look at it: move the orbit target onto the new object and come closer (same viewing
  // direction), so it fills a good part of the view even in a large room
  const bb = boxOf(obj), c = bb.getCenter(new THREE.Vector3());
  const offset = camera.position.clone().sub(controls.target);
  const near = Math.max(2.2, bb.getSize(new THREE.Vector3()).length() * 1.8);
  controls.target.copy(c);
  camera.position.copy(c).add(offset.setLength(Math.min(offset.length(), near)));
  select(obj); renderList(); info();
  lastSaved = lastAuto = JSON.stringify(layoutJson()); updateDirty();
  const sz = sizeOf(obj);
  if (!uiNone) msg(`Placed <b>${esc(label)}</b> — ${sz.x.toFixed(2)} × ${sz.z.toFixed(2)} × ${sz.y.toFixed(2)} m. Drag it, or use the gizmo to move and turn it.`, false, 4500);
  return { name: label, size: [sz.x, sz.z, sz.y].map(v => +v.toFixed(3)) };
}

// ------------------------------------------------------------------- list --
function sizeOf(f) { return localBox(f).getSize(new THREE.Vector3()); }   // object's own size, not its turned AABB
function renderList() {
  const list = $('list');
  list.innerHTML = '';
  for (const f of live()) {
    const li = document.createElement('li');
    const sz = sizeOf(f);
    li.className = (f === selected ? 'sel ' : '') + (f.visible ? '' : 'hidden');
    li.innerHTML = `<span class="name">${f.userData.kind === 'import' ? '⤓ ' : ''}${f.userData.label}</span>
      <span class="dim">${f.visible ? `${sz.x.toFixed(2)}×${sz.z.toFixed(2)}×${sz.y.toFixed(2)}` : 'hidden'}</span>
      <button class="eye" title="hide / show">${f.visible ? '◉' : '○'}</button>`;
    li.onclick = e => { if (e.target.classList.contains('eye')) return; select(f); };
    li.querySelector('.eye').onclick = () => toggleHidden(f);
    list.appendChild(li);
  }
}

function renderSel() {
  const el = $('sel');
  if (!selected) { el.innerHTML = '<span class="sub">Click a piece of furniture.</span>'; return; }
  const p = selected.position;
  const num = (id, v, step) => `<input type="number" id="${id}" value="${v.toFixed(step < 1 ? 3 : 1)}" step="${step}">`;
  el.innerHTML = `<div class="selhead"><b>${selected.userData.label}</b>
      <span class="sub">${selected.userData.kind === 'import' ? 'imported' : 'scanned'}</span></div>
    <div class="grid3"><label>x ${num('px', p.x, 0.01)}</label><label>y ${num('py', p.y, 0.01)}</label><label>z ${num('pz', p.z, 0.01)}</label></div>
    <div class="grid3"><label>turn ry° ${num('ry', DEG(yawOf(selected.quaternion)), 1)}</label></div>
    <div class="btns3">
      <button id="hideBtn">${selected.visible ? 'Hide' : 'Show'} <kbd>H</kbd></button>
      <button id="delBtn" class="danger">Delete <kbd>⌫</kbd></button>
      <button id="resetOne">Reset</button>
    </div>
    ${selected.userData.kind === 'scan' && hasServer ? `<button id="splitBtn" style="width:100%;margin-top:6px"
      title="open the Split tab: pick parts or cut with planes, in focus">Split / separate… <kbd>S</kbd></button>` : ''}
    ${splitParentOf(selected.userData.label) ? `<p class="sub" style="margin:8px 0 0">split from
      <b>${esc(splitParentOf(selected.userData.label))}</b> · <a href="#" id="mergeBack">Merge back</a></p>` : ''}`;
  if ($('splitBtn')) $('splitBtn').onclick = () => editor.openSplit(selected);
  if ($('mergeBack')) $('mergeBack').onclick = e => { e.preventDefault(); mergeBack(selected); };
  const setPos = () => {
    const f = selected, v = ['px', 'py', 'pz'].map(i => parseFloat($(i).value));
    if (v.some(isNaN)) return;
    pushUndo(f);
    tryMove(f, () => { f.position.set(...v); f.updateMatrixWorld(true); });
    renderSel();
  };
  const setRot = () => {
    const f = selected, y = RAD(parseFloat($('ry').value));
    if (isNaN(y)) return;
    pushUndo(f);
    tryMove(f, () => { f.quaternion.copy(yawQuat(y)); f.updateMatrixWorld(true); });
    renderSel();
  };
  ['px', 'py', 'pz'].forEach(i => ($(i).onchange = setPos));
  $('ry').onchange = setRot;
  $('hideBtn').onclick = () => toggleHidden(selected);
  $('delBtn').onclick = () => deleteObj(selected);
  $('resetOne').onclick = () => { pushUndo(selected); resetObj(selected); };
}

// lock=room: the room's own pieces can't be selected, and the placed model stays selected
const movable = f => !lockRoom || f.userData.kind === 'import';
function select(f) {
  if (tool) return;                                           // focus mode: selection is locked
  if (lockRoom && (f ? !movable(f) : selected && !selected.userData.deleted)) return;
  selected = f || null;
  if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
  if (f && !uiNone) { selBox = makeSelBox(f); scene.add(selBox); }
  gizmo.attach(f && f.visible ? f : null);
  renderList(); renderSel();
}
// selection outline = the object's oriented collision box; it follows every move and turn
const selMat = new THREE.LineBasicMaterial({ color: 0xf2a541, depthTest: false, transparent: true, toneMapped: false });
function makeSelBox(f) {
  const b = localBox(f), s = b.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.01, 0.01, 0.01));
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x, s.y, s.z))
    .translate(...b.getCenter(new THREE.Vector3()).toArray());
  const box = new THREE.LineSegments(geo, selMat);
  box.renderOrder = 998;
  box.matrixAutoUpdate = false;
  box.raycast = () => {};
  box.update = () => {
    f.updateMatrixWorld(true);
    box.matrix.copy(f.matrixWorld); box.matrixWorld.copy(f.matrixWorld);
    box.visible = f.visible;
  };
  box.update();
  return box;
}
function changed() { selBox?.update(); gizmo.update(); renderSel(); }

// ----------------------------------------------------- hide / delete / undo --
function snapshot(f) {
  return { f, pos: f.position.clone(), quat: f.quaternion.clone(), visible: f.visible, deleted: f.userData.deleted };
}
function pushUndo(f, extra = {}) { undoStack.push({ ...snapshot(f), ...extra }); if (undoStack.length > 200) undoStack.shift(); }
function undo() {
  const s = undoStack.pop();
  if (!s) return msg('Nothing to undo');
  const f = s.f;
  if (s.created) { f.userData.deleted = true; f.visible = false; if (selected === f) select(null); }
  else {
    f.position.copy(s.pos); f.quaternion.copy(s.quat); f.visible = s.visible; f.userData.deleted = s.deleted;
    f.updateMatrixWorld(true);
  }
  select(s.created ? null : f); info();
}
function toggleHidden(f) {
  pushUndo(f);
  f.visible = !f.visible;
  if (f === selected) gizmo.attach(f.visible ? f : null);
  selBox?.update(); renderList(); renderSel();
}
function deleteObj(f) {
  if (!f) return;
  pushUndo(f);
  f.userData.deleted = true; f.visible = false;
  if (selected === f) select(null);
  renderList(); info();
  msg(`Deleted <b>${f.userData.label}</b> — <a href="#" id="undoLink">undo</a> (⌘/Ctrl+Z)`, false, 4000);
  $('undoLink').onclick = e => { e.preventDefault(); undo(); $('msg').style.display = 'none'; };
}
function resetObj(f) {
  const i = initial.get(f.userData.label);
  f.position.copy(i.pos); f.quaternion.copy(i.quat); f.updateMatrixWorld(true);
  changed();
}

// -------------------------------------------------------------- collision --
// Collisions use ORIENTED boxes: each object's tight box in its own (local) frame,
// carried along by its transform. Turning an object turns its box with it, so the
// box never grows the way a world-axis-aligned box does at 45°.
function boxOf(f) { f.updateMatrixWorld(true); return new THREE.Box3().setFromObject(f); }   // world AABB (focus, placing)
const localBoxes = new WeakMap();
function localBox(f) {
  let b = localBoxes.get(f);
  if (b) return b;
  f.updateMatrixWorld(true);
  const inv = f.matrixWorld.clone().invert(), m = new THREE.Matrix4();
  b = new THREE.Box3();
  f.traverse(o => {
    if (!(o.isMesh || o.isPoints) || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  if (b.isEmpty()) b.set(new THREE.Vector3(), new THREE.Vector3());
  localBoxes.set(f, b);
  return b;
}
// footprint rectangle (4 XZ corners, convex order) + vertical range, shrunk by `shrink` metres
function obb(f, shrink = 0) {
  f.updateMatrixWorld(true);
  const b = localBox(f), c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  h.set(Math.max(h.x - shrink, 0.002), Math.max(h.y - shrink, 0.002), Math.max(h.z - shrink, 0.002));
  const M = f.matrixWorld, quad = [], ys = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    for (const sy of [-1, 1]) {
      const p = new THREE.Vector3(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z).applyMatrix4(M);
      ys.push(p.y);
      if (sy < 0) quad.push(new THREE.Vector2(p.x, p.z));
    }
  }
  return { quad, ymin: Math.min(...ys), ymax: Math.max(...ys) };
}
// separating-axis test for two convex quads on the floor plane + their height ranges
function obbOverlap(A, B) {
  if (A.ymax <= B.ymin || B.ymax <= A.ymin) return false;
  for (const poly of [A.quad, B.quad]) {
    for (let i = 0; i < 4; i++) {
      const a = poly[i], b = poly[(i + 1) % 4];
      const nx = a.y - b.y, nz = b.x - a.x;                // edge normal
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const p of A.quad) { const d = p.x * nx + p.y * nz; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const p of B.quad) { const d = p.x * nx + p.y * nz; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax <= bmin || bmax <= amin) return false;       // found a gap
    }
  }
  return true;
}
const collideOn = () => $('collide').checked;
function setCollide(on) {
  $('collide').checked = on;
  $('collideState').textContent = on ? 'on' : 'off';
  $('collideBtn').classList.toggle('off', !on);
  msg(on ? 'Collisions <b>on</b> — objects block each other' : 'Collisions <b>off</b> — objects pass through each other', !on, 1600);
}
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function collisions(f) {
  const hits = new Set();
  if (!collideOn()) return hits;
  const b = obb(f, 0.03);                               // 3 cm tolerance for scan noise
  if (footprint && !b.quad.every(p => pointInPoly(p.x, p.y, footprint))) hits.add('wall');
  if (b.ymin < -0.02) hits.add('floor');
  if (meta?.room?.ceiling && b.ymax > roomHeight + 0.02) hits.add('ceiling');
  for (const o of live()) {
    if (o === f || !o.visible) continue;
    if (obbOverlap(b, obb(o))) hits.add(o.userData.label);
  }
  return hits;
}
// Overlaps that already exist (chairs tucked under a table, a cabinet against a
// wall, an import dropped on top of something) are allowed; only NEW ones are blocked.
function tryMove(f, apply) {
  const oldP = f.position.clone(), oldQ = f.quaternion.clone();
  const before = collisions(f);
  apply();
  const added = [...collisions(f)].filter(h => !before.has(h));
  if (added.length) {
    f.position.copy(oldP); f.quaternion.copy(oldQ); f.updateMatrixWorld(true);
    const what = uiNone ? ({ wall: 'a wall', floor: 'the floor', ceiling: 'the ceiling' }[added[0]] || 'other furniture') : esc(added[0]);
    msg(`Blocked by <b>${what}</b> — press <kbd>C</kbd> to ${uiNone ? 'let it pass through' : 'turn collisions off'}`, true, 1400);
    return false;
  }
  changed();
  return true;
}

// ---------------------------------------------------------------- pointer --
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let bodyDrag = null, downAt = null;

function setNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function pickItem() {
  const vis = live().filter(f => f.visible && movable(f));
  const hits = ray.intersectObjects(vis, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !vis.includes(o)) o = o.parent;
  return o;
}

gizmo.onStart = f => { pushUndo(f); controls.enabled = false; };
gizmo.onDrag = (f, apply) => tryMove(f, apply);
gizmo.onEnd = () => { controls.enabled = true; renderList(); };

// capture phase: runs before OrbitControls so we can claim the pointer
view.addEventListener('pointerdown', e => {
  if (e.target !== renderer.domElement) return;
  downAt = [e.clientX, e.clientY];
  if (e.button !== 0) return;
  setNdc(e);
  if (tool) { if (tool.pointerDown(e)) controls.enabled = false; return; }   // focus mode tool
  if (gizmo.pointerDown(ndc)) { controls.enabled = false; return; }
  const f = pickItem();
  if (!f) return;
  select(f);
  pushUndo(f);
  controls.enabled = false;                                  // drag the object body on its floor plane
  const hit = new THREE.Vector3();
  floorPlane.constant = -f.position.y;
  ray.ray.intersectPlane(floorPlane, hit);
  bodyDrag = { f, offset: f.position.clone().sub(hit) };
}, { capture: true });

view.addEventListener('pointermove', e => {
  setNdc(e);
  if (tool) return tool.pointerMove(e);
  if (gizmo.dragging) { gizmo.pointerMove(ndc, e.shiftKey); return; }
  if (!bodyDrag) { gizmo.pointerMove(ndc); return; }
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(floorPlane, hit)) return;
  const p = hit.add(bodyDrag.offset);
  if ($('snap').checked || e.shiftKey) { p.x = Math.round(p.x / 0.05) * 0.05; p.z = Math.round(p.z / 0.05) * 0.05; }
  const f = bodyDrag.f;
  // separate X and Z steps so a blocked move slides along the obstacle
  tryMove(f, () => { f.position.x = p.x; f.updateMatrixWorld(true); });
  tryMove(f, () => { f.position.z = p.z; f.updateMatrixWorld(true); });
});

addEventListener('pointerup', e => {
  tool?.pointerUp?.(e);
  if (gizmo.pointerUp() || bodyDrag) renderList();
  bodyDrag = null;
  controls.enabled = true;
});
view.addEventListener('click', e => {
  if (!downAt || e.target !== renderer.domElement) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  setNdc(e);
  if (!tool && !pickItem() && !gizmo._hit(ndc)) select(null);
});

// --------------------------------------------------------------- keyboard --
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 's') { e.preventDefault(); return uiNone || saveProject(); }
  if (!$('modal').hidden) { if (k === 'escape') closeModal(); return; }
  if (tool) { if (tool.keydown(e)) e.preventDefault(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); return undo(); }
  if (k === 'escape') return select(null);
  if (k === 'l') { const s = gizmo.toggleSpace(); $('space').value = s; return msg(`Gizmo: ${s} axes`); }
  if (k === 'c' && !e.metaKey && !e.ctrlKey) return setCollide(!collideOn());
  if (k === '[' && !e.metaKey && !e.ctrlKey) return uiNone || editor.sidebar.toggle();
  if (k === 's' && !e.metaKey && !e.ctrlKey && selected?.userData.kind === 'scan' && hasServer) return editor.openSplit(selected);
  if (!selected) return;
  const f = selected, step = e.shiftKey ? 0.05 : 0.01;
  const axis = a => {                                       // nudge along world or local axes
    const v = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[a];
    return gizmo.space === 'local' ? v.applyQuaternion(f.quaternion) : v;
  };
  const mv = (a, s) => { pushUndo(f); tryMove(f, () => { f.position.addScaledVector(axis(a), s); f.updateMatrixWorld(true); }); };
  const rot = d => {
    pushUndo(f);
    tryMove(f, () => { f.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), RAD(d))); f.updateMatrixWorld(true); });
  };
  if (lockRoom && ['h', 'delete', 'backspace'].includes(k)) return;
  switch (k) {
    case 'q': rot(e.shiftKey ? 90 : 15); break;
    case 'e': rot(e.shiftKey ? -90 : -15); break;
    case 'arrowleft': mv('x', -step); break;
    case 'arrowright': mv('x', step); break;
    case 'arrowup': mv('z', -step); break;
    case 'arrowdown': mv('z', step); break;
    case 'pageup': mv('y', step); break;
    case 'pagedown': mv('y', -step); break;
    case 'h': toggleHidden(f); break;
    case 'delete': case 'backspace': deleteObj(f); break;
    case 'f': controls.target.copy(boxOf(f).getCenter(new THREE.Vector3())); break;
    default: return;
  }
  e.preventDefault();
  renderList();
});

// ------------------------------------------------------------ view panel --
function updateCut() {
  cutPlane.constant = roomHeight * parseFloat($('cut').value);
  $('cutVal').textContent = (roomHeight * $('cut').value).toFixed(2);
}
$('cut').oninput = updateCut;
$('showScan').onchange = e => { if (roomGroups.scan) roomGroups.scan.visible = e.target.checked; };
$('showShell').onchange = e => { if (roomGroups.shell) roomGroups.shell.visible = e.target.checked; };
$('dollhouse').onchange = e => {
  for (const g of Object.values(roomGroups)) if (g) g.traverse(o => {
    if (o.material) { o.material.side = e.target.checked ? THREE.FrontSide : THREE.DoubleSide; o.material.needsUpdate = true; }
  });
};
$('snap').onchange = e => { gizmo.snap = e.target.checked; };
$('collideBtn').onclick = () => setCollide(!collideOn());
$('space').onchange = e => gizmo.setSpace(e.target.value);
view.addEventListener('dragover', e => e.preventDefault());
view.addEventListener('drop', async e => {
  e.preventDefault();
  if (e.dataTransfer.types.includes('application/x-avegeany-item')) return;   // catalog.js
  if (uiNone || lockRoom) return;                           // embedded viewer: nothing to import
  const files = [...e.dataTransfer.files];
  const proj = files.find(f => /\.avjp$/i.test(f.name));
  if (proj && hasServer) return openUpload(proj);
  if (!world) return hasServer && showNewScan(files);       // nothing open yet: treat as a scan
  await importFiles(files);
});

// ---------------------------------------------------------------- layout --
function recOf(f) {
  return {
    position: f.position.toArray().map(v => +v.toFixed(5)),
    quaternion: f.quaternion.toArray().map(v => +v.toFixed(6)),
    rotation_y: +yawOf(f.quaternion).toFixed(6),
    visible: f.visible,
    deleted: !!f.userData.deleted,
  };
}
function layoutJson() {
  const objects = {}, imports = [];
  for (const f of items) {
    const rec = recOf(f);
    if (f.userData.kind === 'import') {
      if (f.userData.deleted) continue;
      imports.push({ name: f.userData.label, file: f.userData.file, ext: f.userData.ext,
        up: f.userData.up, unit_scale: f.userData.unitScale, ...rec });
    } else objects[f.userData.label] = rec;
  }
  return { version: 2, frame: 'glTF Y-up, metres, same frame as scene.glb', objects, imports };
}
async function applyLayout(data) {
  for (const f of items) {
    const o = data.objects?.[f.userData.label];
    if (!o || f.userData.kind !== 'scan') continue;
    f.position.fromArray(o.position);
    f.quaternion.copy(yawQuat(recYaw(o)));
    f.visible = o.visible !== false && !o.deleted;
    f.userData.deleted = !!o.deleted;
    f.updateMatrixWorld(true);
  }
  for (const im of data.imports || []) {
    if (items.some(f => f.userData.label === im.name) || !im.file) continue;
    try {
      const file = inProject(im.file);
      const buf = await fetch(file).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
      const base = file.slice(0, file.lastIndexOf('/') + 1);
      const obj = await buildImport(buf, im.ext, { up: im.up, unitScale: im.unit_scale, name: im.name, base });
      obj.position.fromArray(im.position);
      obj.quaternion.copy(yawQuat(recYaw(im)));
      obj.visible = im.visible !== false;
      world.add(obj); obj.updateMatrixWorld(true);
      register(obj, im.name, 'import', { file: im.file, ext: im.ext, up: im.up, unitScale: im.unit_scale });
    } catch (e) { console.warn('could not restore import', im, e); }
  }
  select(null); info();
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('loadLayout').onclick = () => $('layoutFile').click();
$('layoutFile').onchange = async e => {
  await applyLayout(JSON.parse(await e.target.files[0].text()));
  renderList(); msg('Layout loaded'); e.target.value = '';
};
$('resetAll').onclick = () => {
  for (const f of items) {
    if (f.userData.kind === 'import') { f.userData.deleted = true; f.visible = false; continue; }
    f.userData.deleted = false; f.visible = true; resetObj(f);
  }
  undoStack.length = 0; select(null); info();
};
$('exportGlb').onclick = async () => {
  if (!world) return;
  const bin = await new GLTFExporter().parseAsync(world, { binary: true, onlyVisible: true });
  download(new Blob([bin], { type: 'model/gltf-binary' }), 'room_rearranged.glb');
};

// --------------------------------------------------------------- project --
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function post(url, body, json = true) {
  const r = await fetch(url, {
    method: 'POST', body: json ? JSON.stringify(body) : body,
    headers: json ? { 'Content-Type': 'application/json' } : {},
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// The layout is also sent to the server in the background (a few seconds after each
// change), so a stopped or crashed editor can leave a recovery copy (<project>.recovered.avjp).
let lastAuto = null, autoTimer = null;
function updateDirty() {
  if (!world) return;
  const j = JSON.stringify(layoutJson());
  const d = j !== lastSaved || !!project?.unsaved;
  if (d !== dirty) { dirty = d; renderProject(); }
  if (hasServer && j !== lastAuto) {
    lastAuto = j;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (j === lastSaved) return;
      fetch('api/autosave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: j }).catch(() => {});
    }, 2000);
  }
}
function showRecovery() {
  const r = project.recovery;
  showModal(`<h1>Unsaved changes found</h1>
    <p><b>${esc(project.name)}</b> has changes from <b>${esc(r.modified)}</b> that were never saved —
      the editor was stopped before you saved them. They were kept in
      <code>${esc(r.path.split('/').pop())}</code>.</p>
    <div class="btns" style="margin-top:14px"><button id="recRestore" class="primary">Restore them</button>
      <button id="recDiscard">Discard</button></div>
    <p class="sub" style="margin-top:10px">Restoring opens them as unsaved changes; press ⌘S to keep them.</p>`, false);
  $('recRestore').onclick = async () => {
    try { await post('api/recovery/restore', {}); reloadInto(); }
    catch (e) { msg(`Restore failed: ${esc(e.message)}`, true, 4000); }
  };
  $('recDiscard').onclick = async () => {
    if (!confirm('Discard the unsaved changes for good?')) return;
    try { project = await post('api/recovery/discard', {}); } catch (e) { /* already gone */ }
    $('modal').hidden = true;
    msg('Discarded the recovered changes');
  };
}
setInterval(updateDirty, 700);
addEventListener('beforeunload', e => { if (dirty && !leaving && !uiNone) { e.preventDefault(); e.returnValue = ''; } });

function renderProject() {
  const loaded = !!world;
  $('projName').textContent = hasServer ? (project?.name || 'No project open') : (loaded ? 'Output folder' : '…');
  $('projDirty').hidden = !dirty;
  const path = project?.avjp;
  $('projPath').textContent = !hasServer ? 'static mode — Save downloads layout.json'
    : path ? path.split('/').pop() : loaded ? 'not saved as .avjp yet' : '';
  $('projPath').title = path || '';
  $('saveBtn').disabled = !loaded;
  $('downloadBtn').disabled = !loaded;
  for (const id of ['downloadBtn', 'openBtn', 'newScanBtn']) $(id).hidden = !hasServer;
}

async function saveProject() {
  if (!world) return;
  const data = layoutJson();
  if (!hasServer) {
    if (data.imports.length) msg('Imported objects are only kept when the editor runs via <code>python -m avegeany</code>', true, 3500);
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'layout.json');
    lastSaved = JSON.stringify(data); updateDirty();
    return;
  }
  try {
    project = await post('api/save', data);
    lastSaved = lastAuto = JSON.stringify(data); dirty = false; renderProject();
    msg(`Saved <b>${esc(project.avjp.split('/').pop())}</b>`, false, 2200);
  } catch (e) { msg(`Save failed: ${esc(e.message)}`, true, 4000); }
}
async function downloadProject() {
  // the copy includes the current, possibly unsaved, layout
  try { await post('api/layout', layoutJson()); } catch (e) { return msg(`Download failed: ${esc(e.message)}`, true, 4000); }
  const a = document.createElement('a');
  a.href = 'api/download'; a.click();
}

// leaving the open project (open another / new from scan)
let discardOk = false;
function leaveOk() {
  if (!dirty || discardOk) return true;
  discardOk = confirm(`"${project?.name || 'This project'}" has unsaved changes.\n\nDiscard them? (Cancel, then press ⌘S / Ctrl+S to save first.)`);
  return discardOk;
}
function reloadInto() { leaving = true; location.reload(); }

let modalClosable = true, scanRunning = false;
function showModal(html, closable = true) {
  modalClosable = closable;
  $('modalBox').innerHTML = (closable ? '<button class="x" id="modalX" title="close (Esc)">×</button>' : '') + html;
  $('modal').hidden = false;
  if (closable) $('modalX').onclick = closeModal;
}
function closeModal() {
  if (!modalClosable || scanRunning) return;
  $('modal').hidden = true;
  discardOk = false;
  if (!world && hasServer) showWelcome();
}
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
$('modal').addEventListener('dragover', e => e.preventDefault());
$('modal').addEventListener('drop', e => e.preventDefault());

function showWelcome() { return showOpen(true); }
async function showOpen(welcome = false) {
  if (!welcome && !leaveOk()) return;
  const list = await fetch('api/recent', { cache: 'no-store' }).then(r => r.json()).catch(() => []);
  const rec = list.length
    ? '<ul class="recent">' + list.map((p, i) => `<li data-i="${i}" title="${esc(p.path)}"><span class="name">${esc(p.name)}</span><span class="dim">${esc(p.modified)}</span></li>`).join('') + '</ul>'
    : '<p class="sub">No recent projects yet.</p>';
  showModal(`<h1>${welcome ? 'avegeany' : 'Open project'}</h1>
    ${welcome ? '<p class="sub">Open a saved <b>.avjp</b> project, or start a new one from a room scan.</p>' : ''}
    <div class="btns" style="margin-top:12px"><button id="mNew" class="primary">New from scan…</button><button id="mPick">Open .avjp file…</button></div>
    <h2>Recent projects</h2>${rec}
    <p class="sub">New projects are saved in <code>${esc(project?.workspace)}</code>. You can also drop an .avjp file anywhere.</p>`, !welcome);
  $('mNew').onclick = () => showNewScan([], true);
  $('mPick').onclick = () => $('avjpFile').click();
  $('modalBox').querySelectorAll('li[data-i]').forEach(li => (li.onclick = () => openPath(list[+li.dataset.i].path)));
}
async function openPath(path) {
  try { await post('api/open', { path }); reloadInto(); }
  catch (e) { msg(`Could not open: ${esc(e.message)}`, true, 5000); }
}
async function openUpload(file) {
  if (!leaveOk()) return;
  msg(`Opening <b>${esc(file.name)}</b>…`, false, 20000);
  try { await post(`api/open-upload?name=${encodeURIComponent(file.name)}`, file, false); reloadInto(); }
  catch (e) { msg(`Could not open: ${esc(e.message)}`, true, 5000); }
}
$('avjpFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openUpload(f); };

// ---- new project from a scan
const SCAN_RE = /\.(obj|mtl|jpe?g|png|ply|glb|gltf|stl|off)$/i, MAIN_RE = /\.(obj|ply|glb|gltf|stl|off)$/i;
let scanFiles = [];
function showNewScan(files = [], confirmed = false) {
  if (!confirmed && !leaveOk()) return;
  scanFiles = [];
  showModal(`<h1>New project from a scan</h1>
    <p class="sub">Add the scan file. For a textured <b>.obj</b> add its <b>.mtl</b> and texture image too
      (select them together). The scan is processed once and saved as an <b>.avjp</b> project.</p>
    <div id="drop" class="drop">Drop scan files here or <a href="#" id="pickScan">choose files…</a></div>
    <ul id="scanList" class="files"></ul>
    <p class="sub" id="scanHint"></p>
    <div class="grid2">
      <label>main file<select id="scanMain"></select></label>
      <label>project name<input type="text" id="scanName" maxlength="60" placeholder="room"></label>
      <label>up axis<select id="scanUp"><option value="">auto-detect</option><option>y</option><option>z</option>
        <option>-y</option><option>-z</option><option>x</option><option>-x</option></select></label>
      <label>room height, m<input type="number" id="scanH" step="0.01" min="1" max="20" placeholder="keep scan scale"></label>
      <label>merge factor<input type="number" id="scanMerge" step="0.1" min="0.1" max="20" value="1.5"></label>
    </div>
    <label class="row"><input type="checkbox" id="scanSep" checked> separate merged objects (e.g. seat rows) by shape</label>
    <p class="sub">Merge: lower it if two pieces come out fused, raise it if one piece is split up.</p>
    <button id="scanGo" class="primary" style="width:100%" disabled>Process scan</button>
    <pre id="scanLog" hidden></pre>`);
  const add = fs => {
    for (const f of fs) if (SCAN_RE.test(f.name) && !scanFiles.some(g => g.name === f.name)) scanFiles.push(f);
    renderScanFiles();
  };
  $('pickScan').onclick = e => { e.preventDefault(); $('scanFile').click(); };
  $('scanFile').onchange = e => { add([...e.target.files]); e.target.value = ''; };
  const drop = $('drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); add([...e.dataTransfer.files]); };
  $('scanGo').onclick = processScan;
  add(files);
}
function renderScanFiles() {
  $('scanList').innerHTML = scanFiles.map((f, i) => `<li><span class="name">${esc(f.name)}</span>
    <span class="dim">${(f.size / 1e6).toFixed(1)} MB</span><button class="eye" data-i="${i}" title="remove">×</button></li>`).join('');
  $('scanList').querySelectorAll('button').forEach(b => (b.onclick = () => { scanFiles.splice(+b.dataset.i, 1); renderScanFiles(); }));
  const mains = scanFiles.filter(f => MAIN_RE.test(f.name));
  const sel = $('scanMain'), prev = sel.value;
  sel.innerHTML = mains.map(f => `<option>${esc(f.name)}</option>`).join('');
  if (mains.some(f => f.name === prev)) sel.value = prev;
  const main = sel.value;
  $('scanName').placeholder = main ? main.replace(/\.[^.]+$/, '') : 'room';
  const objNoMtl = /\.obj$/i.test(main) && !scanFiles.some(f => /\.mtl$/i.test(f.name));
  $('scanHint').textContent = objNoMtl ? 'No .mtl added: the objects will come out untextured (grey).' : '';
  $('scanGo').disabled = !mains.length;
}
async function processScan() {
  const main = $('scanMain').value;
  if (!main) return;
  const go = $('scanGo'), log = $('scanLog');
  const line = s => { log.textContent += s + '\n'; log.scrollTop = log.scrollHeight; };
  const job = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(16).padStart(2, '0')).join('');
  scanRunning = true; go.disabled = true; log.hidden = false; log.textContent = '';
  try {
    for (const [i, f] of scanFiles.entries()) {
      go.textContent = `Uploading ${i + 1}/${scanFiles.length}: ${f.name}…`;
      await post(`api/scan/upload?job=${job}&name=${encodeURIComponent(f.name)}`, f, false);
    }
    go.textContent = 'Processing… (this can take a minute)';
    await post('api/scan/process', {
      job, main, name: $('scanName').value.trim() || $('scanName').placeholder,
      up: $('scanUp').value, room_height: $('scanH').value, merge: $('scanMerge').value,
      separate: $('scanSep').checked,
    });
    for (let since = 0; ;) {
      await new Promise(r => setTimeout(r, 600));
      const j = await fetch(`api/job?id=${job}&since=${since}`, { cache: 'no-store' }).then(r => r.json());
      j.log.forEach(line); since = j.lines;
      if (j.state === 'done') { go.textContent = 'Done — opening the new project…'; reloadInto(); return; }
      if (j.state === 'error') throw new Error(j.error);
    }
  } catch (e) {
    line(`ERROR: ${e.message}`);
    go.textContent = 'Process scan'; go.disabled = false; scanRunning = false;
  }
}

// ----------------------------------------------------------- split helpers --
// The Split tab (splittab.js) does the picking / cutting in focus mode; these
// swap an object for the pieces the server wrote, and undo that (Merge back).
const splitParentOf = label => meta?.splits?.find(s => s.pieces.includes(label))?.parent.name || null;
function placeFromRecord(obj, rec) {
  if (!rec) return;
  obj.position.fromArray(rec.position);
  obj.quaternion.copy(yawQuat(recYaw(rec)));
  obj.visible = rec.visible !== false && !rec.deleted;
  obj.userData.deleted = !!rec.deleted;
  obj.updateMatrixWorld(true);
}
async function replaceWithPieces(f, r, verb) {
  const name = f.userData.label;
  unregister(f);
  const pieces = [];
  for (const o of r.objects) {
    const p = await loadObjectEntry(o);
    placeFromRecord(p, r.records[o.name]);
    pieces.push(p);
  }
  const i = meta.objects.findIndex(o => o.name === name);
  meta.objects.splice(i, 1, ...r.objects);
  (meta.splits ||= []).push(r.split);
  project.unsaved = true;
  select(pieces[0]); renderList(); info(); updateDirty();
  msg(`${verb} <b>${esc(name)}</b> into ${pieces.length} pieces — <b>⌘S</b> saves it into the project`, false, 3500);
}
async function mergeBack(f) {
  const parent = splitParentOf(f.userData.label);
  if (!parent) return;
  let r;
  try { r = await post('api/unsplit', { parent, piece: f.userData.label, record: recOf(f) }); }
  catch (e) { return msg(`Merge back failed: ${esc(e.message)}`, true, 4000); }
  for (const nm of r.removed) { const p = items.find(o => o.userData.label === nm); if (p) unregister(p); }
  const obj = await loadObjectEntry(r.object);
  placeFromRecord(obj, r.record);
  const at = meta.objects.findIndex(o => r.removed.includes(o.name));
  meta.objects = meta.objects.filter(o => !r.removed.includes(o.name));
  meta.objects.splice(Math.max(0, at), 0, r.object);
  meta.splits = meta.splits.filter(s => s.parent.name !== parent);
  project.unsaved = true;
  select(obj); renderList(); info(); updateDirty();
  msg(`Merged back into <b>${esc(parent)}</b>`);
}

$('saveBtn').onclick = saveProject;
$('downloadBtn').onclick = downloadProject;
$('openBtn').onclick = () => showOpen();
$('newScanBtn').onclick = () => showNewScan();

// ------------------------------------------------------------ editor API --
// What the sidebar modules (catalog.js, splittab.js) may use.
const editor = {
  THREE, scene, camera, controls, renderer, gizmo, items, roomGroups, $, esc, msg, post, ray, ndc, setNdc,
  get world() { return world; }, get meta() { return meta; }, get project() { return project; },
  get hasServer() { return hasServer; }, get selected() { return selected; },
  get tool() { return tool; }, set tool(t) { tool = t; if (t) { gizmo.detach(); } else if (selected) select(selected); },
  select, register, unregister, live, tryMove, placeFree, isFree, buildImport, loaderFor, defaultUp, uniqueName,
  pushUndo, renderList, renderSel, info, updateDirty, recOf, localBox, obb, boxOf, shareTextures,
  replaceWithPieces, splitParentOf, mergeBack, importFile, importFiles,
  openSplit: f => { editor.sidebar.open('split'); editor.splitTab?.start(f); },
  sidebar: null, splitTab: null,
};
editor.sidebar = initSidebar(editor, params.get('sidebar') === '0' || uiNone ? { open: false } : {});
initCatalog(editor);
editor.splitTab = initSplitTab(editor);

// ------------------------------------------------------------------ loop --
try {
  await boot();
  if (world) notify('ready', { objects: live().map(f => f.userData.label) });
} catch (e) {
  console.error(e);
  $('roomInfo').textContent = 'The room could not be loaded';
  msg(`Could not load the room${projectBase ? ` from <code>${esc(projectBase)}</code>` : ''}: ${esc(e.message)}`, true, 600000);
  notify('error', { message: `room: ${e.message}` });
}
if (world && params.get('place')) {
  try {
    const placed = await placeFromUrl(params.get('place'), { name: params.get('name'), unit: params.get('unit'), up: params.get('up') });
    notify('placed', placed);
  } catch (e) {
    console.error(e);
    msg(`Could not place the model: ${esc(e.message)}`, true, 600000);
    notify('error', { message: e.message });
  }
}
editor.sidebar.ready();
(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  selBox?.update();
  tool?.update?.();
  gizmo.update();
  renderer.render(scene, camera);
})();
window.__avegeany = { items, scene, camera, controls, gizmo, select, tryMove, layoutJson, importFile, undo, deleteObj,
  toggleHidden, saveProject, showNewScan, showOpen, editor, get dirty() { return dirty; } };
