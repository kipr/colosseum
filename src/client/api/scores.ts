import {
  requestJson,
  requestVoid,
  requestJsonBody,
  requestVoidBody,
  ApiError,
} from './http';
import type { BracketResultType } from '../../shared/bracketResult';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ScoreStatus = 'pending' | 'accepted' | 'rejected';
export type ScoreType = 'seeding' | 'bracket' | 'double_seeding';

export type ScoreData = Record<string, any>;

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
  [key: string]: any;
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
  sessionGeneration?: string;
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
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(filters.limit),
  });
  if (filters.status) params.set('status', filters.status);
  if (filters.scoreType) params.set('score_type', filters.scoreType);
  return requestJson<EventScoresResponse>(
    `/scores/by-event/${eventId}?${params.toString()}`,
    { signal },
  );
}

export function acceptEventScore(v: { scoreId: number; force?: boolean }) {
  return requestJsonBody<ScoreAcceptResult>(
    `/scores/${v.scoreId}/accept-event`,
    'POST',
    { force: v.force ?? false },
  );
}

export function revertEventScore(v: {
  scoreId: number;
  dryRun?: boolean;
  confirm?: boolean;
}) {
  return requestJsonBody<RevertPreview>(
    `/scores/${v.scoreId}/revert-event`,
    'POST',
    {
      dryRun: v.dryRun,
      confirm: v.confirm,
    },
  );
}

export const rejectScore = (v: { scoreId: number }) =>
  requestVoid(`/scores/${v.scoreId}/reject`, { method: 'POST' });

export function bulkAcceptEventScores(v: {
  eventId: number;
  scoreIds: number[];
}) {
  return requestJsonBody<BulkAcceptResult>(
    `/scores/event/${v.eventId}/accept/bulk`,
    'POST',
    { score_ids: v.scoreIds },
  );
}

export function updateScore(v: UpdateScoreInput) {
  return requestVoidBody(`/scores/${v.scoreId}`, 'PUT', {
    scoreData: v.scoreData,
    resultType: v.resultType,
    disqualifiedTeamId: v.disqualifiedTeamId,
    resultNote: v.resultNote,
  });
}

export function submitJudgeScore(input: JudgeScoreSubmitInput) {
  const payload = { ...input };
  delete payload.sessionGeneration;
  return requestJsonBody<ScoreSubmission>(
    '/api/scores/submit',
    'POST',
    payload,
  );
}

export const isScoreAcceptConflict = (
  error: unknown,
): error is ApiError & { body: ScoreAcceptConflict } =>
  error instanceof ApiError && error.status === 409;

export function scoreAcceptConflictFrom(error: ApiError): ScoreAcceptConflict {
  return error.body && typeof error.body === 'object'
    ? (error.body as ScoreAcceptConflict)
    : { error: error.message };
}
