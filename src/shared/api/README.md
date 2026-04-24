# `src/shared/api/` — Shared API response DTOs

This directory is the single source of truth for **HTTP response shapes**
exchanged between the Express server (`src/server/`) and the React client
(`src/client/`). Both `tsconfig.json` (server) and `tsconfig.client.json`
(client) include `src/shared`, so types defined here are usable on both
sides without any build-config changes.

It complements `src/shared/domain/`, which holds canonical **entity**
DTOs, enums, label maps, and validators (e.g. `Event`, `Bracket`,
`TeamStatus`). Where a response simply returns a domain entity, prefer
re-using or re-exporting that entity instead of restating it.

## Why this exists

Before this folder existed, response shapes were redeclared on the client
(usually as `interface Foo { ... }` near the call site). That made
silent contract drift very easy: a server route could add, rename, or
drop a field and the client would compile fine while reading
`undefined` at runtime. Centralising response DTOs lets the TypeScript
compiler catch drift at build time.

## Rules for adding a new response DTO

1. **One DTO per response shape.** Name it after the response, e.g.
   `PublicEvent` for `GET /events/:id/public`, `EventScoresPage` for the
   paginated `GET /scores/by-event/:eventId`. If two endpoints really
   return the exact same shape, share one type and document both routes
   in its doc comment.
2. **Reuse `src/shared/domain/`.** Status fields should be typed with the
   domain enum (e.g. `EventStatus`, `QueueStatus`, `BracketStatus`,
   `ScoreSubmissionStatus`), never `string`. Entity payloads should reuse
   the domain DTO (e.g. `Event`, `Bracket`).
3. **No `any`, no stringly-typed unions.** If the wire format is a small
   set of literals, type it as a union (e.g. `'seeding' | 'bracket'`) or
   reuse the matching domain enum.
4. **Prefer `readonly` arrays and properties.** A decoded response is, by
   construction, a snapshot — mutating it in place is almost always a
   bug. `readonly Foo[]` everywhere keeps that intent in the type
   system.
5. **Document the route(s) that produce the shape** in a JSDoc comment at
   the top of each file, so a future maintainer can find the server
   handler from the type and vice versa.
6. **Imports.** From the server use `from '../../shared/api'`; from the
   client use `from '../../shared/api'` (depth varies). The barrel
   `src/shared/api/index.ts` re-exports everything.

## Currently shared

