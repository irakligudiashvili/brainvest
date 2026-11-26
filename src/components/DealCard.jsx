import { Link } from 'react-router-dom';
import AddToCart from './AddToCart';
import HeartButton from './HeartButton';
import Price from './Price';

/** Wide "Top 10" card: image left, details right, red discount badges. */
export default function DealCard({ product }) {
  const pct = Math.round(product.discountPercentage);
  return (
    <article className="deal">
      {pct >= 1 && <span className="sale-dot sale-dot--lg">{pct}</span>}
      <Link to={`/product/${product.id}`} className="deal__media">
        <img src={product.thumbnail} alt={product.title} loading="lazy" />
      </Link>
      <div className="deal__body">
        <div className="deal__top">
          <Link to={`/product/${product.id}`} className="deal__title">{product.title}</Link>
          <HeartButton id={product.id} />
        </div>
        {pct >= 1 && <span className="deal__tag">{pct}% off this week</span>}
        <Price product={product} className="deal__price" />
        <AddToCart product={product} />
      </div>
    </article>
  );
}
