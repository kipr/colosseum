# Queue Team Presence Tracking

Colosseum tracks team arrival independently for two-team double-seeding (DS)
and double-elimination (DE) matches. Queue managers and admins can confirm each
participant as it arrives, while seeding and solo DS items retain the standard
single-step arrival flow.

## Queue workflow

Two-team matches use this workflow:

```text
Queued -> Called -> [Team 1 present + Team 2 present] -> Arrived -> On table -> Scored
```

The second presence confirmation changes the queue item to `arrived`
atomically. After that point, the item uses the same `On table` and `Scored`
actions as every other queue item.

| Queue item               | Arrival behavior                         |
| ------------------------ | ---------------------------------------- |
| Seeding                  | One `Arrived` action                     |
| Solo DS match            | One `Arrived` action                     |
| Two-team DS match        | Confirm each team independently          |
| DE match                 | Confirm each team independently          |
| Any item after `arrived` | Standard `On table` and `Scored` actions |

## Stored presence

Presence belongs to the queue item and is stored in the `game_queue` table:

- `present_team1_id`
- `present_team2_id`

Both columns are nullable foreign keys to `teams.id` with `ON DELETE SET NULL`.
They contain the confirmed team IDs rather than boolean flags. Queue responses
compare these IDs with the current DS or DE participants to produce the
normalized `team1_present` and `team2_present` booleans.

This comparison prevents a confirmation from carrying over when a bracket
rollback or another source update replaces a participant. The schema is
defined for both SQLite and PostgreSQL in
`src/server/database/schema/queue.ts`; existing databases receive the columns
through the schema runner's additive column phase.

## Presence API

An authenticated queue manager or admin updates one participant through:

```http
PATCH /queue/:id/presence
Content-Type: application/json

{
  "team_id": 123,
  "present": true
}
```

Setting `present` to `false` removes that team's confirmation while the item is
still `called`. A successful response contains the queue item ID, current
status, and normalized presence values:

```json
{
  "id": 42,
  "status": "called",
  "team1_present": true,
  "team2_present": false
}
```

The endpoint:

- accepts only paired DS and DE items in the `called` state;
- rejects seeding items, solo DS matches, and stale or unrelated team IDs;
- updates the matching presence slot;
- changes the status to `arrived` when both current teams are confirmed; and
- bumps the event queue version for every successful mutation, including a
  first confirmation that leaves the status as `called`.

The presence update and status reconciliation occur in one guarded SQL update.
Participant IDs are included in the guard, so simultaneous confirmations from
different sessions cannot leave a fully present match as `called` and a source
participant change cannot be confirmed through stale request state.

`GET /queue/event/:eventId` exposes `team1_present` and `team2_present` on queue
items. Queue version changes invalidate the endpoint's ETag so other open queue
screens receive presence changes through normal polling.

## Status guards and resets

The generic `PATCH /queue/:id` endpoint cannot move a paired item from `queued`
or `called` directly to `arrived`, `on_table`, or `scored` unless both stored
IDs match the current participants. Legacy items already at `arrived` or a
later state remain compatible with the normal workflow.

Presence follows these reset rules:

| Transition or operation                          | Presence behavior        |
| ------------------------------------------------ | ------------------------ |
| Call or re-call an item                          | Clear both confirmations |
| Move back to `queued` or `called`                | Clear both confirmations |
| Move from `on_table` back to `arrived`           | Retain confirmations     |
| Move forward after `arrived`                     | Retain confirmations     |
| Queue synchronization resets an item to `queued` | Clear both confirmations |
| Score rollback resets an item to `queued`        | Clear both confirmations |

New and repopulated queue items start with both presence columns null.

## Queue-management interface

For a paired item in the `called` state, the Queue tab replaces the single
`Arrived` button with one control per participant. Confirmed teams are shown in
green with a checkmark and can be unconfirmed until the second team arrives.
The status area shows progress such as `1/2 present` and identifies the team
still expected.

Presence controls are disabled while a request is in flight. Once the second
team is confirmed, the row immediately returns to the standard Back and
`On table` controls. The existing `called` filter includes partially arrived
matches; there is no separate partial-arrival status.

The controls support dark mode and narrow viewports. Seeding and solo DS rows
continue to show one `Arrived` action.

## Synchronization and team availability

Queue repair preserves an existing row while its source game remains eligible.
Normalized presence is always derived from the source game's current
participants, so stale stored IDs are not exposed as valid confirmations after
a valid-to-valid participant change.

Team-rest calculations treat both participants in `called`, `arrived`, and
`on_table` items as busy. This includes a called match where only one team has
been confirmed present, because both teams still occupy the operational queue.

## Test coverage

The feature is covered by:

- `tests/http/queue.test.ts` for the presence contract, status guards,
  concurrent confirmations, resets, and participant replacement;
- `tests/http/queue.doubleSeeding.test.ts` for paired and solo DS behavior;
- `tests/http/queue.sync.test.ts` and `tests/http/scores.revert.test.ts` for
  synchronization and rollback resets;
- `tests/http/queue.versioning.test.ts` for queue-version and ETag invalidation;
- `tests/sql/schema.test.ts`, `tests/server/database/schemaRunner.test.ts`, and
  `tests/server/database/postgresParity.test.ts` for schema behavior and
  database parity;
- `tests/sql/teamRest.test.ts` and `tests/http/queue.rest.test.ts` for busy-team
  derivation; and
- `e2e/admin-queue-management.spec.ts` for queue-manager workflows and
  responsive controls.
