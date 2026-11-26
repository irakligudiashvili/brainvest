// All product data comes from DummyJSON (https://dummyjson.com) — a free,
// keyless, CORS-enabled mock API. No backend required.
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
  return data.products;
}

export async function fetchAllProducts() {
  const lists = await Promise.all(CATEGORIES.map((c) => fetchCategory(c.slug)));
  return lists.flat();
}

export function fetchProduct(id) {
  return get(`/products/${id}`);
}

export const discounted = (p) => p.price * (1 - (p.discountPercentage || 0) / 100);

export const money = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const categoryName = (slug) =>
  CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;

export const FREE_SHIPPING_AT = 500;
export const shippingFor = (subtotal) => (subtotal >= FREE_SHIPPING_AT || subtotal === 0 ? 0 : 49);

// Category-bar links. DummyJSON has two categories, so "rooms" are keyword
// searches over title + description (each verified to match real products).
const shop = (params) => `/shop?${new URLSearchParams(params)}`;
export const NAV = [
  {
    label: 'Furniture',
    to: shop({ category: 'furniture' }),
    children: [
      { label: 'Bedroom', to: shop({ category: 'furniture', q: 'bedroom' }) },
      { label: 'Living room', to: shop({ category: 'furniture', q: 'living room' }) },
      { label: 'Office', to: shop({ category: 'furniture', q: 'office' }) },
      { label: 'Bathroom', to: shop({ category: 'furniture', q: 'bathroom' }) },
    ],
  },
  {
    label: 'Home decor',
    to: shop({ category: 'home-decoration' }),
    children: [
      { label: 'Lighting', to: shop({ category: 'home-decoration', q: 'lamp' }) },
      { label: 'Plants', to: shop({ category: 'home-decoration', q: 'plant' }) },
      { label: 'Photo frames', to: shop({ category: 'home-decoration', q: 'photo' }) },
      { label: 'Swings', to: shop({ category: 'home-decoration', q: 'swing' }) },
    ],
  },
  { label: 'Bedroom', to: shop({ q: 'bedroom' }) },
  { label: 'Living room', to: shop({ q: 'living room' }) },
  { label: 'Office', to: shop({ q: 'office' }) },
  { label: 'Bathroom', to: shop({ q: 'bathroom' }) },
  { label: 'Lighting', to: shop({ q: 'lamp' }) },
  { label: 'Outlet', to: shop({ sort: 'discount' }) },
];
