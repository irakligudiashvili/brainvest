import { motion } from 'motion/react';
import { FREE_SHIPPING_AT, money } from '../api';
import { EASE } from '../motion';

export default function FreeShippingBar({ subtotal }) {
  const pct = Math.min(1, subtotal / FREE_SHIPPING_AT);
  const done = pct >= 1;
  return (
    <div className="ship-bar">
      <p className="small">
        {done ? (
          <>🎉 You’ve unlocked <strong>free delivery</strong></>
        ) : (
          <>Spend <strong>{money(FREE_SHIPPING_AT - subtotal)}</strong> more for free delivery</>
        )}
      </p>
      <div className="ship-bar__track">
        <motion.div
          className={`ship-bar__fill ${done ? 'is-done' : ''}`}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct }}
          transition={{ duration: 0.9, ease: EASE }}
        />
      </div>
    </div>
  );
}
