import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import Header from './components/Header';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import Cursor from './components/Cursor';
import Intro from './components/Intro';
import Page from './components/Page';
import ScrollProgress from './components/ScrollProgress';
import Home from './pages/Home';
import Shop from './pages/Shop';
import ProductPage from './pages/ProductPage';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import NotFound from './pages/NotFound';

const INTRO_KEY = 'hearth-oak-intro-seen';

function shouldSkipIntro() {
  return (
    sessionStorage.getItem(INTRO_KEY) === '1' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export default function App() {
  const location = useLocation();
  const [introDone, setIntroDone] = useState(shouldSkipIntro);

  const finishIntro = () => {
    sessionStorage.setItem(INTRO_KEY, '1');
    setIntroDone(true);
  };

  return (
    <>
      <AnimatePresence>{!introDone && <Intro key="intro" onDone={finishIntro} />}</AnimatePresence>

      {introDone && (
        <>
          <ScrollProgress />
          <Header />
          <CartDrawer />
          <Cursor />
          <main>
            <AnimatePresence mode="wait" onExitComplete={() => window.scrollTo(0, 0)}>
              <Routes location={location} key={location.pathname}>
                <Route path="/" element={<Page><Home /></Page>} />
                <Route path="/shop" element={<Page><Shop /></Page>} />
                <Route path="/product/:id" element={<Page><ProductPage /></Page>} />
                <Route path="/cart" element={<Page><Cart /></Page>} />
                <Route path="/checkout" element={<Page><Checkout /></Page>} />
                <Route path="*" element={<Page><NotFound /></Page>} />
              </Routes>
            </AnimatePresence>
          </main>
          <Footer />
        </>
      )}
    </>
  );
}
