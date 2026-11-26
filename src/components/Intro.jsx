import { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { fetchAllProducts } from '../api';
import { EASE_IN_OUT } from '../motion';
import SplitText from './SplitText';

/** First-visit loader: wordmark reveal + counter, then a curtain wipes up. */
export default function Intro({ onDone }) {
  const count = useMotionValue(0);
  const label = useTransform(count, (v) => String(Math.round(v)).padStart(3, '0'));
  const scaleX = useTransform(count, [0, 100], [0, 1]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    fetchAllProducts().catch(() => {}); // warm the cache while the intro plays
    let timer;
    const controls = animate(count, 100, {
      duration: 1.7,
      ease: [0.65, 0, 0.35, 1],
      onComplete: () => {
        timer = setTimeout(() => doneRef.current(), 250);
      },
    });
    return () => {
      controls.stop();
      clearTimeout(timer);
    };
  }, [count]);

  return (
    <motion.div
      className="intro"
      initial={{ clipPath: 'inset(0% 0% 0% 0%)' }}
      exit={{ clipPath: 'inset(0% 0% 100% 0%)', transition: { duration: 1, ease: EASE_IN_OUT } }}
    >
      <SplitText as="div" className="intro__logo" text="Hearth & *Oak*" stagger={0.12} delay={0.15} />
      <div className="intro__bar">
        <motion.div style={{ scaleX }} />
      </div>
      <motion.span className="intro__count">{label}</motion.span>
    </motion.div>
  );
}
