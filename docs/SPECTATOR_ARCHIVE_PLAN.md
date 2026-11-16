# Spectator Archive Implementation Plan

## Recommended approach

Add a **public archive placement** that is separate from an event’s existing status.

Today, “Archive” sets `status = 'archived'`, which excludes the event from public listings and blocks several spectator endpoints. Reusing that status for a browsable archive would change its meaning and risk exposing events that were intentionally hidden.

The new behavior should be:

| Placement / visibility               | Current spectator list | Spectator Archive      | Existing spectator links     |
| ------------------------------------ | ---------------------- | ---------------------- | ---------------------------- |
| Current, publicly visible            | Shown                  | Not shown              | Continue working             |
| Public archive, assigned to a season | Not shown              | Shown under its season | Continue working             |
| Existing hidden/archived status      | Not shown              | Not shown              | Existing restrictions remain |

Moving an event into the public archive should **not** change its lifecycle status, release results, delete data, or lock it against admin edits.

## Implementation plan

### Testing requirements for every step

Treat each step's tests as part of that step, not as work deferred to step 6. Add regression tests that fail without the implementation, then run the relevant SQL, HTTP, client, or browser tests before moving on.

- Use real PostgreSQL for constraints, migrations, persistence, joins, and HTTP authorization tests. Use focused client tests for rendering/state transitions and Playwright for real navigation and admin/spectator integration. Do not mock away the rule being tested.
- Make public-access assertions with **genuinely anonymous requests and fresh browser contexts**. An admin-authenticated test app or browser is not proof that a spectator link works or that a public endpoint enforces its visibility rules.
- Seed distinct, nonempty sentinel data for current, archive, hidden, released, and unreleased events, with overlapping seasons and deliberately different event/season IDs. Assert exact identities, response keys, order, and persisted state, not just HTTP success, counts, or the absence of a tab. Before state-preservation snapshots, materialize any existing lazy/derived results so later reads cannot be mistaken for archive-induced mutations.
- Keep metadata visibility separate from final-results access: a nonhidden completed event with unreleased results remains listable in its placement and accessible by its public detail URL, but must not expose gated results.
- Before writing assertions, pin any still-unspecified contract: season-name whitespace/case normalization and limits, sort-order direction and ties, event-date direction and missing dates, whether returning to current retains the season, and season-list read authorization. If optional season filtering or season-specific back navigation is implemented, it needs the same negative coverage as the required behavior.
- Use controlled deferred responses, request interception, and database fault injection rather than timing sleeps. Restore test state, close connections, and isolate browser contexts so tests pass independently and do not leak admin sessions or fixtures into other suites.

### 1. Add season assignment and spectator placement

Extend the schema through the existing schema runner:

- Add `events.spectator_listing`: `current | archive`, defaulting to `current`.
- Add nullable `events.season_id`.
- Add a small `seasons` table with an ID, unique display name, and explicit sort order.
- Require a valid season when placing an event in the public archive.

Using named seasons supports both `2026` and `2025–2026`, without assuming that an event’s date determines its competition season. Current events may also have a season assigned.

**Step 1 schema contracts:**

- `seasons.name` is stored verbatim and must be 1–100 PostgreSQL characters long, without leading/trailing whitespace matching PostgreSQL `[[:space:]]`. Invalid names are rejected rather than silently trimmed; display case, internal whitespace, and punctuation are preserved. A unique index on `lower(name)` prevents case-only duplicates under the database locale.
- `seasons.sort_order` is a non-null signed 32-bit PostgreSQL `INTEGER` (`-2147483648` through `2147483647`), defaulting to `0`. Listing direction and tie-breaks will be pinned when the listing contract is implemented.
- `events.season_id` references `seasons.id` with `ON DELETE RESTRICT`, for both current and archive placements. Deleting a referenced season cannot delete events or clear their assignments.
- Updating placement back to `current` does not implicitly clear the season; an explicit same-statement clear is permitted. Neither placement nor season is inferred from event dates, lifecycle status, or release state.
- Placement checks, the season foreign key, and the archive-requires-season check run through the schema runner's constraint phase for fresh installs and upgrades alike. Existing events receive `current` and `NULL` without other row changes.

**Primary files:** `src/server/database/schema/events.ts`, `src/client/utils/eventStatus.ts`.

**Adversarial tests and acceptance criteria:**

