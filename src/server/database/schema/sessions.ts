import type { SchemaModule } from './types';

export const sessionsSchema: SchemaModule = {
  name: 'sessions',
  tables: [
    `
      CREATE TABLE IF NOT EXISTS active_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_id INTEGER NOT NULL REFERENCES scoresheet_templates(id) ON DELETE CASCADE,
        session_token TEXT UNIQUE NOT NULL,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" VARCHAR NOT NULL COLLATE "default",
        "sess" JSON NOT NULL,
        "expire" TIMESTAMP(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      )
    `,
  ],
  indexes: [
    `CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`,
  ],
};
