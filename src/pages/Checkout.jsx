import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../CartContext';
import { money, shippingFor } from '../api';
import { CheckCircle } from '../components/Icons';

export default function Checkout() {
  const { items, subtotal, clear } = useCart();
  const [order, setOrder] = useState(null);
  const shipping = shippingFor(subtotal);

  if (order) {
    return (
      <div className="container section status success">
        <CheckCircle size={88} className="success__mark" />
        <h1>Thank you, <span className="accent">{order.name}!</span></h1>
        <p className="lead">Order <strong>#{order.number}</strong> for {money(order.total)} has been placed.</p>
        <p className="muted small">(This is a staging mockup — nothing was charged or shipped.)</p>
        <Link to="/shop" className="btn">Keep shopping</Link>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="container section status">
        <h1>Nothing to check out</h1>
        <Link to="/shop" className="btn">Go to shop</Link>
      </div>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setOrder({
      name: String(form.get('name')).trim().split(' ')[0],
      number: Math.floor(100000 + Math.random() * 900000),
      total: subtotal + shipping,
    });
    clear();
  };

  return (
    <div className="container section">
      <h1 className="title-xl">Checkout</h1>
      <div className="cart">
        <form className="form" onSubmit={submit}>
          <h3>Delivery details</h3>
          <label>Full name<input className="input" name="name" required autoComplete="name" /></label>
          <label>Email<input className="input" name="email" type="email" required autoComplete="email" /></label>
          <label>Address<input className="input" name="address" required autoComplete="street-address" /></label>
          <div className="form__row">
            <label>City<input className="input" name="city" required autoComplete="address-level2" /></label>
            <label>Postcode<input className="input" name="zip" required autoComplete="postal-code" /></label>
          </div>
          <h3>Payment</h3>
          <p className="muted small">Staging mockup — no payment details are collected.</p>
          <button className="btn btn--lg btn--block" type="submit">Place order · {money(subtotal + shipping)}</button>
        </form>

        <aside className="summary">
          <h3>Order summary</h3>
          {items.map((i) => (
            <div key={i.id} className="summary__row summary__item">
              <img src={i.thumbnail} alt="" />
              <span>{i.qty} × {i.title}</span>
              <span>{money(i.price * i.qty)}</span>
            </div>
          ))}
          <div className="summary__row"><span>Delivery</span><span>{shipping ? money(shipping) : 'Free'}</span></div>
          <div className="summary__row summary__total"><span>Total</span><span>{money(subtotal + shipping)}</span></div>
        </aside>
      </div>
    </div>
  );
}
