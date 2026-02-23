# Tournament API Testing Guide

This document provides curl commands to test all new tournament management endpoints,
along with SQLite verification queries.

## Prerequisites

1. Start the server: `npm run dev`
2. Get an auth cookie by logging in through the browser and copying it from DevTools
3. Replace `COOKIE_VALUE` below with your actual session cookie

```bash
# Set your auth cookie (get this from browser DevTools after logging in)
export COOKIE="connect.sid=COOKIE_VALUE"
```

## Events API

### List all events (auth required)

```bash
curl -X GET http://localhost:3000/events \
  -H "Cookie: $COOKIE"
```

### Create an event (auth required)

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "name": "2026 Botball Fall Regional - Austin",
    "description": "Annual Botball competition",
    "event_date": "2026-10-15",
    "location": "Austin, TX",
    "seeding_rounds": 3
  }'
```

### Get single event (auth required)

```bash
curl -X GET http://localhost:3000/events/1 \
  -H "Cookie: $COOKIE"
```

### Update event (auth required)

```bash
curl -X PATCH http://localhost:3000/events/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "status": "active",
    "location": "Austin Convention Center"
  }'
```

### Delete event (auth required)

```bash
curl -X DELETE http://localhost:3000/events/1 \
  -H "Cookie: $COOKIE"
```

## Teams API

### List teams for event (public)

```bash
curl -X GET http://localhost:3000/teams/event/1
```

### Get single team (public)

```bash
curl -X GET http://localhost:3000/teams/1
```

### Create team (auth required)

```bash
curl -X POST http://localhost:3000/teams \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "event_id": 1,
    "team_number": 859,
    "team_name": "ACES Robotics"
  }'
```

### Bulk create teams (auth required)

```bash
curl -X POST http://localhost:3000/teams/bulk \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "event_id": 1,
    "teams": [
      {"team_number": 101, "team_name": "Robot Warriors"},
      {"team_number": 102, "team_name": "Mech Masters"},
      {"team_number": 103, "team_name": "Circuit Breakers"}
    ]
  }'
```

### Update team (auth required)

```bash
curl -X PATCH http://localhost:3000/teams/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "status": "checked_in"
  }'
```

### Check in team (auth required)

```bash
curl -X PATCH http://localhost:3000/teams/1/check-in \
  -H "Cookie: $COOKIE"
```

### Undo Check-in (auth required)

Set status back to `registered` (automatically clears `checked_in_at` timestamp):

```bash
curl -X PATCH http://localhost:3000/teams/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "status": "registered"
  }'
```

### Bulk check in teams (auth required)

```bash
curl -X PATCH http://localhost:3000/teams/event/1/check-in/bulk \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "team_numbers": [101, 102, 103]
  }'
```

Response: `{ "updated": 3 }` or `{ "updated": 2, "not_found": [103] }` if some teams don't exist.

### Delete team (auth required)

```bash
curl -X DELETE http://localhost:3000/teams/1 \
  -H "Cookie: $COOKIE"
```

## Seeding API

### Get scores for team (public)

```bash
curl -X GET http://localhost:3000/seeding/scores/team/1
```

### Get all scores for event (public)

```bash
curl -X GET http://localhost:3000/seeding/scores/event/1
```

### Submit seeding score (public - for judges)

```bash
curl -X POST http://localhost:3000/seeding/scores \
  -H "Content-Type: application/json" \
  -d '{
    "team_id": 1,
    "round_number": 1,
    "score": 150
  }'
```

### Update seeding score (auth required)

```bash
curl -X PATCH http://localhost:3000/seeding/scores/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "score": 175
  }'
```

### Delete seeding score (auth required)

```bash
curl -X DELETE http://localhost:3000/seeding/scores/1 \
  -H "Cookie: $COOKIE"
```

### Get rankings for event (public)

```bash
curl -X GET http://localhost:3000/seeding/rankings/event/1
```

### Recalculate rankings (auth required)

```bash
curl -X POST http://localhost:3000/seeding/rankings/recalculate/1 \
  -H "Cookie: $COOKIE"
```

## Brackets API

### List brackets for event (public)

```bash
curl -X GET http://localhost:3000/brackets/event/1
```

### Get bracket with entries and games (public)

```bash
curl -X GET http://localhost:3000/brackets/1
```

### Create bracket (auth required)

```bash
curl -X POST http://localhost:3000/brackets \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "event_id": 1,
    "name": "Main Bracket",
    "bracket_size": 8
  }'
```

### Update bracket (auth required)

```bash
curl -X PATCH http://localhost:3000/brackets/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "status": "in_progress"
  }'
```

### Delete bracket (auth required)

```bash
curl -X DELETE http://localhost:3000/brackets/1 \
  -H "Cookie: $COOKIE"
