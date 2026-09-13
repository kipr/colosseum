import { lazy, Suspense } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';

const Home = lazy(() => import('./pages/Home'));
const Judge = lazy(() => import('./pages/Judge'));
const Scoresheet = lazy(() => import('./pages/Scoresheet'));
const SpectatorEvents = lazy(() => import('./pages/SpectatorEvents'));
const Spectator = lazy(() => import('./pages/Spectator'));
const Admin = lazy(() => import('./pages/Admin'));

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
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
                element={<Admin />}
              />
              <Route path="/admin/events/:eventId" element={<Admin />} />
              <Route path="/admin/events" element={<Admin />} />
            </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
