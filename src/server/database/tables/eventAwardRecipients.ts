import type { TableDefinition } from './types';

export const eventAwardRecipientsTable: TableDefinition = {
  name: 'event_award_recipients',
  pg: `
    CREATE TABLE IF NOT EXISTS event_award_recipients (
      id SERIAL PRIMARY KEY,
      event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_award_id, team_id)
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS event_award_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_award_id, team_id)
    )
  `,
};
