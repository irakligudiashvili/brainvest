import { Link } from 'react-router-dom';
import { Logo } from './Header';

export default function Footer() {
  return (
    <footer className="footer" id="contact">
      <div className="container footer__grid">
        <div className="footer__brand">
          <Logo light />
          <p>
            Ebawood brings well-made, comfortable furniture to every room — practical design,
            honest materials and pieces built to be lived with.
          </p>
        </div>
        <div className="footer__col">
          <h4>Company</h4>
          <Link to="/#about">About us</Link>
          <span>FAQ</span>
          <Link to="/#blog">Blog</Link>
          <Link to="/#contact">Contact</Link>
        </div>
        <div className="footer__col">
          <h4>Customer information</h4>
          <span>Warranty policy</span>
          <span>Privacy policy</span>
          <span>Instalment terms</span>
          <span>Terms &amp; conditions</span>
        </div>
        <div className="footer__col">
          <h4>Contact</h4>
          <span>Mon–Sat, 10:00–20:00</span>
          <span>hello@example.com</span>
          <span>Demo store — no real address</span>
        </div>
      </div>
      <div className="container footer__bottom">
        <span>All rights reserved · Ebawood © 2026</span>
        <span>
          Product data &amp; images from{' '}
          <a href="https://dummyjson.com" target="_blank" rel="noreferrer">DummyJSON</a>. Staging mockup — no real orders.
        </span>
      </div>
    </footer>
  );
}
