/**
 * Canonical `events.score_accept_mode` values.
 *
 * Mirrors the SQL CHECK constraint on `events.score_accept_mode` (see
 * `src/server/database/init.ts`).
 */
export const SCORE_ACCEPT_MODES = [
  'manual',
  'auto_accept_seeding',
  'auto_accept_all',
] as const;

export type ScoreAcceptMode = (typeof SCORE_ACCEPT_MODES)[number];

const SCORE_ACCEPT_MODE_SET = new Set<string>(SCORE_ACCEPT_MODES);

export function isValidScoreAcceptMode(
  value: unknown,
): value is ScoreAcceptMode {
  return typeof value === 'string' && SCORE_ACCEPT_MODE_SET.has(value);
}

export const SCORE_ACCEPT_MODE_LABELS: Record<ScoreAcceptMode, string> = {
  manual: 'Manual (admin reviews each score)',
  auto_accept_seeding: 'Auto-accept seeding scores only',
  auto_accept_all: 'Auto-accept all scores (seeding + bracket)',
};
