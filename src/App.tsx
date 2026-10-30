import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StateGate } from './components/StateGate';
import { AssistantPage } from './pages/AssistantPage';
import { AddFriendPage } from './pages/AddFriendPage';
import { AdminPage } from './pages/AdminPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { FriendProfilePage } from './pages/FriendProfilePage';
import { FriendsPage } from './pages/FriendsPage';
import { GamePage } from './pages/GamePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { MessagesPage } from './pages/MessagesPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { PhysicalPage } from './pages/PhysicalPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { StatsPage } from './pages/StatsPage';
import { WishlistPage } from './pages/WishlistPage';

/** New page: back to the top, or to the section a link names ("/settings#alerts"). */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    // Sections render after the route does.
    const timer = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(timer);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <StateGate>
      <Layout>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/physical" element={<PhysicalPage />} />
          <Route path="/stores" element={<Navigate to="/wishlist#stores" replace />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:id" element={<MessagesPage />} />
          <Route path="/friends/:id" element={<FriendProfilePage />} />
          <Route path="/add/:code" element={<AddFriendPage />} />
          {/* Platforms is a section of Settings now; keep old links working. */}
          <Route path="/platforms" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Layout>
    </StateGate>
  );
}
