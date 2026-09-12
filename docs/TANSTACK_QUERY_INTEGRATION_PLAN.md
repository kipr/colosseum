# TanStack Query Integration Plan

This document describes an incremental migration to TanStack Query v5 for the
client's server data, mutations, and polling. React context continues to expose
authentication and event selection; form drafts, navigation, and display
preferences remain local state.

## Scope and constraints

The client currently manages requests, loading and error state, effects, and
refresh logic at the component level. The migration must preserve:

| Area | Behavior to preserve |
| --- | --- |
| Authentication | Session lookup, backend-unavailable feedback, startup retries |
| Event selection | Event list, URL navigation, saved selection, fallback after deletion |
| Admin tabs | CRUD, filtered lists, pagination, imports, previews, calculated results |
| Spectator views | Public endpoints, lazy tab loading, event-status restrictions |
| Judge scoresheets | Access-code verification, session-stored template, dynamic options, submission |
| Queue and scoring | Periodic refresh without replacing the page with a loading indicator |
| Chat | Adaptive polling, older messages, conversation deletion, unread tracking |

Keep routes, API payloads, scoring rules, and browser-storage behavior intact.
Do not change the backend unless a later implementation stage identifies a
specific API limitation.

## 1. Add the client and provider

1. Add `@tanstack/react-query` v5 as a runtime dependency and record the
   resolved version in the lockfile. It supports React 18+, including React 19.
2. Add `@tanstack/eslint-plugin-query` and development-only Query Devtools.
3. Create a QueryClient factory and one stable browser instance.
4. Mount `QueryClientProvider` in `src/client/main.tsx`, outside `App`, so the
   authentication provider and all routes share one cache.
5. Keep the existing lazy route imports and route-level Suspense behavior.
6. Load Devtools only in development and verify the production build excludes
   them.

## 2. Establish a typed data layer

Create this structure:

```text
src/client/api/
  http.ts
  types.ts
  events.ts
  teams.ts
  scores.ts
  ...domain request functions

src/client/queries/
  queryClient.ts
  keys.ts
  invalidation.ts
  events.ts
  teams.ts
  scores.ts
  ...domain query options and mutation hooks
```

API functions construct requests and return typed responses. Reusable
`queryOptions` factories define keys, fetchers, and freshness. Mutation hooks
define writes and cache effects. Components retain rendering, drafts,
confirmations, and notifications.

Build the HTTP helper around native `fetch`. It must preserve cookie
credentials, accept an `AbortSignal`, handle JSON and empty responses, and
throw a typed `ApiError` containing HTTP status and any server error message.
Endpoint-specific meanings stay outside that generic helper: `/auth/user` 401
means signed out, while access-code verification 403 means an invalid code.

Pass Query's signal through every query fetcher so superseded reads can be
cancelled when their consumers disappear or scope changes. Reuse existing
shared types where suitable, introduce client DTOs for currently untyped
responses, and do not import server runtime modules into the browser.

## 3. Define keys and authorization boundaries

Every query key must include each input that changes its response: event,
bracket, filters, pagination, and authorization scope. For example:

```ts
['auth', 'user']

['public', 'events']
['admin', userId, 'events']

['admin', userId, 'event', eventId, 'teams']
['public', 'event', eventId, 'overall']

['admin', userId, 'event', eventId, 'scores',
  { page, limit, status, scoreType }]

['judge', sessionGeneration, 'event', eventId, 'queue',
  { statuses, queueType }]
```

Normalize IDs and unordered filter arrays before key creation. Distinguish an
unfiltered list from an event-filtered list. Initially separate public, admin,
and judge namespaces; do not share public template listings with admin data
that includes access codes. Share cache entries across roles only after
verifying that their responses and authorization contracts are identical.

Use a local judge-session generation value to isolate judge data after a
successful verification or session replacement. Never put access codes in
query keys. Keep the cache in memory; retain existing targeted local and
session storage without adding cache persistence.

## 4. Configure freshness, retry, and polling

Use explicit policies rather than TanStack Query defaults:

