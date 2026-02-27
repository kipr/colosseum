I want to transition from google sheets to a full DB backend. The first step is a SQLite schema to replace the sheets functionality. Here is the important functionality the google sheets fulfilled:

**List participating teams. Columns**:
- Team name: string
- Team number: int > 0
- NameNum combo: "%s %d", teamName, teamnumber (Note: this one may not be strictly required for the new schema)

**Store seed scores. Columns**:
- Team name: string, matches participating team name
- Team number: int, matches participating team number
- Seed 1: int
- Seed 2: int
- Seed 3: int
- Seed average: Average of two highest of seed 1, 2, 3
- Seed rank: Rank among participating teams
- Raw seed score: Normalized seed score computed from seed_rank and seed_average as compared to other participants.

Each team runs three seeding rounds, then we move on to a double elimiation tournament.
The head judge would manually sort the teams into brackets. Depending on the number of participants, there are generally 1-4 brackets.
We prefer to run brackets where teams of similar scores can compete, that way the worse ones don't become demoralized getting crushed by the best.
Once the brackets are seperated, the sheet would automatically use the seeding scores to seed the teams into a double elimination bracket of the correct size (typically the smallest power of 2 that accomodates all teams), placing byes where necessary.
I'm not sure if there is a good way to handle the automatic bracket creating in the database or if it should be application-level.
Also, sometimes we would create brackets of irregular sizes (e.g. 22) to avoid less experienced head judges getting confused by a large number of byes.
Then, the Colosseum admin would configure the sheet containing the bracket, which automatically place all of the games into a list/queue accessable from the judges scoresheets.
From there, the score goes through the usual process: judges score, submit, then the admin reviews and approves, and the bracket is advanced depending on the winner.

These might be later, application-level details, but there are occaisonally teams that no-show or walk-in at the start of the day (but never in the middle), so the DB must be able to handle that.
Make sure to account for the full flow that a score follows in the application, including custom scoresheet field templates and all of the admin controls.

Proposal:

