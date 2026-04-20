import type { TableDefinition } from './types';

export const eventScoresheetTemplatesTable: TableDefinition = {
  name: 'event_scoresheet_templates',
  pg: `
    CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      template_type TEXT NOT NULL
        CHECK (template_type IN ('seeding', 'bracket')),
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, template_id, template_type)
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS event_scoresheet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      template_type TEXT NOT NULL
        CHECK (template_type IN ('seeding', 'bracket')),
      is_default BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, template_id, template_type)
    )
  `,
};
