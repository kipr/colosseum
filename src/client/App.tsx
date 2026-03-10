import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChatProvider } from './contexts/ChatContext';
import { EventProvider } from './contexts/EventContext';
import PublicChat from './components/PublicChat';

// Lazy-load pages for code splitting - reduces initial bundle size
const Home = lazy(() => import('./pages/Home'));
const Judge = lazy(() => import('./pages/Judge'));
const Scoresheet = lazy(() => import('./pages/Scoresheet'));
const Spectator = lazy(() => import('./pages/Spectator'));
const Admin = lazy(() => import('./pages/Admin'));

/** Feature gate: set to true to enable public chat UI. Chat APIs remain available for internal/admin use. */
const CHAT_UI_ENABLED = import.meta.env.VITE_ENABLE_CHAT === 'true' || false;

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ChatProvider>
          <Router>
            <Suspense
              fallback={
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '60vh',
                    color: 'var(--secondary-color)',
                  }}
                >
                  Loading…
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/judge" element={<Judge />} />
                <Route path="/spectator" element={<Spectator />} />
                <Route path="/scoresheet" element={<Scoresheet />} />
                <Route
                  path="/admin"
                  element={
                    <EventProvider>
                      <Admin />
                    </EventProvider>
                  }
                />
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
