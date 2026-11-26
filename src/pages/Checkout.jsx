import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useCart } from '../CartContext';
import { money, shippingFor } from '../api';
import { EASE } from '../motion';
import SplitText from '../components/SplitText';

const field = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export default function Checkout() {
  const { items, subtotal, clear } = useCart();
  const [order, setOrder] = useState(null);
  const shipping = shippingFor(subtotal);

  if (order) return <Success order={order} />;

  if (!items.length) {
    return (
      <div className="container section status">
        <SplitText text="Nothing to *check out*" />
        <Link to="/shop" className="btn">Go to shop</Link>
      </div>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setOrder({
      name: String(form.get('name')).trim().split(' ')[0],
      number: Math.floor(100000 + Math.random() * 900000),
      total: subtotal + shipping,
    });
    clear();
  };

  return (
    <div className="container section">
      <SplitText text="*Checkout*" />
      <div className="cart">
        <motion.form
          className="form"
          onSubmit={submit}
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } } }}
        >
          <motion.h3 variants={field}>Delivery details</motion.h3>
          <motion.label variants={field}>Full name<input className="input" name="name" required autoComplete="name" /></motion.label>
          <motion.label variants={field}>Email<input className="input" name="email" type="email" required autoComplete="email" /></motion.label>
          <motion.label variants={field}>Address<input className="input" name="address" required autoComplete="street-address" /></motion.label>
          <motion.div variants={field} className="form__row">
            <label>City<input className="input" name="city" required autoComplete="address-level2" /></label>
            <label>Postcode<input className="input" name="zip" required autoComplete="postal-code" /></label>
          </motion.div>
          <motion.h3 variants={field}>Payment</motion.h3>
          <motion.p variants={field} className="muted small">Demo store — no payment details are collected.</motion.p>
          <motion.button variants={field} className="btn btn--lg btn--block" type="submit" whileTap={{ scale: 0.98 }}>
            Place order · {money(subtotal + shipping)}
          </motion.button>
        </motion.form>

        <motion.aside
          className="summary"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
        >
          <h3>Order summary</h3>
          {items.map((i) => (
            <div key={i.id} className="summary__row summary__item">
              <img src={i.thumbnail} alt="" />
              <span>{i.qty} × {i.title}</span>
              <span>{money(i.price * i.qty)}</span>
            </div>
          ))}
          <div className="summary__row"><span>Delivery</span><span>{shipping ? money(shipping) : 'Free'}</span></div>
          <div className="summary__row summary__total">
            <span>Total</span><span>{money(subtotal + shipping)}</span>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ['#b0582f', '#5d6448', '#d29a2b', '#1d1b18'];

function Success({ order }) {
  return (
    <div className="container section status success">
      <div className="success__mark">
        {Array.from({ length: 28 }, (_, i) => {
          const angle = (i / 28) * Math.PI * 2;
          const dist = 110 + (i % 4) * 35;
          return (
            <motion.span
              key={i}
              className="confetti"
              style={{ background: CONFETTI_COLORS[i % 4], borderRadius: i % 3 ? 2 : '50%' }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
              animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 1, rotate: 540 }}
              transition={{ duration: 1.6, ease: EASE, delay: 0.55 }}
            />
          );
        })}
        <svg width="104" height="104" viewBox="0 0 52 52">
          <motion.circle
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.7, ease: EASE }}
          />
          <motion.path
            d="M15 27 l7 7 l15 -15"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.5 }}
          />
        </svg>
      </div>
      <SplitText text={`Thank you, *${order.name}!*`} delay={0.6} />
      <motion.p className="lead" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>
        Order <strong>#{order.number}</strong> for {money(order.total)} has been placed.
      </motion.p>
      <motion.p className="muted small" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }}>
        (This is a mockup — nothing was actually charged or shipped.)
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }}>
        <Link to="/shop" className="btn">Keep shopping</Link>
      </motion.div>
    </div>
  );
}
