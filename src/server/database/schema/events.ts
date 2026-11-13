import type { SchemaModule } from './types';

export const eventsSchema: SchemaModule = {
  name: 'events',
  updatedAtTables: ['events', 'teams'],
  tables: [
    `
      CREATE TABLE IF NOT EXISTS seasons (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL CHECK (
          char_length(name) BETWEEN 1 AND 100
          AND name !~ '^[[:space:]]|[[:space:]]$'
        ),
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        event_date DATE,
        location TEXT,
        status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'complete', 'archived')),
        seeding_rounds INTEGER DEFAULT 3,
        double_seeding_rounds INTEGER DEFAULT 0,
        min_rest_minutes INTEGER NOT NULL DEFAULT 3 CHECK (min_rest_minutes >= 0),
        score_accept_mode TEXT NOT NULL DEFAULT 'manual' CHECK (score_accept_mode IN ('manual', 'auto_accept_seeding', 'auto_accept_all')),
        spectator_results_released INTEGER NOT NULL DEFAULT 0,
        spectator_listing TEXT NOT NULL DEFAULT 'current',
        season_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        team_number INTEGER NOT NULL CHECK (team_number > 0),
        team_name TEXT NOT NULL,
        display_name TEXT,
        status TEXT DEFAULT 'registered'
          CHECK (status IN ('registered', 'checked_in', 'no_show', 'withdrawn')),
        checked_in_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, team_number)
      )
    `,
  ],
  columns: [
    {
      table: 'events',
      column: 'spectator_listing',
      definition: "TEXT NOT NULL DEFAULT 'current'",
    },
    {
      table: 'events',
      column: 'season_id',
      definition: 'INTEGER',
    },
    {
      table: 'events',
      column: 'min_rest_minutes',
      definition: 'INTEGER NOT NULL DEFAULT 3 CHECK (min_rest_minutes >= 0)',
    },
  ],
  constraints: [
    `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'events_spectator_listing_check'
            AND table_name = 'events'
            AND table_schema = current_schema()
        ) THEN
          ALTER TABLE events ADD CONSTRAINT events_spectator_listing_check
            CHECK (spectator_listing IN ('current', 'archive'));
        END IF;
      END $$
    `,
    `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'events_season_id_fkey'
            AND table_name = 'events'
            AND table_schema = current_schema()
        ) THEN
          ALTER TABLE events ADD CONSTRAINT events_season_id_fkey
            FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT;
        END IF;
      END $$
    `,
    `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'events_archive_season_check'
            AND table_name = 'events'
            AND table_schema = current_schema()
        ) THEN
          ALTER TABLE events ADD CONSTRAINT events_archive_season_check
            CHECK (spectator_listing <> 'archive' OR season_id IS NOT NULL);
        END IF;
      END $$
    `,
  ],
  triggers: [
    `
      CREATE OR REPLACE FUNCTION teams_clear_checked_in_at()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.status IN ('registered', 'no_show') AND NEW.checked_in_at IS NOT NULL THEN
          NEW.checked_in_at = NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `,
    `
      DROP TRIGGER IF EXISTS teams_clear_checked_in_at_on_status ON teams;
      CREATE TRIGGER teams_clear_checked_in_at_on_status
        BEFORE UPDATE ON teams
        FOR EACH ROW
        EXECUTE FUNCTION teams_clear_checked_in_at()
    `,
  ],
  indexes: [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_name_unique ON seasons (lower(name))`,
    `CREATE INDEX IF NOT EXISTS idx_events_season ON events(season_id)`,
    `CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status)`,
  ],
};
