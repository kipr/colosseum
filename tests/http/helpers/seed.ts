/**
 * Seed helpers for HTTP route tests.
 * Provides functions to insert test data into the in-memory database.
 */
import { Database } from '../../../src/server/database/connection';

export interface SeedUserData {
  name?: string;
  email?: string;
  google_id?: string;
  is_admin?: boolean;
}

export async function seedUser(
  db: Database,
  data: SeedUserData = {},
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO users (name, email, google_id, is_admin) VALUES (?, ?, ?, ?)`,
    [
      data.name ?? 'Test User',
      data.email ?? 'test@example.com',
      data.google_id ?? 'google-123',
      data.is_admin ?? false,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedEventData {
  name?: string;
  description?: string;
  event_date?: string;
  location?: string;
  status?: string;
  seeding_rounds?: number;
  score_accept_mode?: string;
  created_by?: number;
}

export async function seedEvent(
  db: Database,
  data: SeedEventData = {},
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO events (name, description, event_date, location, status, seeding_rounds, score_accept_mode, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name ?? 'Test Event',
      data.description ?? null,
      data.event_date ?? null,
      data.location ?? null,
      data.status ?? 'setup',
      data.seeding_rounds ?? 3,
      data.score_accept_mode ?? 'manual',
      data.created_by ?? null,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedTeamData {
  event_id: number;
  team_number: number;
  team_name?: string;
  display_name?: string;
  status?: string;
}

export async function seedTeam(
  db: Database,
  data: SeedTeamData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO teams (event_id, team_number, team_name, display_name, status)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.event_id,
      data.team_number,
      data.team_name ?? `Team ${data.team_number}`,
      data.display_name ?? null,
      data.status ?? 'registered',
    ],
  );
  return { id: result.lastID! };
}

export interface SeedBracketData {
  event_id: number;
  name?: string;
  bracket_size?: number;
  actual_team_count?: number;
  status?: string;
  created_by?: number;
}

export async function seedBracket(
  db: Database,
  data: SeedBracketData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO brackets (event_id, name, bracket_size, actual_team_count, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.event_id,
      data.name ?? 'Test Bracket',
      data.bracket_size ?? 8,
      data.actual_team_count ?? null,
      data.status ?? 'setup',
      data.created_by ?? null,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedBracketGameData {
  bracket_id: number;
  game_number: number;
  round_name?: string;
  round_number?: number;
  bracket_side?: string;
  team1_id?: number | null;
  team2_id?: number | null;
  status?: string;
}

export async function seedBracketGame(
  db: Database,
  data: SeedBracketGameData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO bracket_games (bracket_id, game_number, round_name, round_number, bracket_side, team1_id, team2_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.bracket_id,
      data.game_number,
      data.round_name ?? 'Round 1',
      data.round_number ?? 1,
      data.bracket_side ?? 'winners',
      data.team1_id ?? null,
      data.team2_id ?? null,
      data.status ?? 'pending',
    ],
  );
  return { id: result.lastID! };
}

export interface SeedQueueItemData {
  event_id: number;
  queue_type: 'seeding' | 'bracket';
  queue_position: number;
  bracket_game_id?: number | null;
  seeding_team_id?: number | null;
  seeding_round?: number | null;
  status?: string;
  table_number?: number | null;
}

export async function seedQueueItem(
  db: Database,
  data: SeedQueueItemData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO game_queue (event_id, bracket_game_id, seeding_team_id, seeding_round, queue_type, queue_position, status, table_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.event_id,
      data.bracket_game_id ?? null,
      data.seeding_team_id ?? null,
      data.seeding_round ?? null,
      data.queue_type,
      data.queue_position,
      data.status ?? 'queued',
      data.table_number ?? null,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedSeedingScoreData {
  team_id: number;
  round_number: number;
  score?: number | null;
}

export async function seedSeedingScore(
  db: Database,
  data: SeedSeedingScoreData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO seeding_scores (team_id, round_number, score)
     VALUES (?, ?, ?)`,
    [data.team_id, data.round_number, data.score ?? null],
  );
  return { id: result.lastID! };
}

