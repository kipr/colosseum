# Step-by-Step Implementation Plan: Option A (Event-Centric Tabs)

## Overview

Implement the event-centric admin UI so every tab is scoped to the selected event. Work is split into phases with clear dependencies.

---

## Implementation Reality Check (Updated Feb 12, 2026)

### Evaluation of the statement: "completed up to phase 6"

**Assessment: Partially true, but not fully accurate.**

- Most of the user-facing work for Phases 1-6 exists in code.
- However, Phase 0 was not completed as originally designed (EventContext was created but is not wired into Admin/Navbar).
- Phase 1 is missing the planned delete action in the Events UI.
- Phase 6 supports event-scoped review/approval in Admin, but score submission still uses legacy `/api/scores/submit` payloads and does not yet reliably write event-scoped linkage fields (`event_id`, `score_type`, `bracket_game_id`, `game_queue_id`) at submit time.

### As-Built Status Through Phase 6

#### Phase 0: Foundation (Event Context) - **Partial**
- Step 0.1: `EventContext` was created with the planned shape (plus `error` and `selectEventById`).
- Step 0.2: Admin event selector is API-backed (`GET /events`) and persists selection in `localStorage`.
- Step 0.2 deviation: Navbar still receives `adminEventData` prop; it does **not** consume `EventContext`.
- Step 0.3: Event type alignment exists in utility/type files; status enum is aligned to API values.
- Step 0.3 deviation: status label mapping is inconsistent (`active -> Active` in current UI helpers; separate context file maps to `Live` but is unused).
- Step 0.4: "No event selected" handling is implemented across event-scoped tabs, and first/last event auto-selection exists in Admin.

#### Phase 1: Events Tab - **Mostly complete**
- Step 1.1: Events list table exists with key fields and status badges; event load uses API.
- Step 1.2: Create event flow implemented (`POST /events`), with refresh and select-new behavior.
- Step 1.3: Edit event flow implemented (`PATCH /events/:id`), with refresh.
- Step 1.4: Implemented in UI. `EventsTab` now exposes a delete action wired to `DELETE /events/:id`.
- Step 1.5 (optional): Not implemented (no dedicated event detail/quick stats view).

#### Phase 2: Teams Tab - **Complete with minor deviation**
- Steps 2.1-2.4 and 2.6 implemented (`GET /teams/event/:eventId`, create/edit/bulk/delete).
- Step 2.5 implemented via available endpoints and UI actions:
  - quick check-in action uses `PATCH /teams/:id/check-in`
  - general status changes are available via edit form (`PATCH /teams/:id`)
- Minor deviation: no dedicated `PATCH /teams/:id/status` endpoint was added; existing PATCH endpoint is used instead.

#### Phase 3: Seeding Tab - **Complete**
- Steps 3.1-3.4 implemented: scores/rankings views, calculate/recalculate rankings, inline score editing with save/upsert.
- Step 3.5 partially addressed at data level (`score_submission_id` supported), but no prominent UI link-out workflow was added.

#### Phase 4: Brackets Tab - **Complete with endpoint variation**
- Steps 4.1-4.4 and 4.6-4.9 implemented (list/create/detail/generate entries/generate games/advance winner/edit/delete).
- Step 4.5 implemented functionally through `POST /brackets/:id/entries/generate` seeded from rankings.
- Deviation: planned `POST /brackets/templates/seed` endpoint was not added; equivalent behavior is covered by existing generation flow.

#### Phase 5: Queue Tab - **Complete plus extra**
- Steps 5.1-5.7 implemented (event queue list, populate, add entries, reorder, status updates, remove).
- Extra: `POST /queue/populate-from-seeding` was added and wired in UI.

#### Phase 6: Scoring Tab Migration - **Partial**
- Steps 6.1-6.4 implemented in Admin UI:
  - dual mode (`spreadsheet` vs `event`)
  - event-scoped score list (`GET /scores/by-event/:eventId`)
  - event filters and score type context display
- Step 6.5 mostly implemented:
  - event-scoped accept/revert flows exist (`POST /scores/:id/accept-event`, `POST /scores/:id/revert-event`)
  - bracket advancement is handled in accept-event path
- Key remaining gap:
  - judge submission path (`POST /api/scores/submit`) still writes legacy payload and does not consistently populate event-scoped submission linkage fields required for full DB-backed flow.

### Course Corrections for Remaining Phases

