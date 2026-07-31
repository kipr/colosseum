import type { SchemaModule } from './types';

export const awardsSchema: SchemaModule = {
  name: 'awards',
  updatedAtTables: [
    'award_templates',
    'event_awards',
    'event_automatic_award_settings',
  ],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS award_templates (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (award_type IN ('certificate', 'trophy')),
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
          award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (award_type IN ('certificate', 'trophy')),
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
      `
        CREATE TABLE IF NOT EXISTS event_award_individual_recipients (
          id SERIAL PRIMARY KEY,
          event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS event_automatic_award_settings (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
          de_top_n INTEGER NOT NULL DEFAULT 3 CHECK (de_top_n >= 0),
          per_bracket_overall_top_n INTEGER NOT NULL DEFAULT 3
            CHECK (per_bracket_overall_top_n >= 0),
          seeding_top_n INTEGER NOT NULL DEFAULT 3 CHECK (seeding_top_n >= 0),
          de_award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (de_award_type IN ('certificate', 'trophy')),
          per_bracket_overall_award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (per_bracket_overall_award_type IN ('certificate', 'trophy')),
          seeding_award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (seeding_award_type IN ('certificate', 'trophy')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_event_awards_event_sort ON event_awards(event_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_event_awards_template ON event_awards(template_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_awards_event_type ON event_awards(event_id, award_type)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_award ON event_award_recipients(event_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_team ON event_award_recipients(team_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_individual_recipients_award ON event_award_individual_recipients(event_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_individual_recipients_team ON event_award_individual_recipients(team_id)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS award_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (award_type IN ('certificate', 'trophy')),
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
          award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (award_type IN ('certificate', 'trophy')),
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
      `
        CREATE TABLE IF NOT EXISTS event_award_individual_recipients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_award_id INTEGER NOT NULL REFERENCES event_awards(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS event_automatic_award_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
          de_top_n INTEGER NOT NULL DEFAULT 3 CHECK (de_top_n >= 0),
          per_bracket_overall_top_n INTEGER NOT NULL DEFAULT 3
            CHECK (per_bracket_overall_top_n >= 0),
          seeding_top_n INTEGER NOT NULL DEFAULT 3 CHECK (seeding_top_n >= 0),
          de_award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (de_award_type IN ('certificate', 'trophy')),
          per_bracket_overall_award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (per_bracket_overall_award_type IN ('certificate', 'trophy')),
          seeding_award_type TEXT NOT NULL DEFAULT 'trophy'
            CHECK (seeding_award_type IN ('certificate', 'trophy')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_event_awards_event_sort ON event_awards(event_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_event_awards_template ON event_awards(template_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_awards_event_type ON event_awards(event_id, award_type)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_award ON event_award_recipients(event_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_team ON event_award_recipients(team_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_individual_recipients_award ON event_award_individual_recipients(event_award_id)`,
      `CREATE INDEX IF NOT EXISTS idx_event_award_individual_recipients_team ON event_award_individual_recipients(team_id)`,
    ],
  },
};
