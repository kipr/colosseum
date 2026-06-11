import type { SchemaModule } from './types';

export const awardsSchema: SchemaModule = {
  name: 'awards',
  updatedAtTables: ['award_templates', 'event_awards'],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS award_templates (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
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
      `
        CREATE TABLE IF NOT EXISTS event_award_recipients (
          id SERIAL PRIMARY KEY,
          event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_award_id, team_id)
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_event_awards_event_sort ON event_awards(event_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_event_awards_template ON event_awards(template_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_award ON event_award_recipients(event_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_team ON event_award_recipients(team_id)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS award_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
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
      `
        CREATE TABLE IF NOT EXISTS event_award_recipients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_award_id, team_id)
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_event_awards_event_sort ON event_awards(event_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_event_awards_template ON event_awards(template_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_award ON event_award_recipients(event_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_team ON event_award_recipients(team_id)`,
    ],
  },
};