```

### Add entry to bracket (auth required)

```bash
curl -X POST http://localhost:3000/brackets/1/entries \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "team_id": 1,
    "seed_position": 1
  }'
```

### Add bye entry to bracket (auth required)

```bash
curl -X POST http://localhost:3000/brackets/1/entries \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "seed_position": 8,
    "is_bye": true
  }'
```

### Remove entry from bracket (auth required)

```bash
curl -X DELETE http://localhost:3000/brackets/1/entries/1 \
  -H "Cookie: $COOKIE"
```

### Get games for bracket (public)

```bash
curl -X GET http://localhost:3000/brackets/1/games
```

### Create game in bracket (auth required)

```bash
curl -X POST http://localhost:3000/brackets/1/games \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "game_number": 1,
    "round_name": "Winners R1",
    "round_number": 1,
    "bracket_side": "winners",
    "team1_source": "seed:1",
    "team2_source": "seed:8"
  }'
```

### Update game (auth required)

```bash
curl -X PATCH http://localhost:3000/brackets/games/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "team1_score": 150,
    "team2_score": 120,
    "winner_id": 1,
    "loser_id": 2,
    "status": "completed"
  }'
```

### Advance winner (auth required)

```bash
curl -X POST http://localhost:3000/brackets/games/1/advance \
  -H "Cookie: $COOKIE"
```

### Get bracket templates (public)

```bash
curl -X GET http://localhost:3000/brackets/templates
```

### Get bracket templates for size (public)

```bash
curl -X GET "http://localhost:3000/brackets/templates?bracket_size=8"
```

### Create bracket template (auth required)

```bash
curl -X POST http://localhost:3000/brackets/templates \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "bracket_size": 8,
    "game_number": 1,
    "round_name": "Winners R1",
    "round_number": 1,
    "bracket_side": "winners",
    "team1_source": "seed:1",
    "team2_source": "seed:8",
    "winner_advances_to": 5,
    "loser_advances_to": 9,
    "winner_slot": "team1"
  }'
```

## Game Queue API

### Get queue for event (public)

```bash
curl -X GET http://localhost:3000/queue/event/1
```

### Get queue filtered by status (public)

```bash
curl -X GET "http://localhost:3000/queue/event/1?status=queued"
```

### Add seeding item to queue (auth required)

```bash
curl -X POST http://localhost:3000/queue \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "event_id": 1,
    "queue_type": "seeding",
    "seeding_team_id": 1,
    "seeding_round": 1
  }'
```

### Add bracket game to queue (auth required)

```bash
curl -X POST http://localhost:3000/queue \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "event_id": 1,
    "queue_type": "bracket",
    "bracket_game_id": 1
  }'
```

### Update queue item status (auth required)

```bash
curl -X PATCH http://localhost:3000/queue/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "status": "in_progress",
    "table_number": 1
  }'
```

### Call team/game (auth required)

```bash
curl -X PATCH http://localhost:3000/queue/1/call \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "table_number": 2
  }'
```

### Uncall team (auth required)

Reset status to `queued` (automatically clears `called_at` timestamp):

```bash
curl -X PATCH http://localhost:3000/queue/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "status": "queued"
  }'
```

### Reorder queue (auth required)

```bash
curl -X POST http://localhost:3000/queue/reorder \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "items": [
      {"id": 1, "queue_position": 2},
      {"id": 2, "queue_position": 1}
    ]
  }'
```

### Remove from queue (auth required)

```bash
curl -X DELETE http://localhost:3000/queue/1 \
  -H "Cookie: $COOKIE"
```

## Audit API

### Get audit log for event (auth required)

```bash
curl -X GET http://localhost:3000/audit/event/1 \
  -H "Cookie: $COOKIE"
```

### Get audit log with filters (auth required)

```bash
curl -X GET "http://localhost:3000/audit/event/1?action=score_submitted&limit=10" \
  -H "Cookie: $COOKIE"
```

### Get audit log for entity (auth required)

```bash
curl -X GET http://localhost:3000/audit/entity/team/1 \
  -H "Cookie: $COOKIE"
```

### Create audit entry (auth required)

```bash
curl -X POST http://localhost:3000/audit \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "event_id": 1,
    "action": "team_added",
    "entity_type": "team",
    "entity_id": 1,
    "new_value": {"team_number": 859, "team_name": "ACES Robotics"}
  }'
