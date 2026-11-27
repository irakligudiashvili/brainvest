import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from '../Icons';

/**
 * Rounded banner slider with arrows outside the frame and dash pagination.
 * No autoplay and no transitions, so screenshots and tests are deterministic.
 */
export default function HeroCarousel({ slides }) {
  const [index, setIndex] = useState(0);
  const n = slides.length;
  const go = (i) => setIndex((i + n) % n);
  const slide = slides[index];

  // Swipe left/right on touch screens (horizontal moves of 40px+ only, so vertical scrolling still works).
  const touch = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <section className="hero container">
      <button type="button" className="hero__arrow hero__arrow--prev" onClick={() => go(index - 1)} aria-label="Previous slide">
        <ArrowLeft />
      </button>

      <div className="hero__frame" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className={`hero__slide hero__slide--${slide.tone}`}>
          <div className="hero__copy">
            <span className="hero__kicker">{slide.kicker}</span>
            <h1>{slide.title}</h1>
            <p>{slide.text}</p>
            <Link to={slide.to} className="btn btn--lg">{slide.cta} <ArrowRight size={18} /></Link>
          </div>
          {slide.image && <img className="hero__img" src={slide.image} alt="" />}
        </div>
        <div className="hero__dashes">
          {slides.map((s, i) => (
            <button key={s.title} type="button" className={`hero__dash ${i === index ? 'is-active' : ''}`} onClick={() => go(i)} aria-label={`Slide ${i + 1}`} />
          ))}
        </div>
      </div>

      <button type="button" className="hero__arrow hero__arrow--next" onClick={() => go(index + 1)} aria-label="Next slide">
        <ArrowRight />
      </button>
    </section>
  );
}
