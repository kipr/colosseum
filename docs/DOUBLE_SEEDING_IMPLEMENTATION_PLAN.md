# Double Seeding Implementation Plan

## Summary

Add a new first-class match type named `double_seeding`.

Double seeding is similar to a double-elimination/bracket game because teams are assigned to sides of the same match and scored on one scoresheet.
It differs from bracket games because there is no winner, loser, or advancement.
It differs from existing seeding because a team only receives the score from its own side of the field, not the combined score from both sides.

Accepted double-seeding submissions must write to a dedicated SQL table separate from existing `seeding_scores`, because double-seeding scores factor into the overall event score separately from ordinary seeding.

## Agreed Product Rules

- Double-seeding matches are pre-paired by application logic when they are created.
- Pairing is randomized once on creation.
- Every team receives the same number of double-seeding rounds, default 5.
- If there is an odd number of teams, one team will run alone. They will still only receive points for their side of the table.
- The lone team should be different each round.
- If the number of rounds exceeds the number of teams, generation should fail.
- Event staff think about progress per team and round, for example: "Has Robo Warriors played their third round yet?"
- A double-seeding scoresheet represents one match with one or two participating teams.
- Each accepted scoresheet creates one team-specific score row per participating team.
- Team 1 receives only the Team 1/Side A score.
- Team 2 receives only the Team 2/Side B score when a second team exists.
- Odd-team lone runs do not create a missing-side score row.
- There is no explicit winner or loser.
- There is no bracket advancement -- all teams play all scheduled rounds regardless of previous outcomes.
- `pending` and `bye` statuses are included for future consistency, even if they are not expected to be used immediately.

## Existing Precedents

Current score types:

- `seeding`: one team plus one round, stored in `seeding_scores`.
- `bracket`: one bracket game, two teams, accepted into `bracket_games`.

Relevant existing tables:

- `score_submissions`
- `seeding_scores`
- `seeding_rankings`
- `bracket_games`
- `bracket_entries`
- `game_queue`
- `event_scoresheet_templates`

Relevant existing server paths:

- `/api/scores/submit`
- `/scores/by-event/:eventId`
- `/scores/:id/accept-event`
- `/scores/:id/revert-event`
- `/scores/event/:eventId/accept/bulk`
- `/seeding/*`
- `/brackets/*`
- `/queue/*`

Relevant existing client areas:

- `ScoresheetForm`
- admin `ScoringTab`
- admin `SeedingTab`
- spectator seeding view
- `ScoreSheetWizard`
- scoresheet template inference/linking

## Data Model

Use both a surrogate match id and natural uniqueness constraints.

The surrogate `id` gives stable references for score submissions, queue rows, audits, admin URLs, and reverts.
The natural keys help to preserve the domain rules.
Complicated requirements like avoiding the same combination between rounds will have to live in application logic.

### `double_seeding_matches`

Stores the pre-paired match for one double-seeding round.

```sql
CREATE TABLE double_seeding_matches (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  match_number INTEGER,
  team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
  score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
  scheduled_time TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, round_number, team1_id, team2_id)
);
```

Notes:

- Generated matches should usually start as `ready` when all participating teams for the match are known.
- `pending` exists for possible future partial match creation.
- `bye` exists for consistency with `bracket_games.status`, but launch odd-team handling uses a ready single-team match instead of a bye row.
- `match_number` is useful for display and ordering within a round.

### `double_seeding_scores`

Stores the accepted per-team score for a double-seeding match.
This is the per-team truth for questions like "has this team played round 3?"

```sql
CREATE TABLE double_seeding_scores (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES double_seeding_matches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  side TEXT NOT NULL CHECK (side IN ('team1', 'team2')),
  score INTEGER,
  score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
  scored_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_id, side),
  UNIQUE(event_id, team_id, round_number)
);
```

Notes:

- `UNIQUE(match_id, side)` ensures one score per side of a match.
- `UNIQUE(event_id, team_id, round_number)` supports the event-level progress model where each team can have only one score per double-seeding round.
- The score rows should be inserted only on score acceptance.
- Reverting an accepted double-seeding submission should delete or clear the score rows associated with that submission.

### `double_seeding_rankings`

Raw double seed score is calculated as: `(2/3)*((n-rank+1)/n)+(1/3)*(avg/max)`, where:

- n = number of teams at event.
- rank = team's ordinal double seeding ranking.
- avg = team's average double seeding score.
- max = max tournament double seeding score.

