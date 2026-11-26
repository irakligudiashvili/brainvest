import { motion } from 'motion/react';
import { EASE } from '../motion';

/** Route wrapper: fades/lifts pages in, and out before the next one arrives. */
export default function Page({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } }}
      exit={{ opacity: 0, y: -16, transition: { duration: 0.3, ease: 'easeIn' } }}
    >
      {children}
    </motion.div>
  );
}
