# Client module

- Vite root is `src/client`; entry is `main.tsx`, routing/composition is `App.tsx`.
- Primary routes: home `/`; judge `/judge`; active score form `/scoresheet`; spectator event list/detail under `/spectator`; admin event/bracket routes under `/admin/events`.
- Route pages are lazy-loaded. App-wide providers wrap routing: theme and authentication; admin pages are additionally wrapped in the event provider.
- Structure: `pages` top-level screens; `components/admin` admin tabs/modals; feature component folders for bracket, seeding, double-seeding, overall, documentation, judge chat, spectator, and tables; `contexts` shared state; `scoring` Botball-specific calculation/display helpers; `utils` pure helpers.
- API calls use relative URLs and the Vite proxy in `vite.config.ts`. When introducing a new backend route prefix, update the proxy. Authenticated admin calls normally include cookies.
- Public spectator endpoints and judge access-code scoring must remain usable without Google OAuth.
- Shared scoresheet schema/types come from `src/shared`; avoid client-only copies of cross-runtime contracts.
- Styling uses global CSS plus colocated component/page CSS; preserve light/dark theme variables and responsive spectator/table behavior.
- See `mem:core` for project invariants, `mem:conventions` for implementation style, and `mem:task_completion` for frontend checks.