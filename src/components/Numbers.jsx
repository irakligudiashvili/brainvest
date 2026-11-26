import { useEffect, useRef } from 'react';
import { animate, motion, useInView, useMotionValue, useSpring, useTransform } from 'motion/react';
import { money } from '../api';

/** A number that glides to its new value whenever it changes (cart totals). */
export function AnimatedNumber({ value, format = money }) {
  const spring = useSpring(value, { stiffness: 140, damping: 22 });
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  const text = useTransform(spring, (v) => format(v));
  return <motion.span>{text}</motion.span>;
}

/** Counts up from zero the first time it scrolls into view. */
export function CountUp({ to, decimals = 0, suffix = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const mv = useMotionValue(0);
  const text = useTransform(
    mv,
    (v) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix
  );

  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, to, { duration: 2, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [inView, mv, to]);

  return <motion.span ref={ref}>{text}</motion.span>;
}
