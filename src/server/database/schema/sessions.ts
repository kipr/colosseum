import type { SchemaModule } from './types';

export const sessionsSchema: SchemaModule = {
  name: 'sessions',
  postgres: {
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
  },
  sqlite: {
    tables: [
      `
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
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`,
    ],
  },
};
