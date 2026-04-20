import type { TableDefinition } from './types';
import { BRACKET_STATUS_SQL } from '../sqlEnums';

export const bracketsTable: TableDefinition = {
  name: 'brackets',
  pg: `
    CREATE TABLE IF NOT EXISTS brackets (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      bracket_size INTEGER NOT NULL,
      actual_team_count INTEGER,
      status TEXT DEFAULT 'setup'
        CHECK (status IN ${BRACKET_STATUS_SQL}),
      weight REAL NOT NULL DEFAULT 1.0
        CHECK (weight > 0 AND weight <= 1),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS brackets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      bracket_size INTEGER NOT NULL,
      actual_team_count INTEGER,
      status TEXT DEFAULT 'setup'
        CHECK (status IN ${BRACKET_STATUS_SQL}),
      weight REAL NOT NULL DEFAULT 1.0
        CHECK (weight > 0 AND weight <= 1),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
};
