import { Fragment } from 'react';
import { motion } from 'motion/react';
import { EASE } from '../motion';

const word = {
  hidden: { y: '115%', rotate: 5 },
  show: { y: '0%', rotate: 0, transition: { duration: 1, ease: EASE } },
};

/**
 * Headline whose words slide up from behind a mask, one after another.
 * Wrap a word in *asterisks* to set it in the italic accent style.
 * `inView` waits until it scrolls into view; otherwise it plays on mount.
 */
export default function SplitText({ text, as = 'h1', className = '', delay = 0, stagger = 0.07, inView = false }) {
  const Tag = motion[as];
  const trigger = inView
    ? { whileInView: 'show', viewport: { once: true, margin: '-10% 0px' } }
    : { animate: 'show' };

  return (
    <Tag
      className={className}
      aria-label={text.replaceAll('*', '')}
      initial="hidden"
      {...trigger}
      variants={{ show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {text.split(' ').map((w, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="split" aria-hidden="true">
            <motion.span className={`split__inner${w.startsWith('*') ? ' accent-word' : ''}`} variants={word}>
              {w.replaceAll('*', '')}
            </motion.span>
          </span>
        </Fragment>
      ))}
    </Tag>
  );
}
