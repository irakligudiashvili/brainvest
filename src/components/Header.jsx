import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../CartContext';
import { useUI } from '../UIContext';
import { useWishlist } from '../WishlistContext';
import { NAV } from '../api';
import { CartIcon, ChevronDown, ChevronUp, ClockIcon, CloseIcon, MenuIcon, GlobeIcon, HeartIcon, SearchIcon, StarIcon, StoreIcon, UserIcon } from './Icons';

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  return (
    <>
      <TopBar />
      <header className="header">
        <div className="container header__main">
          {/* Hamburger: shown only on small screens, where the category bar is hidden. */}
          <button type="button" className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}>
            <MenuIcon size={24} />
          </button>
          <Logo />
          <SearchBox />
          <div className="header__pills">
            <Link to="/shop?sort=discount" className="pill-btn"><StoreIcon size={18} /> Outlet</Link>
            <Link to="/shop?sort=rating" className="pill-btn"><StarIcon size={18} /> Bestsellers</Link>
          </div>
          <HeaderActions />
        </div>
        <div className="container">
          <CategoryBar />
        </div>
      </header>
      <MobileMenu open={menuOpen} onClose={closeMenu} />
    </>
  );
}

const EXTRA_LINKS = [
  { label: 'Bestsellers', to: '/shop?sort=rating' },
  { label: 'All products', to: '/shop' },
  { label: 'About us', to: '/#about' },
  { label: 'Contact', to: '/#contact' },
  { label: 'Wishlist', to: '/wishlist' },
];

/** Slide-in navigation for small screens: the category bar's links, with sub-menus as accordions. */
function MobileMenu({ open, onClose }) {
  const [expanded, setExpanded] = useState(null);
  const { pathname, search, hash } = useLocation();

  // Close whenever the route changes.
  useEffect(() => {
    onClose();
  }, [pathname, search, hash, onClose]);

  // Esc to close + lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <nav className="mnav" aria-label="Main menu">
        <div className="mnav__head">
          <Logo />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu"><CloseIcon size={20} /></button>
        </div>
        <ul className="mnav__list">
          {NAV.map((item, i) => (
            <li key={item.label} className="mnav__item">
              <div className="mnav__row">
                <Link to={item.to} className="mnav__link" onClick={onClose}>{item.label}</Link>
                {item.children && (
                  <button type="button" className="mnav__toggle" onClick={() => setExpanded(expanded === i ? null : i)} aria-expanded={expanded === i} aria-label={`Show ${item.label} sections`}>
                    {expanded === i ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                )}
              </div>
              {expanded === i && item.children && (
                <ul className="mnav__sub">
                  {item.children.map((c) => (
                    <li key={c.label}><Link to={c.to} onClick={onClose}>{c.label}</Link></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <ul className="mnav__extra">
          {EXTRA_LINKS.map((l) => (
            <li key={l.label}><Link to={l.to} onClick={onClose}>{l.label}</Link></li>
          ))}
        </ul>
        <div className="mnav__foot">
          <span><ClockIcon size={16} /> Mon–Sat 10:00–20:00</span>
          <span>Free delivery &amp; assembly over $500</span>
        </div>
      </nav>
    </>
  );
}

export function Logo({ light = false }) {
  return (
    <Link to="/" className={`logo ${light ? 'logo--light' : ''}`} aria-label="Ebawood home">
      Eba<span className="logo__amp"></span><span className="logo__oak">wood</span>
    </Link>
  );
}

function TopBar() {
  return (
    <div className="topbar">
      <div className="container topbar__inner">
        <span className="topbar__note">Free delivery &amp; assembly over $500</span>
        <nav className="topbar__links">
          <Link to="/#about">About us</Link>
          <Link to="/#categories">Categories</Link>
          <Link to="/shop">Products</Link>
          <Link to="/shop?sort=discount">Deals</Link>
          <Link to="/#contact">Contact</Link>
        </nav>
        <div className="topbar__meta">
          <span><ClockIcon size={16} /> Mon–Sat 10:00–20:00</span>
          <span><GlobeIcon size={16} /> EN</span>
        </div>
      </div>
    </div>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const current = pathname === '/shop' ? new URLSearchParams(search).get('q') ?? '' : '';
  const [q, setQ] = useState(current);
  const [lastCurrent, setLastCurrent] = useState(current);
  // Keep the box in sync when the URL's search term changes elsewhere.
  if (current !== lastCurrent) {
    setLastCurrent(current);
    setQ(current);
  }

  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/shop?${new URLSearchParams({ q: term })}` : '/shop');
  };

  return (
    <form className="searchbox" onSubmit={submit} role="search">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" />
      <button type="submit" aria-label="Search"><SearchIcon /></button>
    </form>
  );
}

function HeaderActions() {
  const { count } = useCart();
  const { ids } = useWishlist();
  const { setDrawerOpen } = useUI();

  return (
    <div className="header__actions">
      <Link to="/wishlist" className="action">
        <span className="action__icon">
          <HeartIcon size={22} />
          {ids.length > 0 && <span className="badge-count">{ids.length}</span>}
        </span>
        <span className="action__label">Wishlist</span>
      </Link>
      <span className="action action--disabled" title="Accounts are not available in this demo">
        <span className="action__icon"><UserIcon size={22} /></span>
        <span className="action__label">Sign in</span>
      </span>
      <button className="cart-btn" onClick={() => setDrawerOpen(true)} aria-label={`Open cart, ${count} items`}>
        <CartIcon size={22} />
        {count > 0 && <span className="badge-count">{count}</span>}
      </button>
    </div>
  );
}

function CategoryBar() {
  const [open, setOpen] = useState(null);
  const { pathname, search } = useLocation();
  const here = pathname + search;

  return (
    <nav className="catbar" onMouseLeave={() => setOpen(null)}>
      {NAV.map((item, i) => (
        <div key={item.label} className="catbar__item" onMouseEnter={() => setOpen(item.children ? i : null)}>
          <Link to={item.to} className={`catbar__link ${here === item.to ? 'is-active' : ''}`} onClick={() => setOpen(null)}>
            {item.label}
            {item.children && <ChevronDown />}
          </Link>
          {open === i && item.children && (
            <div className="dropdown">
              {item.children.map((c) => (
                <Link key={c.label} to={c.to} onClick={() => setOpen(null)}>{c.label}</Link>
              ))}
              <Link to={item.to} className="dropdown__all" onClick={() => setOpen(null)}>
                View all {item.label.toLowerCase()} →
              </Link>
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
