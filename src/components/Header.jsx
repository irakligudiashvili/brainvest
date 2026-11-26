import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react';
import { useCart } from '../CartContext';
import { useUI } from '../UIContext';
import { EASE } from '../motion';

export default function Header() {
  const { count } = useCart();
  const { cartTargetRef, bump, flying, drawerOpen, setDrawerOpen } = useUI();
  const { pathname, search } = useLocation();
  const category = new URLSearchParams(search).get('category');

  // Hide on scroll down, reveal on scroll up.
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(y > prev && y > 160);
    setScrolled(y > 10);
  });

  const onShop = pathname === '/shop';
  const links = [
    { to: '/', label: 'Home', active: pathname === '/' },
    { to: '/shop', label: 'Shop all', active: onShop && !category },
    { to: '/shop?category=furniture', label: 'Furniture', active: onShop && category === 'furniture' },
    { to: '/shop?category=home-decoration', label: 'Decor', active: onShop && category === 'home-decoration' },
  ];
  const [hovered, setHovered] = useState(null);
  const pillAt = hovered ?? links.findIndex((l) => l.active);

  return (
    <motion.header
      className={`header ${scrolled ? 'is-scrolled' : ''}`}
      animate={{ y: hidden && !flying && !drawerOpen ? '-100%' : '0%' }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <div className="container header__inner">
        <Link to="/" className="logo">
          Hearth <span>&amp;</span> Oak
        </Link>

        <nav className="nav" onPointerLeave={() => setHovered(null)}>
          {links.map((l, i) => (
            <Link
              key={l.to}
              to={l.to}
              className={l.active ? 'is-active' : ''}
              onPointerEnter={() => setHovered(i)}
            >
              {pillAt === i && (
                <motion.span
                  layoutId="nav-pill"
                  className="nav__pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="nav__label">{l.label}</span>
            </Link>
          ))}
        </nav>

        <motion.button
          ref={cartTargetRef}
          className="cart-link"
          onClick={() => setDrawerOpen(true)}
          whileTap={{ scale: 0.88 }}
          aria-label={`Open cart, ${count} items`}
        >
          <motion.svg
            key={bump}
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            initial={bump ? { rotate: 0 } : false}
            animate={{ rotate: [0, -14, 12, -6, 0] }}
            transition={{ duration: 0.6 }}
          >
            <path d="M6 7h12l-1 13H7L6 7Z" />
            <path d="M9 7a3 3 0 0 1 6 0" />
          </motion.svg>
          <AnimatePresence>
            {count > 0 && (
              <motion.span
                className="cart-badge"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              >
                <motion.span
                  key={`${bump}-${count}`}
                  initial={{ scale: 1.9 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                >
                  {count}
                </motion.span>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </motion.header>
  );
}
