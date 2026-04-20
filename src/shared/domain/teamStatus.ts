/**
 * Canonical `teams.status` values.
 *
 * Mirrors the SQL CHECK constraint on `teams.status` (see
 * `src/server/database/init.ts`).
 */
export const TEAM_STATUSES = [
  'registered',
  'checked_in',
  'no_show',
  'withdrawn',
] as const;

export type TeamStatus = (typeof TEAM_STATUSES)[number];

const TEAM_STATUS_SET = new Set<string>(TEAM_STATUSES);

export function isValidTeamStatus(value: unknown): value is TeamStatus {
  return typeof value === 'string' && TEAM_STATUS_SET.has(value);
}

export const TEAM_STATUS_LABELS: Record<TeamStatus, string> = {
  registered: 'Registered',
  checked_in: 'Checked In',
  no_show: 'No Show',
  withdrawn: 'Withdrawn',
};

/** CSS class name for a team status badge. */
export const TEAM_STATUS_CLASSES: Record<TeamStatus, string> = {
  registered: 'status-registered',
  checked_in: 'status-checked-in',
  no_show: 'status-no-show',
  withdrawn: 'status-withdrawn',
};

export function getTeamStatusClass(status: TeamStatus | string): string {
  return isValidTeamStatus(status) ? TEAM_STATUS_CLASSES[status] : '';
}