| Data | Initial policy |
| --- | --- |
| Event metadata, teams, template lists | 30-second `staleTime`; refresh stale data on mount, focus, and reconnect |
| Scoring inbox | 10-second polling |
| Admin and judge queues | 10-second polling |
| Judge bracket-game options | 10-second polling |
| Admin user list | 30-second polling |
| Chat | 3-second active and 15-second inactive polling |
| Spectator results | Refresh stale data on mount, focus, and reconnect; retain lazy activation |
| Audit history | Fetch on activation or filter change and when loading more |

Start with a five-minute inactive cache lifetime. Pause network polling in
hidden tabs and refresh live views on return to visibility. Do not introduce
spectator interval polling as part of this migration.

For ordinary reads, permit at most two retries for transient network or server
failures. Do not retry authorization, validation, or missing-resource errors.
Treat rate limits separately and honor `Retry-After` where supplied. Set
mutation retries to zero. Configure critical writes to attempt immediately and
report failure; do not automatically replay scores or queue actions offline.

## 5. Migrate authentication and event context

In `src/client/contexts/AuthContext.tsx`, replace the request and retry timer
with a session query while keeping the context's public interface. Preserve
backend-restart recovery with an auth-specific retry policy. Distinguish initial
loading, unauthenticated state, and server failure so a temporary failure does
not appear as a successful logout.

Gate protected queries on confirmed authentication and relevant permissions.
On logout, identity change, or confirmed session expiry, cancel and remove
protected queries. Treat judge-session expiry separately from admin
authentication.

In `src/client/contexts/EventContext.tsx`, keep the selected event ID as local
state and derive the selected event object from query data. Preserve URL
precedence, local-storage restoration, active/setup fallback, and deletion
behavior. Keep `refreshEvents()` temporarily as a Query-backed compatibility
adapter until all callers migrate, then remove duplicated server-data state and
synchronization effects.

## 6. Migrate read features

Migrate public event discovery and simple read-only displays first, followed by
admin features. The target feature groups are:

| Group | Data |
| --- | --- |
| Events and teams | Shared lists, filtered lists, metadata, check-in data |
| Templates | Judge/admin lists, details, field templates, wizard and preview data |
| Seeding | Teams, scores, rankings |
| Double seeding | Scores, rankings, matches |
| Brackets | Lists, details, games, assigned teams, rankings |
| Scoring | Filtered and paginated submissions, score detail |
| Documentation and awards | Categories, scores, templates, recipients, automatic awards, overall results |
| Audit | Filtered history, incremental loading, detail requests |
| Admin users | User list and polling |

Preserve concurrent independent requests instead of creating sequential
dependencies. Use enabled dependent queries only after required IDs are
available. Replace spectator `loaded` flags with query state and tab-based
activation. Continue checking event status before fetching and displaying
restricted final results; disabling a query alone does not remove cached data.

Use page-specific keys for scoring. Previous-page placeholders may remain only
within the same event and filter scope. Implement audit's existing Load More
behavior with `useInfiniteQuery`, offset pagination, and a reset when filters
change.

## 7. Define mutation cache effects

Create domain-specific invalidation helpers instead of clearing the complete
cache after writes.

| Mutation | Cache effects |
| --- | --- |
| Event create, update, delete | Event lists and metadata; affected event resources and visibility-dependent public results |
| Team edit, check-in, import, delete | Teams, queue, and affected score, ranking, bracket, and award displays |
| Template or field-template change | Relevant lists, details, previews, and event associations |
| Score submission | Submission lists and affected queue/game availability |
| Score acceptance, rejection, reversion | Submission detail/list; acceptance and reversion also refresh derived scores, rankings, brackets, queue, overall results, and awards as applicable |
| Bracket lifecycle or game change | Bracket lists/details/games/rankings, assigned teams, queue, and affected derived results |
| Documentation changes | Categories/scores, overall results, and automatic awards |
| Award changes | Awards, recipients, and team award counts |
| Queue changes | Affected filtered queue entries and related selection data |
| Audited writes | Relevant audit history |
| Chat send or delete | Conversation summary and affected message data |