- **Defaults and valid combinations:** insert an event without either field and assert persisted `spectator_listing = 'current'` and `season_id = NULL`. Cover current events with and without a season, and archive events with a valid season, across `setup`, `active`, `complete`, and hidden `archived` lifecycle statuses. Placement alone must not constrain lifecycle status or change the results-release flag.
- **Database invariants, not just form validation:** use direct SQL inserts and updates to reject null/unknown placement values, nonexistent season references, and archive placement without a season. Reject clearing an archive event's season unless the same update returns it to current. A failed multi-field write must leave the entire prior row intact.
- **Season integrity:** verify unique display names under the chosen normalization policy, distinct `2026` and `2025–2026` labels, and the configured sort-order type/default. Cover empty/whitespace-only names and documented length/integer boundaries at the appropriate database/API layer. Duplicate creation must not silently create two picker options. Exercise foreign-key deletion behavior directly: deleting a referenced season must not delete events or leave archive events seasonless; this does not require adding a season-delete API.
- **No inferred placement or season:** seed old, future-dated, undated, and cross-calendar-year events. Dates must not assign a season, move placement, complete an event, release results, or unhide an event.
- **Independent client concepts:** extend status/placement utility tests so `spectator_listing = 'archive'` cannot be treated as `status = 'archived'`. Preserve existing lifecycle helpers and their behavior; if the hidden-status label changes, assert that it is distinguishable from public archive placement.
- **Both schema paths:** run these constraint checks against a fresh install and a migrated pre-feature schema; the full migration/rerun/failure matrix is in step 6. A fresh-schema test alone does not prove an existing database receives the columns and constraints.

**Test targets:** extend `tests/sql/schema.test.ts` and `tests/client/eventStatus.test.ts`; add a focused archive/season schema test file under `tests/sql/` if needed. Use `tests/sql/helpers/testDb.ts` for isolated PostgreSQL schemas.

### 2. Extend the event APIs

In `src/server/routes/events.ts`:

- Extend the existing admin create/update APIs to accept and validate the new fields.
- Save placement and season together in one update, using the existing audit mechanism.
- Add minimal authenticated/admin season listing and creation support for the season picker; a separate season-management screen is unnecessary initially.
- Update the public listing contract:
  - `GET /events/public` returns current events.
  - `GET /events/public?listing=archive` returns public-archive events, including their season metadata.
  - Optionally accept `season_id` for filtering.
- Preserve the array response shape and explicit public-field allowlist.
- Always exclude `status = 'archived'`, regardless of placement.
- Keep `GET /events/:id/public` accessible for both current and public-archive events.

Retain the existing final-results gate: a completed event must still have results explicitly released. Archive placement must not bypass that rule.

**Step 2 API contracts:**

- `GET /events/seasons` requires authentication (401 for anonymous/access-code-only judges), including non-admin users; `POST /events/seasons` requires admin (403 otherwise). Responses explicitly contain `id`, `name`, and `sort_order`. Creation accepts the step 1 name contract and a JSON signed-32-bit integer sort order (default `0`); invalid input is 400 and case-insensitive name conflicts, including races, are 409.
- Event body `season_id` accepts `null`, a positive signed-32-bit JSON integer, or a canonical decimal string (`1` through `2147483647`, without signs, leading zeroes, whitespace, or trailing characters). Public query IDs use the same canonical decimal strings. Invalid IDs/placements, nonexistent season assignments, or invalid resulting archive rows return actionable 400s without partial writes.
- `listing` accepts only one scalar `current` or `archive`, defaulting to `current`. Optional `season_id` filters either placement; a valid nonexistent/empty/hidden-only season returns `[]`. Malformed, repeated, or structured selectors return 400, never a broader list.
- Both public list and detail add the flat fields `spectator_listing`, `season_id`, `season_name`, and `season_sort_order`; unassigned season fields are `null`. The existing safe fields and array list shape remain unchanged; raw release flags and private event configuration remain excluded.
- Seasons sort by `sort_order DESC, id DESC`. Archive lists use that season order first; events within a season, and the entire current listing, sort by `event_date DESC NULLS LAST, created_at DESC, id DESC`.
- PATCH locks the event before validating the resulting row, preserves omitted fields, and writes placement/season in one statement. Returning to current retains the season unless explicitly cleared. Audit entries contain actual before/after snapshots and the acting user. The existing post-write audit-failure policy remains: a committed mutation is not undone if audit persistence fails.

**Adversarial tests and acceptance criteria:**

