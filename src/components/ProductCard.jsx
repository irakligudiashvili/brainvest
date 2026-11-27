import { Link } from 'react-router-dom';
import HeartButton from './HeartButton';
import Price from './Price';

/** Grid card: one square corner, the rest rounded; heart in the top right. */
export default function ProductCard({ product }) {
  const pct = Math.round(product.discountPercentage);
  return (
    <article className="pcard">
      <HeartButton id={product.id} className="pcard__heart" />
      {pct >= 10 && <span className="sale-dot">-{pct}%</span>}
      <Link to={`/product/${product.id}`} className="pcard__media">
        <img src={product.thumbnail} alt={product.title} loading="lazy" />
      </Link>
      <div className="pcard__body">
        <Link to={`/product/${product.id}`} className="pcard__title">{product.title}</Link>
        <Price product={product} />
      </div>
    </article>
  );
}
