import React from 'react';
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
import Home from './pages/Home';
import Judge from './pages/Judge';
import Scoresheet from './pages/Scoresheet';
import Spectator from './pages/Spectator';
import Admin from './pages/Admin';
import PublicChat from './components/PublicChat';

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
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/judge" element={<Judge />} />
              <Route path="/scoresheet" element={<Scoresheet />} />

              {/* Spectator routes */}
              <Route path="/spectator" element={<Spectator />} />
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
            {CHAT_UI_ENABLED && <PublicChat />}
          </Router>
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
