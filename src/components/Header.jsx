import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../CartContext';
import { useUI } from '../UIContext';
import { useWishlist } from '../WishlistContext';
import { NAV } from '../api';
import { CartIcon, ChevronDown, ClockIcon, GlobeIcon, HeartIcon, SearchIcon, StarIcon, StoreIcon, UserIcon } from './Icons';

export default function Header() {
  return (
    <>
      <TopBar />
      <header className="header">
        <div className="container header__main">
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
    </>
  );
}

export function Logo({ light = false }) {
  return (
    <Link to="/" className={`logo ${light ? 'logo--light' : ''}`} aria-label="Hearth & Oak home">
      hearth<span className="logo__amp">&amp;</span><span className="logo__oak">oak</span>
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
