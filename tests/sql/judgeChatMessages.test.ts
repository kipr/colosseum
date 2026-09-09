/**
 * judge_chat_messages schema tests - verify constraints, foreign-key
 * behavior, and indexes for the event-scoped judge chat table.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from './helpers/testDb';

describe('judge_chat_messages table', () => {
  let testDb: TestDb;
  let eventId: number;

  beforeEach(async () => {
    testDb = await createTestDb();

    const eventResult = await testDb.db.run(
      `INSERT INTO events (name, status) VALUES (?, ?) RETURNING id`,
      ['Test Event', 'setup'],
    );
    eventId = eventResult.lastID!;
  });

  afterEach(() => {
    testDb.close();
  });

  describe('sender_role CHECK', () => {
    it('rejects an invalid sender_role', async () => {
      await expect(
        testDb.db.run(
          `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
          [eventId, 'conv-1', 'spectator', 'Mallory', 'hello'],
        ),
      ).rejects.toThrow(/violates check constraint/);
    });

    it('accepts judge and admin roles', async () => {
      for (const role of ['judge', 'admin']) {
        await testDb.db.run(
          `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
          [eventId, 'conv-1', role, `${role} name`, `msg from ${role}`],
        );
      }

      const rows = await testDb.db.all(
        `SELECT * FROM judge_chat_messages WHERE event_id = ? ORDER BY id`,
        [eventId],
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.sender_role)).toEqual(['judge', 'admin']);
    });
  });

  describe('NOT NULL constraints', () => {
    it('rejects NULL event_id', async () => {
      await expect(
        testDb.db.run(
          `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
          [null, 'conv-1', 'judge', 'Judge', 'hi'],
        ),
      ).rejects.toThrow(/violates not-null constraint/);
    });

    it('rejects NULL conversation_key', async () => {
      await expect(
        testDb.db.run(
          `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
          [eventId, null, 'judge', 'Judge', 'hi'],
        ),
      ).rejects.toThrow(/violates not-null constraint/);
    });

    it('rejects NULL sender_name', async () => {
      await expect(
        testDb.db.run(
          `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
          [eventId, 'conv-1', 'judge', null, 'hi'],
        ),
      ).rejects.toThrow(/violates not-null constraint/);
    });

    it('rejects NULL message', async () => {
      await expect(
        testDb.db.run(
          `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
          [eventId, 'conv-1', 'judge', 'Judge', null],
        ),
      ).rejects.toThrow(/violates not-null constraint/);
    });
  });

  describe('event_id foreign key', () => {
    it('rejects an orphan event_id', async () => {
      await expect(
        testDb.db.run(
          `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
          [99999, 'conv-1', 'judge', 'Judge', 'hi'],
        ),
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('cascade deletes messages when the event is deleted', async () => {
      await testDb.db.run(
        `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [eventId, 'conv-1', 'judge', 'Judge', 'hi'],
      );

      let rows = await testDb.db.all(`SELECT * FROM judge_chat_messages`);
      expect(rows).toHaveLength(1);

      await testDb.db.run(`DELETE FROM events WHERE id = ?`, [eventId]);

      rows = await testDb.db.all(`SELECT * FROM judge_chat_messages`);
      expect(rows).toHaveLength(0);
    });
  });

  describe('template_id and user_id ON DELETE SET NULL', () => {
    let templateId: number;
    let userId: number;

    beforeEach(async () => {
      const templateResult = await testDb.db.run(
        `INSERT INTO scoresheet_templates (name, schema, access_code) VALUES (?, ?, ?) RETURNING id`,
        ['Seeding Sheet', '{}', 'ABC123'],
      );
      templateId = templateResult.lastID!;

      const userResult = await testDb.db.run(
        `INSERT INTO users (google_id, email, name) VALUES (?, ?, ?) RETURNING id`,
        ['google-1', 'admin@example.com', 'Admin User'],
      );
      userId = userResult.lastID!;
    });

    it('nulls template_id but preserves history when the template is deleted', async () => {
      await testDb.db.run(
        `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message, template_id)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          eventId,
          'conv-1',
          'judge',
          'Judge',
          'on the seeding sheet',
          templateId,
        ],
      );

      await testDb.db.run(`DELETE FROM scoresheet_templates WHERE id = ?`, [
        templateId,
      ]);

      const row = await testDb.db.get(
        `SELECT * FROM judge_chat_messages WHERE event_id = ?`,
        [eventId],
      );
      expect(row.template_id).toBeNull();
      expect(row.sender_name).toBe('Judge');
      expect(row.message).toBe('on the seeding sheet');
    });

    it('nulls user_id but preserves history when the user is deleted', async () => {
      await testDb.db.run(
        `INSERT INTO judge_chat_messages (event_id, conversation_key, sender_role, sender_name, message, user_id)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        [eventId, 'conv-1', 'admin', 'Admin User', 'reply from admin', userId],
      );

      await testDb.db.run(`DELETE FROM users WHERE id = ?`, [userId]);

      const row = await testDb.db.get(
        `SELECT * FROM judge_chat_messages WHERE event_id = ?`,
        [eventId],
      );
      expect(row.user_id).toBeNull();
      expect(row.sender_name).toBe('Admin User');
      expect(row.message).toBe('reply from admin');
    });
  });

  describe('indexes', () => {
    it('creates idx_judge_chat_thread and idx_judge_chat_event_created', async () => {
      const indexes = await testDb.db.all<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = current_schema()
           AND tablename = 'judge_chat_messages'`,
      );
      const names = indexes.map((i) => i.indexname);
      expect(names).toContain('idx_judge_chat_thread');
      expect(names).toContain('idx_judge_chat_event_created');
    });
  });
});
