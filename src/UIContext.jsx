import { createContext, useContext, useMemo, useState } from 'react';

// UI-only state shared across the app: whether the cart drawer is open.
const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const value = useMemo(() => ({ drawerOpen, setDrawerOpen }), [drawerOpen]);
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside <UIProvider>');
  return ctx;
}
