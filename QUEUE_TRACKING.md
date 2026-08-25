# Individual Team Presence Tracking for DS/DE

## Goal

Allow queue managers and admins to mark each team present independently for double seeding (DS) and double elimination (DE) matches. A two-team match must not advance from `called` to `arrived` until both teams are present. Once both teams are present, the queue item returns to the existing single-action flow for all later steps.

## Intended behavior

| Queue item | Arrival behavior |
| --- | --- |
| Seeding | Keep the existing single `Arrived` action. |
| Solo DS match | Keep the existing single `Arrived` action. |
| Two-team DS match | Mark each team present independently. |
| DE match | Mark each team present independently. |
| Any item after `arrived` | Keep the existing `On table` to `Scored` flow. |

The resulting flow is:

```text
Queued -> Called -> [Team A present + Team B present] -> Arrived -> On table -> Scored
```

Confirming the second team should atomically change the overall queue status to `arrived`. Moving Back from `arrived` to `called` should clear both confirmations so the arrival checkpoint always has an unambiguous state.

## Implementation plan

### 1. Persist queue-specific presence

Presence must survive refreshes and synchronize between queue-manager and admin sessions, so it should be stored on `game_queue`, not only in React state or on the underlying bracket/DS match.

Add two nullable team references to `game_queue`:

- `present_team1_id`
- `present_team2_id`

Store the confirmed team IDs rather than plain booleans. If a bracket rollback or another source update changes a game's participant, an old confirmation will no longer match the current team and cannot accidentally carry forward.

Update both the PostgreSQL and SQLite definitions in `src/server/database/schema/queue.ts`, including additive entries in the schema runner's `columns` phase for existing databases. No additional index is needed because presence mutations address queue rows by their primary key.

Existing records require no data backfill:

- `queued` and `called` rows start with neither team confirmed.
- Legacy `arrived`, `on_table`, and `scored` rows remain governed by their existing status.
- If a legacy row moves Back to `called`, presence starts fresh.

### 2. Add a dedicated presence mutation

Add an authenticated endpoint near the existing queue mutations in `src/server/routes/queue.ts`:

```text
PATCH /queue/:id/presence
{ "team_id": 123, "present": true }
```

The endpoint should:

- Resolve the queue row's current DS or DE participants.
- Reject seeding rows and solo DS matches because those retain the normal status action.
- Reject a stale or unrelated team ID.
- Permit presence changes only while the row is `called`.
- Set or clear the presence column corresponding to the current team.
- Atomically set `status = 'arrived'` when both stored IDs match the current participants.
- Bump the event's queue version even if the overall status remains `called`, ensuring the existing ETag polling updates other open screens.
- Return the updated status and normalized `team1_present` and `team2_present` values.

The queue-list response should also expose normalized boolean presence values. This keeps PostgreSQL and SQLite representation details out of the client and compares the stored IDs against the current DS/DE participants on every read.

Guard the generic queue status endpoint as well. A paired DS/DE item must not advance from `queued` or `called` to `arrived`, `on_table`, or `scored` unless both current participants have been confirmed. Score-acceptance services may continue to manage their own terminal status changes.

### 3. Apply reset semantics consistently

Use the following rules across all status-changing paths:

- Calling or re-calling an item clears both presence fields.
- Moving Back to `queued` or `called` clears both fields.
- Moving from `on_table` Back to `arrived` retains them.
- Normal transitions after `arrived` do not inspect or change them.

Clear presence anywhere queue synchronization or score rollback resets a row to `queued`, particularly in:

- `src/server/services/queueSync.ts`
- `src/server/services/scoreAccept.ts`

New queue items and bracket repopulation naturally begin with null presence fields.

### 4. Update the queue-management UI

Extend the queue item type and rendering logic in `src/client/components/admin/QueueTab.tsx` with normalized presence values and a helper that returns the current pair of participants for DS/DE rows.

When a paired item is `called`:

- Replace the single `Arrived` button with two compact team-specific controls, such as `Mark #123 present` and `Mark #456 present`.
- Show confirmed teams in green with a checkmark.
- Allow the first confirmation to be undone before the second team arrives.
- Show `1/2 present` and `Waiting for #456` beneath the Called badge, making the team that needs another announcement immediately visible.
- Disable the row's presence controls while a request is in flight to prevent accidental duplicate requests.
- Keep the existing Back button.

When the second team is confirmed, the returned `arrived` status should immediately restore the existing Back and On table controls. Seeding and solo DS rows continue using the current `handleFlowStep` behavior without special cases in their visible workflow.

Add styles in `src/client/components/admin/QueueTab.css` for presence controls, progress text, waiting indicators, confirmed states, dark mode, and narrow screens. The existing `called` status filter should continue to include partial-arrival rows; a new status or filter is not required.

An optional queue summary can show the number of teams still expected across called matches. This is useful if it remains compact and does not obscure the primary row-level information.

### 5. Keep synchronization and derived behavior safe

Queue repair currently preserves existing rows when their source game remains eligible. Comparing stored presence team IDs to current source participants prevents stale confirmations after a valid-to-valid participant change.

The existing team-rest logic may continue treating both participants in a `called`, `arrived`, or `on_table` item as busy. A called team still occupies the operational queue even if it has not yet arrived.

The presence endpoint must use an atomic update/reconciliation step so simultaneous confirmations from different admin screens cannot leave a row with both teams present while its overall status remains `called`.

## Verification plan

### Database and schema

- Verify both columns exist for new and upgraded SQLite databases.
- Verify PostgreSQL and SQLite schema parity.
- Verify the columns default to null and their team references use the intended deletion behavior.
- Verify existing active queue rows remain valid after initialization.

### HTTP and service tests

- The first confirmation leaves a paired item `called`.
- The second confirmation changes it to `arrived`.
- Confirmations work for both DS and DE.
- Solo DS and seeding retain the existing single arrival action.
- Undoing the first confirmation works.
- Unrelated or stale team IDs are rejected.
- Presence changes in the wrong workflow state are rejected.
- Direct attempts to bypass the two-team checkpoint are rejected.
- Concurrent confirmations cannot leave a `2/2 present` row at `called`.
- Every presence mutation increments the queue version and invalidates ETags.
- Calling, moving Back, queue synchronization, and score rollback clear presence according to the reset rules.
- A source participant change invalidates a confirmation for the former team.
- Legacy `arrived` and later rows remain compatible.

The primary HTTP coverage should be added to the existing queue suites, including `tests/http/queue.test.ts`, `tests/http/queue.doubleSeeding.test.ts`, `tests/http/queue.sync.test.ts`, and `tests/http/queue.versioning.test.ts`.

### UI and end-to-end tests

Extend `e2e/admin-queue-management.spec.ts` to verify:

- A called DS/DE row shows two team-specific controls.
- Marking one team updates the progress and `Waiting for` text without advancing the row.
- Marking the second team changes the row to `Arrived`.
- The normal On table and Scored actions return after both teams are present.
- Moving Back to `called` clears confirmations and restores both team-specific controls.
- Seeding and solo DS rows still present one Arrived action.
- Presence controls remain understandable and usable at a narrow viewport.

## Acceptance criteria

- Queue managers can tell at a glance which team in a called DS/DE match is still missing.
- Each team can be marked present independently from any authenticated queue-management session.
- Two-team DS/DE rows cannot advance through the operational queue before both current participants are present.
- After arrival, the workflow behaves exactly like the current single-toggle flow.
- Presence survives reloads, propagates through existing polling, and cannot leak to a replacement bracket participant.
- Existing queue data and single-team workflows remain backward compatible.
