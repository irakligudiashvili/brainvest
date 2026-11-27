// Combined move + rotate gizmo (no scaling), written for the avegeany editor.
//
//   red   X arrow  : left / right
//   green Y arrow  : up / down             green ring : turn on the floor (about the vertical Y axis)
//   blue  Z arrow  : front / back
//   yellow square  : free move on the floor plane (X + Z together)
//
// Furniture only turns in the X–Z (floor) plane: there are no tilt rings and the
// ring always turns about the world up axis, also in 'local' space.
//
// Space: 'world' (arrows follow the room axes) or 'local' (arrows follow the
// object, so they move it "in the direction it faces").
//
// The gizmo never writes the transform directly: every drag step is passed to
// `onDrag(object, apply)` so the editor can veto it (collisions, floor).
import * as THREE from 'three';

const COLORS = { x: 0xe5484d, y: 0x46a758, z: 0x3e8ef7, plane: 0xf2c94c, hover: 0xffffff };
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function mat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
}
const pickMat = new THREE.MeshBasicMaterial({ visible: false });

export class TransformGizmo {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.object = null;
    this.space = 'world';
    this.size = 0.12;              // fraction of camera distance
    this.snap = false;             // grid / angle snapping (Shift also snaps)
    this.moveStep = 0.05;          // metres
    this.angleStep = THREE.MathUtils.degToRad(15);
    this.enabledAxes = { tx: true, ty: true, tz: true, ry: true, plane: true };
    this.onDrag = (obj, apply) => { apply(); return true; };
    this.onStart = () => {};
    this.onEnd = () => {};

    this.root = new THREE.Group();
    this.root.name = '__gizmo';
    this.root.visible = false;
    this.root.renderOrder = 999;
    this.pickers = [];
    this.visuals = [];
    this._build();

