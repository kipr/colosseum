import type { SchemaModule } from './types';

export const scoresheetsSchema: SchemaModule = {
  name: 'scoresheets',
  updatedAtTables: ['scoresheet_field_templates', 'scoresheet_templates'],
  tables: [
    `
      CREATE TABLE IF NOT EXISTS scoresheet_field_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        fields_json TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS scoresheet_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        schema TEXT NOT NULL,
        access_code TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
  ],
};
