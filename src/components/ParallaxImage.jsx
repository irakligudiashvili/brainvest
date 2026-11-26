import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { EASE_IN_OUT } from '../motion';

/** Image that wipes into view, then drifts against the scroll inside its frame. */
export default function ParallaxImage({ src, alt = '', className = '', strength = 12 }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [`-${strength}%`, `${strength}%`]);

  return (
    <motion.div
      ref={ref}
      className={`parallax ${className}`}
      initial={{ clipPath: 'inset(100% 0% 0% 0%)' }}
      whileInView={{ clipPath: 'inset(0% 0% 0% 0%)' }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: 1.3, ease: EASE_IN_OUT }}
    >
      {src && <motion.img src={src} alt={alt} loading="lazy" style={{ y, scale: 1 + strength / 40 }} />}
    </motion.div>
  );
}
