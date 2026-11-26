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
