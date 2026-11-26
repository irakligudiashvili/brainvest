import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useCart } from '../CartContext';
import { money, shippingFor } from '../api';
import { EASE } from '../motion';
import { AnimatedNumber } from '../components/Numbers';
import FreeShippingBar from '../components/FreeShippingBar';
import SplitText from '../components/SplitText';

export default function Cart() {
  const { items, setQty, remove, subtotal } = useCart();
  const shipping = shippingFor(subtotal);

  if (!items.length) {
    return (
      <div className="container section status">
        <SplitText text="Your cart is *empty*" />
        <p className="muted">Find something you love.</p>
        <Link to="/shop" className="btn">Start shopping</Link>
      </div>
    );
  }

  return (
    <div className="container section">
      <SplitText text="Your *cart*" />
      <div className="cart">
        <ul className="cart__items">
          <AnimatePresence initial={false}>
            {items.map((i, idx) => (
              <motion.li
                key={i.id}
                layout
                className="cart-item"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, delay: idx * 0.06 } }}
                exit={{ opacity: 0, x: -60, transition: { duration: 0.3 } }}
              >
                <Link to={`/product/${i.id}`}><img src={i.thumbnail} alt={i.title} /></Link>
                <div className="cart-item__info">
                  <Link to={`/product/${i.id}`} className="card__title">{i.title}</Link>
                  <div className="muted">{money(i.price)} each</div>
                  <button className="link small" onClick={() => remove(i.id)}>Remove</button>
                </div>
                <div className="qty">
                  <button onClick={() => setQty(i.id, i.qty - 1)} aria-label="Decrease">−</button>
                  <span>{i.qty}</span>
                  <button onClick={() => setQty(i.id, i.qty + 1)} aria-label="Increase">+</button>
                </div>
                <div className="cart-item__total"><AnimatedNumber value={i.price * i.qty} /></div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        <motion.aside
          className="summary"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
        >
          <h3>Order summary</h3>
          <FreeShippingBar subtotal={subtotal} />
          <div className="summary__row"><span>Subtotal</span><AnimatedNumber value={subtotal} /></div>
          <div className="summary__row">
            <span>Delivery</span><span>{shipping ? money(shipping) : 'Free'}</span>
          </div>
          <div className="summary__row summary__total">
            <span>Total</span><AnimatedNumber value={subtotal + shipping} />
          </div>
          <Link to="/checkout" className="btn btn--lg btn--block">Checkout</Link>
          <Link to="/shop" className="link small center">Continue shopping</Link>
        </motion.aside>
      </div>
    </div>
  );
}
