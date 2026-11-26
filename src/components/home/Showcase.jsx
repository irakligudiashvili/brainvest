import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionValue, useScroll, useSpring, useTransform } from 'motion/react';
import { discounted, money } from '../../api';
import SplitText from '../SplitText';

/**
 * Pinned section: vertical scrolling drives a horizontal strip of products.
 * The section is exactly as tall as the strip is wide (plus one screen),
 * so the strip reaches its end just as the section scrolls away.
 */
export default function Showcase({ products }) {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const distance = useMotionValue(0);
  const [height, setHeight] = useState('300vh');

  useLayoutEffect(() => {
    const measure = () => {
      const d = Math.max(0, trackRef.current.scrollWidth - window.innerWidth);
      distance.set(d);
      setHeight(`${window.innerHeight + d}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(trackRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [distance, products.length]);

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });
  const rawX = useTransform(() => -scrollYProgress.get() * distance.get());
  const x = useSpring(rawX, { stiffness: 160, damping: 32, mass: 0.35 });

  return (
    <section ref={sectionRef} className="showcase" style={{ height }}>
      <div className="showcase__sticky">
        <motion.div ref={trackRef} className="showcase__track" style={{ x }}>
          <div className="showcase__intro">
            <div className="eyebrow">The collection</div>
            <SplitText as="h2" inView text="Made for *living,* not just looking." />
            <p className="muted">Keep scrolling to browse every piece →</p>
          </div>
          {products.map((p, i) => (
            <Link key={p.id} to={`/product/${p.id}`} className="panel" data-cursor="View">
              <div className="panel__media">
                <img src={p.images[0]} alt={p.title} loading="lazy" />
              </div>
              <div className="panel__meta">
                <span className="panel__index">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{p.title}</h3>
                  <span className="muted">{money(discounted(p))}</span>
                </div>
              </div>
            </Link>
          ))}
        </motion.div>
        <div className="showcase__progress">
          <motion.div style={{ scaleX: scrollYProgress }} />
        </div>
      </div>
    </section>
  );
}
