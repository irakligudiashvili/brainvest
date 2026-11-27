import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { CartProvider } from './CartContext';
import { UIProvider } from './UIContext';
import { WishlistProvider } from './WishlistContext';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <CartProvider>
        <WishlistProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </WishlistProvider>
      </CartProvider>
    </BrowserRouter>
  </StrictMode>
);
