import { useEffect, useState } from 'react';
import { useCart } from '../CartContext';
import { BagIcon } from './Icons';

/** Lime "Add to cart" pill; shows "Added" briefly after a click. */
export default function AddToCart({ product, qty = 1, label = 'Add to cart', className = '' }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1500);
    return () => clearTimeout(t);
  }, [added]);

  return (
    <button
      type="button"
      className={`btn add-btn ${className}`}
      onClick={() => {
        add(product, qty);
        setAdded(true);
      }}
    >
      {added ? '✓ Added' : (<><BagIcon size={18} /> {label}</>)}
    </button>
  );
}
