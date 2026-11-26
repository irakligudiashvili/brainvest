import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'motion/react';
import { discounted, money } from '../../api';
import { EASE, EASE_IN_OUT } from '../../motion';
import SplitText from '../SplitText';
import Magnetic from '../Magnetic';
import RotatingBadge from '../RotatingBadge';

const fadeUp = (delay) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, ease: EASE, delay },
});

const ARCH = 'round 999px 999px 28px 28px';

export default function Hero({ hero, floater }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const imgY = useTransform(scrollYProgress, [0, 1], ['0%', '20%']);
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -140]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const floatY = useTransform(scrollYProgress, [0, 1], [0, -220]);

  return (
    <section className="hero" ref={ref}>
      <motion.div
        className="hero__blob"
        aria-hidden="true"
        animate={{
          scale: [1, 1.15, 0.95, 1],
          rotate: [0, 25, -10, 0],
          borderRadius: ['42% 58% 60% 40%', '58% 42% 38% 62%', '50% 50% 62% 38%', '42% 58% 60% 40%'],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="container hero__inner">
        <motion.div className="hero__copy" style={{ y: copyY, opacity: copyOpacity }}>
          <motion.div className="eyebrow" {...fadeUp(0.2)}>Autumn / Winter 2026 Collection</motion.div>
          <SplitText className="hero__title" text="Pieces that make a house feel like *home.*" delay={0.3} />
          <motion.p className="lead" {...fadeUp(0.9)}>
            Thoughtfully made furniture and décor, chosen for comfort, craft and the long haul.
          </motion.p>
          <motion.div className="hero__actions" {...fadeUp(1.05)}>
            <Magnetic>
              <Link to="/shop" className="btn btn--lg">
                Shop the collection <span className="btn__arrow">→</span>
              </Link>
            </Magnetic>
            <Magnetic>
              <Link to="/shop?category=home-decoration" className="btn btn--ghost btn--lg">Browse décor</Link>
            </Magnetic>
          </motion.div>
          <motion.div className="hero__proof" {...fadeUp(1.2)}>
            <span className="hero__stars">★★★★★</span>
            <span><strong>4.8/5</strong> from 2,300+ happy homes</span>
          </motion.div>
        </motion.div>

        <div className="hero__visual">
          <motion.div
            className="hero__arch"
            data-cursor="Shop"
            initial={{ clipPath: `inset(100% 0% 0% 0% ${ARCH})` }}
            animate={{ clipPath: `inset(0% 0% 0% 0% ${ARCH})` }}
            transition={{ duration: 1.5, ease: EASE_IN_OUT, delay: 0.15 }}
          >
            {hero && (
              <Link to={`/product/${hero.id}`} aria-label={hero.title}>
                <motion.img
                  src={hero.images[0]}
                  alt={hero.title}
                  style={{ y: imgY }}
                  initial={{ scale: 1.4 }}
                  animate={{ scale: 1.15 }}
                  transition={{ duration: 2, ease: EASE, delay: 0.15 }}
                />
              </Link>
            )}
          </motion.div>

          <motion.div
            className="hero__badge"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 1.1 }}
          >
            <RotatingBadge>↓</RotatingBadge>
          </motion.div>

          {floater && (
            <motion.div className="hero__float" style={{ y: floatY }}>
              <motion.div {...fadeUp(1.35)}>
                <motion.div animate={{ y: [0, -12, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}>
                  <Link to={`/product/${floater.id}`} className="float-card" data-cursor="View">
                    <img src={floater.thumbnail} alt="" />
                    <div>
                      <span className="eyebrow">Bestseller</span>
                      <strong>{floater.title}</strong>
                      <span className="muted small">{money(discounted(floater))}</span>
                    </div>
                  </Link>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </div>
      </div>

      <motion.div className="hero__scroll" {...fadeUp(1.6)}>
        <span>Scroll</span>
        <span className="hero__scroll-line">
          <motion.span
            animate={{ y: ['-100%', '100%'] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }}
          />
        </span>
      </motion.div>
    </section>
  );
}
