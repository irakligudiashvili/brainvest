import { Children, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';

/**
 * Scroll-snap carousel with page dots and/or round arrow buttons.
 * Paging jumps instantly (no smooth scrolling). `controls`: 'dots' | 'arrows' | 'both'.
 */
export default function Carousel({ children, controls = 'dots', className = '', label }) {
  const ref = useRef(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const count = Children.count(children);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const total = Math.max(1, Math.ceil((el.scrollWidth - 8) / el.clientWidth));
    setPages(total);
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    setPage(atEnd ? total - 1 : Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  useEffect(() => {
    const el = ref.current;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update, count]);

  const go = (i) => {
    const el = ref.current;
    el.scrollTo({ left: Math.max(0, Math.min(i, pages - 1)) * el.clientWidth, behavior: 'instant' });
  };

  const showDots = controls === 'dots' || controls === 'both';
  const showArrows = controls === 'arrows' || controls === 'both';

  return (
    <div className={`carousel ${className}`} role="region" aria-label={label}>
      <div className="carousel__track" ref={ref}>{children}</div>
      {pages > 1 && (
        <div className="carousel__controls">
          {/* Arrows always render; when this carousel uses dots, they are shown on small screens only. */}
          <button type="button" className={`round-btn ${showArrows ? '' : 'carousel__arrow--mobile'}`} onClick={() => go(page - 1)} disabled={page === 0} aria-label="Previous">
            <ChevronLeft />
          </button>
          {showDots && (
            <div className="dots">
              {Array.from({ length: pages }, (_, i) => (
                <button key={i} type="button" className={`dots__dot ${i === page ? 'is-active' : ''}`} onClick={() => go(i)} aria-label={`Page ${i + 1}`} />
              ))}
            </div>
          )}
          <span className="carousel__count" aria-live="polite">{page + 1} / {pages}</span>
          <button type="button" className={`round-btn ${showArrows ? '' : 'carousel__arrow--mobile'}`} onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label="Next">
            <ChevronRight />
          </button>
        </div>
      )}
    </div>
  );
}
