import { lazy, type ComponentType } from 'react';
import {
  createBrowserRouter,
  Outlet,
  RouterProvider,
  useLoaderData,
} from 'react-router-dom';
import { AuthProvider, type User } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { EventProvider } from './contexts/EventContext';
import { adminEventLoader, adminLoader } from './loaders/adminLoader';
import AdminRouteError from './components/AdminRouteError';
import SpectatorRouteError from './components/SpectatorRouteError';
import {
  spectatorAwardsLoader,
  spectatorBracketIndexLoader,
  spectatorBracketLoader,
  spectatorBracketRankingsLoader,
  spectatorDocumentationLoader,
  spectatorDoubleSeedingLoader,
  spectatorEventIndexLoader,
  spectatorEventLoader,
  spectatorEventsLoader,
  spectatorOverallLoader,
  spectatorSeedingLoader,
  spectatorShouldRevalidate,
} from './loaders/spectatorLoaders';
import type {
  AdminRouteHandle,
  AdminView,
  SpectatorRouteHandle,
  SpectatorView,
} from './utils/routes';

const Home = lazy(() => import('./pages/Home'));
const Judge = lazy(() => import('./pages/Judge'));
const Scoresheet = lazy(() => import('./pages/Scoresheet'));
const SpectatorEvents = lazy(() => import('./pages/SpectatorEvents'));
const Spectator = lazy(() => import('./pages/Spectator'));
const Admin = lazy(() => import('./pages/Admin'));

const AdminLoading = () => (
  <main className="app-loading" role="status" aria-live="polite">
    <p>Loading admin area…</p>
  </main>
);

const SpectatorEventsLoading = () => (
  <main className="app-loading" role="status" aria-live="polite">
    <p>Loading spectator events…</p>
  </main>
);

const PublicWithAuth = () => (
  <AuthProvider>
    <Outlet />
  </AuthProvider>
);

const AdminWithProviders = () => {
  const user = useLoaderData() as User;

  return (
    <AuthProvider initialUser={user}>
      <EventProvider>
        <Admin />
      </EventProvider>
    </AuthProvider>
  );
};

type DefaultComponentModule = { default: ComponentType };

function lazyRoute(importer: () => Promise<DefaultComponentModule>) {
  return async () => ({ Component: (await importer()).default });
}

function adminHandle(adminView: AdminView): AdminRouteHandle {
  return { adminView };
}

function spectatorHandle(spectatorView: SpectatorView): SpectatorRouteHandle {
  return { spectatorView };
}