#### Priority Correction A (Before/with Phase 7)
- Implement event-scoped score submission contract in `POST /api/scores/submit` (or new endpoint) so submissions can include and persist:
  - `event_id`
  - `score_type` (`seeding` or `bracket`)
  - `bracket_game_id` and/or seeding linkage
  - `game_queue_id` when applicable
- Update judge/scoresheet clients to send these fields.
- This should be treated as a blocker for claiming full migration.

#### Priority Correction B (Phase 0 debt cleanup)
- Wire `EventProvider` into app/admin composition and refactor Admin/Navbar/tab consumers to use `useEvent`.
- Remove duplicated event state logic and reconcile status label mapping to one source of truth.

#### Priority Correction C (Phase 1 cleanup) - **Complete**
- Added planned delete action in `EventsTab` using existing `DELETE /events/:id`.
- Selection behavior is explicit when deleting the currently selected event (fallback select active/setup event, then first remaining, else clear selection).

#### Phase 7 (Templates) correction
- Schema/table exists (`event_scoresheet_templates`), but CRUD/UI are still missing.
- Build event-template routes and UI first; then integrate judge template listing by selected event.

#### Phase 8 (Audit) correction
- Backend route exists (`GET /audit/event/:eventId` with filters/pagination params), but no admin tab exists.
- Add Audit tab UI and hook into current sidebar model.

#### Phase 9 (Sidebar) correction
- Sidebar currently includes: Events, Teams, Spreadsheets, Score Sheets, Scoring, Seeding, Brackets, Queue, Admins.
- Missing planned tabs: Audit and Templates (event-template-specific).
- Add disabled/empty-state behavior consistently for all event-scoped tabs after EventContext refactor.

#### Phase 10 (Judge) correction
- Judge page still loads generic `/scoresheet/templates` and is not event-driven.
- Introduce event selection and event-template filtering; then queue integration (`GET /queue/event/:eventId`) and DB participants (`GET /teams/event/:eventId`).

---

---

## Phase 0: Foundation (Event Context)

**Goal:** Event selector and shared event context work end-to-end.

### Step 0.1: Create Event Context
- Add `EventContext` (React context) with:
  - `selectedEvent: Event | null`
  - `events: Event[]`
  - `loading: boolean`
  - `refreshEvents: () => Promise<void>`
  - `setSelectedEvent: (event: Event | null) => void`
- Provide it at the Admin page level (or higher).

### Step 0.2: Wire Event Selector to API
- Replace `SAMPLE_EVENTS` with `GET /events`.
- Load events on Admin mount and when `refreshEvents` is called.
- Store `selectedEvent` in context (and optionally in `localStorage`).
- Update Navbar to use `EventContext` instead of `adminEventData` prop.

### Step 0.3: Align Event Types
- Define `Event` type to match API: `id`, `name`, `description`, `event_date`, `location`, `status`, `seeding_rounds`, etc.
- Map API `status` (`setup`, `active`, `complete`, `archived`) to UI labels (e.g. `active` → `live`).
- Add optional `teams_count` and `brackets_count` via API or client aggregation.

### Step 0.4: Handle “No Event Selected”
- When no event is selected, show a clear prompt in event-scoped tabs.
- Optionally auto-select the first event or the last-used event from `localStorage`.

---

## Phase 1: Events Tab

**Goal:** Full CRUD for events.

### Step 1.1: Events List
- Fetch events with `GET /events` (or from context).
- Show table: name, date, location, status, teams count, brackets count.
- Add status badge styling for `setup`, `active`, `complete`, `archived`.
- Sort by `event_date` descending (or match API order).

### Step 1.2: Create Event
- Add “Create Event” button.
- Modal or inline form: name (required), description, event_date, location, status, seeding_rounds.
- Submit via `POST /events`.
- On success: refresh events, select new event, close form.

### Step 1.3: Edit Event
- “Edit” action per row.
- Modal or inline form with same fields as create.
- Submit via `PATCH /events/:id`.
- On success: refresh events and update context if the edited event is selected.

### Step 1.4: Delete Event
- “Delete” action with confirmation.
- Call `DELETE /events/:id`.
- On success: refresh events; clear selection if deleted event was selected.

### Step 1.5: Event Detail / Quick Stats (Optional)
- Optional summary: teams count, seeding status, brackets count.
- Use `GET /events/:id` plus counts from `/teams/event/:id`, `/brackets/event/:id`, etc.

---

## Phase 2: Teams Tab

**Goal:** Manage teams for the selected event.

