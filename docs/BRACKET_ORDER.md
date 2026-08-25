# Bracket Queue Order — Design and Implementation Plan

Status: proposed, not yet implemented.

This document covers three related changes to how bracket matches reach the queue:

1. Give every bracket game a **canonical play order** that is dependency-correct and maximises the time between a team's runs.
2. **Interleave concurrent brackets** in the event queue instead of running them one after another.
3. Show a **soft "just played" warning** in the admin queue when a team is about to be called with little or no rest.

Nothing here changes the bracket structure itself — seeding, advancement, and cross-bracket loser routing in `src/server/services/bracketTemplates.ts` are untouched. This is purely about the order in which existing matches are played.

---

## 1. Motivation

### 1.1 Two goals in tension

- **Rest.** A team should not walk off one table and straight onto another. In the redemption bracket a single team can play six rounds in a row, so this is where it hurts most.
- **Throughput.** Events run on a fixed number of tables and a fixed amount of daylight. The redemption bracket narrows to one match at a time near the end, and while that tail plays out most tables sit idle.

These pull against each other: the shortest possible schedule is by definition the densest one, and a dense schedule is one where teams keep getting called immediately.

### 1.2 What the code does today

`game_number` is the bracket's structural numbering, and it is **not a valid play order**. The redemption bracket consumes losers from higher-numbered winners matches, so the numbering contains back-references:

| Bracket | Back-references in `game_number` order |
| --- | --- |
| 4 | none |
| 8 | G12 needs the loser of G13 |
| 16 | G23 needs the loser of G25; G24 needs the loser of G26 |
| 32 | 6 edges (G45–G48 from G49–G52; G55/G56 from G58/G57) |
| 64 | 14 edges |

Three places order the queue by `game_number` anyway:

- `POST /queue/populate-from-bracket` (`src/server/routes/queue.ts`) selects eligible games `ORDER BY game_number ASC` and assigns `queue_position = 1..N`.
- `syncBracketQueue` (`src/server/services/queueSync.ts`) walks all bracket games `ORDER BY game_number ASC` and appends any newly-eligible game at `MAX(queue_position) + 1`.
- `GET /queue/event/:eventId` returns rows `ORDER BY gq.queue_position ASC`.

The system doesn't break, because only games with both teams assigned are eligible, so a game never gets queued before its feeders resolve. But two consequences follow:

- **The order is emergent, not planned.** Because `syncBracketQueue` appends at the tail, the running order depends on the wall-clock order in which scores happen to be accepted. Two identical events can produce different queues.
- **`populate-from-bracket` serialises multi-bracket events.** It runs `DELETE FROM game_queue WHERE event_id = ?` and then inserts games for the single `bracket_id` it was given. Calling it for a second bracket wipes the first one's rows; they return later via `syncBracketQueue`, appended at the tail. The result is bracket A start-to-finish, then bracket B.

### 1.3 The structure we want

For a bracket of size `S = 2^k`, the shortest possible schedule with unlimited tables is **`2k + 1` rounds**, set by the longest dependency chain: lose in Winners R1, win `2k - 2` redemption rounds, then the Grand Final, then the Championship Reset.

Assigning every match to the **latest** round it can occupy without lengthening the tournament (an as-late-as-possible, or ALAP, schedule) produces line widths of `S/2, S/2, S/4, S/4, …, 2, 2, 1, 1, 1`. This is the structure we want, for two reasons:

- It is minimum-length by construction.
- Pushing winners-bracket matches as late as possible is exactly what interleaves them into the thin redemption tail — Winners Semi lands beside Redemption R3, Winners Final beside Redemption Semi. That is the "make the end of the bracket less serial" goal, and it falls out of the rule rather than needing to be hand-tuned.

Within each line, matches are ordered by **when the last of their feeding matches clears the queue** — earliest-fed first. This is the part that actually buys rest. Get it backwards, and the matches whose teams played at the *end* of the previous line get called first, sending those teams straight back out.

Concretely, for the 16-team bracket, line 2 contains Winners R2 (G9–G12) and Redemption R1 (G13–G16). G9 and G13 are fed by G1 and G2; G12 and G16 are fed by G7 and G8. Ordering the line `9, 13, 10, 14, 11, 15, 12, 16` gives every team in it exactly eight queue slots of rest. Ordering it `9, 10, 11, 12, 13, 14, 15, 16` (today) or `11, 12, 9, 10, 13, 14, 15, 16` gives some teams two or three.

