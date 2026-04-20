import type { TableDefinition } from './types';
import { TEAM_STATUS_SQL } from '../sqlEnums';

export const teamsTable: TableDefinition = {
  name: 'teams',
  pg: `
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team_number INTEGER NOT NULL CHECK (team_number > 0),
      team_name TEXT NOT NULL,
      display_name TEXT,
      status TEXT DEFAULT 'registered'
        CHECK (status IN ${TEAM_STATUS_SQL}),
      checked_in_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, team_number)
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      team_number INTEGER NOT NULL CHECK (team_number > 0),
      team_name TEXT NOT NULL,
      display_name TEXT,
      status TEXT DEFAULT 'registered'
        CHECK (status IN ${TEAM_STATUS_SQL}),
      checked_in_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, team_number)
    )
  `,
};
