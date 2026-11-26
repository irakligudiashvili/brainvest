import { Link } from 'react-router-dom';
import { useCart } from '../CartContext';
import { money, shippingFor } from '../api';
import FreeShippingBar from '../components/FreeShippingBar';

export default function Cart() {
  const { items, setQty, remove, subtotal } = useCart();
  const shipping = shippingFor(subtotal);

  if (!items.length) {
    return (
      <div className="container section status">
        <h1>Your cart is empty</h1>
        <p className="muted">Find something you love.</p>
        <Link to="/shop" className="btn">Start shopping</Link>
      </div>
    );
  }

  return (
    <div className="container section">
      <h1 className="title-xl">Your <span className="accent">cart</span></h1>
      <div className="cart">
        <ul className="cart__items">
          {items.map((i) => (
            <li key={i.id} className="cart-item">
              <Link to={`/product/${i.id}`}><img src={i.thumbnail} alt={i.title} /></Link>
              <div className="cart-item__info">
                <Link to={`/product/${i.id}`} className="card__title">{i.title}</Link>
                <div className="muted">{money(i.price)} each</div>
                <button type="button" className="link small" onClick={() => remove(i.id)}>Remove</button>
              </div>
              <div className="qty">
                <button type="button" onClick={() => setQty(i.id, i.qty - 1)} aria-label="Decrease">−</button>
                <span>{i.qty}</span>
                <button type="button" onClick={() => setQty(i.id, i.qty + 1)} aria-label="Increase">+</button>
              </div>
              <div className="cart-item__total">{money(i.price * i.qty)}</div>
            </li>
          ))}
        </ul>

        <aside className="summary">
          <h3>Order summary</h3>
          <FreeShippingBar subtotal={subtotal} />
          <div className="summary__row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="summary__row"><span>Delivery</span><span>{shipping ? money(shipping) : 'Free'}</span></div>
          <div className="summary__row summary__total"><span>Total</span><span>{money(subtotal + shipping)}</span></div>
          <Link to="/checkout" className="btn btn--lg btn--block">Checkout</Link>
          <Link to="/shop" className="link small center">Continue shopping</Link>
        </aside>
      </div>
    </div>
  );
}
