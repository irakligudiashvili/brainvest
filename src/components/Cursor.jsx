import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react';

/**
 * A soft follower dot that grows into a labelled bubble over anything with
 * a data-cursor="Label" attribute. Mouse/trackpad only — off on touch screens.
 */
export default function Cursor() {
  const [enabled] = useState(() => window.matchMedia('(pointer: fine)').matches);
  const [label, setLabel] = useState(null);
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const spring = { stiffness: 600, damping: 45, mass: 0.5 };
  const sx = useSpring(x, spring);
  const sy = useSpring(y, spring);

  useEffect(() => {
    if (!enabled) return;
    const show = (v) => {
      if (visibleRef.current !== v) {
        visibleRef.current = v;
        setVisible(v);
      }
    };
    const move = (e) => {
      x.set(e.clientX);
      y.set(e.clientY);
      show(true);
    };
    const over = (e) => setLabel(e.target.closest?.('[data-cursor]')?.dataset.cursor ?? null);
    const leave = () => show(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerover', over);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerover', over);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, [enabled, x, y]);

  if (!enabled) return null;

  return (
    <motion.div className="cursor" style={{ x: sx, y: sy }} aria-hidden="true">
      <motion.div
        className={`cursor__dot ${label ? 'has-label' : ''}`}
        animate={{ width: label ? 88 : 12, height: label ? 88 : 12, opacity: visible ? 1 : 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        <AnimatePresence>
          {label && (
            <motion.span
              key={label}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