### 1.4 How much this is worth

Zero-rest handoffs, meaning a team whose next match starts in the very round after the one it just finished. Counts exclude the Grand Final → Championship Reset rematch, which can never be spaced out. Measured by simulating the real templates from `bracketTemplates.ts`.

| Bracket | Tables | Rounds | Today | Canonical order |
| --- | --- | --- | --- | --- |
| 8 | 2 | 9 | 9/20 | **7/20** |
| 16 | 2 | 17 | 9/44 | **7/44** |
| 16 | 3 | 13 | 18/44 | **13/44** |
| 16 | 4 | 11 | 22/44 | **18/44** |
| 32 | 4 | 19 | 22/92 | **18/92** |
| 32 | 6 | 15 | 40/92 | **30/92** |
| 64 | 4 | 35 | 30/188 | **18/188** |
| 64 | 6 | 26 | 36/188 | **26/188** |

A search over all valid orderings (simulated annealing, plus exhaustive enumeration for the 4- and 8-team brackets) could not beat the ALAP + feeder-order rule at any table count. So this is the best a *pure reordering* can do, and it is a real but modest win.

The larger wins come from the other two changes.

**Interleaving concurrent brackets** is better on both axes at once, because the thin tail of one bracket gets filled with another bracket's matches instead of idling tables:

| Configuration | One after another | Interleaved |
| --- | --- | --- |
| 2 × 16-team, 4 tables | 19 rounds, 33/88 | **17 rounds, 14/88** |
| 2 × 16-team, 6 tables | 15 rounds, 49/88 | **13 rounds, 26/88** |
| 3 × 16-team, 4 tables | 27 rounds, 48/132 | **24 rounds, 11/132** |
| 3 × 8-team, 3 tables | 18 rounds, 29/60 | **15 rounds, 6/60** |

**Deliberately spending rounds** is the only way past the floor once a single bracket is running alone. For a 16-team bracket on four tables:

| Total rounds | Zero-rest handoffs (of 44) |
| --- | --- |
| 11 (shortest) | 18 |
| 12 | 10 |
| 13 | 6 |
| 14 | 5 |
| 16 | 3 |

Two extra rounds removes two thirds of them. That requires holding a table idle, which a plain FIFO queue cannot express — hence the soft warning in section 4, and the deferred work in section 7.

### 1.5 Table-count planning

Useful for event planning, and worth surfacing in admin docs eventually. Past the table count in the last column, more tables do nothing: the redemption chain, not capacity, is the constraint.

| Bracket | Games | Round floor | Tables to reach the floor |
| --- | --- | --- | --- |
| 4 | 7 | 5 | 2 |
| 8 | 15 | 7 | 3 |
| 16 | 31 | 9 | 4 |
| 32 | 63 | 11 | 6 |
| 64 | 127 | 13 | 10 |

---

## 2. The canonical orders

Each line is a group of matches with no dependency on each other, so they can run concurrently. Within a line the listed order is the queue order, which is what matters when there are fewer tables than the line is wide.

**4-team** — 7 games, 5 lines

```
1, 2
3, 4
5
6
7
```

**8-team** — 15 games, 7 lines

```
1, 2, 3, 4
5, 7, 6, 8
9, 10
13, 11
12
14
15
```

**16-team** — 31 games, 9 lines

```
1, 2, 3, 4, 5, 6, 7, 8
9, 13, 10, 14, 11, 15, 12, 16
17, 19, 18, 20
25, 26, 21, 22
23, 24
28, 27
29
30
31
```

**32-team** — 63 games, 11 lines

```
1-16
17, 25, 18, 26, 19, 27, 20, 28, 21, 29, 22, 30, 23, 31, 24, 32
33, 37, 34, 38, 35, 39, 36, 40
49, 50, 51, 52, 41, 43, 42, 44
45, 47, 46, 48
57, 58, 53, 54
55, 56
60, 59
61
62
63
```

**64-team** — 127 games, 13 lines

```
1-32
33, 49, 34, 50, 35, 51, 36, 52, 37, 53, 38, 54, 39, 55, 40, 56,
  41, 57, 42, 58, 43, 59, 44, 60, 45, 61, 46, 62, 47, 63, 48, 64
65, 73, 66, 74, 67, 75, 68, 76, 69, 77, 70, 78, 71, 79, 72, 80
97, 98, 99, 100, 101, 102, 103, 104, 81, 85, 82, 86, 83, 87, 84, 88
89, 93, 90, 94, 91, 95, 92, 96
113, 114, 115, 116, 105, 107, 106, 108
109, 111, 110, 112
121, 122, 117, 118
119, 120
124, 123
125
126
127
```

