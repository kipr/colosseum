# Client server data

This is the integration record for the client's TanStack Query data layer after
the staged migration. Feature-specific request and cache behavior lives next to
the domain modules this document points to; do not rebuild a second fetching
stack in components.

## Ownership

| Layer           | Responsibility                                      | Lives in                                                                      |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| HTTP helper     | Cookies, abort, JSON/empty bodies, typed `ApiError` | [`src/client/api/http.ts`](../src/client/api/http.ts)                         |
| Domain requests | URLs, payloads, endpoint-specific status meanings   | `src/client/api/*.ts`                                                         |
| Query options   | Keys, fetchers, freshness, placeholders             | `src/client/queries/*.ts`                                                     |
| Mutations       | Writes plus scoped cache effects                    | `src/client/queries/*.ts`                                                     |
| Invalidation    | Explicit dependents, auth/session eviction          | [`src/client/queries/invalidation.ts`](../src/client/queries/invalidation.ts) |
| Components      | Rendering, drafts, confirmations, notifications     | `src/client/components`, pages, contexts                                      |

Read example: [`teamsQueryOptions`](../src/client/queries/teams.ts) consumed by
[`SeedingTab`](../src/client/components/admin/SeedingTab.tsx) (shared with the
Teams tab; 30-second list freshness). Mutation example:
[`useScoreMutations`](../src/client/queries/scores.ts) (event-prefix invalidation
plus narrow queue dependents).

Pass Query's `signal` through every fetcher. Domain modules return typed DTOs
and do not import server runtime code. Components should not call `fetch` or
duplicate server-data copies, request flags, or refresh effects.

## Authorization and keys

Keys are namespaced in [`src/client/queries/keys.ts`](../src/client/queries/keys.ts):

- `public` — unauthenticated spectator data
- `admin` — authenticated staff data (the prefix is not an `isAdmin` check)
- `judge` — access-code session data, keyed by a locally generated session id

Include every input that changes the response (user, event, filters, page,
conversation). Access codes never enter keys. Privileged queries set
`meta: ADMIN_ONLY_QUERY_META`. Cache error handlers revalidate auth after a
protected 401 or an admin-only 403; confirmed identity transitions use
`removeAdminUserQueries` / `removeAdminOnlyQueries`. Logout clears judge
sessionStorage, then removes judge queries, then navigates to `/auth/logout`.
Delayed mutations check `canUpdateUserCache` / `canUpdateJudgeCache` (and chat
also requires the latest query still to exist) before writing or invalidating
so an evicted cache stays gone.

## Freshness and polling

Defaults are in [`createQueryClient`](../src/client/queries/queryClient.ts):
`staleTime: 0`, `gcTime` 5 minutes, refetch on mount/focus/reconnect, no
interval polling, no background-tab intervals, two retries with exponential
backoff for transport and 5xx/429.

| Policy               | Value                    | Used for                                                                                                                                                                                             |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default `staleTime`  | 0                        | Derived results, audit, chat latest, and anything without an override. Other browsers still write; spectator results have no interval polling. Do not raise this because local mutations invalidate. |
| `LIST_STALE_TIME_MS` | 30s                      | Event/team/template/bracket/award/documentation lists and metadata                                                                                                                                   |
| `LIVE_QUERY`         | 10s interval             | Scoring inboxes, admin/judge queues, judge game options                                                                                                                                              |
| Admin users          | 30s interval             | [`adminUsersQueryOptions`](../src/client/queries/admins.ts)                                                                                                                                          |
| Chat                 | 3s active / 15s inactive | Latest messages and admin conversation summaries. Older pages do not poll.                                                                                                                           |

`refetchIntervalInBackground` stays false. Hidden-tab pauses are interval
polling only; in-flight requests are not cancelled by hiding the tab. Focus and
reconnect still refetch stale queries.

## Invalidation

