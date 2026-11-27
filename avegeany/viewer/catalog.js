// Catalog tab: furniture from the pack (repo catalog/ folder) and "My library"
// (~/.avegeany/catalog), shown as cards. Drag a card onto the 3D view to place it
// on the floor (a ghost follows the mouse and turns red where it would collide),
// or click it to place it where the camera looks. Placed items are ordinary
// imports (copied into the project's imports/), so undo / save / layout work.

const DRAG_TYPE = 'application/x-avegeany-item';

export function initCatalog(editor) {
  const { THREE, $, esc, msg, post } = editor;
  let items = [], loaded = false, category = 'all';
  const buffers = new Map();            // id -> ArrayBuffer (models fetched this session)
  const sizes = new Map();              // id -> [w, d, h] metres

  // ------------------------------------------------------------- loading --
  async function refresh() {
    if (!editor.hasServer) {
      $('catGrid').innerHTML = '';
      return empty('The catalog needs the editor server: start it with <code>python -m avegeany</code>.');
    }
    try {
      const r = await fetch('api/catalog', { cache: 'no-store' }).then(x => x.json());
      items = r.items;
      $('catFolders').innerHTML = `Pack folder: <code>${esc(r.pack)}</code><br>My library: <code>${esc(r.library)}</code>`;
      for (const it of items) if (it.size) sizes.set(it.id, it.size);
    } catch (e) { items = []; }
    loaded = true;
    render();
  }
  editor.sidebar.onTab(tab => { if (tab === 'catalog' && !loaded) refresh(); });

  function empty(html) { const el = $('catEmpty'); el.hidden = !html; el.innerHTML = html || ''; }

  function render() {
    const cats = [...new Set(items.map(i => i.category))].sort();
    $('catCats').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
    if (category !== 'all' && !cats.includes(category)) category = 'all';
    $('catChips').innerHTML = ['all', ...cats].map(c =>
      `<button class="chip ${c === category ? 'on' : ''}" data-c="${esc(c)}">${c === 'all' ? 'All' : esc(c)}</button>`).join('');
    $('catChips').querySelectorAll('.chip').forEach(b => (b.onclick = () => { category = b.dataset.c; render(); }));
    const q = $('catSearch').value.trim().toLowerCase();
    const shown = items.filter(i => (category === 'all' || i.category === category)
      && (!q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q) || i.tags.some(t => t.toLowerCase().includes(q))));
    const grid = $('catGrid');
    grid.innerHTML = '';
    for (const it of shown) grid.appendChild(card(it));
    if (!items.length) empty(`Your catalog is empty. Put furniture models (.glb recommended) in the pack folder below —
      sub-folders become categories — or add one to your library with <b>+ Add to my library</b>.`);
    else empty(shown.length ? '' : 'Nothing matches.');
    queueThumbs(shown.filter(i => !i.thumb || !sizes.has(i.id)));
  }
  $('catSearch').oninput = render;

  function sizeText(id) {
    const s = sizes.get(id);
    return s ? `${s[0].toFixed(2)} × ${s[1].toFixed(2)} × ${s[2].toFixed(2)} m` : '…';
  }
  function card(it) {
    const el = document.createElement('div');
    el.className = 'card';
    el.draggable = true;
    el.dataset.id = it.id;
    el.title = `${it.name} — drag onto the floor, or click to place it where you're looking`;
    el.innerHTML = `<div class="thumb" ${it.thumb ? `style="background-image:url('api/catalog/thumb?id=${encodeURIComponent(it.id)}')"` : ''}>${it.thumb ? '' : 'preview…'}</div>
      ${it.source === 'lib' ? '<span class="src">mine</span><button class="rm" title="remove from my library">×</button>' : ''}
      <div class="cname">${esc(it.name)}</div><div class="csize">${sizeText(it.id)}</div>`;
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData(DRAG_TYPE, it.id);
      e.dataTransfer.effectAllowed = 'copy';
      prepareGhost(it);
    });
    el.addEventListener('dragend', () => hideGhost());
    el.onclick = e => { if (!e.target.classList.contains('rm')) place(it, null); };
    const rm = el.querySelector('.rm');
    if (rm) rm.onclick = async () => {
      if (!confirm(`Remove "${it.name}" from your library? (Objects already placed in projects stay.)`)) return;
      try { await post('api/catalog/remove', { id: it.id }); msg(`Removed <b>${esc(it.name)}</b> from your library`); refresh(); }
      catch (e) { msg(`Remove failed: ${esc(e.message)}`, true, 4000); }
    };
    return el;
  }

  async function modelBuffer(it) {
    if (!buffers.has(it.id)) {
      const r = await fetch(`api/catalog/file?id=${encodeURIComponent(it.id)}`);
      if (!r.ok) throw new Error(`can't load ${it.name}`);
      buffers.set(it.id, await r.arrayBuffer());
    }
    return buffers.get(it.id);
  }
  // a .gltf finds its .bin / textures through the server, next to the model in the catalog
  const build = async (it, name) => editor.buildImport(await modelBuffer(it), it.ext, {
    up: it.up, unitScale: it.unit, name,
    base: it.ext === 'gltf' ? `api/catalog/asset?id=${encodeURIComponent(it.id)}&path=` : '',
  });

  // ---------------------------------------------------------- thumbnails --
  // rendered once in a small offscreen renderer, then stored by the server
  let thumbR = null, thumbScene = null, thumbCam = null;
  const queue = [];
  let busy = false;
  function queueThumbs(list) {
    for (const it of list) if (!queue.includes(it)) queue.push(it);
    if (!busy) nextThumb();
  }
  async function nextThumb() {
    const it = queue.shift();
    if (!it) { busy = false; return; }
    busy = true;
    try {
      if (!thumbR) {
        thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbR.setSize(192, 192, false);
        thumbR.outputColorSpace = THREE.SRGBColorSpace;
        thumbScene = new THREE.Scene();
        thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.8));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 4, 3); thumbScene.add(sun);
        thumbCam = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
      }
      const obj = await build(it, 'thumb');
      thumbScene.add(obj);
      const box = new THREE.Box3().setFromObject(obj), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      sizes.set(it.id, [s.x, s.z, s.y]);
      const d = Math.max(s.x, s.y, s.z) * 2.1 + 0.05;
      thumbCam.position.set(c.x + d * 0.7, c.y + d * 0.55, c.z + d * 0.85);
      thumbCam.lookAt(c);
      thumbR.render(thumbScene, thumbCam);
      const blob = await new Promise(res => thumbR.domElement.toBlob(res, 'image/png'));
      thumbScene.remove(obj);
      obj.traverse(o => { o.geometry?.dispose(); });
      const url = URL.createObjectURL(blob);
      const el = $('catGrid').querySelector(`.card[data-id="${CSS.escape(it.id)}"]`);
      if (el) {
        const t = el.querySelector('.thumb'); t.style.backgroundImage = `url('${url}')`; t.textContent = '';
        el.querySelector('.csize').textContent = sizeText(it.id);
      }
      it.thumb = true;
      fetch(`api/catalog/thumb?id=${encodeURIComponent(it.id)}&size=${[s.x, s.z, s.y].map(v => v.toFixed(3)).join(',')}`,
        { method: 'POST', body: blob }).catch(() => {});
    } catch (e) {
      const el = $('catGrid').querySelector(`.card[data-id="${CSS.escape(it.id)}"] .thumb`);
      if (el) el.textContent = 'no preview';
      console.warn('thumbnail failed', it.id, e);
    }
    setTimeout(nextThumb, 0);
  }

  // ---------------------------------------------------------- drag & drop --
  let ghost = null, ghostFor = null, ghostOk = true;
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const red = new THREE.Color(0xff5a5a), white = new THREE.Color(0xffffff);
  async function prepareGhost(it) {
    hideGhost();
    ghostFor = it.id;
    try {
      const g = await build(it, 'ghost');
      if (ghostFor !== it.id) return;
      g.traverse(o => {
        if (!o.isMesh) return;
        o.material = [].concat(o.material).map(m => Object.assign(m.clone(), { transparent: true, opacity: 0.55, depthWrite: false }));
        if (o.material.length === 1) o.material = o.material[0];
      });
      g.visible = false;
      ghost = g;
      editor.world?.add(ghost);
    } catch (e) { console.warn(e); }
  }
  function hideGhost() {
    if (ghost) { ghost.parent?.remove(ghost); ghost.traverse(o => o.geometry?.dispose()); }
    ghost = null; ghostFor = null;
  }
  function floorPoint(e) {
    editor.setNdc(e);
    const p = new THREE.Vector3();
    return editor.ray.ray.intersectPlane(floor, p) ? p : null;
  }
  const view = $('view');
  view.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const p = floorPoint(e);
    if (!ghost || !p) return;
    ghost.visible = true;
    ghost.position.set(p.x, 0, p.z);
    ghost.updateMatrixWorld(true);
    const ok = editor.isFree(ghost);
    if (ok !== ghostOk) {
      ghostOk = ok;
      ghost.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => m.color?.copy(ok ? white : red)); });
    }
  });
  view.addEventListener('dragleave', e => { if (ghost && !view.contains(e.relatedTarget)) ghost.visible = false; });
  view.addEventListener('drop', e => {
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    const p = floorPoint(e);
    hideGhost();
    const it = items.find(i => i.id === id);
    if (it) place(it, p);
  });

  // ------------------------------------------------------------- placing --
  async function place(it, point) {
    if (!editor.world) return msg('Open a project first', true, 3000);
    if (editor.tool) return msg('Leave the Split focus first (Esc)', true, 2500);
    let r, obj;
    const label = editor.uniqueName(it.id.split('/').pop().replace(/\.[^.]+$/, ''));
    try {
      r = await post('api/catalog/place', { id: it.id });
      obj = await build(it, label);
    } catch (e) { return msg(`Can't place ${esc(it.name)}: ${esc(e.message)}`, true, 4000); }
    editor.world.add(obj);
    const target = point || editor.controls.target;
    obj.position.set(target.x, 0, target.z);
    obj.updateMatrixWorld(true);
    let moved = false;
    if (!editor.isFree(obj)) { editor.placeFree(obj, target.x, target.z); moved = true; }
    editor.register(obj, label, 'import', { file: r.file, ext: it.ext, up: it.up, unitScale: it.unit });
    editor.pushUndo(obj, { created: true });
    editor.select(obj); editor.renderList(); editor.info(); editor.updateDirty();
    msg(`Placed <b>${esc(it.name)}</b>${moved ? ' at the nearest free spot' : ''} — ⌘Z undoes`, false, 2500);
  }

  // ------------------------------------------------------- my library add --
  let addFile = null;
  function choose(f) {
    if (!f) return;
    if (!/\.(glb|gltf|obj|ply|stl)$/i.test(f.name)) return msg('Use a .glb, .gltf, .obj, .ply or .stl file', true, 3000);
    addFile = f;
    $('catAddChosen').textContent = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`;
    if (!$('catAddName').value) $('catAddName').placeholder = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    $('catAddGo').disabled = false;
  }
  $('catAddPick').onclick = e => { e.preventDefault(); $('catAddFile').click(); };
  $('catAddFile').onchange = e => { choose(e.target.files[0]); e.target.value = ''; };
  const drop = $('catAddDrop');
  drop.ondragover = e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('on'); } };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('on'); choose(e.dataTransfer.files[0]); };
  $('catAddGo').onclick = async () => {
    if (!addFile) return;
    const q = new URLSearchParams({
      filename: addFile.name, name: $('catAddName').value.trim() || $('catAddName').placeholder,
      category: $('catAddCat').value.trim() || 'other', up: $('catAddUp').value, unit: $('catAddUnit').value,
    });
    $('catAddGo').disabled = true;
    try {
      const it = await post(`api/catalog/add?${q}`, addFile, false);
      msg(`Added <b>${esc(it.name)}</b> to your library`);
      addFile = null; $('catAddChosen').textContent = ''; $('catAddName').value = ''; $('catAddName').placeholder = 'from file name';
      category = it.category;
      await refresh();
    } catch (e) { msg(`Couldn't add it: ${esc(e.message)}`, true, 4000); $('catAddGo').disabled = false; }
  };

  // ------------------------------------------------------ one-off import --
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => { await editor.importFiles(e.target.files); e.target.value = ''; };

  return { refresh };
}