```

## SQLite Verification Queries

Run these in the SQLite CLI to verify the curl commands worked:

```bash
sqlite3 database/colosseum.db
```

### Verify Events

```sql
SELECT * FROM events;
SELECT COUNT(*) as event_count FROM events;
```

### Verify Teams

```sql
SELECT * FROM teams;
SELECT t.*, e.name as event_name FROM teams t JOIN events e ON t.event_id = e.id;
SELECT COUNT(*) as team_count FROM teams;
```

### Verify Seeding Scores

```sql
SELECT * FROM seeding_scores;
SELECT ss.*, t.team_number, t.team_name
FROM seeding_scores ss
JOIN teams t ON ss.team_id = t.id;
```

### Verify Seeding Rankings

```sql
SELECT * FROM seeding_rankings;
SELECT sr.*, t.team_number, t.team_name
FROM seeding_rankings sr
JOIN teams t ON sr.team_id = t.id
ORDER BY sr.seed_rank;
```

### Verify Brackets

```sql
SELECT * FROM brackets;
SELECT b.*, e.name as event_name
FROM brackets b
JOIN events e ON b.event_id = e.id;
```

### Verify Bracket Entries

```sql
SELECT * FROM bracket_entries;
SELECT be.*, t.team_number, t.team_name
FROM bracket_entries be
LEFT JOIN teams t ON be.team_id = t.id;
```

### Verify Bracket Games

```sql
SELECT * FROM bracket_games;
SELECT bg.*,
       t1.team_number as team1,
       t2.team_number as team2,
       w.team_number as winner
FROM bracket_games bg
LEFT JOIN teams t1 ON bg.team1_id = t1.id
LEFT JOIN teams t2 ON bg.team2_id = t2.id
LEFT JOIN teams w ON bg.winner_id = w.id;
```

### Verify Game Queue

```sql
SELECT * FROM game_queue;
SELECT gq.*,
       bg.game_number,
       t.team_number as seeding_team
FROM game_queue gq
LEFT JOIN bracket_games bg ON gq.bracket_game_id = bg.id
LEFT JOIN teams t ON gq.seeding_team_id = t.id
ORDER BY gq.queue_position;
```

### Verify Bracket Templates

```sql
SELECT * FROM bracket_templates ORDER BY bracket_size, game_number;
```

### Verify Audit Log

```sql
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;
SELECT al.*, u.name as user_name
FROM audit_log al
LEFT JOIN users u ON al.user_id = u.id
ORDER BY al.created_at DESC;
```

## Full Test Sequence

Here's a complete test sequence to verify the entire workflow:

```bash
# 1. Create an event
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"name": "Test Tournament", "event_date": "2026-03-15"}'

# 2. Bulk create teams
curl -X POST http://localhost:3000/teams/bulk \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{
    "event_id": 1,
    "teams": [
      {"team_number": 1, "team_name": "Alpha"},
      {"team_number": 2, "team_name": "Beta"},
      {"team_number": 3, "team_name": "Gamma"},
      {"team_number": 4, "team_name": "Delta"}
    ]
  }'

# 2b. Bulk check in teams
curl -X PATCH http://localhost:3000/teams/event/1/check-in/bulk \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"team_numbers": [1, 2, 3, 4]}'

# 3. Submit seeding scores (as judge - no auth)
curl -X POST http://localhost:3000/seeding/scores -H "Content-Type: application/json" -d '{"team_id": 1, "round_number": 1, "score": 100}'
curl -X POST http://localhost:3000/seeding/scores -H "Content-Type: application/json" -d '{"team_id": 1, "round_number": 2, "score": 120}'
curl -X POST http://localhost:3000/seeding/scores -H "Content-Type: application/json" -d '{"team_id": 2, "round_number": 1, "score": 110}'
curl -X POST http://localhost:3000/seeding/scores -H "Content-Type: application/json" -d '{"team_id": 2, "round_number": 2, "score": 105}'

# 4. Recalculate rankings
curl -X POST http://localhost:3000/seeding/rankings/recalculate/1 -H "Cookie: $COOKIE"

# 5. View rankings
curl -X GET http://localhost:3000/seeding/rankings/event/1

# 6. Create a bracket
curl -X POST http://localhost:3000/brackets \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"event_id": 1, "name": "Main Bracket", "bracket_size": 4}'

# 7. Add entries
curl -X POST http://localhost:3000/brackets/1/entries -H "Content-Type: application/json" -H "Cookie: $COOKIE" -d '{"team_id": 1, "seed_position": 1}'
curl -X POST http://localhost:3000/brackets/1/entries -H "Content-Type: application/json" -H "Cookie: $COOKIE" -d '{"team_id": 2, "seed_position": 2}'

# 8. Add seeding to queue
curl -X POST http://localhost:3000/queue -H "Content-Type: application/json" -H "Cookie: $COOKIE" -d '{"event_id": 1, "queue_type": "seeding", "seeding_team_id": 3, "seeding_round": 1}'

# 9. View queue
curl -X GET http://localhost:3000/queue/event/1
```