- **Create/update round trips:** cover omitted fields on creation, current placement with an optional season, creation directly into archive, current → archive, archive → current, and archive season A → season B. Read back stored values and both admin/public responses. PATCH omission means preserve the existing value, not reset to defaults; explicitly clearing a current event's season is different from omitting it.
- **Validate the resulting row:** moving an already-seasoned current event may reuse its valid season. Moving an unseasoned event requires a valid season in the same request. Clearing the season of an event that remains in archive fails, including when `spectator_listing` is omitted. Unrelated edits to a valid archive event must continue working without resending placement/season.
- **Hostile payloads:** table-test invalid placement values (including lifecycle `archived`), empty strings, nulls, booleans, arrays/objects, and season IDs that are nonexistent, zero/negative, fractional, out of integer range, or contain trailing junk/SQL-like text. Pin whether canonical numeric strings are accepted; do not accept lossy coercion. Exercise invalid season names and sort orders too. Validation failures return actionable 4xx responses rather than database-error 500s, with no partial mutation of other submitted fields.
- **Authorization:** exercise anonymous, authenticated non-admin, judge-access-code-only, and admin callers. Event mutations retain the existing admin boundary (403 for anonymous/non-admin requests); public reads remain public. Season management rejects anonymous access, season creation requires admin, and listing follows the explicitly chosen authenticated/admin policy. Forbidden requests must not change rows or create successful mutation audit entries, even with forged `is_admin`, creator, status, or release fields in the body.
- **Atomicity and audit:** change placement and season together, inject a persistence failure, and assert neither can commit alone. Verify the existing audit mechanism records the actor and actual old/new placement/season for successful writes, without invented lifecycle/release changes or success entries for failed writes. Retain the existing audit-failure policy. Concurrent placement/season edits must leave a valid pair; a placement-only request must not overwrite an independent status or release change. Do not require a new optimistic-locking feature.
- **Season-creation races:** submit duplicate season names concurrently; assert exactly one season row is created and the losing request receives the chosen validation/conflict response, not a 500. The winning season must remain usable for an event assignment.
- **Listing selectors and filters:** assert that omitted `listing` and explicit `listing=current` return the same current-only array, while `listing=archive` returns archive-only events with correct season metadata. Test mixed placements within one season and several seasons. If `season_id` filtering is implemented, test each placement with it, an empty season, a well-formed nonexistent ID (empty array), and a season containing only hidden events. Invalid, repeated, or structured selectors must fail with the documented 4xx contract, never broaden the query; added `status=archived` or release-related parameters cannot bypass visibility.
- **Exact public contract:** assert array shape for empty and populated lists and exact approved key sets for both listings and detail. Permit only explicitly approved placement/season metadata; continue excluding creator/timestamps, description, raw `spectator_results_released`, admin configuration, and unrelated joined columns. Give the event and season different IDs/names to catch joins overwriting event identity. List/detail metadata and `final_scores_available` must agree.
- **Visibility/release matrix:** parameterize both placements over the matrix below, using anonymous requests and populated result fixtures. For nonhidden events, placement selects exactly one listing; a current event with a season must not enter the archive. Hidden status must override either placement and any release flag. Missing events retain the existing 404 behavior.

| Lifecycle status    | Results released                                                 | Public metadata/list eligibility                             | Gated final-results access |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| `setup` or `active` | Either value, including a deliberately seeded stale release flag | Yes, in its placement only                                   | 404                        |
| `complete`          | No                                                               | Yes, in its placement only; `final_scores_available = false` | 404                        |
| `complete`          | Yes                                                              | Yes, in its placement only; `final_scores_available = true`  | 200 with expected results  |
| Hidden `archived`   | Either value                                                     | Neither list; public detail is 404                           | 404                        |

Run the final-results matrix against **all four existing gated endpoints**, not just the event list or UI tabs:

- `GET /documentation-scores/event/:eventId/public`
- `GET /awards/event/:eventId/public`
- `GET /brackets/:bracketId/rankings/public`
- `GET /events/:eventId/overall/public`

Use a bracket's actual owning event when testing rankings: a released event ID in another URL/query must not authorize an unreleased or hidden event's bracket. Preserve existing hidden-event restrictions on live spectator endpoints too; archive queries must not create a new path around them. Any pre-existing visibility gap discovered outside these restrictions should be recorded separately, not described as fixed by this feature.

