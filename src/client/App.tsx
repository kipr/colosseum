import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChatProvider } from './contexts/ChatContext';
import { EventProvider } from './contexts/EventContext';
import Home from './pages/Home';
import Judge from './pages/Judge';
import Scoresheet from './pages/Scoresheet';
import EventList from './pages/EventList';
import EventView from './pages/EventView';
import Admin from './pages/Admin';
import PublicChat from './components/PublicChat';

/** Feature gate: set to true to enable public chat UI. Chat APIs remain available for internal/admin use. */
const CHAT_UI_ENABLED = import.meta.env.VITE_ENABLE_CHAT === 'true' || false;

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
              <Route path="/event" element={<EventList />} />
              <Route path="/event/:eventId" element={<EventView />} />
              <Route
                path="/admin"
                element={
                  <EventProvider>
                    <Admin />
                  </EventProvider>
                }
              />
            </Routes>
            {CHAT_UI_ENABLED && <PublicChat />}
          </Router>
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
