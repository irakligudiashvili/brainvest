import { Link } from 'react-router-dom';
import { fetchAllProducts } from '../api';
import { useAsync } from '../useAsync';
import { useWishlist } from '../WishlistContext';
import ProductCard from '../components/ProductCard';
import { ErrorState, SkeletonGrid } from '../components/Status';

export default function Wishlist() {
  const { ids } = useWishlist();
  const { data, error, loading } = useAsync(fetchAllProducts, []);
  const saved = (data ?? []).filter((p) => ids.includes(p.id));

  return (
    <div className="container section">
      <div className="page-head">
        <h1 className="title-xl">Your <span className="accent">wishlist</span></h1>
        <p className="muted">{ids.length} saved</p>
      </div>
      {loading && ids.length > 0 && <SkeletonGrid count={Math.min(ids.length, 4)} />}
      {error && <ErrorState error={error} />}
      {!loading && saved.length === 0 && (
        <div className="status">
          <p>Nothing saved yet. Tap the heart on any product to keep it here.</p>
          <Link to="/shop" className="btn">Browse products</Link>
        </div>
      )}
      <div className="grid grid--4">
        {saved.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
