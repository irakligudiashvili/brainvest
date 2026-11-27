# Furniture catalog (the preinstalled pack)

Put furniture models here and they show up in the editor's **Catalog** tab
(left sidebar), ready to drag onto the floor.

* **Sub-folders are categories:** `chairs/`, `tables/`, `sofas/`, `lamps/` …
  Files directly in this folder go to "other".
* **Formats:** `.glb` (recommended — keeps textures), `.gltf` (embedded only),
  `.obj` (no textures: the editor doesn't read `.mtl`), `.ply`, `.stl`.
* **Size:** models are placed at their original size, assuming **metres** and
  **Y up** (`.stl` / `.ply`: Z up). If a model uses other units or axes, add a
  sidecar file with the same name, e.g. `chairs/office_chair.json`:

  ```json
  {"name": "Office chair", "category": "chairs", "up": "y", "unit": 0.01, "tags": ["office"]}
  ```

  `unit`: 1 = metres, 0.01 = centimetres, 0.001 = millimetres, 0.0254 = inches.

Models you add from inside the editor ("+ Add to my library") are stored in
`~/.avegeany/catalog/` instead and appear in every project.
