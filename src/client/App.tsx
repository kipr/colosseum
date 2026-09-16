import { lazy } from 'react';
import {
  Navigate,
  createBrowserRouter,
  RouterProvider,
} from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { EventProvider } from './contexts/EventContext';
import { adminLoader } from './loaders/adminLoader';

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
    path: '/',
    element: <Home />,
  },
  {
    path: '/judge',
    element: <Judge />,
  },
  {
    path: '/scoresheet',
    element: <Scoresheet />,
  },
  {
    path: '/spectator',
    element: <SpectatorEvents />,
  },
  {
    path: '/spectator/events/:eventId/brackets/:bracketId',
    element: <Spectator />,
  },
  {
    path: '/spectator/events/:eventId',
    element: <Spectator />,
  },
  {
    path: '/admin',
    loader: adminLoader,
    children: [
      {
        index: true,
        element: <Navigate to="/admin/events" replace />,
      },
      {
        path: 'events/:eventId/brackets/:bracketId',
        element: <AdminWithProvider />,
      },
      {
        path: 'events/:eventId',
        element: <AdminWithProvider />,
      },
      {
        path: 'events',
        element: <AdminWithProvider />,
      },
    ],
  },
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
