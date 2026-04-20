import type { TableDefinition } from './types';
import { QUEUE_STATUS_SQL, QUEUE_TYPE_SQL } from '../sqlEnums';

export const gameQueueTable: TableDefinition = {
  name: 'game_queue',
  pg: `
    CREATE TABLE IF NOT EXISTS game_queue (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
      seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      seeding_round INTEGER,
      queue_type TEXT NOT NULL CHECK (queue_type IN ${QUEUE_TYPE_SQL}),
      queue_position INTEGER NOT NULL,
      status TEXT DEFAULT 'queued'
        CHECK (status IN ${QUEUE_STATUS_SQL}),
      called_at TIMESTAMP,
      table_number INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
        OR
        (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL)
      )
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS game_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
      seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      seeding_round INTEGER,
      queue_type TEXT NOT NULL CHECK (queue_type IN ${QUEUE_TYPE_SQL}),
      queue_position INTEGER NOT NULL,
      status TEXT DEFAULT 'queued'
        CHECK (status IN ${QUEUE_STATUS_SQL}),
      called_at DATETIME,
      table_number INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
        OR
        (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL)
      )
    )
  `,
};