**Test targets:** extend `tests/http/events.test.ts`, `tests/http/events.public.test.ts`, `tests/http/finalScores.public.test.ts`, and `tests/http/auditCoverage.test.ts`; cover season routes in an appropriate focused HTTP test file. Extend existing awards/bracket privacy tests where shared queries change.

### 3. Add clear admin controls

Update `src/client/components/admin/EventsTab.tsx`:

- Add a season field to the event form.
- Add **Move to Spectator Archive**, with a dialog requiring a season and explaining that the event will remain publicly viewable.
- Add **Return to Current Events** for reversing the move.
- Show season and spectator placement in the event details/list, with a placement filter so archived events remain easy to manage.
- Recommend relabeling the existing **Archive** action to **Hide from Spectators**, and clarifying its confirmation text. Keep its existing backend status and behavior.

The normal workflow would be to complete an event, release results when ready, and then move it into the appropriate season’s archive. These remain separate actions.

**Adversarial tests and acceptance criteria:**

- **Form persistence:** create/edit current events with no season or a selected season, reopen the form, and reload the page to verify server persistence. Test an empty season catalog, creating a season through the picker, duplicate/invalid names, and failed/slow season loads. A load failure must not silently clear an existing assignment or send a default value over it.
- **Move dialog:** assert the correct event identity, required season, clear public-visibility explanation, and separation from hiding/releasing results. Submitting without a season is blocked and a crafted API request is still rejected server-side. Cancel, Escape, and any supported backdrop dismissal cause no mutation. Reopening for another event must not reuse a stale event ID or season selection.
- **Mutation failures and retries:** intercept 4xx, expired-session/forbidden, network, and 5xx responses. Keep the event in its last confirmed placement, preserve the chosen season for correction/retry, show an actionable error, and avoid false success notifications. Disable duplicate submissions while pending. If season creation succeeds but assignment fails, retry must reuse the created season rather than create duplicates.
- **Stale responses:** delay a season load or move response, switch selected events or filters, then resolve requests out of order. The result must not mutate another event's form, close its dialog, or overwrite newer list state. A successful move must reconcile against the saved server values, not just an optimistic local toggle.
- **Manageability:** verify current/archive/all placement filters independently of lifecycle-status filters, including current events with seasons and hidden events with archive placement. A moved event must be discoverable in the archive/all admin view after refresh; returning it must restore current placement with the documented season-retention behavior. Placement must not lock further admin edits.
- **No destructive side effects:** snapshot status, release flag, teams, scores, bracket games/rankings, documentation, and awards before move/return. Compare after both operations, allowing only placement/season and normal audit/update metadata to differ. Cover both released and unreleased completed events and a noncomplete event; the recommended workflow must not accidentally become a new completion/release prerequisite.
- **Distinct hide behavior:** “Hide from Spectators” must retain the legacy `status = 'archived'` behavior for both placements and remove/block the existing public views. Moving or returning an already-hidden event must never unhide it, and the UI must not promise otherwise. Verify that completing, releasing, moving, returning, and hiding remain separate requests/actions.
- **Accessibility:** test labeled season controls, keyboard-only selection, dialog focus/return focus, reachable confirmation/cancel controls, and visible/announced validation and pending/error states. Long and script-like season/event names render as text and do not obscure or replace the action labels.

**Test targets:** add focused component tests under `tests/client/` using the existing React/jsdom patterns, and extend `e2e/admin-tournament-setup.spec.ts` for the real admin flow. Keep server authorization and state-preservation assertions in the HTTP tests from step 2; disabled controls are not a security boundary.

### 4. Build the spectator Archive area

Add `/spectator/archive`, with **Current Events** and **Archive** navigation on both listing pages.

- Group archive event cards under season headings.
- Order seasons newest first using the configured sort order.
- Order events within each season by date, with deterministic tie-breaking.
- Reuse the existing event-card presentation and “Final results available” indicator.
- Include loading, error/retry, and empty states.
- Only show season groups containing publicly visible archive events.

**Primary files:** `src/client/pages/SpectatorEvents.tsx`, `src/client/App.tsx`, `src/client/utils/routes.ts`, plus a new archive page and shared card component where useful.

**Adversarial tests and acceptance criteria:**

