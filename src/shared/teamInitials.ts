/**
 * Team initials: each participating team signs off on a scoresheet before the
 * judge submits it. Shared by the judge form, the admin views, and the submit
 * route so the rules (who must initial, what counts as valid) live in one place.
 */

/**
 * `team` is the single team on a seeding sheet. `team_a` / `team_b` are the
 * two sides of a bracket game or double-seeding match (team1 / team2).
 */
export const TEAM_INITIALS_SIDES = ['team', 'team_a', 'team_b'] as const;

export type TeamInitialsSide = (typeof TEAM_INITIALS_SIDES)[number];

export interface TeamInitialsEntry {
  side: TeamInitialsSide;
  initials: string;
}

export const TEAM_INITIALS_MIN_LENGTH = 2;
export const TEAM_INITIALS_MAX_LENGTH = 5;

/**
 * Field ids that older field templates used for initials as plain text fields.
 * The built-in initials panel replaces them; a sheet that still carries one is
 * treated as requiring initials.
 */
export const LEGACY_INITIALS_FIELD_IDS = [
  'side_a_team_initials',
  'side_b_team_initials',
  'team_a_team_initials',
  'team_b_team_initials',
] as const;

const LEGACY_INITIALS_FIELD_ID_SET = new Set<string>(LEGACY_INITIALS_FIELD_IDS);

const VALID_INITIALS_PATTERN = new RegExp(
  `^\\p{L}{${TEAM_INITIALS_MIN_LENGTH},${TEAM_INITIALS_MAX_LENGTH}}$`,
  'u',
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTeamInitialsSide(value: unknown): value is TeamInitialsSide {
  return (
    typeof value === 'string' &&
    (TEAM_INITIALS_SIDES as readonly string[]).includes(value)
  );
}

export function isLegacyInitialsField(field: unknown): boolean {
  return (
    isPlainObject(field) &&
    typeof field.id === 'string' &&
    LEGACY_INITIALS_FIELD_ID_SET.has(field.id)
  );
}

export function stripLegacyInitialsFields<T>(fields: T[]): T[] {
  return fields.filter((field) => !isLegacyInitialsField(field));
}

/**
 * Whether a scoresheet schema requires team initials. An explicit
 * `teamInitials.required` wins; otherwise a sheet built from a template with
 * legacy initials fields keeps requiring them.
 */
export function requiresTeamInitials(schema: unknown): boolean {
  if (!isPlainObject(schema)) return false;

  const setting = schema.teamInitials;
  if (isPlainObject(setting) && typeof setting.required === 'boolean') {
    return setting.required;
  }

  return (
    Array.isArray(schema.fields) && schema.fields.some(isLegacyInitialsField)
  );
}

/** Uppercase and drop the spacing and punctuation people put between letters. */
export function normalizeTeamInitials(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/[\s.-]/g, '')
    .toUpperCase();
}

/** Expects a value already passed through `normalizeTeamInitials`. */
export function isValidTeamInitials(normalized: string): boolean {
  return VALID_INITIALS_PATTERN.test(normalized);
}

export const TEAM_INITIALS_FORMAT_HINT = `${TEAM_INITIALS_MIN_LENGTH}–${TEAM_INITIALS_MAX_LENGTH} letters`;
