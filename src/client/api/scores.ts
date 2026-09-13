import { requestJson, requestVoid, ApiError } from './http';
import type { BracketResultType } from '../../shared/bracketResult';

export type ScoreStatus = 'pending' | 'accepted' | 'rejected';
export type ScoreType = 'seeding' | 'bracket' | 'double_seeding';

export interface ScoreFieldValue {
  // Scoresheet values follow the template schema rather than a fixed DTO.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  label?: string;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  derived?: { rows?: any };
}

export type ScoreData = Record<string, ScoreFieldValue>;

export interface ScoreSubmission {
  id: number;
  template_id: number;
  template_name: string;
  participant_name: string;
  match_id: string;
  created_at: string;
  status: ScoreStatus | string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  score_data: ScoreData;
  result_type: BracketResultType;
  disqualified_team_id: number | null;
  result_note: string | null;
  event_id?: number;
  score_type?: ScoreType;
  bracket_game_id?: number;
  seeding_score_id?: number;
  double_seeding_match_id?: number;
  game_queue_id?: number;
  submitted_by?: string;
  team_display_number?: string;
  team_name?: string;
  bracket_name?: string;
  game_number?: number;
  queue_position?: number;
  seeding_round?: number;
  bracket_team1_id?: number | null;
  bracket_team2_id?: number | null;
  bracket_team1_score?: number | null;
  bracket_team2_score?: number | null;
  bracket_team1_number?: number | null;
  bracket_team1_name?: string | null;
  bracket_team1_display?: string | null;
  bracket_team2_number?: number | null;
  bracket_team2_name?: string | null;
  bracket_team2_display?: string | null;
  bracket_winner_number?: number | null;
  bracket_winner_name?: string | null;
  bracket_winner_display?: string | null;
  double_seeding_round?: number | null;
  double_seeding_match_number?: number | null;
  double_seeding_team1_id?: number | null;
  double_seeding_team2_id?: number | null;
  double_seeding_team1_number?: number | null;
  double_seeding_team1_name?: string | null;
  double_seeding_team1_display?: string | null;
  double_seeding_team2_number?: number | null;
  double_seeding_team2_name?: string | null;
  double_seeding_team2_display?: string | null;
}

export interface EventScoresResponse {
  rows: ScoreSubmission[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface ScoreListFilters {
  page: number;
  limit: number;
  status?: string | null;
  scoreType?: string | null;
}

export interface ScoreAcceptConflict {
  error?: string;
  existingScore?: number;
  newScore?: number;
  existingWinnerId?: number;
  newWinnerId?: number;
  existingResultType?: string;
  newResultType?: string;
}

export interface ScoreAcceptResult {
  success: true;
  scoreType?: string;
  advanced?: boolean;
  advancedTo?: number;
}

export interface AffectedGame {
  id: number;
  game_number: number;
  round_name: string;
  affectedSlot: 'team1' | 'team2' | 'winner';
}

export interface RevertPreview {
  requiresConfirmation: boolean;
  affectedGames?: AffectedGame[];
}

export interface RevertResult {
  revertedGames?: number;
}

export interface BulkAcceptResult {
  accepted: number;
  accepted_ids?: number[];
  skipped?: { id: number; reason: string }[];
}

export interface JudgeScoreSubmitInput {
  templateId: number;
  participantName: string;
  matchId: string;
  scoreData: ScoreData;
  isHeadToHead: boolean;
  bracketSource?: unknown;
  eventId?: number;
  scoreType?: ScoreType;
  game_queue_id?: number;
  bracket_game_id?: number;
  double_seeding_match_id?: number;
  resultType?: BracketResultType;
  disqualifiedTeamId?: number;
  resultNote?: string;
}

export interface UpdateScoreInput {
  scoreId: number;
  scoreData: ScoreData;
  resultType: BracketResultType;
  disqualifiedTeamId: number | null;
  resultNote: string | null;
}

export function getEventScores(
  eventId: number,
  filters: ScoreListFilters,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.scoreType) params.set('score_type', filters.scoreType);
  return requestJson<EventScoresResponse>(
    `/scores/by-event/${eventId}?${params.toString()}`,
    { signal },
  );
}

export function acceptEventScore({
  scoreId,
  force = false,
}: {
  scoreId: number;
  force?: boolean;
}) {
  return requestJson<ScoreAcceptResult>(`/scores/${scoreId}/accept-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
}

export function revertEventScore({
  scoreId,
  dryRun,
  confirm,
}: {
  scoreId: number;
  dryRun?: boolean;
  confirm?: boolean;
}) {
  return requestJson<RevertPreview & RevertResult>(
    `/scores/${scoreId}/revert-event`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, confirm }),
    },
  );
}

export function rejectScore({ scoreId }: { scoreId: number }) {
  return requestVoid(`/scores/${scoreId}/reject`, { method: 'POST' });
}

export function bulkAcceptEventScores({
  eventId,
  scoreIds,
}: {
  eventId: number;
  scoreIds: number[];
}) {
  return requestJson<BulkAcceptResult>(`/scores/event/${eventId}/accept/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score_ids: scoreIds }),
  });
}

export function updateScore({
  scoreId,
  scoreData,
  resultType,
  disqualifiedTeamId,
  resultNote,
}: UpdateScoreInput) {
  return requestVoid(`/scores/${scoreId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scoreData,
      resultType,
      disqualifiedTeamId,
      resultNote,
    }),
  });
}

export function submitJudgeScore(input: JudgeScoreSubmitInput) {
  return requestJson<ScoreSubmission>('/api/scores/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function isScoreAcceptConflict(
  error: unknown,
): error is ApiError & { body: ScoreAcceptConflict } {
  return error instanceof ApiError && error.status === 409;
}

export function scoreAcceptConflictFrom(error: ApiError): ScoreAcceptConflict {
  return error.body && typeof error.body === 'object'
    ? (error.body as ScoreAcceptConflict)
    : { error: error.message };
}