| Type / family                                                                                                                                                                                   | File                     | Server handler(s)                                                                                                                                                                                                                                                                   | Client consumer(s)                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PublicEvent`, `PublicEventListResponse`                                                                                                                                                        | `events.ts`              | `GET /events/public`, `GET /events/:id/public` (`src/server/routes/events.ts`)                                                                                                                                                                                                      | `pages/SpectatorEvents.tsx`, `pages/Spectator.tsx`                                                                                             |
| `AutomaticAwardsPublic` and the `MedalPlacement` family; `AwardTemplate`, `EventAward`, `EventAwardRecipient`, `ApplyAutomaticAwardsResponse`; `PublicManualAward`, `PublicEventAwardsResponse` | `awards.ts`              | Templates: `GET/POST/PATCH /awards/templates`. Admin event awards: `GET /awards/event/:eventId`, `POST /awards/event/:eventId/automatic`. Public bundle: `GET /awards/event/:eventId/public` (composed from `computeAutomaticAwards()` in `src/server/services/automaticAwards.ts`) | `components/admin/AwardsTab.tsx`, `components/spectator/SpectatorAutomaticAwards.tsx`, `pages/Spectator.tsx`                                   |
| `EventScoresResponse`, `EventScoreSubmission`, `ScoreData`, `ScoreDataField`                                                                                                                    | `scores.ts`              | `GET /scores/by-event/:eventId` (`src/server/routes/scores.ts`)                                                                                                                                                                                                                     | `components/admin/ScoringTab.tsx`                                                                                                              |
| `OverallScoreRow`, `OverallScoresResponse`                                                                                                                                                      | `overall.ts`             | `GET /events/:id/overall`, `GET /events/:id/overall/public` (`src/server/routes/events.ts`); `computeOverallScores()` (`src/server/services/overallScores.ts`)                                                                                                                      | `components/overall/OverallScoresDisplay.tsx`, `components/admin/OverallTab.tsx`, `pages/Spectator.tsx`                                        |
| `AuditLogEntry`, `AuditLogResponse`                                                                                                                                                             | `audit.ts`               | `GET /audit/event/:eventId`, `GET /audit/entity/:type/:id` (`src/server/routes/audit.ts`)                                                                                                                                                                                           | `components/admin/AuditTab.tsx` (incl. `EntityHistoryModal`)                                                                                   |
| `AuthUser`                                                                                                                                                                                      | `auth.ts`                | `GET /auth/user` (`src/server/routes/auth.ts`)                                                                                                                                                                                                                                      | `contexts/AuthContext.tsx`                                                                                                                     |
| `AdminUser`, `AdminUserListResponse`                                                                                                                                                            | `admin.ts`               | `GET /api/admin/users` (`src/server/routes/admin.ts`)                                                                                                                                                                                                                               | `components/admin/AdminsTab.tsx`                                                                                                               |
| `QueueItem`                                                                                                                                                                                     | `queue.ts`               | `GET /queue/event/:eventId` (`src/server/routes/queue.ts`)                                                                                                                                                                                                                          | `components/admin/QueueTab.tsx`, `components/ScoresheetForm.tsx`                                                                               |
| `DocumentationCategory` / `DocumentationGlobalCategory`, `DocumentationScoreAdmin`, `PublicDocumentationScores` (and friends)                                                                   | `documentationScores.ts` | `GET /documentation-scores/...` family (`src/server/routes/documentationScores.ts`)                                                                                                                                                                                                 | `components/admin/DocumentationTab.tsx`, `components/documentation/DocumentationScoresDisplay.tsx`, `pages/Spectator.tsx`                      |
| `SeedingScore`, `SeedingRanking`                                                                                                                                                                | `seeding.ts`             | `GET /seeding/scores/event/:eventId`, `GET /seeding/rankings/event/:eventId`, `POST /seeding/rankings/recalculate/:eventId` (`src/server/routes/seeding.ts`)                                                                                                                        | `components/admin/SeedingTab.tsx`, `components/seeding/SeedingDisplay.tsx`, `components/seeding/SeedingScoresTable.tsx`, `pages/Spectator.tsx` |
| `ChatMessage`, `ChatSpreadsheet`                                                                                                                                                                | `chat.ts`                | `GET /chat/spreadsheets`, `GET /chat/messages/:spreadsheetId`, `POST /chat/messages`, `GET /chat/admin/messages`, `POST /chat/admin/messages` (`src/server/routes/chat.ts`)                                                                                                         | `contexts/ChatContext.tsx` (and `components/PublicChat.tsx` via the chat context)                                                              |
| `ScoresheetTemplateAdminListItem`, `ScoresheetTemplateForJudges`, `ScoresheetTemplateDetail` (and the matching `*Response` aliases, plus the `ScoresheetSchema` placeholder)                    | `scoresheetTemplates.ts` | `GET /scoresheet/templates`, `GET /scoresheet/templates/admin`, `GET/POST/PUT /scoresheet/templates/:id` (`src/server/routes/scoresheet.ts`)                                                                                                                                        | `pages/Judge.tsx`, `components/admin/TemplatesTab.tsx`, `components/admin/TemplateEditorModal.tsx`                                             |

## Migration backlog

The following client interfaces still locally restate a server response
(or a server entity) and should be migrated into `shared/api/` (or, when
they really are full entities, into `shared/domain/`). Roughly in
priority order:

### High value — non-trivial shapes that already drift risk

_(empty — see "Currently shared" above for completed migrations)_

### Entity DTOs that should re-use existing `shared/domain`

_(empty — see "Currently shared" above for completed migrations)_

### Server-side typing

The pattern established here gives the **client** a typed view of the
wire, but most server handlers in `src/server/routes/*.ts` still call
`res.json(rawDbRow)` with no compile-time link back to the shared DTO.
That means a renamed column or dropped JOIN field can ship without TS
catching it on the server side.

#### Current state per shared family

A "fully typed" handler imports the response DTO from `shared/api`,
constructs a value of that exact type from typed row interfaces, and
passes it to `res.json`. A "partial" handler delegates to a typed
service (so the body shape is sound) but does not itself name the
response type. "Untyped" handlers receive `db.all`/`db.get` results
and forward them directly with no link to the shared DTO.

| Shared type / family                                                                                                                     | DTO file                 | Server status                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AdminUser`, `AdminUserListResponse`                                                                                                     | `admin.ts`               | **Fully typed.** `routes/admin.ts` imports both DTOs, defines an `AdminUserRow` row interface, and constructs the response via a typed `toAdminUser` mapper.                                                                                                                                                                                                 |
| `AuthUser`                                                                                                                               | `auth.ts`                | **Fully typed.** `routes/auth.ts` imports `AuthUser` and constructs the body explicitly from the (locally typed) `PassportUser`.                                                                                                                                                                                                                             |
| `OverallScoreRow*`                                                                                                                       | `overall.ts`             | **Fully typed via service.** `services/overallScores.ts` imports `OverallScoreRow` and returns `OverallScoreRow[]`; the two `events.ts` route handlers forward that typed value, so the wire shape is locked even though the routes themselves don't restate the type.                                                                                       |
| `AutomaticAwardsPublic` & friends                                                                                                        | `awards.ts`              | **Fully typed via service.** `services/automaticAwards.ts` imports and re-exports the public-bundle DTOs and returns `AutomaticAwardsPublic` from `computeAutomaticAwards`.                                                                                                                                                                                  |
| `AwardTemplate`, `EventAward`, `EventAwardRecipient`, `ApplyAutomaticAwardsResponse`, `PublicManualAward`, `PublicEventAwardsResponse`   | `awards.ts`              | **Untyped.** `routes/awards.ts` does not import `shared/api`; templates, event awards, recipients, the apply-automatic response, and the public `{ manual, automatic }` bundle are all assembled from raw `db.all` rows with `Record<string, unknown>` casts.                                                                                                |
| `PublicEvent`, `PublicEventListResponse`                                                                                                 | `events.ts`              | **Untyped.** `routes/events.ts` does not import `shared/api`; `toPublicEvent` takes `Record<string, unknown>` and the `/public` and `/:id/public` handlers forward whatever shape the spread produces.                                                                                                                                                       |
| `EventScoresResponse`, `EventScoreSubmission`, `ScoreData`, `ScoreDataField`                                                             | `scores.ts`              | **Fully typed.** `routes/scores.ts` defines an `EventScoreSubmissionRow` interface that mirrors the join's `SELECT` list, parses `score_data` JSON inside a `toEventScoreSubmission` mapper (instead of mutating the raw row), and returns an `EventScoresResponse` via `typedJson`.                                                                         |
| `AuditLogEntry`, `AuditLogResponse`                                                                                                      | `audit.ts`               | **Untyped.** `routes/audit.ts` does not import `shared/api`; both endpoints return raw `db.all` results from the `al.*` + `users` join.                                                                                                                                                                                                                      |
| `QueueItem`                                                                                                                              | `queue.ts`               | **Fully typed.** `routes/queue.ts` defines `BaseQueueItemRow` / `JoinedQueueItemRow` interfaces, maps them via `toQueueItem` (joined GET) and `toBareQueueItem` (POST / PATCH / `/call`, which fill the unjoined display columns with `null`), and sends every body via `typedJson` against `QueueItem`.                                                     |
| `DocumentationCategory`, `DocumentationGlobalCategory`, `DocumentationScoreAdmin`, `PublicDocumentationScores` (and friends)             | `documentationScores.ts` | **Untyped.** `routes/documentationScores.ts` does not import `shared/api`; categories, scores, and sub-scores are attached onto raw rows via `(row as Record<string, unknown>).sub_scores = ...`.                                                                                                                                                            |
| `SeedingScore`, `SeedingRanking`, `EventSeedingScoresResponse`, `EventSeedingRankingsResponse`, `RecalculateSeedingRankingsResponse`     | `seeding.ts`             | **Fully typed.** `routes/seeding.ts` imports the DTOs, defines `SeedingScoreRow` / `SeedingRankingRow` interfaces matching each `SELECT` list, and constructs each response via `toSeedingScore` / `toSeedingRanking` mappers + `typedJson`. The non-listed `team`/`POST`/`PATCH`/`DELETE` handlers on individual rows are not in this table and remain raw. |
| `ChatMessage`, `ChatSpreadsheet`                                                                                                         | `chat.ts`                | **Partial / drift risk.** `routes/chat.ts` does not import `shared/api`; it locally restates a `ChatMessage` interface and casts query results to it, and returns `/chat/spreadsheets` rows with no typing. The local interface is the kind of duplication this folder exists to prevent.                                                                    |
| `ScoresheetTemplateAdminListItem`, `ScoresheetTemplateForJudges`, `ScoresheetTemplateDetail` (+ `*Response` aliases, `ScoresheetSchema`) | `scoresheetTemplates.ts` | **Untyped.** `routes/scoresheet.ts` does not import `shared/api`; the four read endpoints return raw rows after ad-hoc `JSON.parse` of `template.schema` and `delete` of secret fields.                                                                                                                                                                      |

#### Server pattern

The canonical example is `src/server/routes/seeding.ts`. Every
wire-typed handler in that file follows the same four-step recipe:

1. **Declare a `readonly` row interface per `SELECT` list.** It
   mirrors the SQL columns 1:1, including JOINed display fields. The
   `readonly` markers state up front that decoded DB rows are
   snapshots — nobody should mutate them on the way to the wire.
2. **Pass the row interface as the generic to `db.all<Row>` /
   `db.get<Row>`.** This is what removes the need for
   `Record<string, unknown>` casts and the `as Foo` escape hatches
   they tend to attract.
3. **Map row → DTO with a small named function.** The mapper is the
   one place that knows how database columns become wire fields.
   Reuse it across endpoints that share a row shape (e.g.
   `toSeedingRanking` is used by both `GET /rankings/event/:eventId`
   and `POST /rankings/recalculate/:eventId`).
4. **Bind the result to the DTO type, then send via `typedJson`.**

```ts
interface SeedingScoreRow {
  readonly id: number;
  readonly team_id: number;
  readonly round_number: number;
  readonly score: number | null;
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

const toSeedingScore = (row: SeedingScoreRow): SeedingScore => ({
  /* ... explicit field-by-field mapping ... */
});

