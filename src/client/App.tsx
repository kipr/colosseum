import { lazy } from 'react';
import { judgeLoader } from './loaders/judgeLoader';
import {
  Navigate,
  createBrowserRouter,
  RouterProvider,
} from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { EventProvider } from './contexts/EventContext';

const Home = lazy(() => import('./pages/Home'));
const Judge = lazy(() => import('./pages/Judge'));
const Scoresheet = lazy(() => import('./pages/Scoresheet'));
const SpectatorEvents = lazy(() => import('./pages/SpectatorEvents'));
const Spectator = lazy(() => import('./pages/Spectator'));
const Admin = lazy(() => import('./pages/Admin'));

const AdminWithProvider = () => (
  <EventProvider>
    <Admin />
  </EventProvider>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />
  },
  {
    path: "/judge",
    element: <Judge />,
    loader: judgeLoader,
  },
  {
    path: "/scoresheet",
    element: <Scoresheet />,
  },
  {
    path: "/spectator",
    element: <SpectatorEvents />
  },
  {
    path: "/spectator/events/:eventId/brackets/:bracketId",
    element: <Spectator />
  },
  {
    path: "/spectator/events/:eventId",
    element: <Spectator />
  },
  {
    path: "/admin",
    element: <Navigate to="/admin/events" replace />
  },
  {
    path: "/admin/events/:eventId/brackets/:bracketId",
    element: <AdminWithProvider />
  },
  {
    path: "/admin/events/:eventId",
    element: <AdminWithProvider />
  },
  {
    path: "/admin/events",
    element: <AdminWithProvider />
  }
]);

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
