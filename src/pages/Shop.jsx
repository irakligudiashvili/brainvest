import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, TYPES, categoryName, discounted, fetchAllProducts, hasType, typeName } from '../api';
import { useAsync } from '../useAsync';
import ProductCard from '../components/ProductCard';
import { ChevronDown, ChevronUp, FilterIcon, SearchIcon } from '../components/Icons';
import { ErrorState, SkeletonGrid } from '../components/Status';

const SORTS = {
  featured: { label: 'Featured', fn: () => 0 },
  'price-asc': { label: 'Price: low to high', fn: (a, b) => discounted(a) - discounted(b) },
  'price-desc': { label: 'Price: high to low', fn: (a, b) => discounted(b) - discounted(a) },
  rating: { label: 'Bestsellers', fn: (a, b) => b.rating - a.rating },
  discount: { label: 'Outlet: biggest discount', fn: (a, b) => b.discountPercentage - a.discountPercentage },
};

const STATUSES = [
  { value: 'in-stock', label: 'In stock', test: (p) => p.stock > 0 },
  { value: 'sale', label: 'On sale (10%+ off)', test: (p) => p.discountPercentage >= 10 },
];

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const categories = params.getAll('category');
  const types = params.getAll('type');
  const brands = params.getAll('brand');
  const statuses = params.getAll('status');
  const q = params.get('q') ?? '';
  const min = params.get('min') ?? '';
  const max = params.get('max') ?? '';
  const sort = SORTS[params.get('sort')] ? params.get('sort') : 'featured';

  const { data, error, loading } = useAsync(fetchAllProducts, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [...params.keys()].filter((k) => k !== 'sort').length;

  const setOne = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const toggleMany = (key, value) => {
    const next = new URLSearchParams(params);
    const current = next.getAll(key);
    next.delete(key);
    (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]).forEach((v) => next.append(key, v));
    setParams(next, { replace: true });
  };

  const allBrands = useMemo(() => [...new Set((data ?? []).map((p) => p.brand).filter(Boolean))].sort(), [data]);
  const priceBounds = useMemo(() => {
    const prices = (data ?? []).map(discounted);
    return prices.length ? [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))] : [0, 0];
  }, [data]);

  const products = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const lo = min === '' ? -Infinity : Number(min);
    const hi = max === '' ? Infinity : Number(max);
    return data
      .filter((p) => !categories.length || categories.includes(p.category))
      .filter((p) => !types.length || types.some((t) => hasType(p, t)))
      .filter((p) => !brands.length || brands.includes(p.brand))
      .filter((p) => statuses.every((s) => STATUSES.find((x) => x.value === s)?.test(p) ?? true))
      .filter((p) => discounted(p) >= lo && discounted(p) <= hi)
      .filter((p) => !needle || `${p.title} ${p.description} ${p.brand ?? ''}`.toLowerCase().includes(needle))
      .sort(SORTS[sort].fn);
  }, [data, categories, types, brands, statuses, q, min, max, sort]);

  const title = q.trim()
    ? `Results for “${q.trim()}”`
    : sort === 'discount'
      ? 'Outlet'
      : types.length === 1
        ? typeName(types[0])
        : categories.length === 1
          ? categoryName(categories[0])
          : 'Products';

  return (
    <>
      <div className="container">
        <div className="page-banner">
          <nav className="page-banner__crumbs">
            <Link to="/">Home</Link> <span>|</span> <strong>{title}</strong>
          </nav>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="container shop">
        {/* Shown only on small screens, where the filter column collapses. */}
        <button type="button" className="filters-toggle" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
          <FilterIcon size={18} /> {filtersOpen ? 'Hide filters' : 'Show filters'}
          {activeFilters > 0 && <span className="filters-toggle__count">{activeFilters}</span>}
          {filtersOpen ? <ChevronUp /> : <ChevronDown />}
        </button>
        <aside className={`filters ${filtersOpen ? 'is-open' : ''}`}>
          <h2 className="filters__title"><FilterIcon size={20} /> Filter</h2>
          <div className="filters__search">
            <input className="input" type="search" placeholder="Search" value={q} onChange={(e) => setOne('q', e.target.value)} aria-label="Search products" />
            <SearchIcon size={18} />
          </div>

          <FilterBox title="Product categories" defaultOpen>
            {CATEGORIES.map((c) => (
              <label key={c.slug} className="check">
                <input type="checkbox" checked={categories.includes(c.slug)} onChange={() => toggleMany('category', c.slug)} />
                {c.name}
              </label>
            ))}
          </FilterBox>

          <FilterBox title="Product type" defaultOpen={types.length > 0}>
            {TYPES.map((t) => (
              <label key={t.slug} className="check">
                <input type="checkbox" checked={types.includes(t.slug)} onChange={() => toggleMany('type', t.slug)} />
                {t.name}
              </label>
            ))}
          </FilterBox>

          <FilterBox title="Brands">
            {allBrands.map((b) => (
              <label key={b} className="check">
                <input type="checkbox" checked={brands.includes(b)} onChange={() => toggleMany('brand', b)} />
                {b}
              </label>
            ))}
          </FilterBox>

          <FilterBox title="Product status">
            {STATUSES.map((s) => (
              <label key={s.value} className="check">
                <input type="checkbox" checked={statuses.includes(s.value)} onChange={() => toggleMany('status', s.value)} />
                {s.label}
              </label>
            ))}
          </FilterBox>

          <FilterBox title="Price" defaultOpen>
            <div className="price-range">
              <input className="input" type="number" min="0" placeholder={String(priceBounds[0])} value={min} onChange={(e) => setOne('min', e.target.value)} aria-label="Minimum price" />
              <input className="input" type="number" min="0" placeholder={String(priceBounds[1])} value={max} onChange={(e) => setOne('max', e.target.value)} aria-label="Maximum price" />
            </div>
          </FilterBox>

          {activeFilters > 0 && (
            <button type="button" className="link" onClick={() => setParams(sort === 'featured' ? {} : { sort }, { replace: true })}>
              Clear all filters
            </button>
          )}
        </aside>

        <div className="shop__main">
          <div className="shop__bar">
            <span className="muted">{loading ? 'Loading…' : `${products.length} products`}</span>
            <select className="input input--select" value={sort} onChange={(e) => setOne('sort', e.target.value === 'featured' ? '' : e.target.value)} aria-label="Sort by">
              {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
          </div>
          {loading && <SkeletonGrid count={6} />}
          {error && <ErrorState error={error} />}
          {!loading && !error && products.length === 0 && (
            <div className="status"><p>No products match these filters.</p></div>
          )}
          <div className="grid grid--3">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </div>
      </div>
    </>
  );
}

function FilterBox({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="filter-box">
      <button type="button" className="filter-box__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {title} {open ? <ChevronUp /> : <ChevronDown />}
      </button>
      {open && <div className="filter-box__body">{children}</div>}
    </div>
  );
}
