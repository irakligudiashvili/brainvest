import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchAllProducts } from '../api';
import { useAsync } from '../useAsync';
import HeroCarousel from '../components/home/HeroCarousel';
import Carousel from '../components/Carousel';
import DealCard from '../components/DealCard';
import ProductCard from '../components/ProductCard';
import { ArrowRight, CardIcon, PercentIcon, QuoteIcon, ShieldIcon, TruckIcon } from '../components/Icons';
import { ErrorState, SkeletonGrid } from '../components/Status';

// All copy on this page is original placeholder text for the staging mockup.
const ROOMS = [
  { label: 'Bedroom furniture', q: 'bedroom', pick: 'bed' },
  { label: 'Living room', q: 'living room', pick: 'sofa' },
  { label: 'Office chairs', q: 'office', pick: 'chair' },
  { label: 'Bedside tables', q: 'bedside', pick: 'bedside' },
  { label: 'Bathroom', q: 'bathroom', pick: 'sink' },
  { label: 'Lighting', q: 'lamp', pick: 'lamp' },
  { label: 'Plants & pots', q: 'plant', pick: 'plant pot' },
  { label: 'Photo frames', q: 'photo', pick: 'frame' },
];

const FEATURES = [
  { icon: ShieldIcon, title: '10-year frame warranty', text: 'Every frame we sell is covered for a decade.' },
  { icon: TruckIcon, title: 'Free delivery & assembly', text: 'On orders over $500, set up in your room.' },
  { icon: PercentIcon, title: 'Interest-free instalments', text: 'Split larger orders into monthly payments.' },
  { icon: CardIcon, title: 'Pay online in one step', text: 'A short, secure checkout with no account needed.' },
];

const REASONS = [
  { title: 'Wide range', text: 'Sofas, beds, storage and décor for every room, chosen to work together.' },
  { title: 'Considered design', text: 'Clean lines and practical details that suit both small flats and family homes.' },
  { title: 'Helpful service', text: 'Real people to help you measure, choose fabrics and plan your delivery.' },
  { title: 'Built to last', text: 'Solid frames, hard-wearing finishes and parts you can replace.' },
];

const POSTS = [
  { title: 'How to choose a sofa that fits your room', text: 'Measure the doorway first, then think about depth, seat height and how you actually sit.', pick: 'sofa' },
  { title: 'Five ways to make a small bedroom feel bigger', text: 'Raised legs, lighter finishes and storage that doubles as a bedside table all help.', pick: 'bedside' },
];