### 2.1 Derive, don't hardcode

These sequences should be **computed from the template DAG**, not pasted into a table. `bracketTemplates.ts` already encodes every dependency in `team1_source` / `team2_source` (`winner:N` / `loser:N`), so the order can be derived in about forty lines:

1. Build the dependency graph from the source strings.
2. Longest-path from the roots gives the critical path length, which is the number of lines.
3. Walk the graph in reverse topological order to get each game's ALAP line.
4. Within each line, sort by the queue position of the game's last-finishing feeder, tie-broken by first feeder then by game number.

The payoff is that if anyone changes the cross-bracket loser routing (`crossBracketPosition`, or the hand-written finals wiring), the play order follows automatically instead of silently going stale. The sequences above then become **test fixtures** that pin the current output, so an accidental structural change is caught rather than absorbed.

Note that a plain topological sort is not sufficient — it reproduces roughly today's behaviour. The ALAP levelling and the within-line feeder sort are both load-bearing.

---

## 3. Implementation

### 3.1 Phase 1 — compute and store `play_order`

**`src/server/services/bracketTemplates.ts`**

Add, alongside the existing exports:

```ts
/** Game numbers in canonical play order for a bracket size. */
export function generatePlayOrder(bracketSize: number): number[];

/** game_number -> 1-based play order rank. */
export function getPlayOrderMap(bracketSize: number): Map<number, number>;
```

Both derive from `generateDEBracketTemplates(bracketSize)` as described in 2.1. Memoise per size; there are only five.

Extend `BracketTemplate` with `play_order: number`, populated in `generateDEBracketTemplates` before it returns.

**Schema** — `src/server/database/schema/brackets.ts`

Add `play_order INTEGER` to both `bracket_templates` and `bracket_games`, in both the `postgres` and `sqlite` blocks. New databases pick it up from `CREATE TABLE IF NOT EXISTS`; existing ones need an additive migration (see 3.4).

Add an index: `CREATE INDEX IF NOT EXISTS idx_bracket_games_play_order ON bracket_games(bracket_id, play_order)`.

**Seeding** — `ensureBracketTemplatesSeeded`

Today this ends in `ON CONFLICT (bracket_size, game_number) DO NOTHING`, which means an already-seeded database would keep `play_order = NULL` forever. Change it to an upsert:

```sql
ON CONFLICT (bracket_size, game_number) DO UPDATE SET play_order = EXCLUDED.play_order
```

This makes the column self-healing: any deployment that has already seeded templates gets them corrected on the next bracket creation. Restricting the `DO UPDATE` to `play_order` keeps the existing "don't clobber hand-edited templates" behaviour for every other column.

**Bracket generation** — `src/server/routes/brackets.ts`

Both places that copy templates into `bracket_games` (the `POST /brackets` path around line 530 and `POST /brackets/:id/games/generate` around line 1343) already `SELECT * FROM bracket_templates`, so `play_order` comes along for free; it just needs adding to the `INSERT` column list.

Also update `POST /brackets/templates` (the handler at line 1649; its `INSERT` column list is around line 1689) to accept and persist `play_order`, and `GET /brackets/templates` to return it.

### 3.2 Phase 2 — order and interleave the queue

**The interleave key.** Sorting by `play_order` alone would interleave brackets round-robin, one match each in turn. That works while both brackets are running, but a 15-game bracket exhausts itself while the 31-game bracket still has 16 games left, and those 16 then run alone — precisely the thin serial tail we were trying to fill.

Instead, normalise each bracket's play order onto `[0, 1]` so brackets of different sizes start together and finish together:

```
key = (bg.play_order - 1.0) / (2 * b.bracket_size - 2)
```

A double-elimination bracket of size `S` always has `2S - 1` games, so the denominator needs no extra column. Ties (equal-size brackets) break on `brackets.id`, which reduces to round-robin — the same thing, since normalisation is monotonic within a bracket and dependencies never cross brackets.

Every query that currently orders bracket games for the queue becomes:

```sql
ORDER BY (COALESCE(bg.play_order, bg.game_number) - 1.0) / (2 * b.bracket_size - 2) ASC,
         b.id ASC,
         bg.game_number ASC
```