router.get('/scores/event/:eventId', async (req, res) => {
  const rows = await db.all<SeedingScoreRow>(
    `SELECT ss.id, ss.team_id, ss.round_number, ss.score,
            t.team_number, t.team_name, t.display_name
     FROM seeding_scores ss JOIN teams t ON ss.team_id = t.id
     WHERE t.event_id = ?
     ORDER BY t.team_number ASC, ss.round_number ASC`,
    [eventId],
  );
  const body: EventSeedingScoresResponse = rows.map(toSeedingScore);
  typedJson(res, body);
});
```

Notes on the pattern:

- **`SELECT` only the columns the row interface declares.** Replace
  `SELECT *` and `SELECT ss.*` with an explicit list — this is what
  links the SQL to the row interface and ultimately to the wire DTO.
- **Don't mutate decoded rows.** If you need to enrich a row (parse
  JSON, attach sub-records), do it inside the mapper and produce a
  new object. The `readonly` markers on `Row` and on the shared DTO
  push you toward this naturally.
- **`typedJson` is a soft nudge, not a guard.** The real type
  commitment happens on the line `const body: TheDTO = ...` — that's
  where excess-property checks and missing-field errors fire.
  `typedJson` exists to keep the commitment grep-able and to
  document the intent at the `res.json` call site.

#### Migration backlog

In rough priority order (busiest endpoints / most join-heavy first):

1. `routes/documentationScores.ts` — all read endpoints. Replace the
   `(row as Record<string, unknown>).sub_scores = ...` mutation with
   typed mappers that produce `DocumentationCategory`,
   `DocumentationGlobalCategory`, `DocumentationScoreAdmin`, and
   `PublicDocumentationScores` directly.
2. `routes/scoresheet.ts` — the four read endpoints. Wrap the raw
   row in a typed mapper that parses the schema column once and
   strips `access_code` / `created_by` in the type, returning
   `ScoresheetTemplateAdminListItem[]`,
   `ScoresheetTemplateForJudges[]`, and `ScoresheetTemplateDetail`.
3. `routes/awards.ts` — every handler. Type the template /
   event-award / recipient row shapes; make `GET /awards/event/:eventId`
   return `EventAward[]` (with typed `recipients`); make
   `POST /awards/event/:eventId/automatic` return
   `ApplyAutomaticAwardsResponse`; make
   `GET /awards/event/:eventId/public` return
   `PublicEventAwardsResponse` (the `automatic` half is already typed
   via the service).
4. `routes/audit.ts` — both `GET` endpoints. Type the
   `audit_log` + `users` join row and map to `AuditLogResponse`.
5. `routes/events.ts` — `GET /events/public` and
   `GET /events/:id/public`. Replace `toPublicEvent`'s
   `Record<string, unknown>` parameter with a typed row interface
   and produce `PublicEvent` / `PublicEventListResponse`.
6. `routes/chat.ts` — delete the local `ChatMessage` interface,
   import `ChatMessage` and `ChatSpreadsheet` from `shared/api`
   instead, and type the `/spreadsheets` and message-list / send
   handlers against them.
