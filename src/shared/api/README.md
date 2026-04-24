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

### Server-side typing (deferred)

The pattern established here gives the **client** a typed view of the
wire, but server handlers in `src/server/routes/*.ts` still call
`res.json(rawDbRow)` with no compile-time link back to the shared DTO.
That means a renamed column or dropped JOIN field can ship without TS
catching it on the server side.

A follow-up pass should:

1. Introduce a small `typedJson<T>(res: Response, body: T): Response`
   helper (or annotate handler return types via
   `Response<T>` from `express-serve-static-core`), and migrate
   handlers to use it.
2. Replace the ad-hoc `Record<string, unknown>` casts around
   `db.all` / `db.get` results with concrete row types (often a
   `Pick<...>` of the corresponding entity DTO plus the joined
   display fields). The DTOs in this folder are forward-compatible
   with that change — no rework needed when the server side is
   tightened later.
