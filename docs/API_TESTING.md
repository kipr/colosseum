# API Testing Guide

This guide covers the current Express API. Route source files in
`src/server/routes/` and the HTTP tests in `tests/http/` are authoritative for
request and response details.

## Start the API

```bash
cp .env.example .env
npm install
npm run db:up && npm run db:wait
npm run dev:server
```

The API listens on `http://localhost:3000`. Confirm it without creating a
database session:

```bash
export API_BASE=http://localhost:3000
curl "$API_BASE/health"
```

The health response has the shape
`{"status":"ok","timestamp":"<ISO timestamp>"}`.

## Access levels

- **Public**: no cookie required. Archived events are hidden, and final results
  endpoints return 404 until results are released for a completed event.
- **Judge**: verify a scoresheet access code to create a 12-hour session scoped
  to that template and its linked events. Judges can submit scores and use
  their own event-chat thread.
- **Staff**: any authenticated Google account accepted by the deployment.
- **Admin**: an authenticated user whose database row has `is_admin = true`.

Google OAuth is the normal way to create a staff/admin session. For manual API
testing, log in through the browser and copy the complete `connect.sid` cookie
from DevTools:

```bash
export AUTH_COOKIE='connect.sid=COOKIE_VALUE'
curl -H "Cookie: $AUTH_COOKIE" "$API_BASE/auth/user"
```

Do not commit cookies, access codes, or cookie-jar files.

## Basic smoke sequence

List spectator-visible events:

```bash
curl "$API_BASE/events/public"
```

Create an event as an admin:

```bash
curl -X POST "$API_BASE/events" \
  -H 'Content-Type: application/json' \
  -H "Cookie: $AUTH_COOKIE" \
  -d '{
    "name": "2026 Botball Fall Regional - Austin",
    "description": "API smoke-test event",
    "event_date": "2026-10-15",
    "location": "Austin, TX",
    "seeding_rounds": 3,
    "min_rest_minutes": 3,
    "score_accept_mode": "manual"
  }'
```

Use the returned event ID in later requests. Create teams as authenticated
staff:

```bash
export EVENT_ID=1
curl -X POST "$API_BASE/teams/bulk" \
  -H 'Content-Type: application/json' \
  -H "Cookie: $AUTH_COOKIE" \
  -d "{
    \"event_id\": $EVENT_ID,
    \"teams\": [
      {\"team_number\": 101, \"team_name\": \"Robot Warriors\"},
      {\"team_number\": 102, \"team_name\": \"Mech Masters\"}
    ]
  }"
```

Read teams and the queue without authentication:

```bash
curl "$API_BASE/teams/event/$EVENT_ID"
curl "$API_BASE/queue/event/$EVENT_ID?sync=1"
```

The explicit `sync=1` queue repair is rate-limited. Normal polling should omit
it and send the previous response's `ETag` in `If-None-Match`; an unchanged
queue returns 304.

## Judge-session smoke test

First find an active template linked to a setup or active event, then verify its
access code while saving the returned session cookie:

```bash
curl "$API_BASE/scoresheet/templates"

export TEMPLATE_ID=1
curl -c judge.cookies -X POST \
  "$API_BASE/scoresheet/templates/$TEMPLATE_ID/verify" \
  -H 'Content-Type: application/json' \
  -d '{"accessCode":"ACCESS_CODE"}'
```

Submit with `-b judge.cookies` to `POST /api/scores/submit`. The payload must
match the verified template and include:

- `templateId`, `eventId`, `scoreType`, and `scoreData`;
- a team selection for seeding, `bracket_game_id` for bracket scoring, or
  `double_seeding_match_id` for double seeding; and
- the required team-initial fields for the match type.

Because score data is template-dependent, use the browser or the focused
examples in `tests/http/apiScoresSubmit.test.ts` when constructing this request.

## Route catalog

### Public routes

| Area             | Routes                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health           | `GET /health`                                                                                                                                                                        |
| Authentication   | `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/access-denied`, `GET /auth/user`, `GET /auth/logout`                                                                     |
| Events           | `GET /events/public`, `GET /events/:id/public`, `GET /events/:id/overall/public`                                                                                                     |
| Teams            | `GET /teams/event/:eventId`, `GET /teams/:id`                                                                                                                                        |
| Seeding          | `GET /seeding/scores/team/:teamId`, `GET /seeding/scores/event/:eventId`, `GET /seeding/rankings/event/:eventId`                                                                     |
| Double seeding   | `GET /double-seeding/matches/event/:eventId`, `GET /double-seeding/scores/event/:eventId`, `GET /double-seeding/scores/team/:teamId`, `GET /double-seeding/rankings/event/:eventId`  |
| Brackets         | `GET /brackets/event/:eventId`, `GET /brackets/event/:eventId/games`, `GET /brackets/templates`, `GET /brackets/:id`, `GET /brackets/:id/games`, `GET /brackets/:id/rankings/public` |
| Queue            | `GET /queue/event/:eventId`                                                                                                                                                          |
| Scoresheets      | `GET /scoresheet/templates`, `POST /scoresheet/templates/:id/verify`                                                                                                                 |
| Released results | `GET /documentation-scores/event/:eventId/public`, `GET /awards/event/:eventId/public`                                                                                               |

### Judge or admin routes

| Area             | Routes                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| Score submission | `POST /api/scores/submit`                                                   |
| Judge chat       | `GET /chat/events/:eventId/messages`, `POST /chat/events/:eventId/messages` |

### Authenticated staff routes

