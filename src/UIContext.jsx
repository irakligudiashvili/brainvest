import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';

// UI-only state shared across the app: the cart drawer and the
// "fly to cart" animation (an image that arcs from a product to the cart icon).
const UIContext = createContext(null);
let uid = 0;

export function UIProvider({ children }) {
  const cartTargetRef = useRef(null);
  const [flyers, setFlyers] = useState([]);
  const [bump, setBump] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fly = useCallback((fromEl, src) => {
    const target = cartTargetRef.current;
    if (!fromEl || !target) {
      setBump((b) => b + 1);
      return;
    }
    const a = fromEl.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    // The header may be scrolled out of view; aim for where the icon sits when it's shown.
    const headerTop = target.closest('header')?.getBoundingClientRect().top ?? 0;
    const size = Math.max(56, Math.min(a.width, a.height, 180));
    setFlyers((f) => [
      ...f,
      {
        id: ++uid,
        src,
        size,
        from: { x: a.left + a.width / 2 - size / 2, y: a.top + a.height / 2 - size / 2 },
        to: { x: b.left + b.width / 2 - size / 2, y: b.top - headerTop + b.height / 2 - size / 2 },
      },
    ]);
  }, []);

  const land = useCallback((id) => {
    setFlyers((f) => f.filter((x) => x.id !== id));
    setBump((b) => b + 1);
  }, []);

  const value = useMemo(
    () => ({ fly, cartTargetRef, bump, flying: flyers.length > 0, drawerOpen, setDrawerOpen }),
    [fly, bump, flyers.length, drawerOpen]
  );

  return (
    <UIContext.Provider value={value}>
      {children}
      <div className="flyers" aria-hidden="true">
        {flyers.map((f) => (
          <motion.img
            key={f.id}
            src={f.src}
            alt=""
            className="flyer"
            style={{ width: f.size, height: f.size }}
            initial={{ x: f.from.x, y: f.from.y, scale: 1, rotate: 0 }}
            animate={{ x: f.to.x, y: f.to.y, scale: 28 / f.size, rotate: 30 }}
            transition={{
              duration: 0.9,
              x: { duration: 0.9, ease: [0.45, 0, 0.25, 1] },
              y: { duration: 0.9, ease: [0.6, -0.45, 0.7, 1] }, // dips first, then shoots up: an arc
              scale: { duration: 0.9, ease: [0.55, 0, 0.8, 0.3] },
            }}
            onAnimationComplete={() => land(f.id)}
          />
        ))}
      </div>
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside <UIProvider>');
  return ctx;
}
