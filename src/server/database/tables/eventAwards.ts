import type { TableDefinition } from './types';

export const eventAwardsTable: TableDefinition = {
  name: 'event_awards',
  pg: `
    CREATE TABLE IF NOT EXISTS event_awards (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_award_id INTEGER REFERENCES award_templates(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS event_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_award_id INTEGER REFERENCES award_templates(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
};
