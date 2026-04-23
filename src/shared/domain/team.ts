/**
 * Canonical team domain enums, label maps, and validators.
 */

export const TEAM_STATUSES = [
  'registered',
  'checked_in',
  'no_show',
  'withdrawn',
] as const;

export type TeamStatus = (typeof TEAM_STATUSES)[number];

const TEAM_STATUS_SET: ReadonlySet<string> = new Set(TEAM_STATUSES);

export function isTeamStatus(value: unknown): value is TeamStatus {
  return typeof value === 'string' && TEAM_STATUS_SET.has(value);
}

export const TEAM_STATUS_LABELS: Record<TeamStatus, string> = {
  registered: 'Registered',
  checked_in: 'Checked In',
  no_show: 'No Show',
  withdrawn: 'Withdrawn',
};

/**
 * CSS-class hints for status badges/dots in the admin UI.
 * Kept here so all teams-status surfaces render consistent styling.
 */
export const TEAM_STATUS_BADGE_CLASSES: Record<TeamStatus, string> = {
  registered: 'status-registered',
  checked_in: 'status-checked-in',
  no_show: 'status-no-show',
  withdrawn: 'status-withdrawn',
};
