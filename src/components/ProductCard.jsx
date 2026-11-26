import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useCart } from '../CartContext';
import { useUI } from '../UIContext';
import { discounted, money } from '../api';
import { EASE } from '../motion';
import Rating from './Rating';

const TILT = { stiffness: 260, damping: 22 };

export default function ProductCard({ product, index = 0, ref }) {
  const { add } = useCart();
  const { fly } = useUI();
  const imgRef = useRef(null);
  const [added, setAdded] = useState(false);

  // Pointer position over the card, -0.5 … 0.5 on each axis.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [7, -7]), TILT);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-7, 7]), TILT);
  const imgX = useSpring(useTransform(px, [-0.5, 0.5], [-14, 14]), TILT);
  const imgY = useSpring(useTransform(py, [-0.5, 0.5], [-14, 14]), TILT);
  const glareX = useTransform(px, [-0.5, 0.5], ['0%', '100%']);
  const glareY = useTransform(py, [-0.5, 0.5], ['0%', '100%']);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.55), transparent 55%)`;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

  const handleAdd = () => {
    fly(imgRef.current, product.thumbnail);
    add(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  };

  const sale = product.discountPercentage >= 1;

  return (
    <motion.article
      ref={ref}
      layout
      className="card"
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-5% 0px' }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
      transition={{
        default: { duration: 0.8, ease: EASE, delay: (index % 4) * 0.08 },
        layout: { duration: 0.55, ease: EASE },
      }}
    >
      <motion.div
        className="card__inner"
        style={{ rotateX, rotateY, transformPerspective: 900 }}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        <Link to={`/product/${product.id}`} className="card__media" data-cursor="View">
          <motion.img
            ref={imgRef}
            src={product.thumbnail}
            alt={product.title}
            loading="lazy"
            style={{ x: imgX, y: imgY }}
          />
          <motion.span className="card__glare" style={{ background: glare }} />
          {sale && <span className="tag">-{Math.round(product.discountPercentage)}%</span>}
        </Link>
        <div className="card__body">
          {product.brand && <div className="eyebrow">{product.brand}</div>}
          <Link to={`/product/${product.id}`} className="card__title">{product.title}</Link>
          <Rating value={product.rating} />
          <div className="card__footer">
            <div className="price">
              {money(discounted(product))}
              {sale && <s>{money(product.price)}</s>}
            </div>
            <motion.button className="btn btn--small" whileTap={{ scale: 0.9 }} onClick={handleAdd}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={added ? 'added' : 'add'}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {added ? 'Added ✓' : 'Add'}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.article>
  );
}
