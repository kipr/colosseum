import type { SchemaModule } from './types';

export const queueSchema: SchemaModule = {
  name: 'queue',
  updatedAtTables: ['game_queue'],
  postgres: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS game_queue (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
          seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
          seeding_round INTEGER,
          double_seeding_match_id INTEGER REFERENCES double_seeding_matches(id) ON DELETE CASCADE,
          queue_type TEXT NOT NULL CHECK (queue_type IN ('seeding', 'bracket', 'double_seeding')),
          queue_position INTEGER NOT NULL,
          status TEXT DEFAULT 'queued'
            CHECK (status IN ('queued', 'called', 'arrived', 'on_table', 'scored')),
          called_at TIMESTAMP,
          table_number INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL AND double_seeding_match_id IS NULL)
            OR
            (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL AND double_seeding_match_id IS NULL)
            OR
            (queue_type = 'double_seeding' AND double_seeding_match_id IS NOT NULL AND bracket_game_id IS NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
          )
        )
      `,
    ],
    triggers: [
      `
        CREATE OR REPLACE FUNCTION game_queue_clear_called_at()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.status = 'queued' AND NEW.called_at IS NOT NULL THEN
            NEW.called_at = NULL;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `,
      `
        DROP TRIGGER IF EXISTS game_queue_clear_called_at_on_queued ON game_queue;
        CREATE TRIGGER game_queue_clear_called_at_on_queued
          BEFORE UPDATE ON game_queue
          FOR EACH ROW
          EXECUTE FUNCTION game_queue_clear_called_at()
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position)`,
      `CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status)`,
      `CREATE INDEX IF NOT EXISTS idx_game_queue_double_seeding_match ON game_queue(double_seeding_match_id)`,
    ],
  },
  sqlite: {
    tables: [
      `
        CREATE TABLE IF NOT EXISTS game_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          bracket_game_id INTEGER REFERENCES bracket_games(id) ON DELETE CASCADE,
          seeding_team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
          seeding_round INTEGER,
          double_seeding_match_id INTEGER REFERENCES double_seeding_matches(id) ON DELETE CASCADE,
          queue_type TEXT NOT NULL CHECK (queue_type IN ('seeding', 'bracket', 'double_seeding')),
          queue_position INTEGER NOT NULL,
          status TEXT DEFAULT 'queued'
            CHECK (status IN ('queued', 'called', 'arrived', 'on_table', 'scored')),
          called_at DATETIME,
          table_number INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (queue_type = 'bracket' AND bracket_game_id IS NOT NULL AND seeding_team_id IS NULL AND seeding_round IS NULL AND double_seeding_match_id IS NULL)
            OR
            (queue_type = 'seeding' AND bracket_game_id IS NULL AND seeding_team_id IS NOT NULL AND seeding_round IS NOT NULL AND double_seeding_match_id IS NULL)
            OR
            (queue_type = 'double_seeding' AND double_seeding_match_id IS NOT NULL AND bracket_game_id IS NULL AND seeding_team_id IS NULL AND seeding_round IS NULL)
          )
        )
      `,
    ],
    triggers: [
      `
        CREATE TRIGGER IF NOT EXISTS game_queue_clear_called_at_on_queued
        AFTER UPDATE OF status ON game_queue
        FOR EACH ROW
        WHEN NEW.status = 'queued' AND NEW.called_at IS NOT NULL
        BEGIN
          UPDATE game_queue
          SET called_at = NULL
          WHERE id = NEW.id;
        END
      `,
    ],
    indexes: [
      `CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position)`,
      `CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status)`,
      `CREATE INDEX IF NOT EXISTS idx_game_queue_double_seeding_match ON game_queue(double_seeding_match_id)`,
    ],
  },
};
