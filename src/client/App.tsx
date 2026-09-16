import { lazy, type ComponentType } from 'react';
import {
  Navigate,
  createBrowserRouter,
  RouterProvider,
} from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { EventProvider } from './contexts/EventContext';
import { adminLoader } from './loaders/adminLoader';
import AdminRouteError from './components/AdminRouteError';
import type { AdminRouteHandle, AdminView } from './utils/routes';

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

type DefaultComponentModule = { default: ComponentType };

function lazyRoute(importer: () => Promise<DefaultComponentModule>) {
  return async () => ({ Component: (await importer()).default });
}

function adminHandle(adminView: AdminView): AdminRouteHandle {
  return { adminView };
}

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
    element: <AdminWithProvider />,
    loader: adminLoader,
    errorElement: <AdminRouteError />,
    children: [
      {
        index: true,
        element: <Navigate to="/admin/events" replace />,
      },
      {
        path: 'events/:eventId?',
        handle: adminHandle('events'),
        lazy: lazyRoute(() => import('./components/admin/EventsTab')),
      },
      {
        path: 'teams/:eventId?',
        handle: adminHandle('teams'),
        lazy: lazyRoute(() => import('./components/admin/TeamsTab')),
      },
      {
        path: 'scoresheets/:eventId?',
        handle: adminHandle('scoresheets'),
        lazy: lazyRoute(() => import('./components/admin/ScoreSheetsTab')),
      },
      {
        path: 'scoring/:eventId?',
        handle: adminHandle('scoring'),
        lazy: lazyRoute(() => import('./components/admin/ScoringTab')),
      },
      {
        path: 'seeding/:eventId?',
        handle: adminHandle('seeding'),
        lazy: lazyRoute(() => import('./components/admin/SeedingTab')),
      },
      {
        path: 'double-seeding/:eventId?',
        handle: adminHandle('double-seeding'),
        lazy: lazyRoute(() => import('./components/admin/DoubleSeedingTab')),
      },
      {
        path: 'brackets/:eventId/:bracketId',
        handle: adminHandle('brackets'),
        lazy: lazyRoute(() => import('./components/admin/BracketsTab')),
      },
      {
        path: 'brackets/:eventId?',
        handle: adminHandle('brackets'),
        lazy: lazyRoute(() => import('./components/admin/BracketsTab')),
      },
      {
        path: 'queue/:eventId?',
        handle: adminHandle('queue'),
        lazy: lazyRoute(() => import('./components/admin/QueueTab')),
      },
      {
        path: 'judge-chat/:eventId?',
        handle: adminHandle('judge-chat'),
        lazy: lazyRoute(() => import('./components/admin/JudgeChatTab')),
      },
      {
        path: 'documentation/:eventId?',
        handle: adminHandle('documentation'),
        lazy: lazyRoute(() => import('./components/admin/DocumentationTab')),
      },
      {
        path: 'awards/:eventId?',
        handle: adminHandle('awards'),
        lazy: lazyRoute(() => import('./components/admin/AwardsTab')),
      },
      {
        path: 'overall/:eventId?',
        handle: adminHandle('overall'),
        lazy: lazyRoute(() => import('./components/admin/OverallTab')),
      },
      {
        path: 'admins/:eventId?',
        handle: adminHandle('admins'),
        lazy: lazyRoute(() => import('./components/admin/AdminsTab')),
      },
      {
        path: 'audit/:eventId?',
        handle: adminHandle('audit'),
        lazy: lazyRoute(() => import('./components/admin/AuditTab')),
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