- **Grouping and exclusion:** render multiple seasons containing mixed current/archive, hidden/nonhidden, and released/unreleased events. Every eligible archive event appears exactly once under its assigned season; current events, hidden events, empty seasons, and hidden-only seasons produce no archive cards/headings/counts. Nonhidden setup/active archive events and completed-but-unreleased archive events remain visible under the unchanged public policy.
- **Ordering independent of input:** shuffle API rows and use season names whose lexical/date order disagrees with configured sort order. Assert configured season order, stable tie-breaking for equal season sort orders, the chosen event-date direction, deterministic ties for identical dates/names, and explicit handling of null dates. Re-render/refetch with shuffled input and verify identical output. Season membership must come from assignment, not event date.
- **Card parity:** assert event identity, unchanged detail link, date/location fallbacks, and the existing final-results indicator on both listing pages. The badge follows `final_scores_available`, not archive placement, season, or completed status alone. Test long, Unicode, duplicate, and HTML/script-like event/season names as literal text; duplicate names must not merge separate event IDs.
- **Loading/error/empty behavior:** control unresolved requests, network rejection, 5xx, and retry success. Loading, failure, and a successful empty archive must be distinguishable. Empty current events with a populated archive, an empty archive with current events, and both lists empty must all retain working navigation. Refetching after a failed request must not duplicate cards or preserve obsolete headings.
- **Navigation and races:** open `/spectator/archive` anonymously by direct URL and refresh; ensure it resolves as the archive route rather than an event ID. Verify Current Events/Archive links and active navigation on both pages, browser back/forward, and correct requests after switching pages. Resolve an old list request after navigation/unmount and assert it cannot replace the new page's data or error state. If season filtering/navigation is added, repeat with rapid season changes and invalid/unknown season IDs.
- **Accessibility and layout:** test heading hierarchy, accessible card/link names and active navigation, keyboard activation, discoverable retry controls, and narrow-viewport behavior with long labels. Verify the same underlying event link is usable without relying on a mouse-only card handler.

**Test targets:** add focused grouping/sorting/shared-card/page tests under `tests/client/`, and extend list/card/navigation coverage in `e2e/spectator-public.spec.ts`. Use deliberately unsorted fixtures rather than relying on insertion order.

### 5. Decouple event details from the current listing

This is an important dependency: `src/client/pages/Spectator.tsx` currently loads `/events/public` and finds the selected event in that list. Once archived events leave that response, their detail pages would stop working correctly.

Change it to:

- Load selected-event metadata from `/events/:id/public`.
- Keep existing event and bracket URLs unchanged, preserving bookmarks and shared links.
- Show **Back to Archive** for public-archive events, ideally returning to their season.
- Preserve existing seeding, bracket, awards, documentation, and overall-results behavior.

**Adversarial tests and acceptance criteria:**

- **Prove the dependency is gone:** open a public-archive event and its existing bracket URL in a fresh anonymous context with **zero current events**. Repeat while `/events/public` fails or returns unrelated events, but `/events/:id/public` succeeds. Assert the selected-event request is used and that event details neither require nor recover metadata from the current listing or an authenticated event API. Repeat for a current event to catch regressions.
- **Bookmark compatibility:** navigate directly to and refresh existing event/bracket URLs and their supported tab/query variants, without first visiting either listing. Preserve selected event, bracket, and view across refresh and browser history. Back links use metadata placement: current → Current Events, public archive → Archive; test a direct-entry session with no browser history. If season-specific return is implemented, verify the correct season and a safe fallback for missing/invalid season state.
- **Bad and unavailable IDs:** exercise malformed/nonexistent event IDs, deleted/hidden events, and nonexistent brackets. Show the existing unavailable/error experience without crashing, rendering another event, exposing stale results, or falling back to privileged endpoints. Public detail 404 and a retryable network/5xx failure must not be conflated. For mismatched event/bracket IDs, preserve the existing routing contract while proving that the bracket's actual owning event governs visibility/release; another event must not lend it authorization. Do not make new client-side ownership rejection an implicit requirement of this feature.
- **Request races and stale data:** delay event A metadata/results, navigate to B, and resolve A last; only B's heading, tabs, data, and back target may render. Include A released/B unreleased, A archive/B current, and a successful event followed by a hidden/missing one. Clear prior event data on identity change, handle unmounts, and test recovery after a transient detail fetch failure.
- **Preserve permitted live views:** for both placements, verify ordinary and double-seeding scores/rankings where configured, bracket lists/games, event switching, and existing live behavior without releasing results. For released complete events, verify populated documentation, awards, bracket rankings, and overall results, not just tab presence or successful fetches.
- **No UI-only gating:** directly enter supported documentation/awards/overall/rankings URLs for unreleased, reopened, and hidden events, and request the four gated APIs from step 2. Denied cases must retain their existing 404 rules even if a query selects a hidden tab or another event is released. Ordinary bracket responses must continue omitting final-ranking/weighted-score fields; metadata/card responses cannot become an alternate source of gated result data or award recipient details.
- **Changing visibility/release state:** load an archived-placement event, revoke its release, then reload/revalidate and assert gated data and tabs disappear. Re-release and explicitly assert restoration. Hide the event and assert it becomes unavailable on the next fetch; returning its placement to current must not undo the hidden status. Do not claim already-delivered browser data can be retroactively erased or add a new live-update guarantee.

