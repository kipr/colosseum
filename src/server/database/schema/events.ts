import type { SchemaModule } from './types';

export const eventsSchema: SchemaModule = {
  name: 'events',
  updatedAtTables: ['events', 'teams'],
  postgres: {
    tables: [
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
          score_accept_mode TEXT NOT NULL DEFAULT 'manual' CHECK (score_accept_mode IN ('manual', 'auto_accept_seeding', 'auto_accept_all')),
          spectator_results_released INTEGER NOT NULL DEFAULT 0,
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
      `CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          event_date DATE,
          location TEXT,
          status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'complete', 'archived')),
          seeding_rounds INTEGER DEFAULT 3,
          double_seeding_rounds INTEGER DEFAULT 0,
          score_accept_mode TEXT NOT NULL DEFAULT 'manual' CHECK (score_accept_mode IN ('manual', 'auto_accept_seeding', 'auto_accept_all')),
          spectator_results_released INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS teams (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          team_number INTEGER NOT NULL CHECK (team_number > 0),
          team_name TEXT NOT NULL,
          display_name TEXT,
          status TEXT DEFAULT 'registered'
            CHECK (status IN ('registered', 'checked_in', 'no_show', 'withdrawn')),
          checked_in_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, team_number)
        )
      `,
    ],
    triggers: [
      `
        CREATE TRIGGER IF NOT EXISTS teams_clear_checked_in_at_on_status
        AFTER UPDATE OF status ON teams
        FOR EACH ROW
        WHEN NEW.status IN ('registered', 'no_show') AND NEW.checked_in_at IS NOT NULL
        BEGIN
          UPDATE teams
          SET checked_in_at = NULL
          WHERE id = NEW.id;
        END
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status)`,
    ],
  },
};
