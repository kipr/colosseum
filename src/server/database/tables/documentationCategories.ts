import type { TableDefinition } from './types';

export const documentationCategoriesTable: TableDefinition = {
  name: 'documentation_categories',
  pg: `
    CREATE TABLE IF NOT EXISTS documentation_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      weight REAL NOT NULL DEFAULT 1.0,
      max_score REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS documentation_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      weight REAL NOT NULL DEFAULT 1.0,
      max_score REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
};
