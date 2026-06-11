import type { SchemaModule } from './types';

export const seedingSchema: SchemaModule = {
  name: 'seeding',
  updatedAtTables: ['seeding_scores', 'seeding_rankings'],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS seeding_scores (
          id SERIAL PRIMARY KEY,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          round_number INTEGER NOT NULL CHECK (round_number > 0),
          score INTEGER,
          score_submission_id INTEGER,
          scored_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team_id, round_number)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS seeding_rankings (
          id SERIAL PRIMARY KEY,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          seed_average REAL,
          seed_rank INTEGER CHECK (seed_rank > 0),
          raw_seed_score REAL,
          tiebreaker_value REAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team_id)
        )
      `,
    ],
    triggers: [
      `
        CREATE OR REPLACE FUNCTION seeding_scores_clear_scored_at()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.score IS NULL AND (NEW.scored_at IS NOT NULL OR NEW.score_submission_id IS NOT NULL) THEN
            NEW.scored_at = NULL;
            NEW.score_submission_id = NULL;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `,
      `
        DROP TRIGGER IF EXISTS seeding_scores_clear_scored_at_when_score_null ON seeding_scores;
        CREATE TRIGGER seeding_scores_clear_scored_at_when_score_null
          BEFORE UPDATE ON seeding_scores
          FOR EACH ROW
          EXECUTE FUNCTION seeding_scores_clear_scored_at()
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_seeding_scores_team ON seeding_scores(team_id)`,
      `CREATE INDEX IF NOT EXISTS idx_seeding_rankings_rank ON seeding_rankings(seed_rank)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS seeding_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          round_number INTEGER NOT NULL CHECK (round_number > 0),
          score INTEGER,
          score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
          scored_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team_id, round_number)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS seeding_rankings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          seed_average REAL,
          seed_rank INTEGER CHECK (seed_rank > 0),
          raw_seed_score REAL,
          tiebreaker_value REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team_id)
        )
      `,
    ],
    triggers: [
      `
        CREATE TRIGGER IF NOT EXISTS seeding_scores_clear_scored_at_when_score_null
        AFTER UPDATE OF score ON seeding_scores
        FOR EACH ROW
        WHEN NEW.score IS NULL AND (NEW.scored_at IS NOT NULL OR NEW.score_submission_id IS NOT NULL)
        BEGIN
          UPDATE seeding_scores
          SET scored_at = NULL, score_submission_id = NULL
          WHERE id = NEW.id;
        END
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_seeding_scores_team ON seeding_scores(team_id)`,
      `CREATE INDEX IF NOT EXISTS idx_seeding_rankings_rank ON seeding_rankings(seed_rank)`,
    ],
  },
};
