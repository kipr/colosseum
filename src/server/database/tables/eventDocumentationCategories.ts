import type { TableDefinition } from './types';

export const eventDocumentationCategoriesTable: TableDefinition = {
  name: 'event_documentation_categories',
  pg: `
    CREATE TABLE IF NOT EXISTS event_documentation_categories (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES documentation_categories(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, ordinal),
      UNIQUE(event_id, category_id)
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS event_documentation_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES documentation_categories(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 1 AND ordinal <= 4),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, ordinal),
      UNIQUE(event_id, category_id)
    )
  `,
};
