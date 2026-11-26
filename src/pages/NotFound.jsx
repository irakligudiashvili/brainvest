import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container section status">
      <div className="notfound__num">404</div>
      <h1>Page not found</h1>
      <Link to="/" className="btn">Back home</Link>
    </div>
  );
}