### Step 2.1: Teams List
- Fetch with `GET /teams/event/:eventId` when event is selected.
- Table: team_number, team_name, display_name, status.
- Show “Select an event” when no event is selected.

### Step 2.2: Add Single Team
- “Add Team” button.
- Form: team_number, team_name, display_name (optional), status.
- Submit via `POST /teams` with `event_id` from context.
- Handle 409 (duplicate team number).

### Step 2.3: Bulk Import
- “Bulk Import” button.
- Textarea or file upload for CSV: team_number, team_name.
- Parse and call `POST /teams/bulk` with `event_id`.
- Show success/error summary.

### Step 2.4: Edit Team
- “Edit” per row.
- Form for team_number, team_name, display_name, status.
- Submit via `PATCH /teams/:id`.

### Step 2.5: Check-In / Status
- Quick actions for status: registered → checked_in, no_show, withdrawn.
- Use `PATCH /teams/:id/status` (or equivalent) if available.

### Step 2.6: Delete Team
- “Delete” with confirmation.
- Call `DELETE /teams/:id`.

---

## Phase 3: Seeding Tab

**Goal:** Manage seeding rounds and rankings.

### Step 3.1: Seeding Scores View
- Fetch with `GET /seeding/scores/event/:eventId`.
- Table: team_number, team_name, round 1, round 2, round 3, seed_average, seed_rank.
- Show “Select an event” when no event is selected.

### Step 3.2: Rankings View
- Fetch with `GET /seeding/rankings/event/:eventId`.
- Table: team, seed_rank, seed_average, raw_seed_score.
- Link rankings to scores (or show both in one view).

### Step 3.3: Calculate Rankings
- “Calculate Rankings” button.
- Call `POST /seeding/rankings/calculate` with `event_id`.
- Refresh rankings after success.

### Step 3.4: Manual Score Entry (Admin)
- Allow editing scores for a team/round.
- Use `PATCH /seeding/scores/:id` or `POST /seeding/scores` for upsert.
- Recalculate rankings after edits (or provide a “Recalculate” button).

### Step 3.5: Link to Score Submissions
- If scores come from scoresheet submissions, show links to those submissions.
- Use `score_submission_id` on `seeding_scores` if present.

---

## Phase 4: Brackets Tab

**Goal:** Create and manage brackets for the event.

### Step 4.1: Brackets List
- Fetch with `GET /brackets/event/:eventId`.
- Table: name, bracket_size, actual_team_count, status.
- Show “Select an event” when no event is selected.

### Step 4.2: Create Bracket
- “Create Bracket” button.
- Form: name, bracket_size (4, 8, 16, 32, 64), actual_team_count (optional).
- Submit via `POST /brackets` with `event_id`.

### Step 4.3: Bracket Detail View
- On row click or “View”, load `GET /brackets/:id` (entries + games).
- Show entries (teams and seed positions) and games.

### Step 4.4: Generate Entries from Seeding
- “Generate Entries” for a bracket.
- Call `POST /brackets/:id/entries/generate` (or equivalent).
- Ensure seeding rankings exist first.

### Step 4.5: Seed from Rankings
- “Seed from Rankings” to populate bracket from `seeding_rankings`.
- Use `POST /brackets/templates/seed` (or similar) if available.
- Verify API contract in `brackets.ts`.

### Step 4.6: Create Games from Template
- “Create Games” to generate `bracket_games` from `bracket_templates`.
- Use `POST /brackets/:id/games` or a dedicated endpoint.
- Verify exact API in `brackets.ts`.

### Step 4.7: Advance Winner
- For completed games, “Advance Winner” action.
- Call `POST /brackets/:id/advance-winner` with game id and winner.
- Refresh bracket after success.

### Step 4.8: Edit Bracket
- “Edit” for name, bracket_size, actual_team_count, status.
- Use `PATCH /brackets/:id`.

### Step 4.9: Delete Bracket
- “Delete” with confirmation.
- Call `DELETE /brackets/:id`.

---

## Phase 5: Queue Tab

**Goal:** Manage the game queue for judges.

### Step 5.1: Queue List
- Fetch with `GET /queue/event/:eventId`.
- Show items with: queue_position, type (seeding vs bracket), team(s), round/game, status.
- Show “Select an event” when no event is selected.

### Step 5.2: Populate from Bracket
- “Populate from Bracket” button.
- Modal: select bracket, then call `POST /queue/populate-from-bracket`.
- Refresh queue after success.

