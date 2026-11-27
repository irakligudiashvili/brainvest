// Product data comes from DummyJSON (https://dummyjson.com) — a free, keyless,
// CORS-enabled mock API — plus a local furniture catalogue (src/catalog.js),
// because DummyJSON only has five furniture items. No backend required.
import { LOCAL_PRODUCTS, localProduct } from './catalog';

const BASE = 'https://dummyjson.com';

export const CATEGORIES = [
  { slug: 'furniture', name: 'Furniture', blurb: 'Beds, sofas, chairs & tables' },
  { slug: 'home-decoration', name: 'Home Decor', blurb: 'Frames, lamps & accents' },
];

const cache = new Map();

async function get(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = fetch(BASE + path).then((res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
  cache.set(path, promise);
  promise.catch(() => cache.delete(path)); // allow retry after a failure
  return promise;
}

export async function fetchCategory(slug) {
  const data = await get(`/products/category/${slug}?limit=0`);
  return [...data.products, ...LOCAL_PRODUCTS.filter((p) => p.category === slug)];
}

export async function fetchAllProducts() {
  const lists = await Promise.all(CATEGORIES.map((c) => fetchCategory(c.slug)));
  return lists.flat();
}

export function fetchProduct(id) {
  const local = localProduct(id);
  return local ? Promise.resolve(local) : get(`/products/${id}`);
}

export const discounted = (p) => p.price * (1 - (p.discountPercentage || 0) / 100);

export const money = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const categoryName = (slug) =>
  CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;

export const FREE_SHIPPING_AT = 500;
export const shippingFor = (subtotal) => (subtotal >= FREE_SHIPPING_AT || subtotal === 0 ? 0 : 49);

// Product types, matched against each product's `tags` (DummyJSON and the
// local catalogue use the same tag names). Used by the shop's `type` filter.
export const TYPES = [
  { slug: 'sofas', name: 'Sofas & couches', tags: ['sofas'] },
  { slug: 'chairs', name: 'Armchairs & chairs', tags: ['armchairs', 'chairs', 'office chairs'] },
  { slug: 'beds', name: 'Beds', tags: ['beds'] },
  { slug: 'tables', name: 'Tables & desks', tags: ['dining tables', 'coffee tables', 'bedside tables', 'desks'] },
  { slug: 'lighting', name: 'Lighting', tags: ['lighting'] },
  { slug: 'decor', name: 'Plants & accents', tags: ['artificial plants', 'plant accessories', 'photo frame', 'swing'] },
];
export const typeName = (slug) => TYPES.find((t) => t.slug === slug)?.name ?? slug;
export const hasType = (product, slug) => {
  const t = TYPES.find((x) => x.slug === slug);
  return !!t && (product.tags ?? []).some((tag) => t.tags.includes(tag));
};

// Category-bar links: types filter by tag; rooms are keyword searches over
// title + description + brand.
const shop = (params) => `/shop?${new URLSearchParams(params)}`;
export const NAV = [
  {
    label: 'Furniture',
    to: shop({ category: 'furniture' }),
    children: [
      { label: 'Sofas & couches', to: shop({ type: 'sofas' }) },
      { label: 'Armchairs & chairs', to: shop({ type: 'chairs' }) },
      { label: 'Beds', to: shop({ type: 'beds' }) },
      { label: 'Tables & desks', to: shop({ type: 'tables' }) },
      { label: 'Bathroom', to: shop({ category: 'furniture', q: 'bathroom' }) },
    ],
  },
  {
    label: 'Home decor',
    to: shop({ category: 'home-decoration' }),
    children: [
      { label: 'Lighting', to: shop({ type: 'lighting' }) },
      { label: 'Plants', to: shop({ category: 'home-decoration', q: 'plant' }) },
      { label: 'Photo frames', to: shop({ category: 'home-decoration', q: 'photo' }) },
      { label: 'Swings', to: shop({ category: 'home-decoration', q: 'swing' }) },
    ],
  },
  { label: 'Sofas', to: shop({ type: 'sofas' }) },
  { label: 'Chairs', to: shop({ type: 'chairs' }) },
  { label: 'Beds', to: shop({ type: 'beds' }) },
  { label: 'Tables', to: shop({ type: 'tables' }) },
  { label: 'Living room', to: shop({ q: 'living room' }) },
  { label: 'Bedroom', to: shop({ q: 'bedroom' }) },
  { label: 'Outlet', to: shop({ sort: 'discount' }) },
];