The `COALESCE` means a bracket created before the migration still produces a sane order instead of sorting all its games to the front on `NULL`. The `- 1.0` forces float division in both SQLite and Postgres; integer division would collapse every key to 0.

**`POST /queue/populate-from-bracket`** — `src/server/routes/queue.ts`

Two changes:

- Order by the interleave key instead of `game_number ASC`.
- Stop scoping the insert to one bracket while deleting the whole event's queue. Either accept an optional `bracket_id` and only delete that bracket's rows, or make it event-wide and populate from every bracket at once. **Event-wide is preferred** — it matches what the button means to a tournament director, and it is the change that actually delivers the interleaving win. Keep `bracket_id` accepted for backwards compatibility, treating it as a filter rather than a wipe-and-replace scope.

This is a user-visible behaviour change; the modal copy in `QueueTab.tsx` ("This will completely clear the existing queue and replace it with eligible games from the selected bracket") needs updating, as do the existing expectations in `tests/http/queue.test.ts`.

**`syncBracketQueue`** — `src/server/services/queueSync.ts`

Today newly-eligible games are appended at `MAX(queue_position) + 1`. Change to **insert in sorted position**: find the first existing bracket-type row whose interleave key is greater than the new game's, shift it and everything after it up by one, and insert there. Fall back to appending when there is no such row.

Details worth getting right:

- Do the shift and the insert inside the existing `db.transaction` so a partial renumber can't be observed.
- Compute all insertions for one sync pass together, then apply one renumber, rather than shifting once per game.
- Only reposition among `queue_type = 'bracket'` rows. Seeding and double-seeding items keep their relative placement.
- This does mean a manual reorder can drift when new games arrive. That is inherent to a single `queue_position` column and is acceptable: the admin's manual moves are corrections to a live window, not a persistent plan. Call it out in the PR description so it isn't a surprise.

### 3.3 A reusable additive-column migration

There is currently no mechanism for adding a column to an existing table. `runSchema` (`src/server/database/schema/runner.ts`) executes `tables` → `constraints` → updated-at triggers → `triggers` → `indexes`, and `scoring.ts` does schema evolution with idempotent Postgres `DO $$ … END $$` blocks. Postgres supports `ALTER TABLE … ADD COLUMN IF NOT EXISTS`; SQLite does not, and errors on a duplicate column.

Add a `columns` phase to `DialectSchema` in `src/server/database/schema/types.ts`:

```ts
export interface ColumnAddition {
  table: string;
  column: string;
  definition: string; // e.g. 'INTEGER'
}

export interface DialectSchema {
  tables?: readonly string[];
  columns?: readonly ColumnAddition[];
  constraints?: readonly string[];
  triggers?: readonly string[];
  indexes?: readonly string[];
}
```

In `runner.ts`, run `columns` between `tables` and `constraints`, checking existence first — `information_schema.columns` for Postgres, `PRAGMA table_info(<table>)` for SQLite — and issuing the `ALTER TABLE … ADD COLUMN` only when missing. This is reusable for the `events.min_rest_minutes` column in phase 3 and for every future additive migration, which is worth more than a one-off hack.

### 3.4 Backfilling in-flight brackets

Brackets created before the migration will have `play_order IS NULL`. The `COALESCE(play_order, game_number)` fallback keeps them working, but they should be corrected:

- On server start, or lazily on the first queue sync for an event, run a backfill that sets `bracket_games.play_order` from `getPlayOrderMap(bracket.bracket_size)` for any bracket with null values.
- Skip bracket sizes that are not powers of two between 4 and 64 (none exist today, but `generatePlayOrder` should throw rather than silently produce garbage, matching `generateDEBracketTemplates`).
- The backfill only writes `play_order`. It must never touch `queue_position`, so an event mid-run doesn't get resequenced underneath the scorekeeper.

---

## 4. Soft "just played" warning

### 4.1 Behaviour

In the admin queue, a row whose team finished a match recently gets a visible but non-blocking warning:

- A warning chip next to the team, reading e.g. `#4021 · 3 min`.
- A subtle row tint, in the same family as the existing `queue-row--<status>` tints.
- A tooltip giving the exact elapsed time and which match it was.
- When the admin clicks the button that advances `queued → called`, a confirm dialog appears (`useConfirm` is already wired into `QueueTab`) — "Team 4021 finished Game 14 three minutes ago. Call anyway?" — rather than the call being silently blocked.

A second, stronger case: a team that is **currently out on another table** (some other queue row for that team is `called`, `arrived`, or `on_table`). That is almost always a mistake and deserves a distinct, louder chip.

