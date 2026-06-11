import type { SchemaModule } from './types';

export const auditSchema: SchemaModule = {
  name: 'audit',
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS audit_log (
          id SERIAL PRIMARY KEY,
          event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id INTEGER,
          old_value TEXT,
          new_value TEXT,
          ip_address TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id INTEGER,
          old_value TEXT,
          new_value TEXT,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,
    ],
  },
};
