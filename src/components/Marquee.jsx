import { motion, useScroll, useSpring, useTransform, useVelocity } from 'motion/react';

/** Endless ticker that leans in the direction you scroll, harder the faster you go. */
export default function Marquee({ items, duration = 35, className = '' }) {
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const skewX = useSpring(useTransform(velocity, [-2500, 2500], [10, -10]), { stiffness: 200, damping: 40 });

  // Two identical halves: sliding by -50% lands exactly where it started.
  const half = [...items, ...items];
  return (
    <div className={`marquee ${className}`} aria-hidden="true">
      <motion.div
        className="marquee__track"
        style={{ skewX }}
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration, ease: 'linear', repeat: Infinity }}
      >
        {[...half, ...half].map((t, i) => (
          <span key={i} className="marquee__item">
            {t}
            <span className="marquee__star">✦</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}
