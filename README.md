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

## This branch: `embawood-style`

A static staging/test copy of the store that mirrors the page structure of
[embawood.ge](https://embawood.ge) section by section. It keeps our own name ("Hearth & Oak"),
DummyJSON product data and photos, and original placeholder copy; no Embawood logos, photos
or text are used.

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