| Area               | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication     | `GET /auth/check-tokens`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Events             | `GET /events`, `GET /events/:id`, `GET /events/:id/overall`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Teams              | `POST /teams`, `POST /teams/bulk`, `PATCH /teams/:id`, `PATCH /teams/:id/check-in`, `PATCH /teams/event/:eventId/check-in/bulk`, `DELETE /teams/:id`                                                                                                                                                                                                                                                                                                                                                          |
| Brackets           | `GET /brackets/event/:eventId/assigned-teams`, `GET /brackets/:id/rankings`, `POST /brackets`, `PATCH /brackets/:id`, `DELETE /brackets/:id`, `POST /brackets/:id/rankings/calculate`, `POST /brackets/:id/entries`, `DELETE /brackets/:bracketId/entries/:entryId`, `POST /brackets/:id/entries/generate`, `POST /brackets/:id/games`, `PATCH /brackets/games/:id`, `POST /brackets/games/:id/advance`, `POST /brackets/:id/games/generate`, `POST /brackets/:id/advance-winner`, `POST /brackets/templates` |
| Queue              | `POST /queue`, `POST /queue/populate-from-bracket`, `POST /queue/populate-from-seeding`, `PATCH /queue/:id/presence`, `PATCH /queue/:id`, `PATCH /queue/:id/call`, `DELETE /queue/:id`                                                                                                                                                                                                                                                                                                                        |
| Field templates    | `GET /field-templates`, `GET /field-templates/:id`, `POST /field-templates`, `PUT /field-templates/:id`, `DELETE /field-templates/:id`                                                                                                                                                                                                                                                                                                                                                                        |
| Audit              | `GET /audit/event/:eventId`, `GET /audit/entity/:type/:id`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Personal history   | `GET /api/scores/history`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Scoresheet preview | `GET /scoresheet/templates/:id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Admin-only routes

| Area                  | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin users           | `GET /api/admin/users`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Events                | `POST /events`, `PATCH /events/:id`, `DELETE /events/:id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Scoresheets           | `GET /scoresheet/templates/admin`, `POST /scoresheet/templates`, `PUT /scoresheet/templates/:id`, `DELETE /scoresheet/templates/:id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Seeding writes        | `POST /seeding/scores`, `PATCH /seeding/scores/:id`, `DELETE /seeding/scores/:id`, `POST /seeding/rankings/recalculate/:eventId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Double-seeding writes | `POST /double-seeding/matches/generate/:eventId`, `DELETE /double-seeding/matches/event/:eventId`, `DELETE /double-seeding/matches/event/:eventId/round/:roundNumber`, `POST /double-seeding/rankings/recalculate/:eventId`                                                                                                                                                                                                                                                                                                                                                                                                          |
| Score review          | `GET /scores/by-event/:eventId`, `POST /scores/event/:eventId/accept/bulk`, `POST /scores/:id/accept-event`, `POST /scores/:id/revert-event`, `POST /scores/:id/reject`, `POST /scores/:id/revert`, `PUT /scores/:id`, `DELETE /scores/:id`                                                                                                                                                                                                                                                                                                                                                                                          |
| Documentation scoring | `GET /documentation-scores/global-categories`, `GET /documentation-scores/categories/event/:eventId`, `POST /documentation-scores/categories`, `PATCH /documentation-scores/categories/:id`, `DELETE /documentation-scores/categories/:id`, `GET /documentation-scores/event/:eventId`, `GET /documentation-scores/team/:teamId`, `PUT /documentation-scores/event/:eventId/team/:teamId`, `DELETE /documentation-scores/event/:eventId/team/:teamId`                                                                                                                                                                                |
| Awards                | `GET /awards/templates`, `POST /awards/templates`, `PATCH /awards/templates/:id`, `DELETE /awards/templates/:id`, `GET /awards/event/:eventId`, `GET /awards/event/:eventId/automatic/preview`, `POST /awards/event/:eventId/automatic`, `GET /awards/event/:eventId/team-award-counts`, `POST /awards/event/:eventId`, `PATCH /awards/event-awards/:id`, `DELETE /awards/event-awards/:id`, `POST /awards/event-awards/:id/recipients`, `DELETE /awards/event-awards/:awardId/recipients/:teamId`, `POST /awards/event-awards/:id/individual-recipients`, `DELETE /awards/event-awards/:awardId/individual-recipients/:recipientId` |
| Chat administration   | `GET /chat/events/:eventId/conversations`, `DELETE /chat/events/:eventId/conversations/:conversationKey`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The Google OAuth entry and callback routes are public browser routes. Successful
login depends on configured OAuth credentials and the allowed-domain policy.

## Database inspection

Open `psql` against the local application database:

```bash
npm run db:psql
```

Useful read-only checks:

```sql
\dt
SELECT id, name, status, event_date FROM events ORDER BY event_date DESC;
SELECT id, event_id, team_number, team_name, status FROM teams ORDER BY event_id, team_number;
SELECT id, event_id, score_type, status, created_at FROM score_submissions ORDER BY id DESC LIMIT 20;
SELECT id, event_id, queue_type, queue_position, status FROM game_queue ORDER BY event_id, queue_position;
```

See [Database Architecture](DATABASE.md) for the complete table map.

## Automated verification

The supported repeatable API checks are the HTTP test suite and Playwright
flows, not a long stateful curl script:

```bash
npm run db:up && npm run db:wait
npm run test:run
npm run test:e2e
```

Vitest uses per-worker schemas in `colosseum_test`; Playwright uses that
database's `public` schema. They do not modify the local `colosseum` database.
