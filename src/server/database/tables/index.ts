/**
 * Ordered list of every baseline table. Order is FK-respecting:
 * - parents (users, events, teams, ...) before children
 * - `score_submissions` before `bracket_games` and `game_queue`; the
 *   forward references on Postgres are added later by migrations 0008/0009
 *   (SQLite parses those FKs lazily so the inline declarations work).
 *
 * `applyBaseline()` in `init.ts` iterates this list and `db.exec()`s the
 * appropriate dialect string for each entry.
 */
import type { TableDefinition } from './types';
import { usersTable } from './users';
import { spreadsheetConfigsTable } from './spreadsheetConfigs';
import { scoresheetFieldTemplatesTable } from './scoresheetFieldTemplates';
import { scoresheetTemplatesTable } from './scoresheetTemplates';
import { eventsTable } from './events';
import { teamsTable } from './teams';
import { seedingScoresTable } from './seedingScores';
import { seedingRankingsTable } from './seedingRankings';
import { documentationCategoriesTable } from './documentationCategories';
import { eventDocumentationCategoriesTable } from './eventDocumentationCategories';
import { documentationScoresTable } from './documentationScores';
import { documentationSubScoresTable } from './documentationSubScores';
import { bracketsTable } from './brackets';
import { bracketEntriesTable } from './bracketEntries';
import { scoreSubmissionsTable } from './scoreSubmissions';
import { bracketGamesTable } from './bracketGames';
import { scoreDetailsTable } from './scoreDetails';
import { eventScoresheetTemplatesTable } from './eventScoresheetTemplates';
import { gameQueueTable } from './gameQueue';
import { bracketTemplatesTable } from './bracketTemplates';
import { auditLogTable } from './auditLog';
import { activeSessionsTable } from './activeSessions';
import { chatMessagesTable } from './chatMessages';
import { awardTemplatesTable } from './awardTemplates';
import { eventAwardsTable } from './eventAwards';
import { eventAwardRecipientsTable } from './eventAwardRecipients';
import { sessionTable } from './session';

export const TABLES_IN_ORDER: readonly TableDefinition[] = [
  usersTable,
  spreadsheetConfigsTable,
  scoresheetFieldTemplatesTable,
  scoresheetTemplatesTable,
  eventsTable,
  teamsTable,
  seedingScoresTable,
  seedingRankingsTable,
  documentationCategoriesTable,
  eventDocumentationCategoriesTable,
  documentationScoresTable,
  documentationSubScoresTable,
  bracketsTable,
  bracketEntriesTable,
  scoreSubmissionsTable,
  bracketGamesTable,
  scoreDetailsTable,
  eventScoresheetTemplatesTable,
  gameQueueTable,
  bracketTemplatesTable,
  auditLogTable,
  activeSessionsTable,
  chatMessagesTable,
  awardTemplatesTable,
  eventAwardsTable,
  eventAwardRecipientsTable,
  sessionTable,
];

export type { TableDefinition } from './types';
