import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import App from './App';
import { CartProvider } from './CartContext';
import { UIProvider } from './UIContext';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Honour the OS "reduce motion" setting for every animation. */}
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <CartProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </CartProvider>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>
);
