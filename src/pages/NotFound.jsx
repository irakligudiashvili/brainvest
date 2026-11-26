import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import SplitText from '../components/SplitText';

export default function NotFound() {
  return (
    <div className="container section status">
      <motion.div
        className="notfound__num"
        animate={{ rotate: [0, -4, 4, 0], y: [0, -10, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        404
      </motion.div>
      <SplitText text="This room is *empty.*" />
      <Link to="/" className="btn">Back home</Link>
    </div>
  );
}