**Test targets:** add focused detail-page tests under `tests/client/` (using controlled async responses as in `tests/client/useScopedLoad.test.ts`) and extend `e2e/spectator-public.spec.ts`. Retain ownership/privacy/gating assertions in `tests/http/finalScores.public.test.ts` and `tests/http/brackets.crud.test.ts`.

### 6. Migrate safely and test the full workflow

**Migration:**

- Use additive, repeatable schema changes for both existing databases and fresh installs.
- Default all existing events to `current`, preserving present behavior.
- Leave season assignment optional until an admin moves an event.
- Do not automatically publish existing hidden events or move events based on age.

**Adversarial migration tests and acceptance criteria:**

- **Actual upgrade fixture:** use an isolated schema from `createMinimalTestDb()` in `tests/sql/helpers/testDb.ts` to construct a representative pre-feature schema before invoking the production schema runner. Do not use only `createTestDb()`, which already initializes the latest schema and can hide missing upgrade logic. Never alter a developer/app database to simulate an upgrade.
- **Legacy data preservation:** seed every lifecycle status, both release states, old/future/null event dates, creator references, and populated teams/scores/brackets/documentation/awards. After migration, assert every existing event is current with no season, hidden statuses remain hidden, and all pre-existing identities, lifecycle/release values, dates, scores, and references survive. No date-based moves or result publication are allowed.
- **Fresh/upgrade equivalence:** compare columns, defaults, nullability, checks, foreign keys, unique constraints, and relevant indexes between fresh and upgraded schemas; rerun the step 1 invalid-write tests against both. Verify adding the new season table does not break initialization order or existing event/team triggers.
- **Repeatability and partial states:** run initialization repeatedly, including after seasons and archive assignments have been created. Reruns must not duplicate constraints/indexes/rows, reset placement, clear seasons, or reseed sort orders. Test a compatible intermediate schema with only some additions present, including new columns already present but required constraints missing, so a simple column-exists check cannot conceal an incomplete upgrade.
- **Failure and recovery:** inject a failure during schema application and verify the existing transaction rolls back schema/data changes together. Remove the fault and rerun successfully. Assert the failed run neither publishes hidden events nor leaves an invalid archive/season pair or a partially usable schema.
- **Harness isolation:** verify the new table is included in test resets and fixture cleanup, with no season/assignment leakage across tests. Any new PostgreSQL pool must use `POSTGRES_SESSION_OPTIONS` and `postgresTypes`; date-ordering assertions must not shift dates in non-UTC environments. Follow the existing time-zone test helpers where applicable.

**End-to-end release gate:**

1. Seed multiple deliberately out-of-order seasons, a released completed current event with nonempty results, an unreleased completed current event, an already-hidden event, and a current event with a season. Also seed a separate visible archive event in its own season to test hiding without disturbing the main round trip. Materialize existing derived bracket/overall results before capturing event/child-row state, so read-triggered ranking calculations do not invalidate preservation checks. Use separate admin and anonymous spectator contexts throughout.
2. As admin, attempt a move without a season and assert validation/no mutation. Select/create a season, move the released event, reload the admin view, and confirm its saved placement/season. Confirm no implicit completion, release, or hide request was sent.
3. As spectator, refresh Current Events and assert that exact event is absent, then open Archive and assert it appears exactly once under the correct heading/order with its final-results indicator. Current events with that season and hidden events must remain excluded from Archive.
4. Move the unreleased completed event into the same archive season, and move any remaining publicly visible current events into archive so the current list is empty. In a fresh spectator context, directly open and refresh the original event and bracket URLs. Verify seeding, bracket, documentation, awards, rankings, and overall data, plus the archive back link, without warming either list first.
5. Inspect the unreleased completed event now in the archive. Assert it is listed but has no final-results indicator or gated data; request all four final-results APIs and assert 404. Release → revoke → re-release this event's results, explicitly checking both denied and restored responses/tabs after reload. Reopen this formerly unreleased event and complete it again; the existing release-reset behavior must prevent automatic republication. Leave the original released event unchanged for the return trip.
6. Hide the separately seeded visible archive event and verify its card disappears and the public detail, final-results endpoints, and live spectator endpoints that already enforce hidden status remain blocked. Change its placement back to current via admin/API and prove it is still hidden. Keep its now-hidden-only season absent from the spectator page.
7. Return the visible released archive event to current. Confirm the reverse listing transition after refresh, unchanged bookmark URLs, the current-events back link, persisted season behavior, and continued admin editability. Move it again if needed to exercise repeated round trips. Compare the original state snapshot: only intended placement/season, explicit release/status actions from this scenario, and audit/update metadata may differ.
8. In independent isolated cases, repeat mutation authorization failures and recoverable network/server failures from earlier steps. Assert no half-moved event, orphaned assignment, false success, duplicate season/card, or exposure of another event's data. Do not make one long stateful scenario the only coverage of any invariant.

