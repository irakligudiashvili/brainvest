# Prepared 3D model for "View in 3D"

Put the model here as **`product.glb`**:

```
public/models/product.glb
```

Every product's **View in 3D** button opens the room editor and places this one model
in the room. There's no rebuild or restart: reopen the dialog and it loads the new file.

## Requirements

- **Format:** `.glb` is recommended because it keeps textures in one file. `.gltf` (with its
  `.bin` and textures next to it), `.obj` (no textures), `.ply` and `.stl` also work.
  If you use another file name or format, change `VIEW3D.model.url` in `src/view3d.js`.
- **Size:** the model is shown at its real size, read as **metres**. If the file is in
  centimetres, millimetres or inches, set `VIEW3D.model.unit` in `src/view3d.js` to
  `0.01`, `0.001` or `0.0254`.
- **Up axis:** Y up (the glTF default). For a Z-up file (common for `.stl` / `.ply`)
  set `VIEW3D.model.up` to `'z'`.
- The pivot doesn't matter: the editor stands the model on the floor, centred on its footprint.

If the file is missing, the dialog says so and still shows the room.
