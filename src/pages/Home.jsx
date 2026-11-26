import { Link } from 'react-router-dom';
import { CATEGORIES, fetchAllProducts } from '../api';
import { useAsync } from '../useAsync';
import Hero from '../components/home/Hero';
import Showcase from '../components/home/Showcase';
import Marquee from '../components/Marquee';
import Magnetic from '../components/Magnetic';
import ParallaxImage from '../components/ParallaxImage';
import ProductCard from '../components/ProductCard';
import Reveal from '../components/Reveal';
import RotatingBadge from '../components/RotatingBadge';
import SplitText from '../components/SplitText';
import { CountUp } from '../components/Numbers';
import { ErrorState, SkeletonGrid } from '../components/Status';

export default function Home() {
  const { data: products, error, loading } = useAsync(fetchAllProducts, []);

  const find = (word) => products?.find((p) => p.title.toLowerCase().includes(word));
  const heroProduct = find('sofa') ?? products?.[0];
  const floatProduct = find('chair') ?? products?.[1];
  const featured = products ? [...products].sort((a, b) => b.rating - a.rating).slice(0, 4) : [];

  return (
    <>
      <Hero hero={heroProduct} floater={floatProduct} />

      <Marquee items={['Sofas', 'Beds', 'Lighting', 'Chairs', 'Mirrors', 'Décor', 'Tables']} />

      <section className="container section">
        <div className="section__head">
          <SplitText as="h2" inView text="Shop by *category*" />
          <Reveal><Link to="/shop" className="link-arrow">Everything <span>→</span></Link></Reveal>
        </div>
        <div className="categories">
          {CATEGORIES.map((c, i) => {
            const sample = products?.find((p) => p.category === c.slug);
            return (
              <Reveal key={c.slug} delay={i * 0.12}>
                <Link to={`/shop?category=${c.slug}`} className="category" data-cursor="Explore">
                  {sample && <img src={sample.images[0]} alt="" loading="lazy" />}
                  <div className="category__label">
                    <span className="category__num">0{i + 1}</span>
                    <h3>{c.name}</h3>
                    <span className="muted small">{c.blurb}</span>
                  </div>
                  <span className="category__arrow">→</span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {products && <Showcase products={products} />}

      <section className="container section editorial">
        <div className="editorial__media">
          <ParallaxImage className="editorial__img editorial__img--lg" src={find('bed')?.images[0]} strength={10} />
          <ParallaxImage className="editorial__img editorial__img--sm" src={find('swing')?.images[0] ?? find('lamp')?.images[0]} strength={18} />
        </div>
        <div className="editorial__copy">
          <Reveal className="eyebrow">Our approach</Reveal>
          <SplitText as="h2" inView text="Designed for real life, *built* for the long haul." />
          <Reveal as="p" className="lead" delay={0.15}>
            We work with small workshops and long-standing makers, choosing solid materials and honest
            joinery over trends. Every piece is meant to be used, moved, sat on and loved for years.
          </Reveal>
          <Reveal delay={0.25}>
            <Link to="/shop?category=furniture" className="link-arrow">Explore furniture <span>→</span></Link>
          </Reveal>
        </div>
      </section>

      <section className="stats">
        <div className="container stats__inner">
          {[
            { to: 12480, label: 'Homes furnished' },
            { to: 38, label: 'Partner workshops' },
            { to: 100, label: 'Night home trial' },
            { to: 10, suffix: ' yr', label: 'Frame warranty' },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 0.1} className="stat">
              <strong><CountUp to={s.to} decimals={s.decimals} suffix={s.suffix} /></strong>
              <span>{s.label}</span>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="container section">
        <div className="section__head">
          <SplitText as="h2" inView text="Customer *favourites*" />
          <Reveal><Link to="/shop?sort=rating" className="link-arrow">View all <span>→</span></Link></Reveal>
        </div>
        {loading && <SkeletonGrid count={4} />}
        {error && <ErrorState error={error} />}
        <div className="grid">
          {featured.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
        </div>
      </section>

      <section className="cta">
        <div className="container cta__inner">
          <RotatingBadge className="cta__badge" text="Free delivery over $500 • 100 night trial • ">✦</RotatingBadge>
          <SplitText as="h2" inView className="cta__title" text="Make room for something *good.*" />
          <Reveal delay={0.3}>
            <Magnetic strength={0.4}>
              <Link to="/shop" className="btn btn--light btn--xl">Shop now <span className="btn__arrow">→</span></Link>
            </Magnetic>
          </Reveal>
        </div>
      </section>
    </>
  );
}