**Test ownership and execution:**

- SQL/migrations: `tests/sql/schema.test.ts`, a focused new archive-migration test under `tests/sql/`, and the isolated schema helpers.
- HTTP/contracts/security: `tests/http/events.test.ts`, `tests/http/events.public.test.ts`, `tests/http/finalScores.public.test.ts`, `tests/http/auditCoverage.test.ts`, and season-route tests. Extend `tests/http/awards.test.ts` and `tests/http/brackets.crud.test.ts` for privacy/ownership, plus the existing teams/seeding/double-seeding suites for hidden/live regressions where affected.
- Client: extend `tests/client/eventStatus.test.ts` and add focused tests for admin forms/dialogs, archive grouping/order, shared cards, routes, and selected-event loading. Reuse the repository's React/jsdom and deferred-request patterns rather than adding a test dependency solely for this feature.
- Browser: extend `e2e/admin-tournament-setup.spec.ts` and `e2e/spectator-public.spec.ts`. Check actual re-release restoration rather than merely restoring a database flag in test cleanup. Keep assertions event/season-scoped so unrelated fixtures cannot satisfy them.
- Run focused SQL/HTTP/client cases with `npm run test:run -- <test paths>` and focused browser cases with `npm run test:e2e -- e2e/spectator-public.spec.ts e2e/admin-tournament-setup.spec.ts`, then run the full Vitest and Playwright suites. PostgreSQL is required; inside the devcontainer use its existing `postgres` service and preset URLs, without invoking Docker commands there.
- Before accepting the implementation, run `npm run pretty`, `npm run lint`, both typechecks, `npm run test:run`, `npm run test:e2e`, and `npm run build`. Also check this document explicitly with `npx prettier docs/SPECTATOR_ARCHIVE_PLAN.md --check` because `npm run pretty` checks only `src/`. Record commands and actual outcomes; document unrelated baseline failures or unavailable infrastructure rather than claiming validation passed.

## Scope recommendation

Keep the first version to **manual, per-event moves and season grouping**. Defer automatic age-based archiving, bulk moves, and immutable historical snapshots.

## Status

Steps 1–3 are implemented: the schema runner adds seasons, event season assignment, and independent spectator placement on fresh installs and upgrades; the client model exposes separate lifecycle and placement concepts. Event APIs support validated, audited placement/season writes, authenticated season listing/admin creation, and anonymous current/archive listings and event details with safe season metadata. Admin event controls now support optional season assignment, inline season creation, explicit move/return dialogs, season/placement metadata, and independent lifecycle/placement filters. Hidden lifecycle status and final-results release gates remain independent of placement. Steps 4–6, including the spectator Archive browsing UI, remain planned.

Step 1 validation:

- Regression tests were added and observed failing before implementation.
- `npm run test:run -- tests/sql/spectatorArchiveSchema.test.ts tests/sql/schema.test.ts tests/client/eventStatus.test.ts`: 131 tests passed, including the same invariants on fresh and pre-feature schemas.
- `npm run test:run`: all 1,437 tests passed across 101 files. The existing schema inventory was updated to include `seasons`.
- `npm run test:e2e -- --reporter=line`: all 97 existing browser tests passed.
- `npm run pretty`, `npm run lint`, `npm run typecheck:client`, and `npm run typecheck:server`: passed. The plan and changed test files were also explicitly checked with Prettier, and the archive-schema/client-model tests were typechecked.
- `npm run build`: passed, with the existing unrelated `eval` warning in `src/client/components/scoresheetUtils.ts`.

