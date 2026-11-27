# Hearth & Oak — Furniture Store Mockup

A front-end-only furniture e-commerce mockup built with **React 19 + Vite + React Router**.

## Data source

All product data and images come from [DummyJSON](https://dummyjson.com/docs/products).
It's free, needs no API key, and has CORS enabled, so no backend is required. The app uses:

- `GET /products/category/furniture` — beds, sofas, chairs, tables
- `GET /products/category/home-decoration` — frames, lamps, décor
- `GET /products/:id` — full product detail (images, dimensions, warranty, reviews…)

The API calls live in `src/api.js`. To add categories, add them to `CATEGORIES` there.
The full list is at `https://dummyjson.com/products/category-list`.

## This branch: `ebawood-style`

A static staging/test copy of the store that mirrors the page structure of
[ebawood.ge](https://ebawood.ge) section by section. It keeps our own name ("Hearth & Oak"),
its own product data and photos, and original placeholder copy; no Ebawood logos, photos
or text are used.

- **Products (29):** the 10 furniture/décor items from DummyJSON plus 19 local furniture items
  in `src/catalog.js` (sofas, armchairs, beds, dining/coffee tables, a desk), merged in
  `src/api.js`. Their photos are CC0 images from StockSnap (found via Openverse), stored in
  `public/catalog/` — sources listed in `public/catalog/CREDITS.md`.
- **Product types:** `/shop?type=sofas|chairs|beds|tables|lighting|decor` filters by product
  tags; also available as a "Product type" box in the shop sidebar and in the category bar.

- **No animation:** the `motion` library is removed and the stylesheet has no transitions or
  keyframes. Sliders don't autoplay and carousels page instantly, so screenshots and tests are deterministic.
- **Look:** Montserrat, lime `#8CC63F` + dark green `#00703C`, pill buttons and search,
  cards with one square corner (`0 60px 60px 60px`), dark footer with a rounded corner
- **Header:** gradient top bar, logo + search + Outlet/Bestsellers + wishlist/sign-in/cart,
  and a lime category bar with dropdowns (`NAV` in `src/api.js`)
- **Home, in order:** hero slider → intro → category carousel → bestsellers → 4 feature
  cards → about mosaic → new arrivals → Top 10 deals → most viewed → banner →
  "Why choose us" cards → blog → showrooms → footer, plus a (non-functional) chat button
- **Products page (`/shop`):** title banner with breadcrumb, sidebar filters (search,
  categories, brands, status, min/max price) and a 3-column grid. Every filter lives in
  the URL, e.g. `/shop?category=furniture&brand=Knoll&max=500`.

## View in 3D (avegeany room editor)

Every product page has a **View in 3D** button. It opens a full-screen dialog that runs the
[avegeany](avegeany/README.md) room editor: a scanned room, with the product's 3D model
placed on the floor. The dialog shows only the 3D view: visitors orbit and zoom, and drag, move
and turn the product (gizmo arrows and ring, Q / E); the room's own furniture can't be selected
but still blocks the product (C lets it pass through). Room brightness: `roomLight` in `src/view3d.js`.

- **The model:** all products use one prepared model for now. Put it at
  **`public/models/product.glb`** (see [`public/models/README.md`](public/models/README.md)).
  The file path, units and up axis are set in `src/view3d.js`. Without the file, the dialog
  says so and shows the room anyway.
- **The room:** `public/rooms/auditorium/` (in use) is the scanned auditorium from
  `room.avjp`, extracted. The browser can't read an `.avjp` itself; it's a zip, so the editor
  needs it unpacked (only the `.glb` files, `scene.json` and `textures/`; the `.obj` copies and
  `objects/_split/` are for the Python tools). `public/rooms/demo/` is avegeany's small synthetic
  test room. To use another scan, write it to a folder with
  `python -m avegeany segment SCAN.obj -o public/rooms/<name>` (or unzip its `.avjp` there)
  and point `VIEW3D.room` in `src/view3d.js` at it.
- **The editor:** `avegeany/` is the whole avegeany repo (Python pipeline + `viewer/`), copied
  from `soulus2/avegeany` at commit `4da0bfb`. `vite.config.js` serves `avegeany/viewer/` at
  `/avegeany/` in dev and copies it into `dist/avegeany/` on build, so it isn't duplicated.
  The store opens it in an iframe with URL options (`project`, `place`, `name`, `unit`, `up`,
  `sidebar`) and listens for its `avegeany:ready / placed / error` messages. Both are documented in
  [`avegeany/docs/EMBEDDING.md`](avegeany/docs/EMBEDDING.md) §5.2.
- In the browser, the editor runs in **static mode**: changes last for the visit only. Save
  downloads `layout.json`, Export GLB downloads the arranged room, and the Catalog / Split
  tabs (which need the Python server) are unavailable.

## Features

- Product page with gallery, specs and delivery accordions, reviews, and related products
- Wishlist (hearts on cards, `/wishlist`) and cart, both stored in `localStorage`
- Cart drawer with a free-delivery progress bar
- Mock checkout and order confirmation (no payment is collected)
- Responsive down to phone widths

## Run it

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```
