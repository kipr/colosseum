import type { TableDefinition } from './types';

export const activeSessionsTable: TableDefinition = {
  name: 'active_sessions',
  pg: `
    CREATE TABLE IF NOT EXISTS active_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
      session_token TEXT UNIQUE NOT NULL,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS active_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE CASCADE
    )
  `,
};
