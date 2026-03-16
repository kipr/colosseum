import React, { lazy, Suspense } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChatProvider } from './contexts/ChatContext';
import { EventProvider } from './contexts/EventContext';
import PublicChat from './components/PublicChat';

const Home = lazy(() => import('./pages/Home'));
const Judge = lazy(() => import('./pages/Judge'));
const Scoresheet = lazy(() => import('./pages/Scoresheet'));
const SpectatorEvents = lazy(() => import('./pages/SpectatorEvents'));
const Spectator = lazy(() => import('./pages/Spectator'));
const Admin = lazy(() => import('./pages/Admin'));

/** Feature gate: set to true to enable public chat UI. Chat APIs remain available for internal/admin use. */
const CHAT_UI_ENABLED = import.meta.env.VITE_ENABLE_CHAT === 'true' || false;

const AdminWithProvider = () => (
  <EventProvider>
    <Admin />
  </EventProvider>
);

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ChatProvider>
          <Router>
            <Suspense fallback={<div className="app-loading">Loading...</div>}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/judge" element={<Judge />} />
                <Route path="/scoresheet" element={<Scoresheet />} />

                {/* Spectator routes */}
                <Route path="/spectator" element={<SpectatorEvents />} />
                <Route
                  path="/spectator/events/:eventId/brackets/:bracketId"
                  element={<Spectator />}
                />
                <Route
                  path="/spectator/events/:eventId"
                  element={<Spectator />}
                />

                {/* Admin routes */}
                <Route
                  path="/admin"
                  element={<Navigate to="/admin/events" replace />}
                />
                <Route
                  path="/admin/events/:eventId/brackets/:bracketId"
                  element={<AdminWithProvider />}
                />
                <Route
                  path="/admin/events/:eventId"
                  element={<AdminWithProvider />}
                />
                <Route path="/admin/events" element={<AdminWithProvider />} />
              </Routes>
            </Suspense>
            {CHAT_UI_ENABLED && <PublicChat />}
          </Router>
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
