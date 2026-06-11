import type { SchemaModule } from './types';

export const bracketsSchema: SchemaModule = {
  name: 'brackets',
  updatedAtTables: ['brackets', 'bracket_games'],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS brackets (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          bracket_size INTEGER NOT NULL,
          actual_team_count INTEGER,
          status TEXT DEFAULT 'setup'
            CHECK (status IN ('setup', 'in_progress', 'completed')),
          weight REAL NOT NULL DEFAULT 1.0
            CHECK (weight > 0 AND weight <= 1),
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS bracket_entries (
          id SERIAL PRIMARY KEY,
          bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
          team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
          seed_position INTEGER NOT NULL,
          initial_slot INTEGER,
          is_bye BOOLEAN DEFAULT FALSE,
          final_rank INTEGER,
          bracket_raw_score REAL,
          weighted_bracket_raw_score REAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(bracket_id, team_id),
          UNIQUE(bracket_id, seed_position),
          CHECK (
            (is_bye = TRUE AND team_id IS NULL) OR
            (is_bye = FALSE AND team_id IS NOT NULL)
          )
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS bracket_games (
          id SERIAL PRIMARY KEY,
          bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
          game_number INTEGER NOT NULL,
          round_name TEXT,
          round_number INTEGER,
          bracket_side TEXT
            CHECK (bracket_side IN ('winners', 'losers', 'finals')),
          team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          team1_source TEXT,
          team2_source TEXT,
          status TEXT DEFAULT 'pending'
            CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
          winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          loser_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          winner_advances_to_id INTEGER REFERENCES bracket_games(id),
          loser_advances_to_id INTEGER REFERENCES bracket_games(id),
          winner_slot TEXT,
          loser_slot TEXT,
          team1_score INTEGER,
          team2_score INTEGER,
          score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
          scheduled_time TIMESTAMP,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(bracket_id, game_number)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS bracket_templates (
          id SERIAL PRIMARY KEY,
          bracket_size INTEGER NOT NULL,
          game_number INTEGER NOT NULL,
          round_name TEXT NOT NULL,
          round_number INTEGER NOT NULL,
          bracket_side TEXT NOT NULL,
          team1_source TEXT NOT NULL,
          team2_source TEXT NOT NULL,
          winner_advances_to INTEGER,
          loser_advances_to INTEGER,
          winner_slot TEXT CHECK (winner_slot IN ('team1', 'team2')),
          loser_slot TEXT,
          is_championship BOOLEAN DEFAULT FALSE,
          is_grand_final BOOLEAN DEFAULT FALSE,
          is_reset_game BOOLEAN DEFAULT FALSE,
          UNIQUE(bracket_size, game_number)
        )
      `,
    ],
    triggers: [
      `
        CREATE OR REPLACE FUNCTION bracket_games_clear_times_on_rollback()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.status IN ('pending', 'ready') AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL) THEN
            NEW.started_at = NULL;
            NEW.completed_at = NULL;
          ELSIF NEW.status = 'in_progress' AND NEW.completed_at IS NOT NULL THEN
            NEW.completed_at = NULL;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `,
      `
        DROP TRIGGER IF EXISTS bracket_games_clear_times_on_status_rollback ON bracket_games;
        CREATE TRIGGER bracket_games_clear_times_on_status_rollback
          BEFORE UPDATE ON bracket_games
          FOR EACH ROW
          EXECUTE FUNCTION bracket_games_clear_times_on_rollback()
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_brackets_event ON brackets(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_bracket ON bracket_games(bracket_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_status ON bracket_games(bracket_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1 ON bracket_games(team1_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2 ON bracket_games(team2_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1_source ON bracket_games(bracket_id, team1_source)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2_source ON bracket_games(bracket_id, team2_source)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_templates_size ON bracket_templates(bracket_size)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS brackets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          bracket_size INTEGER NOT NULL,
          actual_team_count INTEGER,
          status TEXT DEFAULT 'setup'
            CHECK (status IN ('setup', 'in_progress', 'completed')),
          weight REAL NOT NULL DEFAULT 1.0
            CHECK (weight > 0 AND weight <= 1),
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS bracket_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
          team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
          seed_position INTEGER NOT NULL,
          initial_slot INTEGER,
          is_bye BOOLEAN DEFAULT FALSE,
          final_rank INTEGER,
          bracket_raw_score REAL,
          weighted_bracket_raw_score REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(bracket_id, team_id),
          UNIQUE(bracket_id, seed_position),
          CHECK (
            (is_bye = 1 AND team_id IS NULL) OR
            (is_bye = 0 AND team_id IS NOT NULL)
          )
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS bracket_games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
          game_number INTEGER NOT NULL,
          round_name TEXT,
          round_number INTEGER,
          bracket_side TEXT
            CHECK (bracket_side IN ('winners', 'losers', 'finals')),
          team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          team1_source TEXT,
          team2_source TEXT,
          status TEXT DEFAULT 'pending'
            CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
          winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          loser_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          winner_advances_to_id INTEGER REFERENCES bracket_games(id),
          loser_advances_to_id INTEGER REFERENCES bracket_games(id),
          winner_slot TEXT,
          loser_slot TEXT,
          team1_score INTEGER,
          team2_score INTEGER,
          score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
          scheduled_time DATETIME,
          started_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(bracket_id, game_number)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS bracket_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bracket_size INTEGER NOT NULL,
          game_number INTEGER NOT NULL,
          round_name TEXT NOT NULL,
          round_number INTEGER NOT NULL,
          bracket_side TEXT NOT NULL,
          team1_source TEXT NOT NULL,
          team2_source TEXT NOT NULL,
          winner_advances_to INTEGER,
          loser_advances_to INTEGER,
          winner_slot TEXT CHECK (winner_slot IN ('team1', 'team2')),
          loser_slot TEXT,
          is_championship BOOLEAN DEFAULT FALSE,
          is_grand_final BOOLEAN DEFAULT FALSE,
          is_reset_game BOOLEAN DEFAULT FALSE,
          UNIQUE(bracket_size, game_number)
        )
      `,
    ],
    triggers: [
      `
        CREATE TRIGGER IF NOT EXISTS bracket_games_clear_times_on_status_rollback
        AFTER UPDATE OF status ON bracket_games
        FOR EACH ROW
        WHEN NEW.status IN ('pending', 'ready') AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL)
        BEGIN
          UPDATE bracket_games
          SET started_at = NULL, completed_at = NULL
          WHERE id = NEW.id;
        END
      `,
      `
        CREATE TRIGGER IF NOT EXISTS bracket_games_clear_completed_at_on_in_progress
        AFTER UPDATE OF status ON bracket_games
        FOR EACH ROW
        WHEN NEW.status = 'in_progress' AND NEW.completed_at IS NOT NULL
        BEGIN
          UPDATE bracket_games
          SET completed_at = NULL
          WHERE id = NEW.id;
        END
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_brackets_event ON brackets(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_bracket ON bracket_games(bracket_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_status ON bracket_games(bracket_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1 ON bracket_games(team1_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2 ON bracket_games(team2_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1_source ON bracket_games(bracket_id, team1_source)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2_source ON bracket_games(bracket_id, team2_source)`,
      `CREATE INDEX IF NOT EXISTS idx_bracket_templates_size ON bracket_templates(bracket_size)`,
    ],
  },
};