Nothing is ever disabled. Tournament directors override this constantly for good reasons, and a hard block would just get worked around.

### 4.2 Where "last played" comes from

Queue rows are deleted when a score is accepted, so the queue itself carries no history. The data has to come from the match tables:

| Source | Timestamp | Teams |
| --- | --- | --- |
| `bracket_games` | `completed_at` | `team1_id`, `team2_id` |
| `double_seeding_matches` | `completed_at` | `team1_id`, `team2_id` |
| `seeding_scores` | `scored_at` | `team_id` |
| `game_queue` (active) | `called_at` | via the joined match/team |

New service, `src/server/services/teamRest.ts`:

```ts
export interface TeamRestInfo {
  lastPlayedAt: Map<number, string>; // team_id -> ISO timestamp
  busy: Set<number>;                 // team_id currently called/arrived/on_table
}

export async function getTeamRest(db: Database, eventId: number): Promise<TeamRestInfo>;
```

One `UNION ALL` query with a `MAX(...) GROUP BY team_id` for the timestamps, one query for the busy set.

### 4.3 Return timestamps, not a computed flag

`GET /queue/event/:eventId` is ETag-cached on `queue_versions.version` and polled every 10 seconds; unchanged polls are answered with a 304 from a single-row version lookup.

That makes a server-computed `is_resting` boolean wrong. Whether a team is "recently played" depends on the current wall clock, so the correct value changes continuously while `version` does not — the client would sit on a stale 304 and show a warning that should have expired, or miss one that should have appeared.

So the endpoint returns **raw timestamps**, which only change when something is actually mutated:

- `team1_last_played_at`, `team2_last_played_at` (bracket rows)
- `seeding_team_last_played_at` (seeding rows)
- `double_seeding_team1_last_played_at`, `double_seeding_team2_last_played_at`
- `team1_busy`, `team2_busy`, … as booleans, which *are* version-correct because busy state only changes through queue mutations

The client computes elapsed time against `Date.now()` and re-renders on its own interval. The ETag stays honest and the warning stays live.

### 4.4 The threshold

Add `min_rest_minutes INTEGER NOT NULL DEFAULT 10` to `events` (both dialects, via the `columns` phase from 3.3), exposed in the event settings UI and returned by the events API. Ten minutes is a reasonable default for a KIPR-style match cycle; a director running a fast event can lower it, and setting it to `0` disables the warning entirely.

Time-based rather than round-based, because a "round" is not a thing the system tracks — table count and match duration vary between events, and elapsed minutes is what the person at the queue table actually cares about.

### 4.5 Client changes

`src/client/components/admin/QueueTab.tsx`:

- Extend the `QueueItem` interface with the new fields.
- Add a `useRestWarning(item, minRestMinutes, now)` helper returning `null | 'resting' | 'busy'`.
- Drive a ticking `now` from a `setInterval` at ~30s so chips age without a network round trip.
- Render the chip inside `renderTeamNumber` / `renderItemDetails`, add the row class in `rowClassName`, and gate the `queued → called` step in `handleFlowStep` behind `confirm()` when a warning is present.

`QueueTab.css` gets `.queue-rest-chip`, `.queue-rest-chip--busy`, and `.queue-row--rest-warning`.

The same fields are available to the judge-facing views for free, but wiring them up there is out of scope for this change.

---

## 5. Testing

**`tests/sql/bracketPlayOrder.test.ts`** (new)

- For each of 4, 8, 16, 32, 64: `generatePlayOrder(size)` exactly equals the sequences in section 2. These are the regression fixtures.
- Every generated order is a valid topological order of the template DAG — no game appears before a game it draws a team from.
- Line count equals `2 * log2(size) + 1`.
- Line widths equal `S/2, S/2, S/4, S/4, …, 2, 2, 1, 1, 1`.
- `generatePlayOrder` throws on unsupported sizes, matching `generateDEBracketTemplates`.
- A property check worth having: for each size, assert the canonical order's zero-rest count at 2, 3, and 4 tables is no worse than plain `game_number` order. This is the actual thing we care about, and it keeps a future "harmless" tweak from quietly regressing it.

**`tests/sql/bracketTemplatesSeed.test.ts`** (extend)

- `play_order` is non-null for every seeded template and is a permutation of `1..2S-1` per size.
- Re-running `ensureBracketTemplatesSeeded` over rows seeded without `play_order` fills it in (the upsert path).

