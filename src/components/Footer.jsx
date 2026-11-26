import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import SplitText from './SplitText';
import Magnetic from './Magnetic';

export default function Footer() {
  const [joined, setJoined] = useState(false);

  return (
    <footer className="footer">
      <div className="container footer__top">
        <div className="footer__news">
          <h3>Slow news, good furniture.</h3>
          <p className="muted">New arrivals and the occasional story from the workshop. (Demo form.)</p>
          <AnimatePresence mode="wait" initial={false}>
            {joined ? (
              <motion.p key="thanks" className="footer__thanks" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                ✦ Thanks — you’re on the list.
              </motion.p>
            ) : (
              <motion.form
                key="form"
                className="footer__form"
                exit={{ opacity: 0, y: -10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  setJoined(true);
                }}
              >
                <input className="input input--dark" type="email" placeholder="you@example.com" required />
                <Magnetic>
                  <button className="btn btn--light" type="submit">Subscribe</button>
                </Magnetic>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
        <div className="footer__cols">
          <div>
            <h4>Shop</h4>
            <Link to="/shop">All products</Link>
            <Link to="/shop?category=furniture">Furniture</Link>
            <Link to="/shop?category=home-decoration">Home decor</Link>
          </div>
          <div>
            <h4>Help</h4>
            <Link to="/cart">Your cart</Link>
            <span>Delivery</span>
            <span>Returns</span>
          </div>
        </div>
      </div>

      <SplitText as="div" inView className="footer__wordmark" text="Hearth & *Oak*" stagger={0.1} />

      <div className="container footer__bottom small">
        <span>
          Product data &amp; images from{' '}
          <a href="https://dummyjson.com" target="_blank" rel="noreferrer">DummyJSON</a>.
        </span>
        <span>A design mockup — no real orders are placed.</span>
      </div>
    </footer>
  );
}
