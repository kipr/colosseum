import type { TableDefinition } from './types';
import { EVENT_STATUS_SQL, SCORE_ACCEPT_MODE_SQL } from '../sqlEnums';

export const eventsTable: TableDefinition = {
  name: 'events',
  pg: `
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      event_date DATE,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ${EVENT_STATUS_SQL}),
      seeding_rounds INTEGER DEFAULT 3,
      score_accept_mode TEXT NOT NULL DEFAULT 'manual' CHECK (score_accept_mode IN ${SCORE_ACCEPT_MODE_SQL}),
      spectator_results_released INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      event_date DATE,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ${EVENT_STATUS_SQL}),
      seeding_rounds INTEGER DEFAULT 3,
      score_accept_mode TEXT NOT NULL DEFAULT 'manual' CHECK (score_accept_mode IN ${SCORE_ACCEPT_MODE_SQL}),
      spectator_results_released INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
};