Confirm every dependency against the server handlers during implementation.
Capture event and resource IDs in mutation variables so a write that completes
after navigation invalidates the event it originally changed. Use complete
mutation responses to update exact entries where useful, then invalidate
dependent collections. Await essential refreshes when the UI needs them before
completing an action.

Preserve confirmations and server-authoritative scoring calculations. Do not
initially use optimistic updates for scoring, bracket progression, queue
movement, or multi-request bulk operations. For partial bulk success, refresh
resources changed by successful writes and report failures individually.
Distinguish a successful write followed by a failed refresh from a failed write.
Polling remains necessary to observe changes from other browsers.

## 8. Preserve queue and scoresheet behavior

`QueueTab.tsx` and `ScoresheetForm.tsx` use ETags to skip unchanged updates.
Preserve HTTP revalidation and Query's structural sharing. Any explicit ETag
bookkeeping must be scoped to the complete query key. If raw 304 responses are
handled, return existing cached data rather than attempting to parse an empty
body.

Keep the queue's separate 30-second rest-warning clock because it measures
elapsed wall-clock time even when server data does not change.

Convert access-code verification to a mutation while preserving the
`currentTemplate` session-storage handoff. Verification establishes a judge
session and must remain a deliberate action. Move teams, queue options, and
bracket options to queries, but keep scoresheet fields, touched state, formulas,
selections, and validation local. Background refreshes must not reset a draft
or replace its template schema.

Convert score submission to a mutation while preserving payload, success and
reset behavior, and the expired-session redirect. Disable duplicate submission
while pending. On an uncertain network outcome, retain the draft and require a
deliberate recovery action; client work alone cannot provide exactly-once score
submission.

## 9. Migrate chat last

`JudgeChatContext.tsx` combines polling with conversation selection, pagination,
merging, and unread state. Retain the context as the UI-facing adapter while
moving network state into Query.

Use a conversation-list query, a query for latest messages, and separately
keyed older-message pages. This preserves the current request pattern without
refetching the full loaded history every three seconds. Merge pages by message
ID with the existing tested utilities. Preserve ordering, scroll position,
older-page detection, and unread calculations.

Scope data by event, mode, session, and conversation. Cancel obsolete reads
during switches. On deletion, remove cached history as well as refreshing the
latest data, preventing old messages from reappearing. Keep drawer state,
display name, selected conversation, and last-seen markers in their current
local/context storage.

## 10. Standardize UI states and remove duplicate fetching

For each migrated feature:

- Show a full loading state only when usable data is absent.
- Keep current data visible during background refreshes.
- Provide unobtrusive refresh errors with a retry action.
- Place mutation errors by the initiating form or action.
- Do not show repeated toast errors for polling failures.
- Preserve drafts after failure and do not reset them after query success.
- Remove or hide protected data after confirmed authorization loss.

Remove old fetch effects, polling timers, and server-data state in the same
change that migrates a feature. This prevents two independent fetching systems
from operating at once.

## 11. Test, stage, and validate the migration

Deliver the work in these reviewable stages:

| Stage | Deliverable |
| --- | --- |
| 1 | Dependencies, provider, HTTP helper, keys, defaults, test utilities, and public event-list pilot |
| 2 | Authentication and event context |
| 3 | Events, teams, templates, simple admin reads and mutations |
| 4 | Seeding, double seeding, brackets, documentation, awards, overall results, and audit |
| 5 | Scoring, queue, judge verification, and scoresheet submission |
| 6 | Chat |
| 7 | Cleanup, regression checks, bundle comparison, and developer documentation |

Add React Testing Library and a DOM environment for hook/provider tests, scoped
to those tests, and extend Vitest discovery to `.test.tsx`. Keep the existing
PostgreSQL setup for the current suite. Use a fresh QueryClient per test and
disable retries except in tests that exercise retry behavior.