### Step 5.3: Add Seeding Round
- “Add Seeding Round” for a team + round.
- Call `POST /queue` with `queue_type: 'seeding'`, `seeding_team_id`, `seeding_round`.

### Step 5.4: Add Bracket Game
- “Add Bracket Game” for a game.
- Call `POST /queue` with `queue_type: 'bracket'`, `bracket_game_id`.

### Step 5.5: Reorder
- Drag-and-drop or up/down buttons.
- Call `PATCH /queue/reorder` with new order.

### Step 5.6: Update Status
- Actions: call, in_progress, completed, skipped.
- Use `PATCH /queue/:id` for status (and optionally `table_number`).

### Step 5.7: Remove from Queue
- “Remove” with confirmation.
- Call `DELETE /queue/:id`.

---

## Phase 6: Scoring Tab Migration

**Goal:** Support event-scoped scoring alongside spreadsheets.

### Step 6.1: Add Event Filter
- Add event selector (or use context) in Scoring tab.
- When event is selected, prefer event-scoped loading.

### Step 6.2: Event-Scoped Scores API (if needed)
- Add `GET /scores/by-event/:eventId` (or equivalent) if not present.
- Filter `score_submissions` by `event_id`.

### Step 6.3: Dual Mode UI
- Toggle or tabs: “By Spreadsheet” (legacy) vs “By Event” (new).
- “By Event” loads scores for the selected event.
- Keep existing spreadsheet flow for migration period.

### Step 6.4: Score Type Display
- Indicate `score_type`: seeding vs bracket.
- Show `bracket_game_id` or `seeding_score_id` for context.

### Step 6.5: Accept/Reject Flow
- Ensure accept/reject works for event-scoped scores.
- If accepting a bracket score, trigger bracket advancement (or link to manual advance).

---

## Phase 7: Templates Tab (Event Scoresheet Templates)

**Goal:** Link templates to events for seeding and bracket.

### Step 7.1: Event Templates List
- Fetch `event_scoresheet_templates` for the selected event.
- Table: template name, template_type (seeding/bracket), is_default.

### Step 7.2: Add Template to Event
- “Add Template” button.
- Modal: select template, template_type (seeding/bracket), is_default.
- Call API to create `event_scoresheet_templates` row (add endpoint if missing).

### Step 7.3: Set Default
- Toggle or action to set `is_default` for a template type.
- Update other templates of same type to non-default.

### Step 7.4: Remove Template from Event
- “Remove” with confirmation.
- Delete `event_scoresheet_templates` row.

### Step 7.5: Merge with Score Sheets Tab (Optional)
- Consider merging “Event Templates” into Score Sheets tab as a subsection.
- Or keep a separate “Templates” tab for event-specific links.

---

## Phase 8: Audit Tab

**Goal:** View audit log for the selected event.

### Step 8.1: Audit List
- Fetch with `GET /audit/event/:eventId`.
- Table: timestamp, action, entity_type, entity_id, user, old_value, new_value (summary).
- Show “Select an event” when no event is selected.

### Step 8.2: Filters
- Optional filters: action, entity_type.
- Use query params on `GET /audit/event/:eventId`.

### Step 8.3: Pagination
- Use `limit` and `offset` for pagination.
- “Load more” or page controls.

### Step 8.4: Entity Detail Link
- Link to entity (e.g. team, score, bracket_game) when applicable.

---

## Phase 9: Sidebar and Navigation

**Goal:** Implement the full Option A sidebar.

### Step 9.1: Add New Tabs
- Add sidebar items: Teams, Seeding, Brackets, Queue, Audit.
- Add Templates if separate from Score Sheets.
- Order: Events, Teams, Seeding, Brackets, Queue, Scoring, Score Sheets, Templates (if separate), Spreadsheets, Audit, Admins.

### Step 9.2: Tab Visibility
- All event-scoped tabs require a selected event (except Events).
- Disable or show “Select an event” for Teams, Seeding, Brackets, Queue, Scoring, Audit when no event is selected.

### Step 9.3: Persist Tab Selection
- Keep `localStorage` for last active tab.
- Ensure new tab keys are included in the persistence logic.

---

## Phase 10: Judge Page Integration

**Goal:** Judges use DB-backed participants and queue.

### Step 10.1: Event Selection for Judges
- Add event selector on Judge page (or derive from template/access code).
- Load templates filtered by event (via `event_scoresheet_templates`).

### Step 10.2: Participants from DB
- When template is event-linked, load participants from `GET /teams/event/:eventId`.
- Replace or supplement spreadsheet-based participants.