const router = createBrowserRouter([
  {
    element: <PublicWithAuth />,
    children: [
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
        errorElement: <SpectatorRouteError />,
        children: [
          {
            index: true,
            element: <SpectatorEvents />,
            HydrateFallback: SpectatorEventsLoading,
            loader: spectatorEventsLoader,
          },
          {
            id: 'spectator-event',
            path: 'events/:eventId',
            element: <Spectator />,
            loader: spectatorEventLoader,
            shouldRevalidate: spectatorShouldRevalidate,
            children: [
              {
                index: true,
                loader: spectatorEventIndexLoader,
              },
              {
                path: 'seeding',
                handle: spectatorHandle('seeding'),
                loader: spectatorSeedingLoader,
                lazy: async () => ({
                  Component: (await import('./pages/SpectatorViews'))
                    .SpectatorSeedingView,
                }),
              },
              {
                path: 'double-seeding',
                handle: spectatorHandle('double-seeding'),
                loader: spectatorDoubleSeedingLoader,
                lazy: async () => ({
                  Component: (await import('./pages/SpectatorViews'))
                    .SpectatorDoubleSeedingView,
                }),
              },
              {
                path: 'brackets',
                handle: spectatorHandle('brackets'),
                loader: spectatorBracketIndexLoader,
                lazy: async () => ({
                  Component: (await import('./pages/SpectatorViews'))
                    .SpectatorNoBracketsView,
                }),
              },
              {
                id: 'spectator-bracket',
                path: 'brackets/:bracketId',
                loader: spectatorBracketLoader,
                shouldRevalidate: spectatorShouldRevalidate,
                children: [
                  {
                    index: true,
                    handle: spectatorHandle('brackets'),
                    lazy: async () => ({
                      Component: (await import('./pages/SpectatorViews'))
                        .SpectatorBracketView,
                    }),
                  },
                  {
                    path: 'rankings',
                    handle: spectatorHandle('bracket-rankings'),
                    loader: spectatorBracketRankingsLoader,
                    lazy: async () => ({
                      Component: (await import('./pages/SpectatorViews'))
                        .SpectatorBracketRankingsView,
                    }),
                  },
                ],
              },
              {
                path: 'documentation',
                handle: spectatorHandle('documentation'),
                loader: spectatorDocumentationLoader,
                lazy: async () => ({
                  Component: (await import('./pages/SpectatorViews'))
                    .SpectatorDocumentationView,
                }),
              },
              {
                path: 'awards',
                handle: spectatorHandle('awards'),
                loader: spectatorAwardsLoader,
                lazy: async () => ({
                  Component: (await import('./pages/SpectatorViews'))
                    .SpectatorAwardsView,
                }),
              },
              {
                path: 'overall',
                handle: spectatorHandle('overall'),
                loader: spectatorOverallLoader,
                lazy: async () => ({
                  Component: (await import('./pages/SpectatorViews'))
                    .SpectatorOverallView,
                }),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '/admin',
    element: <AdminWithProviders />,
    HydrateFallback: AdminLoading,
    loader: adminLoader,
    errorElement: <AdminRouteError />,
    children: [
      {
        path: 'events',
        handle: adminHandle('events'),
        lazy: lazyRoute(() => import('./components/admin/EventsTab')),
      },
      {
        id: 'admin-event',
        path: 'events/:eventId',
        loader: adminEventLoader,
        children: [
          {
            index: true,
            handle: adminHandle('events'),
            lazy: lazyRoute(() => import('./components/admin/EventsTab')),
          },
          {
            path: 'teams',
            handle: adminHandle('teams'),
            lazy: lazyRoute(() => import('./components/admin/TeamsTab')),
          },
          {
            path: 'scoresheets',
            handle: adminHandle('scoresheets'),
            lazy: lazyRoute(() => import('./components/admin/ScoreSheetsTab')),
          },
          {
            path: 'scoring',
            handle: adminHandle('scoring'),
            lazy: lazyRoute(() => import('./components/admin/ScoringTab')),
          },
          {
            path: 'seeding',
            handle: adminHandle('seeding'),
            lazy: lazyRoute(() => import('./components/admin/SeedingTab')),
          },
          {
            path: 'double-seeding',
            handle: adminHandle('double-seeding'),
            lazy: lazyRoute(
              () => import('./components/admin/DoubleSeedingTab'),
            ),
          },
          {
            path: 'brackets/:bracketId',
            handle: adminHandle('brackets'),
            lazy: lazyRoute(() => import('./components/admin/BracketsTab')),
          },
          {
            path: 'brackets',
            handle: adminHandle('brackets'),
            lazy: lazyRoute(() => import('./components/admin/BracketsTab')),
          },
          {
            path: 'queue',
            handle: adminHandle('queue'),
            lazy: lazyRoute(() => import('./components/admin/QueueTab')),
          },
          {
            path: 'judge-chat',
            handle: adminHandle('judge-chat'),
            lazy: lazyRoute(() => import('./components/admin/JudgeChatTab')),
          },
          {
            path: 'documentation',
            handle: adminHandle('documentation'),
            lazy: lazyRoute(
              () => import('./components/admin/DocumentationTab'),
            ),
          },
          {
            path: 'awards',
            handle: adminHandle('awards'),
            lazy: lazyRoute(() => import('./components/admin/AwardsTab')),
          },
          {
            path: 'overall',
            handle: adminHandle('overall'),
            lazy: lazyRoute(() => import('./components/admin/OverallTab')),
          },
          {
            path: 'admins',
            handle: adminHandle('admins'),
            lazy: lazyRoute(() => import('./components/admin/AdminsTab')),
          },
          {
            path: 'audit',
            handle: adminHandle('audit'),
            lazy: lazyRoute(() => import('./components/admin/AuditTab')),
          },
        ],
      },
    ],
  },
]);

function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

export default App;
