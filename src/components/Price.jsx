import { discounted, money } from '../api';

export default function Price({ product, className = '' }) {
  const sale = product.discountPercentage >= 1;
  return (
    <div className={`price ${className}`}>
      {sale && <s>{money(product.price)}</s>}
      <strong>{money(discounted(product))}</strong>
    </div>
  );
}
