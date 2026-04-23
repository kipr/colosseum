/**
 * Canonical score-submission domain enums and validators.
 */

export const SCORE_SUBMISSION_STATUSES = [
  'pending',
  'accepted',
  'rejected',
] as const;

export type ScoreSubmissionStatus = (typeof SCORE_SUBMISSION_STATUSES)[number];

const SCORE_SUBMISSION_STATUS_SET: ReadonlySet<string> = new Set(
  SCORE_SUBMISSION_STATUSES,
);

export function isScoreSubmissionStatus(
  value: unknown,
): value is ScoreSubmissionStatus {
  return typeof value === 'string' && SCORE_SUBMISSION_STATUS_SET.has(value);
}
