import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { categoryName, discounted, fetchCategory, fetchProduct, money } from '../api';
import { useAsync } from '../useAsync';
import { useCart } from '../CartContext';
import { useUI } from '../UIContext';
import { EASE } from '../motion';
import ProductCard from '../components/ProductCard';
import Rating from '../components/Rating';
import Reveal from '../components/Reveal';
import SplitText from '../components/SplitText';
import { ErrorState, Loading } from '../components/Status';

const list = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } };
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export default function ProductPage() {
  const { id } = useParams();
  // Keyed so gallery/qty state resets when navigating between products.
  return <ProductDetail key={id} id={id} />;
}

function ProductDetail({ id }) {
  const { data: p, error, loading } = useAsync(() => fetchProduct(id), [id]);
  const { add } = useCart();
  const { fly } = useUI();
  const mediaRef = useRef(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;

  const sale = p.discountPercentage >= 1;
  const handleAdd = () => {
    fly(mediaRef.current, p.thumbnail);
    add(p, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  const specs = [
    p.dimensions && ['Dimensions', `${p.dimensions.width} W × ${p.dimensions.height} H × ${p.dimensions.depth} D cm`],
    p.weight != null && ['Weight', `${p.weight} kg`],
    p.sku && ['SKU', p.sku],
    p.brand && ['Maker', p.brand],
  ].filter(Boolean);
  const delivery = [
    p.shippingInformation && ['Shipping', p.shippingInformation],
    p.warrantyInformation && ['Warranty', p.warrantyInformation],
    p.returnPolicy && ['Returns', p.returnPolicy],
  ].filter(Boolean);

  return (
    <div className="container section">
      <motion.nav className="breadcrumbs" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Link to="/shop">Shop</Link> /{' '}
        <Link to={`/shop?category=${p.category}`}>{categoryName(p.category)}</Link> /{' '}
        <span>{p.title}</span>
      </motion.nav>

      <div className="product">
        <Gallery product={p} mediaRef={mediaRef} />

        <motion.div className="product__info" variants={list} initial="hidden" animate="show">
          {p.brand && <motion.div variants={item} className="eyebrow">{p.brand}</motion.div>}
          <SplitText className="product__title" text={p.title} stagger={0.05} />
          <motion.div variants={item}>
            <Rating value={p.rating} count={p.reviews?.length} />
          </motion.div>
          <motion.div variants={item} className="price price--lg">
            {money(discounted(p))}
            {sale && <s>{money(p.price)}</s>}
            {sale && <span className="tag tag--inline">Save {Math.round(p.discountPercentage)}%</span>}
          </motion.div>
          <motion.p variants={item} className="lead">{p.description}</motion.p>

          <motion.div variants={item} className={`stock ${p.stock > 10 ? 'ok' : 'low'}`}>
            <span className="stock__dot" /> {p.availabilityStatus} · {p.stock} available
          </motion.div>

          <motion.div variants={item} className="buy">
            <div className="qty">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={qty}
                  initial={{ y: -14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 14, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {qty}
                </motion.span>
              </AnimatePresence>
              <button onClick={() => setQty((q) => Math.min(p.stock || 99, q + 1))} aria-label="Increase">+</button>
            </div>
            <motion.button className="btn btn--lg btn--grow" onClick={handleAdd} whileTap={{ scale: 0.97 }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={added ? 'added' : 'add'}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {added ? '✓ Added to cart' : `Add to cart · ${money(discounted(p) * qty)}`}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </motion.div>

          <motion.div variants={item}>
            <Accordion
              sections={[
                { title: 'Specifications', rows: specs },
                { title: 'Delivery & returns', rows: delivery },
              ].filter((s) => s.rows.length)}
            />
          </motion.div>
        </motion.div>
      </div>

      {p.reviews?.length > 0 && (
        <section className="section">
          <SplitText as="h2" inView text="What people *say*" />
          <div className="reviews">
            {p.reviews.map((r, i) => (
              <Reveal key={i} className="review" delay={i * 0.1}>
                <Rating value={r.rating} />
                <p>“{r.comment}”</p>
                <div className="muted small">
                  {r.reviewerName} · {new Date(r.date).toLocaleDateString()}
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <Related category={p.category} excludeId={p.id} />
    </div>
  );
}

function Gallery({ product, mediaRef }) {
  const images = product.images.length ? product.images : [product.thumbnail];
  const [[index, dir], setState] = useState([0, 0]);
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');

  const go = (i) => setState([i, i > index ? 1 : -1]);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
  };

  return (
    <motion.div
      className="gallery"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.9, ease: EASE }}
    >
      <div
        ref={mediaRef}
        className="gallery__main"
        onPointerEnter={() => setZoom(true)}
        onPointerLeave={() => setZoom(false)}
        onPointerMove={onMove}
      >
        <motion.div
          className="gallery__zoom"
          animate={{ scale: zoom ? 1.7 : 1 }}
          style={{ transformOrigin: origin }}
          transition={{ type: 'spring', stiffness: 200, damping: 30 }}
        >
          <AnimatePresence initial={false} custom={dir}>
            <motion.img
              key={index}
              src={images[index]}
              alt={product.title}
              custom={dir}
              variants={{
                enter: (d) => ({ opacity: 0, x: d * 80 }),
                center: { opacity: 1, x: 0 },
                exit: (d) => ({ opacity: 0, x: d * -80 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.6, ease: EASE }}
            />
          </AnimatePresence>
        </motion.div>
        <span className="gallery__hint small">Hover to zoom</span>
      </div>

      {images.length > 1 && (
        <div className="gallery__thumbs">
          {images.map((src, i) => (
            <motion.button
              key={src}
              onClick={() => go(i)}
              whileHover={{ y: -3 }}
              aria-label={`Show image ${i + 1}`}
            >
              {i === index && <motion.span layoutId="thumb-ring" className="gallery__ring" />}
              <img src={src} alt="" />
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function Accordion({ sections }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="accordion">
      {sections.map((s, i) => (
        <div key={s.title} className="accordion__item">
          <button className="accordion__head" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            {s.title}
            <motion.span animate={{ rotate: open === i ? 45 : 0 }} transition={{ duration: 0.3 }}>+</motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div
                key="body"
                className="accordion__body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <dl className="specs">
                  {s.rows.map(([k, v]) => (
                    <div key={k} className="specs__row">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function Related({ category, excludeId }) {
  const { data } = useAsync(() => fetchCategory(category), [category]);
  const items = (data ?? []).filter((p) => p.id !== excludeId).slice(0, 4);
  if (!items.length) return null;
  return (
    <section className="section">
      <SplitText as="h2" inView text="You may also *like*" />
      <div className="grid">
        {items.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
      </div>
    </section>
  );
}
