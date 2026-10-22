import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StateGate } from './components/StateGate';
import { AssistantPage } from './pages/AssistantPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { GamePage } from './pages/GamePage';
import { LibraryPage } from './pages/LibraryPage';
import { PhysicalPage } from './pages/PhysicalPage';
import { PlatformsPage } from './pages/PlatformsPage';
import { StatsPage } from './pages/StatsPage';
import { StoresPage } from './pages/StoresPage';
import { WishlistPage } from './pages/WishlistPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <StateGate>
      <Layout>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/physical" element={<PhysicalPage />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route path="/platforms" element={<PlatformsPage />} />
          <Route path="*" element={<LibraryPage />} />
        </Routes>
      </Layout>
    </StateGate>
  );
}
