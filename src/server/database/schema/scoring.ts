import type { SchemaModule } from './types';

export const scoringSchema: SchemaModule = {
  name: 'scoring',
  updatedAtTables: ['score_submissions'],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS score_submissions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
          participant_name TEXT,
          match_id TEXT,
          score_data TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at TIMESTAMP,
          event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
          bracket_game_id INTEGER,
          seeding_score_id INTEGER REFERENCES seeding_scores(id) ON DELETE SET NULL,
          score_type TEXT,
          game_queue_id INTEGER,
          double_seeding_match_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS score_details (
          id SERIAL PRIMARY KEY,
          score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
          field_id TEXT NOT NULL,
          field_value TEXT,
          calculated_value INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
          template_type TEXT NOT NULL
            CHECK (template_type IN ('seeding', 'bracket', 'double_seeding')),
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, template_id, template_type)
        )
      `,
    ],
    constraints: [
      `
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'score_submissions_bracket_game_id_fkey'
              AND table_name = 'score_submissions'
          ) THEN
            ALTER TABLE score_submissions
              ADD CONSTRAINT score_submissions_bracket_game_id_fkey
              FOREIGN KEY (bracket_game_id) REFERENCES bracket_games(id) ON DELETE SET NULL;
          END IF;
        END $$
      `,
      `
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'score_submissions_game_queue_id_fkey'
              AND table_name = 'score_submissions'
          ) THEN
            ALTER TABLE score_submissions
              ADD CONSTRAINT score_submissions_game_queue_id_fkey
              FOREIGN KEY (game_queue_id) REFERENCES game_queue(id) ON DELETE SET NULL;
          END IF;
        END $$
      `,
      `
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'score_submissions_double_seeding_match_id_fkey'
              AND table_name = 'score_submissions'
          ) THEN
            ALTER TABLE score_submissions
              ADD CONSTRAINT score_submissions_double_seeding_match_id_fkey
              FOREIGN KEY (double_seeding_match_id) REFERENCES double_seeding_matches(id) ON DELETE SET NULL;
          END IF;
        END $$
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_status ON score_submissions(event_id, status, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_type ON score_submissions(event_id, score_type, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_game_queue ON score_submissions(game_queue_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_bracket_game ON score_submissions(bracket_game_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_seeding_score ON score_submissions(seeding_score_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_double_seeding_match ON score_submissions(double_seeding_match_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_details_submission ON score_details(score_submission_id)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS score_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          template_id INTEGER NOT NULL,
          participant_name TEXT,
          match_id TEXT,
          score_data TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          reviewed_by INTEGER,
          reviewed_at DATETIME,
          event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
          bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE SET NULL,
          seeding_score_id INTEGER REFERENCES seeding_scores(id) ON DELETE SET NULL,
          score_type TEXT,
          game_queue_id INTEGER REFERENCES game_queue(id) ON DELETE SET NULL,
          double_seeding_match_id INTEGER REFERENCES double_seeding_matches(id) ON DELETE SET NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS score_details (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          score_submission_id INTEGER NOT NULL REFERENCES score_submissions(id) ON DELETE CASCADE,
          field_id TEXT NOT NULL,
          field_value TEXT,
          calculated_value INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
          template_type TEXT NOT NULL
            CHECK (template_type IN ('seeding', 'bracket', 'double_seeding')),
          is_default BOOLEAN DEFAULT FALSE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, template_id, template_type)
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_status ON score_submissions(event_id, status, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_type ON score_submissions(event_id, score_type, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_game_queue ON score_submissions(game_queue_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_bracket_game ON score_submissions(bracket_game_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_seeding_score ON score_submissions(seeding_score_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_submissions_double_seeding_match ON score_submissions(double_seeding_match_id)`,
      `CREATE INDEX IF NOT EXISTS idx_score_details_submission ON score_details(score_submission_id)`,
    ],
  },
};
