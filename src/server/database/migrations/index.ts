/**
 * Ordered list of every numbered migration.
 *
 * Add new migrations by creating `NNNN_snake_case.ts` exporting a default
 * `Migration` object and appending it here. Never reorder or rename existing
 * entries -- the IDs are recorded in `schema_migrations` on every database.
 */
import type { Migration } from './runner';
import migration0001 from './0001_game_queue_status_v2';
import migration0002 from './0002_events_score_accept_mode';
import migration0003 from './0003_events_spectator_results_released';
import migration0004 from './0004_spreadsheet_configs_auto_accept';
import migration0005 from './0005_brackets_weight';
import migration0006 from './0006_bracket_entries_ranking_columns';
import migration0007 from './0007_score_submissions_event_scoped_columns';
import migration0008 from './0008_score_submissions_bracket_game_fk';
import migration0009 from './0009_score_submissions_game_queue_fk';
import migration0010 from './0010_users_last_activity';

export const MIGRATIONS: readonly Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
];
