// "View in 3D" on the product page opens the avegeany room editor (avegeany/viewer,
// published at /avegeany/ by vite.config.js) with a room and ONE prepared model that every
// product uses for now. Change the model or the room here.
const BASE = import.meta.env.BASE_URL;

export const VIEW3D = {
  editor: `${BASE}avegeany/index.html`,
  // A room folder: scene.glb, scene.json, objects/, textures/ — written by
  // `python -m avegeany segment SCAN -o public/rooms/<name>`, or extracted from an .avjp
  // (a zip of the same files). rooms/auditorium is public/models/room.avjp, extracted;
  // rooms/demo is avegeany's small synthetic test room.
  room: `${BASE}rooms/auditorium/`,
  model: {
    url: `${BASE}models/product.glb`, // ← put the prepared model in public/models/
    unit: 1, // file units in metres: 1 = m, 0.01 = cm, 0.001 = mm, 0.0254 = inches
    up: 'y', // 'y' for .glb/.gltf/.obj; most .stl/.ply files are 'z'
  },
  // Brightness of the scanned room next to the product: 1 = as scanned, higher = brighter.
  roomLight: 1,
};

// Editor URL for a product: the room, the model to place, and its name in the object list.
export function view3dUrl(product) {
  const params = new URLSearchParams({
    project: VIEW3D.room,
    place: VIEW3D.model.url,
    name: product.title,
    unit: String(VIEW3D.model.unit),
    up: VIEW3D.model.up,
    roomLight: String(VIEW3D.roomLight),
    ui: 'none', // only the 3D view: no editor panels
    lock: 'room', // only the product can be selected and moved
  });
  return `${VIEW3D.editor}?${params}`;
}
