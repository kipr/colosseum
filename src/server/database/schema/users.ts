import type { SchemaModule } from './types';

export const usersSchema: SchemaModule = {
  name: 'users',
  updatedAtTables: ['users'],
  tables: [
    `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at BIGINT,
        is_admin BOOLEAN DEFAULT FALSE,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
  ],
  columns: [
    {
      table: 'users',
      column: 'access_token',
      definition: 'TEXT',
    },
    {
      table: 'users',
      column: 'refresh_token',
      definition: 'TEXT',
    },
    {
      table: 'users',
      column: 'token_expires_at',
      definition: 'BIGINT',
    },
    {
      table: 'users',
      column: 'last_activity',
      definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    },
  ],
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`,
  ],
};