- No rounds are dropped.
- Missing scores are ignored and zeros are zeros.
- The internal tiebreaker for two tied teams is their lowest score.

Rankings will be stored similarly to seeding rankings:

```sql
CREATE TABLE double_seeding_rankings (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  seed_average REAL,
  seed_rank INTEGER CHECK (seed_rank > 0),
  raw_double_seed_score REAL,
  tiebreaker_value REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id)
);
```

### `events`

Add:

```sql
ALTER TABLE events
  ADD COLUMN double_seeding_rounds INTEGER DEFAULT 0
```

When zero, application logic should hide all references to/controls for double-seeding.

### `score_submissions`

Add:

```sql
ALTER TABLE score_submissions
  ADD COLUMN double_seeding_match_id INTEGER
    REFERENCES double_seeding_matches(id) ON DELETE SET NULL;
```

Don't forget to add the appropriate SQLite version.

Do not add `double_seeding_score1_id` or `double_seeding_score2_id`.
A single submission fans out into one score row per participating team, which can be found by `score_submission_id` or `double_seeding_match_id`.

### `game_queue`

Double seeding matches are queued like any other:

```sql
ALTER TABLE game_queue
  ADD COLUMN double_seeding_match_id INTEGER
    REFERENCES double_seeding_matches(id) ON DELETE CASCADE;
```

Extend `queue_type` to include:

```text
double_seeding
```

The queue constraint should allow exactly one of the supported queue identities:

- bracket: `bracket_game_id`
- seeding: `seeding_team_id` plus `seeding_round`
- double seeding: `double_seeding_match_id`

### Type Checks

Extend score/template type checks from:

```text
seeding, bracket
```

to:

```text
seeding, bracket, double_seeding
```

This applies to:

- `event_scoresheet_templates.template_type`
- API request validation
- admin score filters
- tests that assert accepted type values

## Match Generation

Add application logic to generate double-seeding matches for an event.
This will occur after regular seeding has concluded.

Inputs:

- `event_id`
- number of rounds, usually 5 or 6
- eligible teams

Rules:

- Pair teams once per round.
- If the event has an odd number of eligible teams, create one single-team match per round.
- Randomize pairing on creation.
- A team may appear at most once per round.
- Every team should receive the same number of rounds.
- Avoid creating matches involving the same teams in different rounds.

Recommended application-level validation:

- Before inserting a round, verify no team appears twice in that round.
- Tests should cover duplicate team prevention.
- If match generation is rerun, require explicit destructive confirmation before replacing existing matches.
- Block regeneration once any double-seeding submission or score exists unless a separate archival/replacement workflow is defined.

## Submission Lifecycle

### Judge Submission

`ScoresheetForm` should support a new explicit schema marker:

```json
{
  "scoreKind": "double_seeding",
  "scoreDestination": "db",
  "eventId": 123
}
```

Do not infer double seeding from `mode: "head-to-head"` because that currently
means bracket scoring with a winner.

The double-seeding form should:

- Select a double-seeding match from queue.
- Populate Team A and Team B fields from the selected match.
- Hide or omit winner selection.
- Submit `scoreType: "double_seeding"`.
- Submit `double_seeding_match_id`.
- Include side totals in `score_data`.

Expected score data fields:

- `team_a_total`
- `team_b_total`
- `team_a_id`
- `team_b_id`
- `round`

The server should use `double_seeding_match_id` as the authoritative match identity and verify that it belongs to the submitted event.

### Accept

Extend `acceptEventScore` for `scoreType === "double_seeding"`.

Validation:

- Submission is event-scoped.
- Submission has `double_seeding_match_id`.
- Match exists and belongs to the submission event.
- Match has at least one participating team.
- A match may have one participating team only for odd-team single-team rounds.
- Submitted team ids, if present, match the stored match teams.
- All participating side scores are present or default consistently according to scoresheet rules.
- Existing `double_seeding_scores` for the match or team/round should conflict and block acceptance.

Transaction:

1. Insert Team 1 score into `double_seeding_scores`.
2. Insert Team 2 score into `double_seeding_scores` when `team2_id` is present.
3. Update `double_seeding_matches`:
   - `status = 'completed'`
   - `completed_at = CURRENT_TIMESTAMP`
   - `score_submission_id = submission id`
4. Update `score_submissions`:
   - `status = 'accepted'`
   - `reviewed_by`
   - `reviewed_at`
   - `double_seeding_match_id`

After transaction:

