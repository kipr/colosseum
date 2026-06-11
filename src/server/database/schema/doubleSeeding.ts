import type { SchemaModule } from './types';

export const doubleSeedingSchema: SchemaModule = {
  name: 'double-seeding',
  updatedAtTables: [
    'double_seeding_matches',
    'double_seeding_scores',
    'double_seeding_rankings',
  ],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS double_seeding_matches (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          round_number INTEGER NOT NULL CHECK (round_number > 0),
          match_number INTEGER,
          team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'ready'
            CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
          score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
          scheduled_time TIMESTAMP,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, round_number, team1_id, team2_id)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS double_seeding_scores (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          match_id INTEGER NOT NULL REFERENCES double_seeding_matches(id) ON DELETE CASCADE,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          round_number INTEGER NOT NULL CHECK (round_number > 0),
          side TEXT NOT NULL CHECK (side IN ('team1', 'team2')),
          score INTEGER,
          score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
          scored_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(match_id, side),
          UNIQUE(event_id, team_id, round_number)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS double_seeding_rankings (
          id SERIAL PRIMARY KEY,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          seed_average REAL,
          seed_rank INTEGER CHECK (seed_rank > 0),
          raw_double_seed_score REAL,
          tiebreaker_value REAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team_id)
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_matches_event_round ON double_seeding_matches(event_id, round_number)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_matches_team1 ON double_seeding_matches(team1_id)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_matches_team2 ON double_seeding_matches(team2_id)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_scores_event_team_round ON double_seeding_scores(event_id, team_id, round_number)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_scores_match ON double_seeding_scores(match_id)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_rankings_rank ON double_seeding_rankings(seed_rank)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS double_seeding_matches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          round_number INTEGER NOT NULL CHECK (round_number > 0),
          match_number INTEGER,
          team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'ready'
            CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'bye')),
          score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
          scheduled_time DATETIME,
          started_at DATETIME,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, round_number, team1_id, team2_id)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS double_seeding_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          match_id INTEGER NOT NULL REFERENCES double_seeding_matches(id) ON DELETE CASCADE,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          round_number INTEGER NOT NULL CHECK (round_number > 0),
          side TEXT NOT NULL CHECK (side IN ('team1', 'team2')),
          score INTEGER,
          score_submission_id INTEGER REFERENCES score_submissions(id) ON DELETE SET NULL,
          scored_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(match_id, side),
          UNIQUE(event_id, team_id, round_number)
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS double_seeding_rankings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          seed_average REAL,
          seed_rank INTEGER CHECK (seed_rank > 0),
          raw_double_seed_score REAL,
          tiebreaker_value REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(team_id)
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_matches_event_round ON double_seeding_matches(event_id, round_number)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_matches_team1 ON double_seeding_matches(team1_id)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_matches_team2 ON double_seeding_matches(team2_id)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_scores_event_team_round ON double_seeding_scores(event_id, team_id, round_number)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_scores_match ON double_seeding_scores(match_id)`,
      `CREATE INDEX IF NOT EXISTS idx_double_seeding_rankings_rank ON double_seeding_rankings(seed_rank)`,
    ],
  },
};