Helpers in `invalidation.ts` take the originating mutation's user/event (and
judge generation when relevant). Independent keys refresh concurrently with
`Promise.all`. There is no whole-cache clear and no generic CRUD/mutation
factory. Event-scoped writes invalidate the admin event prefix and matching
public event prefix (plus the public event list and entity-audit queries).
Query marks matches stale and refetches active observers only. Queue and chat
writes stay narrow because they happen more often. Documentation category
writes also refresh the user-scoped catalog; double-seeding generate/delete
also refresh the admin event list; team, score, and bracket writes also
refresh queue dependents.

| Mutation family            | Cache effects                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Event create/update/delete | Admin and public event lists, public templates, affected event resources              |
| Event-scoped domain writes | Admin and public event prefixes, public event list, entity audit; extras in onSuccess |
| Template / field-template  | Relevant lists, details, previews, and event associations                             |
| Queue                      | Filtered queue entries and related judge queue/game data                              |
| Chat send                  | Exact latest cache; admin also refreshes the conversation list                        |
| Chat delete                | Remove both message caches, update and refresh the originating conversation list      |

Query's `invalidateQueries` does not reject when a follow-up refetch fails, so
a successful write stays successful if a later read fails. Await refreshes when
the action needs them (including partial bulk success). Chat: an empty latest
page clears older history; deletion removes cached message queries (Query
cancels their retryers on destroy); a delayed judge send after session
replacement or logout must not recreate evicted data.

## Loading and refresh errors

[`QueryFeedback`](../src/client/components/QueryFeedback.tsx) shows a full
loading state only when usable data is absent, and a retryable inline error
that distinguishes first load from a failed refresh. `queryData` hides cached
rows after a 401/403 so protected content does not linger. Mutation errors stay
on the initiating form or action. Polling failures must not spam toasts.

## HTTP cache and ETags

The helper defaults to `cache: 'no-store'` so Query `staleTime` is the
freshness policy. Queue and event-game GETs pass `cache: 'no-cache'`
(`VERSIONED_GET_CACHE`) so the browser can revalidate with `If-None-Match`.
Unchanged 304 responses keep existing Query data through structural sharing; do
not parse an empty body and do not store ETags in component refs.

## Legitimate UI and storage effects

Keep these outside Query:

- Form drafts, touched state, formula evaluation, and scoresheet validation
- Confirmations, toasts, and tab/localStorage UI preferences
- The queue's 30-second rest-warning clock (elapsed wall time, not server data)
- Chat drawer, display name, selected conversation, and last-seen markers
- Duplicate-submit guards while a mutation is pending

Background refreshes must not reset a draft or replace its template schema.

## Test setup

`createTestQueryClient` in
[`tests/client/helpers/queryTestUtils.tsx`](../tests/client/helpers/queryTestUtils.tsx)
builds a fresh client per test with retries disabled unless the test exercises
retry. Playwright seeds PostgreSQL through `e2e/helpers/db.ts` and logs admins
in by writing the `"session"` table. Do not treat a `cache` or `refetchInterval`
option as proof of browser behavior; visibility and HTTP revalidation need a
browser.

## Production Devtools

`src/client/main.tsx` lazy-loads Devtools only when `import.meta.env.DEV` and
`VITE_QUERY_DEVTOOLS` is not `'false'`. Vite still sees the static import, so
production builds alias `@tanstack/react-query-devtools` to
`reactQueryDevtoolsStub.tsx`. Removing that alias pulls the real Devtools into
the production graph. Playwright sets `VITE_QUERY_DEVTOOLS=false` so the
floating button does not intercept clicks.

## Stage seven measurements

Tracked production client TypeScript (`src/client/**/*.ts` and `*.tsx`,
including declarations; API/query is `src/client/api/` plus
`src/client/queries/`). Newlines and raw bytes from the working tree. Tests and
documentation are listed separately and are not part of the reduction target.