- Create audit entry for `score_submission`.
- Create audit entry for `double_seeding_match` completion.
- Remove matching double-seeding queue row.
- Recalculate double-seeding rankings.

### Reject

Reject behavior should match existing score submissions:

- Set submission status to `rejected`.
- Restore queue item from `scored` to `queued` if it was only pending.
- Do not write score rows.

### Revert

Extend `/scores/:id/revert-event`.

For accepted double-seeding submissions:

- No cascade confirmation is required because there is no bracket advancement.
- Delete or clear `double_seeding_scores` rows linked to the submission.
- Reset `double_seeding_matches`:
  - `status = 'ready'` when at least one participating team exists
  - `completed_at = NULL`
  - `score_submission_id = NULL`
- Reset `score_submissions` to `pending`.
- Restore or create the queue item as `queued`.
- Recalculate double-seeding rankings.
- Audit both the submission revert and score/match clearing.

### Bulk Accept

The current bulk accept route duplicates type-specific accept logic.
Before or while adding double seeding, refactor bulk accept to call the shared `acceptEventScore` service for each pending submission.
Bulk accept should use the same conflict behavior as single accept: existing score conflicts are skipped/reported, not overridden.
Use a best-effort per-score approach: process each selected pending submission independently, call `acceptEventScore` for each one, accept valid scores, and return separate `accepted` and `skipped` lists. One invalid or conflicting submission should not block the rest of the batch.

Benefits:

- One implementation path for seeding, bracket, and double seeding.
- Less risk that single accept and bulk accept diverge.
- Easier future score-type additions.

## API Plan

Add a new route module, for example:

```text
src/server/routes/doubleSeeding.ts
```

Suggested endpoints:

- `GET /double-seeding/matches/event/:eventId`
- `POST /double-seeding/matches/generate/:eventId`
- `DELETE /double-seeding/matches/event/:eventId`
- `GET /double-seeding/scores/event/:eventId`
- `GET /double-seeding/scores/team/:teamId`
- `GET /double-seeding/rankings/event/:eventId`
- `POST /double-seeding/rankings/recalculate/:eventId`

Public/spectator access should follow the same archived-event visibility rules as existing seeding routes.

Admin-only actions:

- Generate matches.
- Delete/regenerate matches.
- Manually recalculate rankings.
- Directly edit/delete scores, if that is supported.

Public or judge-facing actions:

- Read active matches needed to populate scoresheets.
- Read public scores/rankings where existing spectator rules allow it.

## Admin UI Plan

### Scoring Tab

Add `Double Seeding` to the Score Type filter.

When showing all score types, render a separate stacked section:

- Seeding Scores
- Bracket Scores
- Double Seeding Scores

Double-seeding review columns:

- Matchup: Team A vs Team B
- Round
- Match number
- Score: `Team A score - Team B score`
- Submitted
- Status
- Reviewed
- Actions

Actions should match other event-scoped scores:

- Accept
- Reject
- View Details (allows editing like other submissions)
- Revert after acceptance

### Dedicated Double Seeding Admin View

Add a new admin tab or section named `Double Seeding`.

It should resemble the existing seeding UI, not the bracket UI:

- Rows are teams.
- Columns are double-seeding rounds.
- Each cell shows that team's own side score for that round.
- Ranking/aggregate columns are separate from ordinary seeding.

Suggested sections:

- Match generation controls.
- Match list grouped by round.
- Team-round score matrix.
- Double-seeding rankings.

Match management controls:

- Generate randomized matches.
- Regenerate with explicit destructive confirmation.
- Recalculate rankings.

## Spectator UI Plan

Add a dedicated `Double Seeding` spectator view.

It should resemble the existing seeding spectator table:

- Sticky team/rank columns where existing seeding has them.
- Round columns.
- Raw double-seeding score/rank columns.
- Same visual language as existing `SeedingDisplay` / `SeedingScoresTable`.

Do not combine ordinary seeding and double seeding in one table unless product rules later request that.

## Overall Scores

Extend overall scoring from:

```text
documentation + raw seeding + weighted DE
```

to:

```text
documentation + raw seeding + raw double seeding + weighted DE
```

Update the overall row type with a separate field:

```ts
raw_double_seed_score: number;
```

Keep ordinary seeding and double seeding separate in the API response and UI so event staff can audit each contribution independently.

Consolidate overall-score calculations into one definitive server-side implementation.
Existing scattered formulas in event overall, bracket ranking totals, spectator awards, and any public/admin score summaries should call the shared implementation or a shared SQL/helper layer instead of duplicating `documentation + raw seeding + raw double seeding + weighted DE`.

