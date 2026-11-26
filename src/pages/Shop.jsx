import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CATEGORIES, categoryName, discounted, fetchAllProducts } from '../api';
import { useAsync } from '../useAsync';
import ProductCard from '../components/ProductCard';
import SplitText from '../components/SplitText';
import { ErrorState, SkeletonGrid } from '../components/Status';

const SORTS = {
  featured: { label: 'Featured', fn: () => 0 },
  'price-asc': { label: 'Price: low to high', fn: (a, b) => discounted(a) - discounted(b) },
  'price-desc': { label: 'Price: high to low', fn: (a, b) => discounted(b) - discounted(a) },
  rating: { label: 'Top rated', fn: (a, b) => b.rating - a.rating },
};

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const sort = SORTS[params.get('sort')] ? params.get('sort') : 'featured';
  const q = params.get('q') ?? '';

  const { data, error, loading } = useAsync(fetchAllProducts, []);

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const products = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data
      .filter((p) => !category || p.category === category)
      .filter(
        (p) =>
          !needle ||
          p.title.toLowerCase().includes(needle) ||
          p.description.toLowerCase().includes(needle) ||
          (p.brand ?? '').toLowerCase().includes(needle)
      )
      .sort(SORTS[sort].fn);
  }, [data, category, q, sort]);

  const title = category ? `*${categoryName(category)}*` : 'All *products*';
  const chips = [{ slug: '', name: 'All' }, ...CATEGORIES];

  return (
    <div className="container section">
      <div className="page-head">
        <SplitText key={title} text={title} />
        <AnimatePresence mode="wait">
          <motion.p
            key={products.length}
            className="muted"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {loading ? '…' : `${products.length} items`}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="toolbar">
        <div className="chips">
          {chips.map((c) => {
            const active = category === c.slug;
            return (
              <button
                key={c.slug || 'all'}
                className={`chip ${active ? 'is-active' : ''}`}
                onClick={() => update('category', c.slug)}
              >
                {active && (
                  <motion.span
                    layoutId="chip-pill"
                    className="chip__pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="chip__label">{c.name}</span>
              </button>
            );
          })}
        </div>
        <div className="toolbar__right">
          <input
            type="search"
            className="input"
            placeholder="Search…"
            value={q}
            onChange={(e) => update('q', e.target.value)}
          />
          <select className="input" value={sort} onChange={(e) => update('sort', e.target.value)}>
            {Object.entries(SORTS).map(([key, s]) => (
              <option key={key} value={key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <SkeletonGrid />}
      {error && <ErrorState error={error} />}
      <AnimatePresence>
        {!loading && !error && products.length === 0 && (
          <motion.div className="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p>No products match your search.</p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="grid">
        <AnimatePresence mode="popLayout">
          {products.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </AnimatePresence>
      </div>
    </div>
  );
}