Prioritize tests for event/session isolation, cancellation, invalidation after
navigation, hidden-tab polling, ETag behavior, partial bulk failures, draft
preservation, duplicate-submit prevention, and chat pagination/deletion races.
Extend existing Playwright workflows for tournament setup, judge scoring, score
administration, queues, bracket lifecycle, spectator visibility, templates, and
chat.

Run these final checks from an environment with the project's required
PostgreSQL service available:

```text
npm run pretty
npm run lint
npm run typecheck:client
npm run typecheck:server
npm run test:run
npm run build
npm run test:e2e
```

Compare production bundle sizes and representative network traces with a
pre-migration baseline. Verify route splitting remains effective, Devtools do
not enter production output, polling stays at the intended cadence, and repeated
navigation benefits from caching.

The migration is complete when every client server-data operation uses the
agreed query/mutation layer, remaining effects describe UI behavior, existing
workflows pass, and cached data cannot cross event or authorization boundaries.

## Stage three implementation

Stage three migrates event writes, team management, scoresheet and field-template
management, public judge template discovery, and admin-user polling. Domain API
functions and query/mutation hooks own requests and cache effects; components
retain navigation, confirmations, drafts, and notifications. The forwarding-only
score-sheet preview wrapper and hand-built template toast implementations were
removed. Bulk-import parsing and results, and editor bracket indicators, no
longer require synchronized copies of state.

Implementation boundaries:

- Field-template management, the wizard, and the field editor share one list
  query. Its API function normalizes stored `fields_json`; the list contains all
  fields needed by the editor, so no separate detail request is necessary.
- Scoresheet details distinguish admin and staff permissions within the user
  namespace. Privileged queries carry `adminOnly` metadata. Cache-level error
  callbacks revalidate auth after protected 401 or admin-only 403 responses;
  confirmed identity/permission transitions use the existing eviction helpers.
- Event writes apply the complete server response to the event list before UI
  navigation. Background list refresh does not delay selecting a created event.
  Deletion removes the event and its cached resources, including its filtered
  scoresheet list. Other mutations await active list refreshes without treating
  a refresh failure as a failed write.
- Mutation variables capture the originating user and resource scope. Cache
  effects survive component unmounting; late responses cannot recreate another
  identity's protected cache. Editor drafts survive background data changes.
- The supporting bracket-options query deliberately uses zero stale time until
  stage four migrates bracket writes. Reopening an editor therefore refreshes
  bracket choices despite legacy mutations not yet invalidating Query data.
- `refreshEvents()` remains only as the compatibility adapter for Admin's retry
  control and DoubleSeedingTab. Remove it when those remaining callers migrate.

Later stages must extend the domain invalidations as their consumers migrate:
team changes affect queue, scoring/ranking, bracket, award, and audit views;
event settings affect queue and visibility-dependent results; template changes
affect later template consumers. Scoresheet updates replace event associations,
so all cached template-list filters are invalidated today. Field-template edits
do not rewrite previously generated scoresheet schemas. No speculative keys or
bridges to legacy component state were added.

Stage-three validation adds hook/component coverage for shared reads,
cancellation, event/filter/permission isolation, delayed writes, partial bulk
success, draft preservation, duplicate submission, authorization recovery, and
hidden-tab polling. Browser coverage verifies delayed event-list refresh and
cache reuse across team navigation and the scoresheet wizard. The migration
retains route splitting and excludes Query Devtools from production output.

The source-size tradeoff is explicit: compared with the pre-stage-three HEAD,
client UI/context code decreases by 386 lines, while the API/query layer adds
594 lines (net +208 client lines, excluding tests and this document). Production
JavaScript totals change from 644,108 to 648,136 bytes; summed per-chunk gzip
sizes change from 200,399 to 202,669 bytes (+2,270 bytes). Lazy JavaScript chunks
remain split (36 before, 38 after), with no Query Devtools in the build. Review
future consumers for reuse of these modules rather than another fetching layer.

## References

- [TanStack Query installation](https://tanstack.com/query/latest/docs/framework/react/installation)
- [TanStack Query important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [TanStack Query invalidation from mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
- [TanStack Query network mode](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)
