import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { categoryName, discounted, fetchCategory, fetchProduct, money } from '../api';
import { useAsync } from '../useAsync';
import AddToCart from '../components/AddToCart';
import HeartButton from '../components/HeartButton';
import ProductCard from '../components/ProductCard';
import Rating from '../components/Rating';
import { ChevronDown, ChevronUp } from '../components/Icons';
import { ErrorState, Loading } from '../components/Status';

export default function ProductPage() {
  const { id } = useParams();
  // Keyed so gallery/qty state resets when navigating between products.
  return <ProductDetail key={id} id={id} />;
}

function ProductDetail({ id }) {
  const { data: p, error, loading } = useAsync(() => fetchProduct(id), [id]);
  const [qty, setQty] = useState(1);
  const [image, setImage] = useState(0);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;

  const images = p.images.length ? p.images : [p.thumbnail];
  const sale = p.discountPercentage >= 1;
  const specs = [
    p.dimensions && ['Dimensions', `${p.dimensions.width} W × ${p.dimensions.height} H × ${p.dimensions.depth} D cm`],
    p.weight != null && ['Weight', `${p.weight} kg`],
    p.sku && ['SKU', p.sku],
    p.brand && ['Brand', p.brand],
  ].filter(Boolean);
  const delivery = [
    p.shippingInformation && ['Shipping', p.shippingInformation],
    p.warrantyInformation && ['Warranty', p.warrantyInformation],
    p.returnPolicy && ['Returns', p.returnPolicy],
  ].filter(Boolean);

  return (
    <div className="container section">
      <nav className="breadcrumbs">
        <Link to="/">Home</Link> | <Link to="/shop">Products</Link> |{' '}
        <Link to={`/shop?category=${p.category}`}>{categoryName(p.category)}</Link> | <strong>{p.title}</strong>
      </nav>

      <div className="product">
        <div className="gallery">
          <div className="gallery__main">
            <img src={images[image]} alt={p.title} />
          </div>
          {images.length > 1 && (
            <div className="gallery__thumbs">
              {images.map((src, i) => (
                <button key={src} type="button" className={i === image ? 'is-active' : ''} onClick={() => setImage(i)} aria-label={`Show image ${i + 1}`}>
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="product__info">
          {p.brand && <div className="eyebrow">{p.brand}</div>}
          <h1 className="product__title">{p.title}</h1>
          <Rating value={p.rating} count={p.reviews?.length} />
          <div className="price price--lg">
            {sale && <s>{money(p.price)}</s>}
            <strong>{money(discounted(p))}</strong>
            {sale && <span className="tag">-{Math.round(p.discountPercentage)}%</span>}
          </div>
          <p className="lead">{p.description}</p>
          <div className={`stock ${p.stock > 10 ? 'ok' : 'low'}`}>● {p.availabilityStatus} · {p.stock} available</div>

          <div className="buy">
            <div className="qty">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button>
              <span>{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(p.stock || 99, q + 1))} aria-label="Increase">+</button>
            </div>
            <AddToCart product={p} qty={qty} label={`Add to cart · ${money(discounted(p) * qty)}`} className="btn--lg btn--grow" />
            <HeartButton id={p.id} className="heart--boxed" />
          </div>

          <Accordion sections={[{ title: 'Specifications', rows: specs }, { title: 'Delivery & returns', rows: delivery }].filter((s) => s.rows.length)} />
        </div>
      </div>

      {p.reviews?.length > 0 && (
        <section className="section">
          <h2 className="title-xl">Customer <span className="accent">reviews</span></h2>
          <div className="reviews">
            {p.reviews.map((r, i) => (
              <div key={i} className="review">
                <Rating value={r.rating} />
                <p>“{r.comment}”</p>
                <div className="muted small">{r.reviewerName} · {new Date(r.date).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Related category={p.category} excludeId={p.id} />
    </div>
  );
}

function Accordion({ sections }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="accordion">
      {sections.map((s, i) => (
        <div key={s.title} className="accordion__item">
          <button type="button" className="accordion__head" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            {s.title} {open === i ? <ChevronUp /> : <ChevronDown />}
          </button>
          {open === i && (
            <dl className="specs">
              {s.rows.map(([k, v]) => (
                <div key={k} className="specs__row"><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          )}
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
      <h2 className="title-xl">You may also <span className="accent">like</span></h2>
      <div className="grid grid--4">
        {items.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}