**`tests/http/queue.playOrder.test.ts`** (new)

- `populate-from-bracket` on a single 16-team bracket yields `queue_position` in canonical play order.
- With two brackets in one event, the queue alternates between them, and populating the second does not wipe the first.
- A 16-team and an 8-team bracket in one event interleave proportionally — the 8-team bracket's last game is near the end of the combined queue, not two thirds of the way through.
- `syncBracketQueue` inserts a newly-eligible game at its sorted position rather than the tail. Set up by completing the feeders of a mid-bracket game out of order.
- A bracket with `play_order IS NULL` still produces a stable order via the fallback.

**`tests/http/queue.rest.test.ts`** (new)

- A team with a recently completed bracket game surfaces `team1_last_played_at`.
- A team with an `on_table` row elsewhere surfaces `team1_busy = true`.
- A team that has never played surfaces `null`.
- The response is unchanged across two calls with no mutation, so the ETag still 304s — this is the regression guard for 4.3.

**`tests/client/queueRestWarning.test.ts`** (new)

- The warning helper returns `'resting'` inside the window, `null` outside it, and `null` when `min_rest_minutes` is 0.
- `'busy'` takes precedence over `'resting'`.

**Existing tests to update**

- `tests/http/queue.test.ts` — `populate-from-bracket` expectations change with the event-wide behaviour.
- `tests/http/queue.sync.test.ts` — append-at-tail assertions become sorted-insert assertions.
- `tests/sql/schema.test.ts` — new columns.
- `e2e/admin-queue-management.spec.ts` — check the warning chip renders; verify the call confirm appears.

Run `npm run pretty && npm run lint && npm run test:run && npm run build` before each PR.

---

## 6. Suggested sequencing

Four PRs, each independently shippable and useful on its own.

| PR | Scope | Risk |
| --- | --- | --- |
| 1 | `columns` migration phase in the schema runner, with tests | Low — no behaviour change |
| 2 | `generatePlayOrder`, `play_order` columns, template upsert, generation copy, backfill | Low — column is written but nothing reads it yet |
| 3 | Queue ordering and cross-bracket interleaving | Medium — changes running order and `populate-from-bracket` semantics |
| 4 | `min_rest_minutes`, `teamRest` service, queue response fields, admin UI warning | Low — additive |

PR 3 is the one to be careful with. It should not ship in the middle of an event season without a dry run: generate a bracket on a copy of a real event, populate the queue, and eyeball the order against section 2 before trusting it live.

---

## 7. Deliberately out of scope

**Rest-aware dispatch (holding a table idle).** Section 1.4 shows this is the biggest remaining lever — two extra rounds removes two thirds of the zero-rest handoffs on a 16-team bracket. But a FIFO `queue_position` cannot express "leave this table empty for one round"; it needs the dispatcher to be able to skip a match and come back to it. That is a genuine scheduling feature, not an ordering change, and it should follow only if the soft warning turns out to be insufficient in practice. The warning is the cheap version of the same idea: it puts the decision in front of a human who can already see the room.

**Per-bracket table assignment.** `game_queue.table_number` is set by hand at call time. Automatic assignment would let the scheduler reason about physical table turnaround, but there is no evidence yet that it is a bottleneck.

**Surfacing the planning numbers.** The table in 1.5 ("with N tables, this bracket takes M rounds") would be genuinely useful in the bracket setup UI as an estimate. Separate change.

---

## Appendix: how the numbers were produced

Every figure in section 1 comes from simulating the actual templates returned by `generateDEBracketTemplates`, not from a model of a bracket:

- The dependency graph is read from `team1_source` / `team2_source`.
- Scheduling is a non-blocking list schedule: unit-length matches, `T` tables, each round dispatching the earliest queue entries whose feeders have finished.
- A "zero-rest handoff" is a graph edge whose endpoints land in consecutive rounds. Edges into the Championship Reset are excluded throughout, since that rematch is immediate by definition.
- Optimality claims come from simulated annealing over dispatch priorities for the larger brackets, and exhaustive enumeration of all valid wave schedules for the 4- and 8-team brackets.

The proportional interleaving key in 3.2 is the one recommendation carried on reasoning rather than measurement — the harness could not be re-run on this machine, since it has no Node toolchain outside the dev container. The argument is that interleaving is most valuable in the thin tail, and round-robin by rank stops interleaving exactly when the smaller bracket runs out. The mixed-size test in section 5 is what confirms it; if the numbers disagree, prefer whichever key measures better and update this section.
