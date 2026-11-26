import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useCart } from '../CartContext';
import { useUI } from '../UIContext';
import { money } from '../api';
import { AnimatedNumber } from './Numbers';
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

  return (
    <AnimatePresence>
      {drawerOpen && (
        <motion.div
          key="backdrop"
          className="drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        />
      )}
      {drawerOpen && (
        <motion.aside
          key="drawer"
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Shopping cart"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 36 }}
        >
          <div className="drawer__head">
            <h3>Your cart <span className="muted">({count})</span></h3>
            <motion.button className="icon-btn" onClick={close} whileHover={{ rotate: 90 }} aria-label="Close cart">
              ✕
            </motion.button>
          </div>

          {items.length > 0 && <FreeShippingBar subtotal={subtotal} />}

          <ul className="drawer__items">
            <AnimatePresence initial={false}>
              {items.map((i, idx) => (
                <motion.li
                  key={i.id}
                  layout
                  className="drawer-item"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0, transition: { delay: 0.08 + idx * 0.05 } }}
                  exit={{ opacity: 0, x: 80, transition: { duration: 0.25 } }}
                >
                  <Link to={`/product/${i.id}`}>
                    <img src={i.thumbnail} alt={i.title} />
                  </Link>
                  <div className="drawer-item__info">
                    <Link to={`/product/${i.id}`} className="card__title">{i.title}</Link>
                    <span className="muted small">{money(i.price)}</span>
                    <div className="qty qty--sm">
                      <button onClick={() => setQty(i.id, i.qty - 1)} aria-label="Decrease">−</button>
                      <span>{i.qty}</span>
                      <button onClick={() => setQty(i.id, i.qty + 1)} aria-label="Increase">+</button>
                    </div>
                  </div>
                  <button className="link small" onClick={() => remove(i.id)}>Remove</button>
                </motion.li>
              ))}
            </AnimatePresence>
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
                <AnimatedNumber value={subtotal} />
              </div>
              <Link to="/checkout" className="btn btn--lg btn--block">Checkout</Link>
              <Link to="/cart" className="link small center">View full cart</Link>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
