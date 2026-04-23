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

| Type / family                                           | File        | Server handler(s)                                                                                                                                                  | Client consumer(s)                                                         |
| ------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `PublicEvent`, `PublicEventListResponse`                | `events.ts` | `GET /events/public`, `GET /events/:id/public` (`src/server/routes/events.ts`)                                                                                     | `pages/SpectatorEvents.tsx`, `pages/Spectator.tsx`                         |
| `AutomaticAwardsPublic` and the `MedalPlacement` family | `awards.ts` | `computeAutomaticAwards()` (`src/server/services/automaticAwards.ts`), surfaced by `GET /awards/event/:eventId/public` and `POST /awards/event/:eventId/automatic` | `components/spectator/SpectatorAutomaticAwards.tsx`, `pages/Spectator.tsx` |

## Migration backlog

The following client interfaces still locally restate a server response
(or a server entity) and should be migrated into `shared/api/` (or, when
they really are full entities, into `shared/domain/`). Roughly in
priority order:

### High value — non-trivial shapes that already drift risk

- `EventScoresResponse` + `ScoreSubmission`
  (`src/client/components/admin/ScoringTab.tsx`) ↔
  `GET /scores/by-event/:eventId` in `src/server/routes/scores.ts`. The
  client `ScoreSubmission` carries ~30 optional joined display fields;
  this is exactly the kind of shape that drifts silently today.
- `OverallRow` (`src/client/components/overall/OverallScoresDisplay.tsx`)
  ↔ `OverallScoreRow` in `src/server/services/overallScores.ts`. Already
  defined twice with the same fields minus `team_id`.
- `QueueItem` (`src/client/components/admin/QueueTab.tsx`) ↔
  `GET /queue/event/:eventId` in `src/server/routes/queue.ts`. ~20
  joined display fields.
- `AuditLogEntry` (`src/client/components/admin/AuditTab.tsx`) ↔
  `src/server/routes/audit.ts`.
- Documentation scores: `DocCategory`, `DocScore`, `DocSubScore`
  (`src/client/components/admin/DocumentationTab.tsx`,
  `src/client/components/documentation/DocumentationScoresDisplay.tsx`)
  ↔ `src/server/routes/documentationScores.ts` (incl. the `{ categories,
scores }` public bundle and `{ team, documentation_score, sub_scores }`
  per-team shape).
- Awards admin: `AwardTemplate`, `EventAward`, `Recipient`
  (`src/client/components/admin/AwardsTab.tsx`) ↔
  `src/server/routes/awards.ts`.

### Entity DTOs that should re-use existing `shared/domain`

- `Team` redeclared in `TeamsTab`, `QueueTab`, `AwardsTab`,
  `SeedingScoresTable`, `DocumentationTab`. Add a canonical `Team` to
  `src/shared/domain/team.ts` (the enum module already lives there) and
  re-export.
- `Bracket` / `BracketGame` redeclared in
  `components/admin/QueueTab.tsx` and
  `components/admin/TemplateEditorModal.tsx`. The canonical versions
  already live in `src/shared/domain/bracket.ts`.
- `User` (`src/client/contexts/AuthContext.tsx`) ↔
  `AuthenticatedUser` shape in `src/server/routes/auth.ts`
  (`GET /auth/user`).
- `AdminUser` (`src/client/components/admin/AdminsTab.tsx`) ↔
  `GET /api/admin/users` in `src/server/routes/admin.ts`.
- `Template` (`src/client/pages/Judge.tsx`,
  `src/client/components/admin/TemplatesTab.tsx`,
  `src/client/components/admin/TemplateEditorModal.tsx`).
- `ChatMessage`, `Spreadsheet` (`src/client/contexts/ChatContext.tsx`) ↔
  `src/server/routes/chat.ts`.
- `SeedingScore`, `SeedingRanking`
  (`src/client/components/seeding/SeedingScoresTable.tsx`) ↔
  `src/server/routes/seeding.ts`.

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