| Production client source  | `4f1eb23` (plan) | `32fb64b` (stage six) | Stage seven | vs six     | vs plan |
| ------------------------- | ---------------- | --------------------- | ----------- | ---------- | ------- |
| UI and other client lines | 25,785           | 23,771                | 23,777      | +6         | −2,008  |
| API/query lines           | 0                | 4,010                 | 3,948       | −62        | +3,948  |
| Total lines               | 25,785           | 27,781                | 27,725      | **−56**    | +1,940  |
| Total bytes               | 783,988          | 836,616               | 835,324     | **−1,292** | +51,336 |

The UI-line increase is `clearJudgeSessionStorage` before judge-query eviction
and `readStoredJudgeGeneration` for delayed-write guards — not formatting or
comment deletion.

Client Vitest files at this revision: 33 files, 7,479 lines, 230,272 bytes.
Playwright: 19 files, 6,087 lines, 201,327 bytes. Documentation under `docs/`
(including this file): 15 files, 4,243 lines, 216,935 bytes. Tests and docs
are not part of the production client reduction target.

### Bundle comparison

Clean `npm run build` with Node v22.14.0 (`/exec-daemon/node`), each revision's
committed lockfile, isolated worktrees whose source paths share the same
18-character prefix (`/tmp/c7measure-pre`, `-six`, `-svn`). Vite's React plugin
embeds absolute `fileName` strings in `jsxDEV` calls unless `NODE_ENV` is
`production` during the client build (Docker's builder does not set it), so
unequal path lengths inflate raw JS. Measure `dist/client/assets/*.js`, exclude
source maps and server output, gzip at compression level 9.

```text
python3 measure-bundle.py dist/client out.json
```

| Revision                                              | JS files | Raw bytes | gzip-9 bytes |
| ----------------------------------------------------- | -------- | --------- | ------------ |
| `4f1eb23`                                             | 36       | 1,037,259 | 260,993      |
| `32fb64b`                                             | 47       | 1,104,411 | 285,288      |
| Stage seven (`c581e07` client; docs do not change JS) | 46       | 1,103,886 | 285,049      |

Stage seven versus stage six: −1 file, −525 raw, −239 gzip-9. Versus the
pre-migration plan: +10 files, +66,627 raw, +24,056 gzip-9. The extra files are
lazy route/domain chunks (Query, scores, queue, seeding, chat helpers), not a
collapsed bundle. Query Devtools remain a 280-byte stub; production JS does not
contain `@tanstack/react-query-devtools`. The missing file versus stage six is
the tiny `judgeSession` chunk, now pulled into the main graph by the delayed
judge-write guard.

Initial route loads `index-*.js` plus the `vendor-*.js` modulepreload only:

| Revision    | Initial JS raw / gzip-9 | Vendor preload raw / gzip-9 | Startup sum raw / gzip-9 |
| ----------- | ----------------------- | --------------------------- | ------------------------ |
| `4f1eb23`   | 372,368 / 111,592       | 67,891 / 22,800             | 440,259 / 134,392        |
| `32fb64b`   | 429,568 / 128,976       | 67,891 / 22,800             | 497,459 / 151,776        |
| Stage seven | 429,852 / 129,095       | 67,891 / 22,800             | 497,743 / 151,895        |

Startup JS is dominated by the Query runtime in `index` (+57,484 raw versus the
plan). Stage seven's index is +284 raw versus stage six (chat write guards).
Representative lazy chunks (raw bytes, equal-path builds):

| Chunk          | Plan   | Stage six | Stage seven |
| -------------- | ------ | --------- | ----------- |
| TeamsTab       | 28,054 | 27,048    | 27,048      |
| SeedingTab     | 2,769  | 2,541     | 2,541       |
| BracketsTab    | 42,337 | 39,563    | 39,563      |
| ScoringTab     | 53,834 | 52,655    | 52,655      |
| QueueTab       | 36,908 | 33,717    | 33,717      |
| AdminsTab      | 6,867  | 5,925     | 5,914       |
| JudgeChatTab   | 8,020  | 8,512     | 8,512       |
| Spectator      | 32,522 | 30,329    | 30,329      |
| ScoreSheetsTab | 59,498 | 60,223    | 60,223      |

Route splitting is unchanged: admin tabs, spectator, judge, and scoresheet stay
lazy. Admin chat remains a `JudgeChatTab` chunk; `useInfiniteQuery` stays a
shared helper chunk with audit.

### Network comparison

One-off Playwright observation (not a committed benchmark). Same seeded
tournament (two checked-in teams, pending seeding score, complete event with
released finals, bracket, chat message), Chromium, e2e Vite stack on 3001/5174,
Node v22.14.0. After the first admin load, tab switches are in-app clicks so
the QueryClient survives; `page.goto` would remount the app and hide cache
reuse.

```text
# spec kept outside the repo; copy into e2e/ for one run, then delete
STAGE7_NETWORK_OUT=/tmp/colosseum-measurements/network-<rev>.json \
STAGE7_REVISION=<rev> \
  npx playwright test e2e/_stage7_network_observe.spec.ts --reporter=line
```

Unique resource fetches (Playwright sometimes emits a request row and a
response row for the same GET; the narrative counts distinct URLs/timings):

| Observation                                  | `4f1eb23`                    | `32fb64b`                     | Stage seven         |
| -------------------------------------------- | ---------------------------- | ----------------------------- | ------------------- |
| Teams GET on first Teams visit               | yes                          | yes                           | yes                 |
| Teams GET when opening Seeding within 30s    | **refetch**                  | **none (cache)**              | **none (cache)**    |
| Teams GET when returning to Teams            | **refetch**                  | **none (cache)**              | **none (cache)**    |
| Overall GET on Overall tab                   | yes (`staleTime` 0 / always) | yes                           | yes                 |
| Scoring `/scores/by-event` in ~11.5s visible | initial + ~10s poll          | initial + ~10s poll           | initial + ~10s poll |
| Scoring polls while tab hidden 11.5s         | **1 poll**                   | **0**                         | **0**               |
| Scoring GET after tab restored               | 1                            | 1                             | 1                   |
| Queue GET in ~11.5s                          | initial + ~10s poll          | initial + ~10s poll           | initial + ~10s poll |
| Queue `If-None-Match` on poll (Playwright)   | not observed                 | not observed                  | not observed        |
| Queue response `ETag`                        | `W/"queue-v1"`               | `W/"queue-v1"`                | `W/"queue-v1"`      |
| Admins `/api/admin/users` in 32s             | initial + ~30s poll          | initial + ~30s poll           | initial + ~30s poll |
| Chat conversations while inbox idle 17s      | more frequent (5)            | initial + ~15s (3)            | initial + ~15s (3)  |
| Chat with thread selected 10s                | 9                            | 7 (3s conversations + latest) | 7                   |
| After successful score accept                | 1 scores list GET            | 1 scores list GET             | 1 scores list GET   |
| Spectator seeding extra GETs after 2s        | 0                            | 0                             | 0                   |
| Spectator overall (lazy click)               | 1 `/overall/public`          | 1                             | 1                   |
| Spectator overall extra GETs after 2s        | 0                            | 0                             | 0                   |

Stage seven matches stage six. Shared team lists reuse 30-second freshness;
derived overall still refetches on mount. Interval polling is 10s (scores,
queue), 30s (admins), 15s inactive chat / 3s active chat. Query pauses scoring
intervals while hidden; the pre-migration client still issued a hidden-tab
poll. Accepting a score refetches the mounted scores list once — no second
identical invalidation GET. Spectator tabs stay lazy and have no interval
polling.

Queue polls return 200 with a stable `W/"queue-v1"` ETag. Playwright did not
expose `If-None-Match` on the outgoing request in this stack, so HTTP 304
revalidation was not confirmed here; `VERSIONED_GET_CACHE = 'no-cache'` remains
the intended browser revalidation mode. Vitest covers abort, 304 empty-body,
and focus/hidden defaults on the Query client.

Unavoidable runtime cost versus the plan is the Query library in the initial
`index` chunk (~57 kB raw), not duplicate polling. Stage seven does not add
network traffic relative to stage six.
