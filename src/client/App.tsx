import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChatProvider } from './contexts/ChatContext';
import Home from './pages/Home';
import Judge from './pages/Judge';
import Scoresheet from './pages/Scoresheet';
import Admin from './pages/Admin';
import PublicChat from './components/PublicChat';

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
              <Route path="/admin" element={<Admin />} />
            </Routes>
            <PublicChat />
          </Router>
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
