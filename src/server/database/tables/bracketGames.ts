import type { TableDefinition } from './types';
import { BRACKET_SIDE_SQL, GAME_STATUS_SQL } from '../sqlEnums';

export const bracketGamesTable: TableDefinition = {
  name: 'bracket_games',
  pg: `
    CREATE TABLE IF NOT EXISTS bracket_games (
      id SERIAL PRIMARY KEY,
      bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      game_number INTEGER NOT NULL,
      round_name TEXT,
      round_number INTEGER,
      bracket_side TEXT
        CHECK (bracket_side IN ${BRACKET_SIDE_SQL}),
      team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team1_source TEXT,
      team2_source TEXT,
      status TEXT DEFAULT 'pending'
        CHECK (status IN ${GAME_STATUS_SQL}),
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
  sqlite: `
    CREATE TABLE IF NOT EXISTS bracket_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      game_number INTEGER NOT NULL,
      round_name TEXT,
      round_number INTEGER,
      bracket_side TEXT
        CHECK (bracket_side IN ${BRACKET_SIDE_SQL}),
      team1_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team2_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team1_source TEXT,
      team2_source TEXT,
      status TEXT DEFAULT 'pending'
        CHECK (status IN ${GAME_STATUS_SQL}),
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
};