    this.ray = new THREE.Raycaster();
    this.drag = null;
    this.hovered = null;
  }

  // ---------------------------------------------------------------- build --
  _add(kind, axis, visual, picker, color) {
    visual.userData = { ...visual.userData, kind, axis, color };
    visual.renderOrder = 999;
    picker.userData = { kind, axis, visual };
    this.root.add(visual, picker);
    this.visuals.push(visual);
    this.pickers.push(picker);
  }

  _build() {
    // arrows
    const shaft = new THREE.CylinderGeometry(0.022, 0.022, 0.76, 12).translate(0, 0.38 + 0.12, 0);
    const head = new THREE.ConeGeometry(0.065, 0.16, 20).translate(0, 0.96, 0);
    const pick = new THREE.CylinderGeometry(0.08, 0.08, 0.92, 6).translate(0, 0.58, 0);
    const toAxis = { x: [0, 0, -Math.PI / 2], y: [0, 0, 0], z: [Math.PI / 2, 0, 0] };
    for (const a of ['x', 'y', 'z']) {
      const g = new THREE.Group();
      const m = mat(COLORS[a]);
      const s = new THREE.Mesh(shaft, m), h = new THREE.Mesh(head, m);
      s.renderOrder = h.renderOrder = 999;
      g.add(s, h);
      g.rotation.set(...toAxis[a]);
      const p = new THREE.Mesh(pick, pickMat);
      p.rotation.set(...toAxis[a]);
      g.userData.materials = [m];
      this._add('translate', a, g, p, COLORS[a]);
    }
    // floor plane square (X+Z)
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2).rotateX(-Math.PI / 2).translate(0.22, 0, 0.22),
      mat(COLORS.plane, 0.7));
    sq.userData.materials = [sq.material];
    const sqp = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26).rotateX(-Math.PI / 2).translate(0.22, 0, 0.22), pickMat);
    this._add('plane', 'y', sq, sqp, COLORS.plane);

    // one rotation ring, lying on the floor plane: turn about the vertical axis
    const ringR = 1.15;                      // just outside the arrow tips
    const m = mat(COLORS.y, 0.95);
    const r = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.022, 8, 96), m);
    r.rotation.x = Math.PI / 2;
    r.userData.materials = [m];
    const p = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.08, 4, 48), pickMat);
    p.rotation.x = Math.PI / 2;
    this._add('rotate', 'y', r, p, COLORS.y);
  }

  // ---------------------------------------------------------------- state --
  attach(obj) { this.object = obj; this.root.visible = !!obj; this.update(); }
  detach() { this.attach(null); }
  setSpace(s) { this.space = s; this.update(); }
  toggleSpace() { this.setSpace(this.space === 'world' ? 'local' : 'world'); return this.space; }
  get dragging() { return !!this.drag; }

  _axisWorld(axis) {
    const v = AXES[axis].clone();
    if (this.space === 'local' && this.object) v.applyQuaternion(this.object.getWorldQuaternion(new THREE.Quaternion()));
    return v.normalize();
  }

  update() {
    if (!this.object) return;
    const p = this.object.getWorldPosition(new THREE.Vector3());
    this.root.position.copy(p);
    if (this.space === 'local') this.root.quaternion.copy(this.object.getWorldQuaternion(new THREE.Quaternion()));
    else this.root.quaternion.identity();
    const d = this.camera.position.distanceTo(p);
    this.root.scale.setScalar(Math.max(0.05, d * this.size));
    const map = { translate: 't', rotate: 'r' };
    for (const v of this.visuals) {
      const { kind, axis } = v.userData;
      const key = kind === 'plane' ? 'plane' : map[kind] + axis;
      v.visible = this.enabledAxes[key] !== false;
    }
    for (const p2 of this.pickers) p2.visible = p2.userData.visual.visible;
    this.root.updateMatrixWorld(true);
  }

  _hit(ndc) {
    if (!this.object || !this.root.visible) return null;
    this.ray.setFromCamera(ndc, this.camera);
    const pickers = this.pickers.filter(p => p.userData.visual.visible);
    pickers.forEach(p => (p.material = pickMat));
    const hits = this.ray.intersectObjects(pickers, false);
    if (!hits.length) return null;
    // prefer arrows / square over rings when both are under the cursor
    hits.sort((a, b) => (a.object.userData.kind === 'rotate') - (b.object.userData.kind === 'rotate') || a.distance - b.distance);
    return hits[0].object.userData;
  }

  _highlight(handle) {
    for (const v of this.visuals) {
      const on = handle && v === handle.visual;
      for (const m of v.userData.materials) m.color.setHex(on ? COLORS.hover : v.userData.color);
    }
  }

  // drag plane for a translate axis: contains the axis, faces the camera as much as possible
  _axisPlane(axisW, origin) {
    const eye = new THREE.Vector3().subVectors(this.camera.position, origin).normalize();
    let n = new THREE.Vector3().crossVectors(axisW, eye).cross(axisW);
    if (n.lengthSq() < 1e-8) n = new THREE.Vector3(0, 1, 0).cross(axisW);
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), origin);
  }

  _intersect(plane) {
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, p) ? p : null;
  }

  // ------------------------------------------------------------- pointer ---
  /** returns true when the gizmo took the pointer (editor should not orbit / pick) */
  pointerDown(ndc) {
    const h = this._hit(ndc);
    if (!h) return false;
    const obj = this.object;
    const origin = obj.getWorldPosition(new THREE.Vector3());
    // turning is always about the world up axis (furniture stays upright)
    const axisW = h.kind === 'rotate' ? AXES.y.clone() : this._axisWorld(h.axis);
    let plane;
    if (h.kind === 'translate') plane = this._axisPlane(axisW, origin);
    else if (h.kind === 'plane') plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisW, origin);
    else plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisW, origin);
    const start = this._intersect(plane);
    if (!start) return false;
    this.drag = {
      handle: h, plane, axisW, origin, start,
      pos0: obj.position.clone(), quat0: obj.quaternion.clone(), lastAngle: 0,
    };
    this._highlight(h);
    this.onStart(obj, h);
    return true;
  }

  pointerMove(ndc, shift = false) {
    if (!this.drag) {
      this.ray.setFromCamera(ndc, this.camera);
      const h = this._hit(ndc);
      if (h !== this.hovered) { this.hovered = h; this._highlight(h); }
      this.dom.style.cursor = h ? 'grab' : '';
      return !!h;
    }
    this.ray.setFromCamera(ndc, this.camera);
    const d = this.drag, obj = this.object;
    const p = this._intersect(d.plane);
    if (!p) return true;
    const snap = this.snap || shift;

    if (d.handle.kind === 'translate') {
      let t = p.clone().sub(d.start).dot(d.axisW);
      if (snap) t = Math.round(t / this.moveStep) * this.moveStep;
      const target = d.pos0.clone().addScaledVector(d.axisW, t);
      this.onDrag(obj, () => { obj.position.copy(target); obj.updateMatrixWorld(true); }, d.handle);
    } else if (d.handle.kind === 'plane') {
      const delta = p.clone().sub(d.start);
      delta.addScaledVector(d.axisW, -delta.dot(d.axisW));          // stay in the plane
      if (snap) delta.set(Math.round(delta.x / this.moveStep) * this.moveStep, Math.round(delta.y / this.moveStep) * this.moveStep, Math.round(delta.z / this.moveStep) * this.moveStep);
      const target = d.pos0.clone().add(delta);
      this.onDrag(obj, () => { obj.position.copy(target); obj.updateMatrixWorld(true); }, d.handle);
    } else {
      const v0 = d.start.clone().sub(d.origin), v1 = p.clone().sub(d.origin);
      let ang = Math.atan2(new THREE.Vector3().crossVectors(v0, v1).dot(d.axisW), v0.dot(v1));
      // unwrap so a full turn keeps accumulating
      while (ang - d.lastAngle > Math.PI) ang -= 2 * Math.PI;
      while (ang - d.lastAngle < -Math.PI) ang += 2 * Math.PI;
      d.lastAngle = ang;
      let a = ang;
      if (snap) a = Math.round(a / this.angleStep) * this.angleStep;
      const q = new THREE.Quaternion().setFromAxisAngle(d.axisW, a).multiply(d.quat0);
      this.onDrag(obj, () => { obj.quaternion.copy(q); obj.updateMatrixWorld(true); }, d.handle, a);
    }
    this.update();
    return true;
  }

  pointerUp() {
    if (!this.drag) return false;
    const h = this.drag.handle;
    this.drag = null;
    this._highlight(this.hovered);
    this.onEnd(this.object, h);
    this.update();
    return true;
  }
}