export default function Home() {
  const { data: products, error, loading } = useAsync(fetchAllProducts, []);
  const { hash } = useLocation();

  // Support /#about style links from the top bar and footer.
  useEffect(() => {
    if (!hash || !products) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash, products]);

  const find = (word) => products?.find((p) => p.title.toLowerCase().includes(word));
  const bestsellers = products ? [...products].sort((a, b) => b.rating - a.rating) : [];
  const deals = products ? [...products].sort((a, b) => b.discountPercentage - a.discountPercentage).slice(0, 10) : [];
  const newest = products ? [...products].sort((a, b) => b.id - a.id) : [];
  const mostViewed = products ? [...products].sort((a, b) => b.stock - a.stock).slice(0, 4) : [];
  const maxOff = deals[0] ? Math.round(deals[0].discountPercentage) : 20;

  const slides = [
    { tone: 'green', kicker: 'New season', title: 'Comfort for every corner of your home', text: 'Sofas, beds and storage made for everyday living.', cta: 'Shop living room', to: '/shop?q=living%20room', image: find('sofa')?.images[0] },
    { tone: 'light', kicker: 'Delivery & assembly', title: 'Free delivery on orders over $500', text: 'We bring it in, put it together and take the packaging away.', cta: 'Browse furniture', to: '/shop?category=furniture', image: find('bed')?.images[0] },
    { tone: 'lime', kicker: 'Outlet', title: `Up to ${maxOff}% off this week`, text: 'Selected pieces at their lowest price of the season.', cta: 'See the deals', to: '/shop?sort=discount', image: find('swing')?.images[0] },
  ];

  return (
    <>
      <HeroCarousel slides={slides} />

      <section className="container section intro-copy">
        <h2 className="title-xl upper">Furniture for <span className="accent">everyday</span> life</h2>
        <p className="lead">
          Browse by room or by piece — every category is chosen for comfort, durability and value.
        </p>
      </section>

      <section className="container section--tight" id="categories">
        <Carousel controls="arrows" label="Categories" className="carousel--cats">
          {ROOMS.map((r) => {
            const img = find(r.pick)?.thumbnail;
            return (
              <Link key={r.label} to={`/shop?q=${encodeURIComponent(r.q)}`} className="cat-tile">
                <div className="cat-tile__media">{img && <img src={img} alt="" loading="lazy" />}</div>
                <h3>{r.label}</h3>
                <span className="more-link">Details <ArrowRight size={16} /></span>
              </Link>
            );
          })}
        </Carousel>
      </section>

      <section className="band">
        <div className="container section">
          <div className="split-head">
            <h2 className="title-xl">Bestselling <span className="accent">models</span></h2>
            <p className="split-head__text">The pieces our customers rate highest for comfort, build and value.</p>
          </div>
          {loading && <SkeletonGrid count={4} />}
          {error && <ErrorState error={error} />}
          {products && (
            <Carousel controls="dots" label="Bestsellers" className="carousel--cards">
              {bestsellers.map((p) => <ProductCard key={p.id} product={p} />)}
            </Carousel>
          )}
        </div>
      </section>

      <section className="container section">
        <div className="features">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <div className="feature__icon"><f.icon size={30} /></div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <span className="feature__swoosh" aria-hidden="true" />
            </div>
          ))}
        </div>
      </section>

      <section className="container section about" id="about">
        <div className="about__copy">
          <h2 className="title-xl">Everything for your home, <span className="accent">in one place</span></h2>
          <p className="lead">
            From the sofa you sink into every evening to the lamp on your bedside table, we put
            practical design and durable materials first — so your rooms stay comfortable for years.
          </p>
          <Link to="/shop" className="about__arrow" aria-label="Shop all products">
            <ArrowRight size={110} strokeWidth={0.9} />
          </Link>
        </div>
        <div className="about__mosaic">
          <div className="mosaic__img mosaic__img--a">{find('sofa') && <img src={find('sofa').images[1]} alt="" loading="lazy" />}</div>
          <a href="#top10" className="mosaic__tile mosaic__tile--a">
            <strong>Top 10 deals</strong>
            <span>Our biggest discounts this week</span>
          </a>
          <Link to="/shop" className="mosaic__tile mosaic__tile--b">
            <strong>Shop online</strong>
            <span>Order from home in a few clicks</span>
          </Link>
          <div className="mosaic__img mosaic__img--b">{find('lamp') && <img src={find('lamp').images[0]} alt="" loading="lazy" />}</div>
        </div>
      </section>

      <section className="band">
        <div className="container section">
          <div className="split-head">
            <h2 className="title-xl">New <span className="accent">arrivals</span></h2>
            <p className="split-head__text">Recently added pieces for modern, easy-going interiors.</p>
          </div>
          {products && (
            <div className="arrivals">
              <div className="arrivals__media">
                {find('swing') && <img src={find('swing').images[1] ?? find('swing').images[0]} alt="" loading="lazy" />}
              </div>
              <Carousel controls="arrows" label="New arrivals" className="carousel--arrivals">
                {newest.map((p) => <ProductCard key={p.id} product={p} />)}
              </Carousel>
            </div>
          )}
        </div>
      </section>

      <section className="container section" id="top10">
        <h2 className="title-xl upper">Top 10 <span className="accent">deals</span></h2>
        {products && (
          <Carousel controls="dots" label="Top deals" className="carousel--deals">
            {deals.map((p) => <DealCard key={p.id} product={p} />)}
          </Carousel>
        )}
      </section>

      <section className="container section">
        <h2 className="title-xl upper center-text">Most <span className="accent">viewed</span></h2>
        <div className="grid grid--4">
          {mostViewed.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      <section className="container section--tight">
        <div className="banner">
          <span className="hero__kicker">Nationwide delivery</span>
          <h2>We deliver and assemble across the country</h2>
          <p>Choose a delivery slot at checkout and we’ll handle the rest. (Demo banner.)</p>
        </div>
      </section>

      <section className="container section">
        <h2 className="title-xl upper center-text">Why choose <span className="accent">Hearth &amp; Oak</span></h2>
        <Carousel controls="arrows" label="Why choose us" className="carousel--reasons">
          {REASONS.map((r) => (
            <div key={r.title} className="reason">
              <QuoteIcon size={22} className="reason__q" />
              <p>{r.text}</p>
              <h3>{r.title}</h3>
            </div>
          ))}
        </Carousel>
      </section>

      <section className="band" id="blog">
        <div className="container section blog">
          <div className="blog__list">
            <div className="blog__head">
              <h2 className="title-xl">Blog</h2>
              <p>Ideas and news from our team</p>
              <span className="more-link more-link--dark">Read all <ArrowRight size={18} /></span>
            </div>
            {POSTS.map((post) => (
              <article key={post.title} className="post">
                <div className="post__thumb">{find(post.pick) && <img src={find(post.pick).thumbnail} alt="" loading="lazy" />}</div>
                <div>
                  <h3>{post.title}</h3>
                  <p>{post.text}</p>
                  <span className="post__more">Details</span>
                </div>
              </article>
            ))}
          </div>
          <div className="blog__feature">
            {find('sofa') && <img src={find('sofa').images[2] ?? find('sofa').images[0]} alt="" loading="lazy" />}
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="stores">
          <span className="stores__kicker">Across the country</span>
          <h2>Showrooms</h2>
          <p>Visit a showroom to try pieces in person. (Demo — no real locations.)</p>
        </div>
      </section>
    </>
  );
}
