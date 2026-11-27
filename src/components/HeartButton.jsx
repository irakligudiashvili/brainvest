import { useWishlist } from '../WishlistContext';
import { HeartIcon } from './Icons';

export default function HeartButton({ id, className = '' }) {
  const { has, toggle } = useWishlist();
  const saved = has(id);
  return (
    <button
      type="button"
      className={`heart ${saved ? 'is-saved' : ''} ${className}`}
      onClick={() => toggle(id)}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'}
    >
      <HeartIcon size={22} filled={saved} />
    </button>
  );
}