## Scoresheet Templates

Update template type inference to honor an explicit schema marker:

```ts
scoreKind === 'double_seeding'
```

Recommended precedence:

1. If `schema.scoreKind === 'double_seeding'`, type is `double_seeding`.
2. Else if `schema.mode === 'head-to-head'`, type is `bracket`.
3. Else if `schema.bracketSource` exists, type is `bracket`.
4. Else type is `seeding`.

Update `ScoreSheetWizard`:

- Add sheet type `double_seeding`.
- Generate a schema with two teams, two sides, no winner selection.
- Use `scoreKind: "double_seeding"`.
- Use `scoreDestination: "db"`.
- Use event-scoped match selection instead of ordinary seeding team/round
  selection.

Double-seeding scoring fields can reuse the same side A/B field templates as DE, but the generated total fields should preserve side-specific totals instead of producing one combined `grand_total`.

## Queue Plan

Queue integration is required for launch.
Extend queue sync and display logic to support `queue_type = 'double_seeding'`.

Queue item display:

- Team 1 number/name
- Team 2 number/name
- Round number
- Match number
- Status
- Table number

Submission behavior:

- When a double-seeding score is submitted and pending review, mark the queue row `scored`.
- When accepted, delete the queue row.
- When rejected or reverted, restore it to `queued`.

## Migration Notes

This project supports SQLite in development/tests and PostgreSQL in production.
All schema additions must be added to both schema paths in `src/server/database/init.ts`.

Migration work should include:

- Create `double_seeding_matches`.
- Create `double_seeding_scores`.
- Create `double_seeding_rankings`.
- Add `score_submissions.double_seeding_match_id`.
- Add `game_queue.double_seeding_match_id`.
- Rebuild SQLite tables where CHECK constraints need widening.
- Widen PostgreSQL CHECK constraints for template/queue types.
- Add indexes:
  - `double_seeding_matches(event_id, round_number)`
  - `double_seeding_matches(team1_id)`
  - `double_seeding_matches(team2_id)`
  - `double_seeding_scores(event_id, team_id, round_number)`
  - `double_seeding_scores(match_id)`
  - `double_seeding_rankings(seed_rank)`
  - `score_submissions(double_seeding_match_id)`
  - `game_queue(double_seeding_match_id)`

## Testing Plan

### SQL / Service Tests

- Schema creates double-seeding tables in SQLite.
- Match generation creates the requested number of rounds.
- No team appears twice in one double-seeding round.
- Every team receives the expected number of rounds.
- Accepting a double-seeding submission creates one score row per participating team.
- Team 1 receives only side A score.
- Team 2 receives only side B score when a second team exists.
- Existing score conflicts are detected and acceptance is blocked.
- Reverting deletes/clears associated score rows and resets match/submission state.
- Double-seeding rankings recalculate independently from ordinary seeding.
- Overall score includes double-seeding contribution separately.

### HTTP Tests

- Submit requires valid `eventId`, `scoreType`, and `double_seeding_match_id`.
- Submit rejects match ids from another event.
- Admin accept works.
- Bulk accept works after refactor.
- Revert works without cascade confirmation.
- Score listing filters by `score_type=double_seeding`.
- Dedicated double-seeding score/ranking endpoints respect archived-event rules.
- Queue endpoints list and update double-seeding queue rows.

### Client Tests

- `ScoresheetForm` handles double-seeding match selection.
- Winner selection is not required for double-seeding.
- Submitted payload includes `scoreType: "double_seeding"`.
- Admin `ScoringTab` displays double-seeding rows and filters.
- Dedicated admin view renders team-round matrix.
- Spectator view renders double-seeding matrix.

## Suggested Implementation Order

1. Add schema and migrations for double-seeding tables and type widening.
2. Add double-seeding route/service skeletons.
3. Add match generation service and tests.
4. Add queue generation/sync/display support.
5. Extend `/api/scores/submit` for `double_seeding`.
6. Extend `acceptEventScore` for `double_seeding`.
7. Refactor bulk accept to reuse `acceptEventScore`.
8. Extend revert/reject queue behavior.
9. Add double-seeding rankings service.
10. Extend overall scoring.
11. Add admin Scoring tab support.
12. Add dedicated admin Double Seeding view.
13. Add spectator Double Seeding view.
14. Add scoresheet wizard/template support.
15. Run full verification:
    `npm run pretty && npm run lint && npm run test:run && npm run build`