```sql
-- ============================================================================
-- TOURNAMENT/EVENT MANAGEMENT
-- ============================================================================

-- Events/Tournaments - Top-level container for competition days
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                          -- "2026 Botball Fall Regional - Austin"
    description TEXT,
    event_date DATE,                             -- Competition date
    location TEXT,
    status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'complete', 'archived')),
    seeding_rounds INTEGER DEFAULT 3,            -- Number of seeding rounds (typically 3)
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- TEAMS
-- ============================================================================

-- Teams - Master list of participating teams per event
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_number INTEGER NOT NULL CHECK (team_number > 0),                -- e.g., 859
    team_name TEXT NOT NULL,                     -- e.g., "ACES Robotics"
    display_name TEXT,                           -- Computed or custom: "859 ACES Robotics" (optional shorthand)
    status TEXT DEFAULT 'registered'
        CHECK (status IN ('registered', 'checked_in', 'no_show', 'withdrawn')),
    checked_in_at DATETIME,                      -- When the team checked in (cleared if status -> registered/no_show)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, team_number)
);

CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id);
CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status);

-- ============================================================================
-- SEEDING
-- ============================================================================

-- Seeding Scores - Individual round scores for each team
CREATE TABLE IF NOT EXISTS seeding_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL CHECK (round_number > 0),               -- 1, 2, or 3
    score INTEGER,                               -- NULL if not yet scored
    score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
    scored_at DATETIME,                          -- Cleared if score -> NULL
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_seeding_scores_team ON seeding_scores(team_id);

-- Seeding Rankings - Computed/cached seeding results per team
-- Recalculated when scores change
CREATE TABLE IF NOT EXISTS seeding_rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    seed_average REAL,                           -- Average of top 2 of 3 scores
    seed_rank INTEGER CHECK (seed_rank > 0),     -- Rank among all teams in event (1 = best)
    raw_seed_score REAL,                         -- Normalized score (0-1) for bracket seeding
    tiebreaker_value REAL,                       -- For breaking ties (e.g., 3rd score, sum of all)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id)
);

CREATE INDEX IF NOT EXISTS idx_seeding_rankings_rank ON seeding_rankings(seed_rank);

-- ============================================================================
-- BRACKETS
-- ============================================================================

-- Brackets - Container for a double-elimination bracket
CREATE TABLE IF NOT EXISTS brackets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                          -- "Bracket A", "Upper Division", "Main Bracket"
    bracket_size INTEGER NOT NULL,               -- 4, 8, 16, 32, or 64 (smallest power of 2 >= teams)
    actual_team_count INTEGER,                   -- Actual number of teams assigned (may be < bracket_size)
    status TEXT DEFAULT 'setup'
        CHECK (status IN ('setup', 'in_progress', 'completed')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_brackets_event ON brackets(event_id);

-- Bracket Entries - Teams assigned to a bracket with their seeding position
-- NOTE: In the schema, team_id can point to a team in a different event than the bracket.
-- Make sure this cannot happen at application-level.
CREATE TABLE IF NOT EXISTS bracket_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    seed_position INTEGER NOT NULL,              -- 1-N position based on seeding (1 = top seed)
    initial_slot INTEGER,                        -- Starting slot in bracket (after bye handling)
    is_bye BOOLEAN DEFAULT FALSE,                -- If this slot is a bye (no team)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bracket_id, team_id),
    UNIQUE(bracket_id, seed_position),
    CHECK (
        (is_bye = 1 AND team_id IS NULL) OR
        (is_bye = 0 AND team_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id);

-- Games/Matches - Individual games within a bracket
-- NOTE team1_id/team2_id/winner_id/loser_id can point across events.
-- Make sure this cannot happen at application-level.
CREATE TABLE IF NOT EXISTS bracket_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
    game_number INTEGER NOT NULL,                -- Game 1, 2, 3... (sequential within bracket)
    round_name TEXT,                             -- "Winners R1", "Redemption R2", "Finals", "Grand Final"
    round_number INTEGER,                        -- Round within bracket flow
    bracket_side TEXT
        CHECK (bracket_side IN ('winners', 'losers', 'finals')),
    
    -- Team slots (NULL if TBD or bye)
    team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    team1_source TEXT,                           -- "seed:1", "winner:5", "loser:3" - where team came from
    team2_source TEXT,
    
    -- Game state
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
    winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    loser_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    
    -- Advancement routing
    winner_advances_to_id INTEGER REFERENCES bracket_games(id),                  -- game_number winner goes to
    loser_advances_to_id INTEGER REFERENCES bracket_games(id),                   -- game_number loser goes to (for DE)
    winner_slot TEXT,                            -- 'team1' or 'team2' in next game
    loser_slot TEXT,
    
    -- Scoring
    team1_score INTEGER,
    team2_score INTEGER,
    score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
    
    -- Timing
    scheduled_time DATETIME,                     -- Optional scheduled start
    started_at DATETIME,                         -- Cleared if status -> pending/ready
    completed_at DATETIME,                       -- Cleared if status -> pending/ready/in_progress
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bracket_id, game_number)
);

CREATE INDEX IF NOT EXISTS idx_bracket_games_bracket ON bracket_games(bracket_id);
CREATE INDEX IF NOT EXISTS idx_bracket_games_status ON bracket_games(bracket_id, status);
CREATE INDEX IF NOT EXISTS idx_bracket_games_teams ON bracket_games(team1_id);
CREATE INDEX IF NOT EXISTS idx_bracket_games_teams ON bracket_games(team2_id);

-- ============================================================================
-- SCORE SUBMISSIONS (Enhanced from existing)
-- ============================================================================

-- Update the existing score_submissions table to work with the new schema
-- This maintains backward compatibility while adding event/bracket context

-- New columns to add to existing score_submissions:
--   event_id INTEGER REFERENCES events(id)
--   bracket_game_id INTEGER REFERENCES bracket_games(id)
--   seeding_score_id INTEGER REFERENCES seeding_scores(id)
--   score_type TEXT -- 'seeding', 'bracket', 'other'

-- Score Submission Details - Detailed field-by-field scores
-- (The score_data JSON blob is kept for flexibility, but this provides queryable structure)
-- score_details is canonical: JSON is entirely derived at application-level
CREATE TABLE IF NOT EXISTS score_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
    field_id TEXT NOT NULL,                      -- Matches scoresheet template field ID
    field_value TEXT,                            -- Raw value entered
    calculated_value INTEGER,                    -- Computed point value
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_score_details_submission ON score_details(score_submission_id);

-- ============================================================================
-- SCORESHEET TEMPLATES (Enhanced)
-- ============================================================================

-- Link templates to events for event-specific scoring rules
-- Same template can serve both seeding and bracket within one event
CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
    template_type TEXT NOT NULL
        CHECK (template_type IN ('seeding', 'bracket')),
    is_default BOOLEAN DEFAULT FALSE,            -- Default template for this type
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, template_id, template_type)
);

-- ============================================================================
-- GAME QUEUE / SCHEDULING
-- ============================================================================

-- Game Queue - Ordered list of games ready for judging
-- Ensure we never queue the same game twice at application level
CREATE TABLE IF NOT EXISTS game_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
    seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,  -- For seeding rounds
    seeding_round INTEGER,                       -- Round number for seeding
    queue_type TEXT NOT NULL CHECK (queue_type IN ('seeding', 'bracket')),
    queue_position INTEGER NOT NULL,             -- Order in queue
    status TEXT DEFAULT 'queued'
        CHECK (status IN ('queued', 'called', 'in_progress', 'completed', 'skipped')),
    called_at DATETIME,                          -- When announced/called (cleared if status -> queued)
    table_number INTEGER,                        -- Which scoring table
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
        OR
        (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id);
CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position);
CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status);

-- ============================================================================
-- BRACKET TEMPLATES (For generating bracket structures)
-- ============================================================================

-- Pre-defined bracket game templates for standard DE bracket sizes
-- This replaces the hardcoded lookup tables in bracketParser.ts
CREATE TABLE IF NOT EXISTS bracket_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_size INTEGER NOT NULL,               -- 4, 8, 16, 32, 64
    game_number INTEGER NOT NULL,                -- Game number within bracket
    round_name TEXT NOT NULL,                    -- "Winners R1", "Redemption R2", etc.
    round_number INTEGER NOT NULL,
    bracket_side TEXT NOT NULL,                  -- 'winners', 'losers', 'finals'
    team1_source TEXT NOT NULL,                  -- "seed:1", "winner:5", "loser:3"
    team2_source TEXT NOT NULL,
    winner_advances_to INTEGER,                  -- Next game number for winner
    loser_advances_to INTEGER,                   -- Next game number for loser (DE only)
    winner_slot TEXT CHECK (winner_slot IN ('team1', 'team2')),
    loser_slot TEXT,
    is_championship BOOLEAN DEFAULT FALSE,
    is_grand_final BOOLEAN DEFAULT FALSE,
    is_reset_game BOOLEAN DEFAULT FALSE,         -- For "if necessary" games
    UNIQUE(bracket_size, game_number)
);

CREATE INDEX IF NOT EXISTS idx_bracket_templates_size ON bracket_templates(bracket_size);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

-- Track important changes for accountability
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,                        -- 'score_submitted', 'score_accepted', 'team_added', etc.
    entity_type TEXT NOT NULL,                   -- 'team', 'score', 'bracket_game', etc.
    entity_id INTEGER,
    old_value TEXT,                              -- JSON of previous state
    new_value TEXT,                              -- JSON of new state
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Generic trigger to update timestamp
CREATE TRIGGER ${table_name}_updated_at
AFTER UPDATE ON ${table_name}
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE ${table_name}
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

-- Timestamp Cleanup Triggers (enforced by SQLite)
-- 1. teams: Clear checked_in_at when status -> registered/no_show
-- 2. game_queue: Clear called_at when status -> queued
-- 3. seeding_scores: Clear scored_at when score -> NULL
-- 4. bracket_games: Clear started_at/completed_at on status rollback

```

New requirement: calculate overall score.
The overall score is a value [0..3] for regionals and [0..4] for GCER.

```sql
-- ============================================================================
-- DOCUMENTATION SCORES
-- ============================================================================

-- Documentation score categories - 1-4 categories per event (names, weights, max scores)
-- All teams in the event share the same category definitions
CREATE TABLE IF NOT EXISTS documentation_score_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
    name TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    max_score REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_doc_score_categories_event ON documentation_score_categories(event_id);

-- Documentation scores - one row per team per event (overall score + metadata)
-- Admin enters scores directly (no scoresheet/access-code flow)
CREATE TABLE IF NOT EXISTS documentation_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    overall_score REAL,
    scored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scored_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_scores_event ON documentation_scores(event_id);
CREATE INDEX IF NOT EXISTS idx_doc_scores_team ON documentation_scores(team_id);

-- Documentation sub-scores - individual category scores per team
CREATE TABLE IF NOT EXISTS documentation_sub_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documentation_score_id INTEGER NOT NULL
        REFERENCES documentation_scores(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL
        REFERENCES documentation_score_categories(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(documentation_score_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_sub_scores_doc ON documentation_sub_scores(documentation_score_id);
```