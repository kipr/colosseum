import type { TableDefinition } from './types';

export const bracketTemplatesTable: TableDefinition = {
  name: 'bracket_templates',
  pg: `
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
  sqlite: `
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
};