Step 2 validation:

- New API regression tests were added and observed failing before implementation; season-route tests initially failed because the route did not exist. The first event-write run had 45 failures and the first public-list run had 102 failures.
- `npm run test:run`: all 1,694 tests passed across 103 files, including PostgreSQL-backed write validation, authorization, duplicate-season races, controlled concurrent edits, persistence/audit fault injection, exact anonymous metadata contracts, and all four final-results endpoints across the full placement/status/release matrix.
- Populated-state preservation tests materialize lazy results before snapshots and verify placement/season moves leave other persistent data and released results unchanged. Reopening an event still clears release in both placements.
- `npm run test:e2e -- --reporter=line`: all 97 existing browser tests passed.
- `npm run pretty`, explicit Prettier checks of changed documentation/tests, `npm run lint`, targeted ESLint for changed tests, `npm run typecheck:client`, `npm run typecheck:server`, `npm run build`, and `git diff --check`: passed.
- An additional standalone TypeScript check of the changed HTTP tests is blocked by three pre-existing errors in the unchanged `tests/http/helpers/seed.ts` (lines 343–345): `SeedScoreSubmissionData` lacks `result_type`, `disqualified_team_id`, and `result_note`. The normal application typechecks and runtime test suite pass; these unrelated helper types were not changed.

Step 3 UI contracts and validation:

- The admin list defaults to all placements, with independent lifecycle and placement filters. The selected event remains visible above the filtered list. Hidden lifecycle status is labeled **Hidden from Spectators** locally in event management, without changing the shared lifecycle helpers or backend status values.
- Current-event forms allow no season; archive-event forms require a season. Unchanged season assignments are omitted from edit requests, including during slow or failed catalog loads. New season names are sent verbatim, with code-point length/common-whitespace validation and the server remaining authoritative for PostgreSQL locale-specific rules. Inline creation exposes the existing signed-32-bit sort order and explains descending order/ties.
- Moving requires a season and changes only placement/season. Returning omits the season to retain its saved assignment. Neither action requires completion/release or unhides hidden events. **Hide from Spectators** retains the legacy status mutation, including the existing backend behavior of clearing the results-release flag when leaving Complete; the confirmation explains this distinction.
- Mutation errors preserve inputs for retry, pending writes disable duplicate submission/dismissal, and created seasons survive assignment retries and overlapping catalog reads. Server-saved events reconcile into the authenticated event cache, including after browser-history navigation away from a pending dialog. Background refreshes preserve filters and focus; when a moved row leaves the filter, focus returns to the placement filter instead.
- New component/state and browser regression tests were observed failing before implementation. Focused coverage now includes 88 tests in `tests/client/eventsTab.test.ts`, `tests/client/eventContext.test.ts`, and `tests/client/useSeasons.test.ts`, with controlled deferred responses for errors, retries, catalog/save races, unmounts, and auth-scope changes.
- `npm run test:run`: all 1,782 tests passed across 106 files, including the existing PostgreSQL-backed authorization, visibility, audit, and populated-state preservation regressions from step 2.
- `npm run test:e2e -- e2e/admin-tournament-setup.spec.ts --reporter=line`: all 22 tests passed. Added workflows cover persisted season assignment/creation/clearing, move/return across lifecycle/release states, fresh anonymous visibility checks, sentinel-data preservation, independent filters, editability, hiding, keyboard dismissal/focus, delayed background reads, and browser-history navigation during a save.
- `npm run test:e2e -- --reporter=line`: all 111 browser tests passed.
- `npm run pretty`, explicit Prettier/ESLint checks of changed tests, `npm run lint`, `npm run typecheck:client`, `npm run typecheck:server`, `npm run build`, and `git diff --check`: passed. The build still reports the existing unrelated `eval` warning in `src/client/components/scoresheetUtils.ts`.

### Pre-existing visibility gaps (outside step 2)

Anonymous probes with populated hidden-event fixtures found that these existing routes do not enforce hidden lifecycle status: `GET /teams/:id`, `GET /seeding/scores/team/:teamId`, `GET /double-seeding/scores/team/:teamId`, `GET /brackets/:id/games`, and `GET /queue/event/:eventId`. They are unchanged by this feature and need a separate visibility-hardening follow-up; passing the archive tests must not be interpreted as fixing them.
