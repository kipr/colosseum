import type { TableDefinition } from './types';

export const spreadsheetConfigsTable: TableDefinition = {
  name: 'spreadsheet_configs',
  pg: `
    CREATE TABLE IF NOT EXISTS spreadsheet_configs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT,
      sheet_purpose TEXT DEFAULT 'scores',
      is_active BOOLEAN DEFAULT TRUE,
      auto_accept BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS spreadsheet_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_name TEXT,
      sheet_name TEXT,
      sheet_purpose TEXT DEFAULT 'scores',
      is_active BOOLEAN DEFAULT 1,
      auto_accept BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `,
};
