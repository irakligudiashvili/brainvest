// Split tab: separate one object into pieces, in focus.
//
// Focus: everything else fades out, the object floats a little above the floor
// and the camera orbits it. Two tools:
//   Parts  - the object is shown as small natural patches ("islands", from the
//            server: separate.islands). Pick the active piece and click / drag over
//            islands to assign them (Shift = single triangle, Alt = eyedropper).
//            Starts from the automatic separation; Apply -> /api/split/parts.
//   Planes - vertical cut planes along the object; drag a plane to slide it, drag
//            its ring (or type an angle) to turn it. Apply -> /api/split (planes).
// Both end in ordinary split records, so Merge back undoes them.

const PALETTE = [0xff6b6b, 0x4dabf7, 0x69db7c, 0xffd43b, 0xda77f2, 0xff922b, 0x38d9a9, 0xf783ac,
  0x94d82d, 0x748ffc, 0xe599f7, 0x66d9e8];
const LIFT = 0.25;              // metres the object floats while in focus
const FADE = 0.12;              // opacity of everything else

const b64ToU32 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Uint32Array(u.buffer); };
function u32ToB64(a) {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const rot2 = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

export function initSplitTab(editor) {
  const { THREE, $, esc, msg, post } = editor;
  const pane = $('pane-split');
  let st = null;                 // focus state
  let lastSel = undefined;

  // ------------------------------------------------------------ the pane --
  function renderIdle() {
    const f = editor.selected;
    lastSel = f;
    const ok = f && f.userData.kind === 'scan' && editor.hasServer;
    const parent = f && editor.splitParentOf(f.userData.label);
    pane.innerHTML = `<h2>Split an object</h2>
      ${ok ? `<p>Selected: <b style="color:var(--acc)">${esc(f.userData.label)}</b></p>
        <div class="btns"><button id="stParts" class="primary">Pick parts</button><button id="stPlanes">Cut with planes</button></div>
        ${parent ? `<p class="sub">This is a piece of <b>${esc(parent)}</b>. <a href="#" id="stMerge" style="color:var(--acc)">Merge back</a></p>` : ''}`
        : `<p class="sub">${editor.hasServer ? 'Click a scanned object (e.g. a row of seats), then press <kbd>S</kbd> or come back here.'
          : 'Splitting needs the editor server (<code>python -m avegeany</code>).'}</p>`}
      <p class="sub" style="margin-top:14px;line-height:1.55"><b>Pick parts</b> shows the object in focus as small patches that
      follow its creases and joints; paint them onto pieces. It starts from the automatic separation.<br>
      <b>Cut with planes</b> uses straight vertical cuts you can slide and turn one by one.<br>
      Every split can be undone with <b>Merge back</b> on any of its pieces.</p>`;
    if (ok) {
      $('stParts').onclick = () => start(f, 'parts');
      $('stPlanes').onclick = () => start(f, 'planes');
      if ($('stMerge')) $('stMerge').onclick = e => { e.preventDefault(); editor.mergeBack(f); };
    }
  }
  // follow the selection while idle (the pane is only re-drawn when it changed)
  setInterval(() => { if (!st && editor.sidebar.tab === 'split' && editor.selected !== lastSel) renderIdle(); }, 400);
  editor.sidebar.onTab(t => { if (t === 'split' && !st) renderIdle(); });

  // -------------------------------------------------------------- focus --
  function meshesOf(f) { const m = []; f.traverse(o => { if ((o.isMesh || o.isPoints) && !o.userData.splitUi) m.push(o); }); return m; }

  function enterFocus(f) {
    editor.select(f);
    const saved = new Map();
    const fade = root => root?.traverse(o => {
      if (!(o.isMesh || o.isPoints)) return;
      for (const m of [].concat(o.material)) {
        if (!m || saved.has(m)) continue;
        saved.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
        Object.assign(m, { transparent: true, opacity: FADE * (m.opacity ?? 1), depthWrite: false });
        m.needsUpdate = true;
      }
    });
    for (const o of editor.items) if (o !== f) fade(o);
    fade(editor.roomGroups.scan); fade(editor.roomGroups.shell);
    const cam = { pos: editor.camera.position.clone(), target: editor.controls.target.clone() };
    f.position.y += LIFT;
    f.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(f), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const dir = editor.camera.position.clone().sub(editor.controls.target).normalize();
    if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
    editor.controls.target.copy(c);
    editor.camera.position.copy(c).addScaledVector(dir, Math.max(s.x, s.y, s.z) * 1.6 + 0.6);
    $('focusBar').innerHTML = `Focus: <b>${esc(f.userData.label)}</b> · <kbd>Enter</kbd> apply · <kbd>Esc</kbd> leave`;
    $('focusBar').classList.add('on');
    return { f, saved, cam, mode: null, tool: null };
  }
  function leaveFocus(restoreCamera = true) {
    if (!st) return;
    const s = st;
    s.tool?.destroy();
    for (const [m, v] of s.saved) { Object.assign(m, v); m.needsUpdate = true; }
    s.f.position.y -= LIFT;
    s.f.updateMatrixWorld(true);
    if (restoreCamera) { editor.camera.position.copy(s.cam.pos); editor.controls.target.copy(s.cam.target); }
    $('focusBar').classList.remove('on');
    st = null;
    editor.tool = null;
    renderIdle();
  }
  // what the editor should record for the object (without the focus lift)
  function realRecord(f) {
    f.position.y -= LIFT; f.updateMatrixWorld(true);
    const r = editor.recOf(f);
    f.position.y += LIFT; f.updateMatrixWorld(true);
    return r;
  }

  async function start(f, mode = 'parts') {
    if (!f || f.userData.kind !== 'scan') return msg('Select a scanned object first', true);
    if (!editor.hasServer) return msg('Splitting needs the editor server', true);
    if (st && st.f !== f) leaveFocus(false);
    editor.sidebar.open('split');
    if (!st) {
      st = enterFocus(f);
      editor.tool = toolHooks;
    }
    const isCloud = meshesOf(f).some(o => o.isPoints);
    if (mode === 'parts' && isCloud) mode = 'planes';
    st.isCloud = isCloud;
    await setMode(mode);
  }
  async function setMode(mode) {
    st.tool?.destroy();
    st.mode = mode;
    st.tool = null;
    pane.innerHTML = `<h2>Splitting ${esc(st.f.userData.label)}</h2>
      <div class="seg"><button data-m="parts" ${st.isCloud ? 'disabled title="needs a mesh (this is a point cloud)"' : ''}>Pick parts</button>
        <button data-m="planes">Cut with planes</button></div>
      <div id="stBody"><p class="sub">Loading…</p></div>
      <div class="btns" style="margin-top:12px"><button id="stApply" class="primary">Apply <kbd>↵</kbd></button>
        <button id="stCancel">Cancel <kbd>Esc</kbd></button></div>`;
    pane.querySelectorAll('.seg button').forEach(b => {
      b.classList.toggle('on', b.dataset.m === mode);
      b.onclick = () => { if (b.dataset.m !== st.mode) setMode(b.dataset.m); };
    });
    $('stCancel').onclick = () => leaveFocus();
    $('stApply').onclick = () => st.tool?.apply();
    try {
      st.tool = mode === 'parts' ? await partsTool(st) : await planesTool(st);
    } catch (e) {
      $('stBody').innerHTML = `<p class="warn">${esc(e.message)}</p>`;
    }
  }

  const toolHooks = {
    pointerDown: e => st?.tool?.pointerDown?.(e) || false,
    pointerMove: e => st?.tool?.pointerMove?.(e),
    pointerUp: e => st?.tool?.pointerUp?.(e),
    update: () => st?.tool?.update?.(),
    keydown(e) {
      const k = e.key.toLowerCase();
      if (k === 'escape') { leaveFocus(); return true; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return false;
      if (k === 'enter') { st?.tool?.apply(); return true; }
      return st?.tool?.keydown?.(e) || false;
    },
  };

  async function finish(r, verb) {
    const f = st.f;
    leaveFocus(false);
    await editor.replaceWithPieces(f, r, verb);
  }

  // =============================================================== PARTS ==
  async function partsTool(s) {
    const f = s.f;
    const meshes = meshesOf(f);
    if (meshes.length !== 1) throw new Error('Pick parts needs an object made of one mesh — use Cut with planes.');
    const mesh = meshes[0];
    const g0 = mesh.geometry;
    const triCount = g0.index ? g0.index.count / 3 : g0.attributes.position.count / 3;
    let isl = null, islTris = null, labels = null, size = 0.15, hover = -1, active = 0, painting = false;
    let showTex = false;                           // flat piece colours read best on dark scans
    // bucket fill: spreads over islands that share an edge, stops at floating islands,
    // at edges sharper than stopAngle, at thin joints, and (sameOnly) at other pieces
    let brush = 'brush', stopAngle = 30, sameOnly = true, thinStop = true;
    let nb = [], perim = null, hoverSet = new Set();
    let info = { method: '', k: 1 };
    const undo = [];

    // display copy: one colour per corner, tinted over the texture
    const geo = g0.index ? g0.toNonIndexed() : g0.clone();
    const col = new Float32Array(triCount * 9).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const texMap = [].concat(mesh.material)[0].map || null;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const disp = new THREE.Mesh(geo, mat);
    disp.userData.splitUi = true;
    const oldVisible = [].concat(mesh.material).map(m => m.visible);
    [].concat(mesh.material).forEach(m => (m.visible = false));
    mesh.add(disp);
    const tmp = new THREE.Color();

    function shade(i) { const h = Math.imul(i + 1, 2654435761) >>> 0; return 0.8 + 0.2 * (h / 4294967296); }
    const WHITE = new THREE.Color(1, 1, 1);
    function paintTri(t) {
      tmp.setHex(PALETTE[labels[t] % PALETTE.length]).lerp(WHITE, showTex ? 0.35 : 0.1);
      const k = (showTex ? shade(isl[t]) : 0.55 + 0.45 * (shade(isl[t]) - 0.8) / 0.2) * (hoverSet.has(isl[t]) ? 1.4 : 1);
      for (let v = 0; v < 3; v++) { col[t * 9 + v * 3] = tmp.r * k; col[t * 9 + v * 3 + 1] = tmp.g * k; col[t * 9 + v * 3 + 2] = tmp.b * k; }
    }
    function paintIsland(i) { if (i >= 0) for (const t of islTris[i]) paintTri(t); }
    function recolorAll() { for (let t = 0; t < triCount; t++) paintTri(t); geo.attributes.color.needsUpdate = true; }

    async function load(start, k) {
      $('stBody').querySelector('.sub')?.replaceChildren('Finding the islands…');
      const q = new URLSearchParams({ name: f.userData.label, size: size.toFixed(3), start });
      if (k) q.set('k', k);
      const r = await fetch(`api/islands?${q}`, { cache: 'no-store' }).then(async x => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j; });
      if (r.count !== triCount) throw new Error(`the server sees ${r.count} triangles, the editor ${triCount} — reload the page`);
      isl = b64ToU32(r.islands);
      const ba = b64ToU32(r.borders.a), bb = b64ToU32(r.borders.b);
      const bl = new Float32Array(b64ToU32(r.borders.length).buffer), bang = new Float32Array(b64ToU32(r.borders.angle).buffer);
      nb = Array.from({ length: r.n }, () => []);
      perim = new Float32Array(r.n);
      for (let e = 0; e < ba.length; e++) {
        nb[ba[e]].push({ j: bb[e], len: bl[e], ang: bang[e] });
        nb[bb[e]].push({ j: ba[e], len: bl[e], ang: bang[e] });
        perim[ba[e]] += bl[e]; perim[bb[e]] += bl[e];
      }
      hoverSet = new Set();
      islTris = Array.from({ length: r.n }, () => []);
      for (let t = 0; t < triCount; t++) islTris[isl[t]].push(t);
      if (start !== 'keep') { labels = b64ToU32(r.parts).slice(); info = { method: r.method, k: r.k }; undo.length = 0; active = 0; }
      recolorAll();
      render();
    }
    function counts() { const c = new Map(); for (let t = 0; t < triCount; t++) c.set(labels[t], (c.get(labels[t]) || 0) + 1); return c; }
    function render() {
      const c = counts();
      const ids = [...new Set([...c.keys(), active])].sort((a, b) => a - b);
      const used = [...c.keys()].length;
      $('stBody').innerHTML = `
        <div class="seg" style="margin-top:10px"><button id="ptBrush" class="${brush === 'brush' ? 'on' : ''}" title="click or drag islands (B toggles)">🖌 Brush</button>
          <button id="ptBucket" class="${brush === 'bucket' ? 'on' : ''}" title="fill connected islands (B toggles)">🪣 Bucket</button></div>
        ${brush === 'brush'
          ? `<p class="sub" style="margin:8px 0 6px">Click or drag over the object to give islands to the active piece.
              <kbd>Shift</kbd> one triangle · <kbd>Alt</kbd> pick a piece's colour · <kbd>⌘Z</kbd> undo.</p>`
          : `<p class="sub" style="margin:8px 0 6px">Click to fill the connected area (shown brighter while you hover).
              It stops at floating islands, at edges sharper than the limit, and at thin joints. <kbd>Alt</kbd> picks a colour.</p>
             <label class="row" style="justify-content:space-between">stop at edges sharper than
               <span><input type="number" id="ptAng" min="5" max="180" step="5" value="${stopAngle}" style="width:64px">°</span></label>
             <label class="row"><input type="checkbox" id="ptSame" ${sameOnly ? 'checked' : ''}> stay inside the piece I click</label>
             <label class="row"><input type="checkbox" id="ptThin" ${thinStop ? 'checked' : ''}> stop at thin joints</label>`}
        <ul class="pieces">${ids.map(i => `<li data-i="${i}" class="${i === active ? 'on' : ''}">
          <span class="swatch" style="background:#${PALETTE[i % PALETTE.length].toString(16).padStart(6, '0')}"></span>
          <span class="name">Piece ${i + 1}${i < 9 ? ` <kbd>${i + 1}</kbd>` : ''}</span>
          <span class="dim">${(c.get(i) || 0).toLocaleString()} ▲</span></li>`).join('')}</ul>
        <div class="btns" style="margin-top:6px"><button id="ptNew">+ New piece <kbd>N</kbd></button>
          <button id="ptOne" title="start over with everything in one piece">One piece</button></div>
        <h2>Automatic start</h2>
        <div class="splitrow"><button id="ptMinus" title="fewer pieces">−</button><input type="number" id="ptK" min="2" max="40" value="${Math.max(2, info.k)}">
          <button id="ptPlus" title="more pieces">+</button><button id="ptAuto" title="let it decide">Auto</button></div>
        <p class="sub" style="margin:6px 0 0">${esc(info.method ? `Started from: ${info.method}` : '')} · ${used} piece${used === 1 ? '' : 's'} in use</p>
        <h2>Island size <span id="ptSizeV" style="text-transform:none">${Math.round(size * 100)} cm</span></h2>
        <input type="range" id="ptSize" min="0.08" max="0.4" step="0.01" value="${size}">
        ${texMap ? `<label class="row"><input type="checkbox" id="ptTex" ${showTex ? 'checked' : ''}> show texture</label>` : ''}`;
      if ($('ptTex')) $('ptTex').onchange = e => { showTex = e.target.checked; mat.map = showTex ? texMap : null; mat.needsUpdate = true; recolorAll(); };
      $('stBody').querySelectorAll('.pieces li').forEach(li => (li.onclick = () => { active = +li.dataset.i; render(); }));
      $('ptBrush').onclick = () => setBrush('brush');
      $('ptBucket').onclick = () => setBrush('bucket');
      if ($('ptAng')) $('ptAng').onchange = e => { stopAngle = Math.max(5, Math.min(180, parseFloat(e.target.value) || 30)); setHover(-1); };
      if ($('ptSame')) $('ptSame').onchange = e => { sameOnly = e.target.checked; setHover(-1); };
      if ($('ptThin')) $('ptThin').onchange = e => { thinStop = e.target.checked; setHover(-1); };
      $('ptNew').onclick = () => { active = Math.max(...labels, active) + 1; render(); };
      $('ptOne').onclick = () => load('one');
      const k = () => parseInt($('ptK').value, 10) || 2;
      $('ptMinus').onclick = () => load('auto', Math.max(2, k() - 1));
      $('ptPlus').onclick = () => load('auto', k() + 1);
      $('ptK').onchange = () => load('auto', Math.max(2, k()));
      $('ptAuto').onclick = () => load('auto');
      $('ptSize').oninput = e => ($('ptSizeV').textContent = `${Math.round(e.target.value * 100)} cm`);
      $('ptSize').onchange = e => { size = parseFloat(e.target.value); load('keep'); };
    }

    function hitTri(e) {
      editor.setNdc(e);
      const h = editor.ray.intersectObject(disp, false)[0];
      return h ? h.faceIndex : -1;
    }
    function setBrush(b) { brush = b; setHover(-1); render(); }
    // islands the bucket would fill from island i0
    function region(i0) {
      const lab0 = labels[islTris[i0][0]];
      const seen = new Set([i0]), queue = [i0];
      while (queue.length) {
        const i = queue.pop();
        for (const { j, len, ang } of nb[i]) {
          if (seen.has(j) || ang > stopAngle) continue;
          if (thinStop && len < 0.15 * Math.min(perim[i], perim[j])) continue;    // narrow neck
          if (sameOnly && labels[islTris[j][0]] !== lab0) continue;
          seen.add(j); queue.push(j);
        }
      }
      return seen;
    }
    function setHover(i) {
      const next = i < 0 ? new Set() : brush === 'bucket' ? region(i) : new Set([i]);
      const old = hoverSet;
      hoverSet = next;
      for (const j of old) if (!next.has(j)) paintIsland(j);
      for (const j of next) paintIsland(j);
      hover = i;
      geo.attributes.color.needsUpdate = true;
    }
    function paintAt(t, single) {
      if (single) { labels[t] = active; paintTri(t); }
      else { for (const u of islTris[isl[t]]) labels[u] = active; paintIsland(isl[t]); }
      geo.attributes.color.needsUpdate = true;
    }

    await load('auto');
    return {
      pointerDown(e) {
        if (e.button !== 0) return false;
        const t = hitTri(e);
        if (t < 0) return false;                         // empty space: orbit as usual
        if (e.altKey) { active = labels[t]; render(); return true; }
        undo.push(labels.slice());
        if (undo.length > 50) undo.shift();
        if (brush === 'bucket') {
          const reg = region(isl[t]);
          for (const i of reg) for (const u of islTris[i]) labels[u] = active;
          for (const i of reg) paintIsland(i);
          geo.attributes.color.needsUpdate = true;
          render();
          return true;
        }
        painting = true;
        paintAt(t, e.shiftKey);
        return true;
      },
      pointerMove(e) {
        const t = hitTri(e);
        if (painting && t >= 0) return paintAt(t, e.shiftKey);
        const i = t >= 0 ? isl[t] : -1;
        if (i !== hover) setHover(i);
        editor.renderer.domElement.style.cursor = t >= 0 ? (brush === 'bucket' ? 'cell' : 'crosshair') : '';
      },
      pointerUp() { if (painting) { painting = false; render(); } },
      keydown(e) {
        const k = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && k === 'z') {
          if (undo.length) { labels = undo.pop(); recolorAll(); render(); }
          return true;
        }
        if (k === 'n') { $('ptNew').click(); return true; }
        if (k === 'b') { setBrush(brush === 'brush' ? 'bucket' : 'brush'); return true; }
        if (/^[1-9]$/.test(k)) { active = +k - 1; render(); return true; }
        return false;
      },
      async apply() {
        if (counts().size < 2) return msg('Give at least one island to a second piece first', true, 2500);
        let r;
        try { r = await post('api/split/parts', { name: f.userData.label, labels: u32ToB64(labels), record: realRecord(f) }); }
        catch (e) { return msg(`Split failed: ${esc(e.message)}`, true, 4000); }
        await finish(r, 'Split');
      },
      destroy() {
        mesh.remove(disp);
        geo.dispose(); mat.dispose();
        [].concat(mesh.material).forEach((m, i) => (m.visible = oldVisible[i]));
        editor.renderer.domElement.style.cursor = '';
      },
    };
  }

  // ============================================================== PLANES ==
  async function planesTool(s) {
    const f = s.f;
    const r = await fetch(`api/split/suggest?name=${encodeURIComponent(f.userData.label)}`, { cache: 'no-store' })
      .then(async x => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j; });
    let cuts = (r.cuts.length ? r.cuts : [(r.tmin + r.tmax) / 2]).map(t => ({ t, ang: 0 }));
    let rowAng = 0, drag = null, hover = null;
    const group = new THREE.Group();
    group.userData.splitUi = true;
    f.add(group);
    const lb = editor.localBox(f), sz = lb.getSize(new THREE.Vector3()), lc = lb.getCenter(new THREE.Vector3());
    const H = Math.max(sz.y, 0.2) + 0.12, yc = lb.min.y + sz.y / 2;
    const planeMat = new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false });
    const planeHot = planeMat.clone(); planeHot.opacity = 0.6;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd43b, depthTest: false, toneMapped: false });
    const ringHot = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, toneMapped: false });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xff8a8d, depthTest: false, toneMapped: false });

    const axisR = () => rot2(r.axis, rowAng);
    const normalOf = c => rot2(axisR(), c.ang);
    const originOf = c => { const a = axisR(); return [r.origin[0] + a[0] * c.t, r.origin[1] + a[1] * c.t]; };
    const widthHalf = () => { const a = axisR(), n = [-a[1], a[0]]; return 0.5 * (Math.abs(n[0]) * sz.x + Math.abs(n[1]) * sz.z) + 0.08; };

    function build() {
      for (const c of [...group.children]) { group.remove(c); c.traverse(o => o.geometry?.dispose()); }
      cuts.sort((a, b) => a.t - b.t);
      cuts.forEach((c, i) => {
        const g = new THREE.Group();
        const geo = new THREE.PlaneGeometry(2 * widthHalf(), H);
        const plane = new THREE.Mesh(geo, planeMat);
        plane.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
        plane.userData = { i, kind: 'slide' };
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 32), ringMat);
        ring.position.y = H / 2 + 0.09;
        ring.userData = { i, kind: 'turn' };
        g.add(plane, ring);
        g.renderOrder = plane.renderOrder = ring.renderOrder = 997;
        group.add(g);
        c.g = g; c.plane = plane; c.ring = ring;
        place(c);
      });
      renderList();
    }
    function place(c) {
      const o = originOf(c), n = normalOf(c), a = axisR(), p = [-a[1], a[0]];
      const cn = (lc.x - r.origin[0]) * p[0] + (lc.z - r.origin[1]) * p[1];      // centre the plane across the object
      const along = [-n[1], n[0]];
      const k = cn / Math.max(1e-6, along[0] * p[0] + along[1] * p[1]);
      c.g.position.set(o[0] + along[0] * k, yc, o[1] + along[1] * k);
      c.g.rotation.y = Math.atan2(n[0], n[1]);
    }
    function crossing() {
      // do two neighbouring planes meet inside the object's footprint?
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i], b = cuts[i + 1], na = normalOf(a), nb = normalOf(b), oa = originOf(a), ob = originOf(b);
        const det = na[0] * nb[1] - na[1] * nb[0];
        if (Math.abs(det) < 1e-6) continue;
        const da = na[0] * oa[0] + na[1] * oa[1], db = nb[0] * ob[0] + nb[1] * ob[1];
        const x = (da * nb[1] - db * na[1]) / det, z = (na[0] * db - nb[0] * da) / det;
        if (x > lb.min.x && x < lb.max.x && z > lb.min.z && z < lb.max.z) return i + 1;
      }
      return 0;
    }
    const DEGR = 180 / Math.PI;
    function renderList() {
      const bad = crossing();
      $('stBody').innerHTML = `
        <p class="sub" style="margin:10px 0 6px">Drag a red plane to slide it, drag its yellow ring left/right to turn it.</p>
        <div class="splitrow"><button id="plMinus" title="fewer pieces">−</button><input type="number" id="plN" min="2" max="40" value="${cuts.length + 1}">
          <button id="plPlus" title="more pieces">+</button><button id="plAuto" title="restore the automatic guess">Auto</button></div>
        <p class="sub" style="margin:6px 0">${cuts.length + 1} pieces · guess: ${r.count} of ~${Math.round(r.pitch * 100)} cm</p>
        <label class="row" style="justify-content:space-between">Row direction°
          <input type="number" id="plRow" step="1" value="${(rowAng * DEGR).toFixed(1)}" style="width:80px"></label>
        <ul class="planes">${cuts.map((c, i) => `<li><span class="name">Cut ${i + 1}</span>
          <input type="number" step="1" min="-80" max="80" data-i="${i}" value="${(c.ang * DEGR).toFixed(1)}" title="turn (degrees)">°
          <button class="eye" data-z="${i}" title="straighten">↺</button></li>`).join('')}</ul>
        ${bad ? `<p class="warn">Cuts ${bad} and ${bad + 1} cross inside the object — turn them less.</p>` : ''}`;
      const n = () => parseInt($('plN').value, 10) || 2;
      const even = k => { cuts = Array.from({ length: k - 1 }, (_, i) => ({ t: r.tmin + ((i + 1) * (r.tmax - r.tmin)) / k, ang: 0 })); build(); };
      $('plMinus').onclick = () => even(Math.max(2, n() - 1));
      $('plPlus').onclick = () => even(n() + 1);
      $('plN').onchange = () => even(Math.max(2, n()));
      $('plAuto').onclick = () => { cuts = r.cuts.map(t => ({ t, ang: 0 })); rowAng = 0; build(); };
      $('plRow').onchange = e => { rowAng = (parseFloat(e.target.value) || 0) / DEGR; build(); };
      $('stBody').querySelectorAll('.planes input').forEach(inp => (inp.onchange = () => {
        cuts[+inp.dataset.i].ang = Math.max(-80, Math.min(80, parseFloat(inp.value) || 0)) / DEGR; place(cuts[+inp.dataset.i]); renderList();
      }));
      $('stBody').querySelectorAll('[data-z]').forEach(b => (b.onclick = () => { cuts[+b.dataset.z].ang = 0; place(cuts[+b.dataset.z]); renderList(); }));
    }
    function hit(e) {
      editor.setNdc(e);
      const objs = cuts.flatMap(c => [c.ring, c.plane]);
      const h = editor.ray.intersectObjects(objs, false)[0];
      return h || null;
    }
    function setHover(o) {
      if (hover === o) return;
      if (hover) hover.material = hover.userData.kind === 'turn' ? ringMat : planeMat;
      hover = o;
      if (hover) hover.material = hover.userData.kind === 'turn' ? ringHot : planeHot;
    }
    build();
    return {
      pointerDown(e) {
        if (e.button !== 0) return false;
        const h = hit(e);
        if (!h) return false;
        const c = cuts[h.object.userData.i];
        drag = { c, kind: h.object.userData.kind, x0: e.clientX, ang0: c.ang, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -h.point.y) };
        return true;
      },
      pointerMove(e) {
        if (!drag) { const h = hit(e); setHover(h?.object || null); editor.renderer.domElement.style.cursor = h ? (h.object.userData.kind === 'turn' ? 'ew-resize' : 'grab') : ''; return; }
        const c = drag.c;
        if (drag.kind === 'turn') {
          c.ang = Math.max(-80, Math.min(80, drag.ang0 * DEGR + (e.clientX - drag.x0) * 0.4)) / DEGR;
        } else {
          editor.setNdc(e);
          const p = new THREE.Vector3();
          if (!editor.ray.ray.intersectPlane(drag.plane, p)) return;
          const lp = f.worldToLocal(p), a = axisR();
          c.t = Math.max(r.tmin + 0.03, Math.min(r.tmax - 0.03, (lp.x - r.origin[0]) * a[0] + (lp.z - r.origin[1]) * a[1]));
        }
        place(c);
      },
      pointerUp() { if (drag) { drag = null; build(); } },
      update() {},
      async apply() {
        if (crossing()) return msg('Two cuts cross inside the object — turn them less first', true, 3000);
        const planes = [...cuts].sort((a, b) => a.t - b.t).map(c => ({ origin: originOf(c), normal: normalOf(c) }));
        let res;
        try { res = await post('api/split', { name: f.userData.label, planes, record: realRecord(f) }); }
        catch (e) { return msg(`Split failed: ${esc(e.message)}`, true, 4000); }
        await finish(res, 'Split');
      },
      destroy() {
        f.remove(group);
        group.traverse(o => o.geometry?.dispose());
        editor.renderer.domElement.style.cursor = '';
      },
    };
  }

  return { start, stop: () => leaveFocus(), get active() { return !!st; } };
}