export interface SeedScoresheetTemplateData {
  name?: string;
  schema?: string;
  access_code?: string;
  created_by?: number | null;
  spreadsheet_config_id?: number | null;
}

export async function seedScoresheetTemplate(
  db: Database,
  data: SeedScoresheetTemplateData = {},
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO scoresheet_templates (name, schema, access_code, created_by, spreadsheet_config_id)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.name ?? 'Test Template',
      data.schema ?? '[]',
      data.access_code ?? 'test-access-code',
      data.created_by ?? null,
      data.spreadsheet_config_id ?? null,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedEventScoresheetTemplateData {
  event_id: number;
  template_id: number;
  template_type: 'seeding' | 'bracket';
  is_default?: boolean;
}

export async function seedEventScoresheetTemplate(
  db: Database,
  data: SeedEventScoresheetTemplateData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO event_scoresheet_templates (event_id, template_id, template_type, is_default)
     VALUES (?, ?, ?, ?)`,
    [
      data.event_id,
      data.template_id,
      data.template_type,
      data.is_default ?? false,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedSpreadsheetConfigData {
  user_id: number;
  spreadsheet_id?: string;
  spreadsheet_name?: string;
  sheet_name?: string;
  sheet_purpose?: string;
  is_active?: boolean;
}

export async function seedSpreadsheetConfig(
  db: Database,
  data: SeedSpreadsheetConfigData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO spreadsheet_configs (user_id, spreadsheet_id, spreadsheet_name, sheet_name, sheet_purpose, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.user_id,
      data.spreadsheet_id ?? 'test-spreadsheet-id',
      data.spreadsheet_name ?? 'Test Spreadsheet',
      data.sheet_name ?? 'Sheet1',
      data.sheet_purpose ?? 'scores',
      data.is_active ?? true,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedAuditLogData {
  event_id?: number | null;
  user_id?: number | null;
  action: string;
  entity_type: string;
  entity_id?: number | null;
  old_value?: string | null;
  new_value?: string | null;
  created_at?: string | null;
}

export async function seedAuditLog(
  db: Database,
  data: SeedAuditLogData,
): Promise<{ id: number }> {
  const hasCreatedAt = data.created_at != null && data.created_at !== '';
  const columns = hasCreatedAt
    ? 'event_id, user_id, action, entity_type, entity_id, old_value, new_value, created_at'
    : 'event_id, user_id, action, entity_type, entity_id, old_value, new_value';
  const placeholders = hasCreatedAt
    ? '?, ?, ?, ?, ?, ?, ?, ?'
    : '?, ?, ?, ?, ?, ?, ?';
  const values = hasCreatedAt
    ? [
        data.event_id ?? null,
        data.user_id ?? null,
        data.action,
        data.entity_type,
        data.entity_id ?? null,
        data.old_value ?? null,
        data.new_value ?? null,
        data.created_at,
      ]
    : [
        data.event_id ?? null,
        data.user_id ?? null,
        data.action,
        data.entity_type,
        data.entity_id ?? null,
        data.old_value ?? null,
        data.new_value ?? null,
      ];
  const result = await db.run(
    `INSERT INTO audit_log (${columns}) VALUES (${placeholders})`,
    values,
  );
  return { id: result.lastID! };
}

export interface SeedScoreSubmissionData {
  user_id?: number | null;
  template_id: number;
  spreadsheet_config_id?: number | null;
  participant_name?: string | null;
  match_id?: string | null;
  score_data: string;
  status?: string;
  event_id?: number | null;
  bracket_game_id?: number | null;
  seeding_score_id?: number | null;
  score_type?: string | null;
  game_queue_id?: number | null;
}

export async function seedScoreSubmission(
  db: Database,
  data: SeedScoreSubmissionData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO score_submissions (user_id, template_id, spreadsheet_config_id, participant_name, match_id, score_data, status, event_id, bracket_game_id, seeding_score_id, score_type, game_queue_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.user_id ?? null,
      data.template_id,
      data.spreadsheet_config_id ?? null,
      data.participant_name ?? null,
      data.match_id ?? null,
      data.score_data,
      data.status ?? 'pending',
      data.event_id ?? null,
      data.bracket_game_id ?? null,
      data.seeding_score_id ?? null,
      data.score_type ?? null,
      data.game_queue_id ?? null,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedDocumentationScoreCategoryData {
  event_id: number;
  ordinal: number;
  name?: string;
  weight?: number;
  max_score: number;
}

export async function seedDocumentationScoreCategory(
  db: Database,
  data: SeedDocumentationScoreCategoryData,
): Promise<{ id: number }> {
  const name = data.name ?? `Category ${data.ordinal}`;
  const weight = data.weight ?? 1.0;
  const maxScore = data.max_score;

  let categoryId: number;
  const existing = await db.get(
    'SELECT id FROM documentation_categories WHERE name = ? AND weight = ? AND max_score = ?',
    [name, weight, maxScore],
  );
  if (existing) {
    categoryId = (existing as { id: number }).id;
  } else {
    const catResult = await db.run(
      'INSERT INTO documentation_categories (name, weight, max_score) VALUES (?, ?, ?)',
      [name, weight, maxScore],
    );
    categoryId = catResult.lastID!;
  }

  await db.run(
    'INSERT INTO event_documentation_categories (event_id, category_id, ordinal) VALUES (?, ?, ?)',
    [data.event_id, categoryId, data.ordinal],
  );
  return { id: categoryId };
}

export interface SeedDocumentationScoreData {
  event_id: number;
  team_id: number;
  overall_score?: number | null;
  scored_by?: number | null;
}

export async function seedDocumentationScore(
  db: Database,
  data: SeedDocumentationScoreData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO documentation_scores (event_id, team_id, overall_score, scored_by, scored_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      data.event_id,
      data.team_id,
      data.overall_score ?? null,
      data.scored_by ?? null,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedDocumentationSubScoreData {
  documentation_score_id: number;
  category_id: number;
  score: number;
}

export async function seedDocumentationSubScore(
  db: Database,
  data: SeedDocumentationSubScoreData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO documentation_sub_scores (documentation_score_id, category_id, score)
     VALUES (?, ?, ?)`,
    [data.documentation_score_id, data.category_id, data.score],
  );
  return { id: result.lastID! };
}

// ── Awards ──

export interface SeedAwardTemplateData {
  name?: string;
  description?: string | null;
}

export async function seedAwardTemplate(
  db: Database,
  data: SeedAwardTemplateData = {},
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO award_templates (name, description) VALUES (?, ?)`,
    [data.name ?? 'Test Award', data.description ?? null],
  );
  return { id: result.lastID! };
}

export interface SeedEventAwardData {
  event_id: number;
  name?: string;
  description?: string | null;
  template_award_id?: number | null;
  sort_order?: number;
}

export async function seedEventAward(
  db: Database,
  data: SeedEventAwardData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO event_awards (event_id, template_award_id, name, description, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.event_id,
      data.template_award_id ?? null,
      data.name ?? 'Test Event Award',
      data.description ?? null,
      data.sort_order ?? 0,
    ],
  );
  return { id: result.lastID! };
}

export interface SeedEventAwardRecipientData {
  event_award_id: number;
  team_id: number;
}

export async function seedEventAwardRecipient(
  db: Database,
  data: SeedEventAwardRecipientData,
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO event_award_recipients (event_award_id, team_id) VALUES (?, ?)`,
    [data.event_award_id, data.team_id],
  );
  return { id: result.lastID! };
}