### Step 10.3: Queue from DB
- Load queue from `GET /queue/event/:eventId`.
- Show queued games for judges to pick from.

### Step 10.4: Score Submission with Event Context
- Include `event_id`, `bracket_game_id`, or `seeding_score_id` when submitting scores.
- Ensure `POST /api/scores/submit` (or equivalent) accepts and stores these.

---

## Phase 11: Polish and Migration

**Goal:** Clean up and prepare for full DB migration.

### Step 11.1: Loading and Error States
- Consistent loading spinners and error messages across tabs.
- Retry and refresh actions where useful.

### Step 11.2: Empty States
- Clear empty states: “No teams yet”, “No brackets”, etc.
- Short guidance on next steps.

### Step 11.3: Spreadsheets Tab
- Mark as “Legacy” or “Google Sheets (legacy)”.
- Add note that DB-backed flow is preferred.

### Step 11.4: Testing
- Manual test of full flow: create event → teams → seeding → brackets → queue → scoring.
- Verify Judge page with DB-backed data.

### Step 11.5: Documentation
- Update docs (e.g. `BOTBALL_SETUP.md`) for the new admin flow.
- Document any new env vars or config.

---

## Dependency Graph (Summary)

```
Phase 0 (Foundation) ─────────────────────────────────────────┐
                                                              │
Phase 1 (Events) ──────► depends on Phase 0                    │
                                                              │
Phase 2 (Teams) ───────► depends on Phase 0, 1                 │
                                                              │
Phase 3 (Seeding) ────► depends on Phase 0, 1, 2               │
                                                              │
Phase 4 (Brackets) ───► depends on Phase 0, 1, 2, 3            │
                                                              │
Phase 5 (Queue) ───────► depends on Phase 0, 1, 4               │
                                                              │
Phase 6 (Scoring) ────► depends on Phase 0, 1                  │
                                                              │
Phase 7 (Templates) ──► depends on Phase 0, 1                  │
                                                              │
Phase 8 (Audit) ──────► depends on Phase 0, 1                  │
                                                              │
Phase 9 (Sidebar) ────► depends on Phases 1–8 (as implemented) │
                                                              │
Phase 10 (Judge) ─────► depends on Phase 2, 5, 7               │
                                                              │
Phase 11 (Polish) ────► depends on all above                  │
```

---

## Suggested Implementation Order

1. **Phase 0** – Foundation  
2. **Phase 1** – Events tab  
3. **Phase 9** – Sidebar (with placeholders for unimplemented tabs)  
4. **Phase 2** – Teams tab  
5. **Phase 3** – Seeding tab  
6. **Phase 4** – Brackets tab  
7. **Phase 5** – Queue tab  
8. **Phase 6** – Scoring migration  
9. **Phase 7** – Templates  
10. **Phase 8** – Audit tab  
11. **Phase 10** – Judge integration  
12. **Phase 11** – Polish  

---

## API Gaps to Verify

Before implementation, confirm:

- `POST /brackets/:id/entries/generate` – behavior and request body  
- `POST /brackets/templates/seed` – exact endpoint and params  
- `POST /queue/populate-from-bracket` – request body and behavior  
- `PATCH /queue/reorder` – format for new order  
- `PATCH /teams/:id/status` – or equivalent for status updates  
- Event-scoped scores: `GET /scores/by-event/:eventId` or equivalent  
- `event_scoresheet_templates` – CRUD endpoints if not present  

### Verification Update (as implemented)

- `POST /brackets/:id/entries/generate`: **Implemented** and in use by Brackets UI (`force=true` supported for replace).
- `POST /brackets/templates/seed`: **Not implemented as a separate endpoint**. Functional equivalent is handled via `/:id/entries/generate`.
- `POST /queue/populate-from-bracket`: **Implemented** and in use.
- `PATCH /queue/reorder`: **Implemented** (also `POST /queue/reorder` alias). Payload format is `{ items: [{ id, queue_position }] }`.
- `PATCH /teams/:id/status`: **Not implemented as dedicated route**. Existing `PATCH /teams/:id` supports `status`; check-in shortcut routes also exist.
- Event-scoped scores endpoint: **Implemented** at `GET /scores/by-event/:eventId` (admin-protected, paginated, filterable).
- `event_scoresheet_templates` CRUD: **Still missing** (table exists in schema, routes/UI not yet added).

I can expand any phase into more granular tasks or adjust the plan for your codebase structure.
