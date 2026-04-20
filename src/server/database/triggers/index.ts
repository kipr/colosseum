/**
 * Trigger emitters for both dialects.
 *
 * Two groups:
 *   - `emitUpdatedAtTriggers` installs the `<table>_updated_at` BEFORE/AFTER
 *     UPDATE triggers that bump `updated_at = CURRENT_TIMESTAMP` whenever a
 *     row is updated without explicitly setting it.
 *   - `emitCleanupTriggers` installs the small set of state-cleanup triggers
 *     (teams check-in clear, game_queue called_at clear, seeding scored_at
 *     clear, bracket_games timestamp rollback).
 *
 * The Postgres bodies are the original PL/pgSQL functions and triggers from
 * `init.ts`, and the SQLite bodies are the `CREATE TRIGGER IF NOT EXISTS`
 * statements -- both lifted verbatim.
 */
import type { Database } from '../connection';
import type { Dialect } from '../dialect';

/** Tables that get the standard `<table>_updated_at` trigger. */
export const UPDATED_AT_TABLES: readonly string[] = [
  'users',
  'spreadsheet_configs',
  'scoresheet_field_templates',
  'scoresheet_templates',
  'score_submissions',
  'events',
  'teams',
  'seeding_scores',
  'seeding_rankings',
  'brackets',
  'bracket_games',
  'game_queue',
  'documentation_scores',
  'award_templates',
  'event_awards',
];

export async function emitUpdatedAtTriggers(
  db: Database,
  dialect: Dialect,
): Promise<void> {
  if (dialect === 'pg') {
    await db.exec(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.updated_at = OLD.updated_at THEN
          NEW.updated_at = CURRENT_TIMESTAMP;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const table of UPDATED_AT_TABLES) {
      await db.exec(`
        DROP TRIGGER IF EXISTS ${table}_updated_at ON ${table};
        CREATE TRIGGER ${table}_updated_at
          BEFORE UPDATE ON ${table}
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column()
      `);
    }
    return;
  }

  // SQLite
  for (const table of UPDATED_AT_TABLES) {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_updated_at
      AFTER UPDATE ON ${table}
      FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE ${table}
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END
    `);
  }
}

export async function emitCleanupTriggers(
  db: Database,
  dialect: Dialect,
): Promise<void> {
  if (dialect === 'pg') {
    await emitCleanupTriggersPg(db);
    return;
  }
  await emitCleanupTriggersSqlite(db);
}

async function emitCleanupTriggersPg(db: Database): Promise<void> {
  // teams.checked_in_at clear
  await db.exec(`
    CREATE OR REPLACE FUNCTION teams_clear_checked_in_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status IN ('registered', 'no_show') AND NEW.checked_in_at IS NOT NULL THEN
        NEW.checked_in_at = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS teams_clear_checked_in_at_on_status ON teams;
    CREATE TRIGGER teams_clear_checked_in_at_on_status
      BEFORE UPDATE ON teams
      FOR EACH ROW
      EXECUTE FUNCTION teams_clear_checked_in_at()
  `);

  // game_queue.called_at clear
  await db.exec(`
    CREATE OR REPLACE FUNCTION game_queue_clear_called_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status = 'queued' AND NEW.called_at IS NOT NULL THEN
        NEW.called_at = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS game_queue_clear_called_at_on_queued ON game_queue;
    CREATE TRIGGER game_queue_clear_called_at_on_queued
      BEFORE UPDATE ON game_queue
      FOR EACH ROW
      EXECUTE FUNCTION game_queue_clear_called_at()
  `);

  // seeding_scores.scored_at clear when score removed
  await db.exec(`
    CREATE OR REPLACE FUNCTION seeding_scores_clear_scored_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.score IS NULL AND (NEW.scored_at IS NOT NULL OR NEW.score_submission_id IS NOT NULL) THEN
        NEW.scored_at = NULL;
        NEW.score_submission_id = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS seeding_scores_clear_scored_at_when_score_null ON seeding_scores;
    CREATE TRIGGER seeding_scores_clear_scored_at_when_score_null
      BEFORE UPDATE ON seeding_scores
      FOR EACH ROW
      EXECUTE FUNCTION seeding_scores_clear_scored_at()
  `);

  // bracket_games timestamps rollback
  await db.exec(`
    CREATE OR REPLACE FUNCTION bracket_games_clear_times_on_rollback()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.status IN ('pending', 'ready') AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL) THEN
        NEW.started_at = NULL;
        NEW.completed_at = NULL;
      ELSIF NEW.status = 'in_progress' AND NEW.completed_at IS NOT NULL THEN
        NEW.completed_at = NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.exec(`
    DROP TRIGGER IF EXISTS bracket_games_clear_times_on_status_rollback ON bracket_games;
    CREATE TRIGGER bracket_games_clear_times_on_status_rollback
      BEFORE UPDATE ON bracket_games
      FOR EACH ROW
      EXECUTE FUNCTION bracket_games_clear_times_on_rollback()
  `);
}

async function emitCleanupTriggersSqlite(db: Database): Promise<void> {
  // teams.checked_in_at clear
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS teams_clear_checked_in_at_on_status
    AFTER UPDATE OF status ON teams
    FOR EACH ROW
    WHEN NEW.status IN ('registered', 'no_show') AND NEW.checked_in_at IS NOT NULL
    BEGIN
      UPDATE teams
      SET checked_in_at = NULL
      WHERE id = NEW.id;
    END
  `);

  // game_queue.called_at clear
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS game_queue_clear_called_at_on_queued
    AFTER UPDATE OF status ON game_queue
    FOR EACH ROW
    WHEN NEW.status = 'queued' AND NEW.called_at IS NOT NULL
    BEGIN
      UPDATE game_queue
      SET called_at = NULL
      WHERE id = NEW.id;
    END
  `);

  // seeding_scores scored_at clear
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS seeding_scores_clear_scored_at_when_score_null
    AFTER UPDATE OF score ON seeding_scores
    FOR EACH ROW
    WHEN NEW.score IS NULL AND (NEW.scored_at IS NOT NULL OR NEW.score_submission_id IS NOT NULL)
    BEGIN
      UPDATE seeding_scores
      SET scored_at = NULL, score_submission_id = NULL
      WHERE id = NEW.id;
    END
  `);

  // bracket_games timestamps rollback (pending/ready)
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS bracket_games_clear_times_on_status_rollback
    AFTER UPDATE OF status ON bracket_games
    FOR EACH ROW
    WHEN NEW.status IN ('pending', 'ready') AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL)
    BEGIN
      UPDATE bracket_games
      SET started_at = NULL, completed_at = NULL
      WHERE id = NEW.id;
    END
  `);

  // bracket_games completed_at clear (in_progress) -- SQLite needs a second
  // trigger because WHEN clauses can't express the ELSIF branch the Postgres
  // function does inline.
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS bracket_games_clear_completed_at_on_in_progress
    AFTER UPDATE OF status ON bracket_games
    FOR EACH ROW
    WHEN NEW.status = 'in_progress' AND NEW.completed_at IS NOT NULL
    BEGIN
      UPDATE bracket_games
      SET completed_at = NULL
      WHERE id = NEW.id;
    END
  `);
}
