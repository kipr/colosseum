import type { SchemaModule } from './types';

export const judgeChatSchema: SchemaModule = {
  name: 'judge-chat',
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS judge_chat_messages (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          conversation_key TEXT NOT NULL,
          sender_role TEXT NOT NULL CHECK (sender_role IN ('judge', 'admin')),
          sender_name TEXT NOT NULL,
          message TEXT NOT NULL,
          template_id INTEGER REFERENCES scoresheet_templates(id) ON DELETE SET NULL,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_judge_chat_thread ON judge_chat_messages(event_id, conversation_key, id)`,
      `CREATE INDEX IF NOT EXISTS idx_judge_chat_event_created ON judge_chat_messages(event_id, created_at)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS judge_chat_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          conversation_key TEXT NOT NULL,
          sender_role TEXT NOT NULL CHECK (sender_role IN ('judge', 'admin')),
          sender_name TEXT NOT NULL,
          message TEXT NOT NULL,
          template_id INTEGER,
          user_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
          FOREIGN KEY (template_id) REFERENCES scoresheet_templates(id) ON DELETE SET NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_judge_chat_thread ON judge_chat_messages(event_id, conversation_key, id)`,
      `CREATE INDEX IF NOT EXISTS idx_judge_chat_event_created ON judge_chat_messages(event_id, created_at)`,
    ],
  },
};
