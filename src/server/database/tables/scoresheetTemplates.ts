import type { TableDefinition } from './types';

export const scoresheetTemplatesTable: TableDefinition = {
  name: 'scoresheet_templates',
  pg: `
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      access_code TEXT NOT NULL,
      spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  sqlite: `
    CREATE TABLE IF NOT EXISTS scoresheet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      schema TEXT NOT NULL,
      access_code TEXT NOT NULL,
      spreadsheet_config_id INTEGER REFERENCES spreadsheet_configs(id),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `,
};
