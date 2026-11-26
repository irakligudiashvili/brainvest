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

## Features

- Home page with hero, category tiles, a sideways product showcase, an editorial section, stats, and top-rated products
- Shop page with category filters, search, and sorting, all kept in the URL
- Product page with zoomable gallery, specs and delivery accordions, reviews, and related products
- Cart stored in `localStorage`, with a slide-out drawer and a free-delivery progress bar
- Mock checkout form and order confirmation (no payment is collected)
- Responsive layout

## Motion

Built with [Motion](https://motion.dev) (`motion/react`). The shared pieces are in `src/components/`:

| Effect | Where |
| --- | --- |
| Intro loader + curtain wipe (first visit per session) | `Intro.jsx` |
| Masked word-by-word headline reveals (`*word*` = italic accent) | `SplitText.jsx` |
| Fade-up when scrolled into view | `Reveal.jsx` |
| Arch-shaped hero image, scroll parallax, rotating badge, floating card | `home/Hero.jsx`, `RotatingBadge.jsx` |
| Ticker that tilts with scroll speed | `Marquee.jsx` |
| Pinned section that scrolls products sideways | `home/Showcase.jsx` |
| Image wipe-in + parallax | `ParallaxImage.jsx` |
| Count-up stats, animated cart totals | `Numbers.jsx` |
| 3D tilt + light sheen on product cards | `ProductCard.jsx` |
| Product image flies into the cart, badge bounces | `UIContext.jsx`, `Header.jsx` |
| Buttons that pull toward the cursor, custom cursor | `Magnetic.jsx`, `Cursor.jsx` |
| Page transitions, sliding nav/filter pills, filter reshuffling | `Page.jsx`, `Header.jsx`, `pages/Shop.jsx` |
| Self-drawing checkmark + confetti | `pages/Checkout.jsx` |

All animation respects the OS "reduce motion" setting (`MotionConfig reducedMotion="user"`),
and the intro is skipped for users who have it turned on.

## Run it

Requires Node.js 20.19+ (or 22.12+).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```
