import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const WishlistContext = createContext(null);
const KEY = 'hearth-oak-wishlist';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

/** Saved product ids, persisted in localStorage. */
export function WishlistProvider({ children }) {
  const [ids, setIds] = useState(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(ids));
  }, [ids]);

  const value = useMemo(
    () => ({
      ids,
      has: (id) => ids.includes(id),
      toggle: (id) => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    }),
    [ids]
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used inside <WishlistProvider>');
  return ctx;
}
