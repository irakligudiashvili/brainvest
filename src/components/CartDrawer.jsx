import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCart } from '../CartContext';
import { useUI } from '../UIContext';
import { money } from '../api';
import FreeShippingBar from './FreeShippingBar';

export default function CartDrawer() {
  const { drawerOpen, setDrawerOpen } = useUI();
  const { items, setQty, remove, subtotal, count } = useCart();
  const { pathname, search } = useLocation();
  const close = () => setDrawerOpen(false);

  // Close whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, search, setDrawerOpen]);

  // Esc to close + lock page scroll while open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Shopping cart">
        <div className="drawer__head">
          <h3>Your cart <span className="muted">({count})</span></h3>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close cart">✕</button>
        </div>

        {items.length > 0 && <FreeShippingBar subtotal={subtotal} />}

        <ul className="drawer__items">
          {items.map((i) => (
            <li key={i.id} className="drawer-item">
              <Link to={`/product/${i.id}`}><img src={i.thumbnail} alt={i.title} /></Link>
              <div className="drawer-item__info">
                <Link to={`/product/${i.id}`} className="card__title">{i.title}</Link>
                <span className="muted small">{money(i.price)}</span>
                <div className="qty qty--sm">
                  <button type="button" onClick={() => setQty(i.id, i.qty - 1)} aria-label="Decrease">−</button>
                  <span>{i.qty}</span>
                  <button type="button" onClick={() => setQty(i.id, i.qty + 1)} aria-label="Increase">+</button>
                </div>
              </div>
              <button type="button" className="link small" onClick={() => remove(i.id)}>Remove</button>
            </li>
          ))}
        </ul>

        {items.length === 0 ? (
          <div className="drawer__empty">
            <p className="muted">Your cart is empty.</p>
            <Link to="/shop" className="btn">Start shopping</Link>
          </div>
        ) : (
          <div className="drawer__foot">
            <div className="summary__row summary__total">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <Link to="/checkout" className="btn btn--lg btn--block">Checkout</Link>
            <Link to="/cart" className="link small center">View full cart</Link>
          </div>
        )}
      </aside>
    </>
  );
}
