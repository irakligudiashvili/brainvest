import { useId } from 'react';
import { motion } from 'motion/react';

/** Circular text badge that slowly spins. */
export default function RotatingBadge({ text = 'Crafted to last • Free delivery • Est. 2026 • ', className = '', children = '✦' }) {
  const id = useId();
  return (
    <div className={`badge ${className}`}>
      <motion.svg
        viewBox="0 0 200 200"
        animate={{ rotate: 360 }}
        transition={{ duration: 22, ease: 'linear', repeat: Infinity }}
      >
        <defs>
          <path id={id} d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" />
        </defs>
        <text>
          <textPath href={`#${id}`} textLength="488" lengthAdjust="spacing">
            {text}
          </textPath>
        </text>
      </motion.svg>
      <span className="badge__center">{children}</span>
    </div>
  );
}
