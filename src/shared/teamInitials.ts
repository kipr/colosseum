/**
 * Team initials sign-off for judge score sheets.
 *
 * Initials are a score-sheet-level requirement (not a template field): each
 * participating team's representative initials the sheet to acknowledge the
 * submitted outcome, whatever the result type. Client and server share these
 * rules so the browser cannot be the only line of enforcement.
 */

export const TEAM_INITIALS_SLOTS = ['team_a', 'team_b'] as const;

export type TeamInitialsSlot = (typeof TEAM_INITIALS_SLOTS)[number];

export type TeamInitials = Partial<Record<TeamInitialsSlot, string>>;

export type TeamInitialsScoreType = 'seeding' | 'bracket' | 'double_seeding';

export const TEAM_INITIALS_MAX_LENGTH = 4;

const VALID_INITIALS_PATTERN = new RegExp(
  `^\\p{L}{1,${TEAM_INITIALS_MAX_LENGTH}}$`,
  'u',
);

/**
 * Field ids that older templates used to model initials as ordinary text
 * fields. Schemas carrying them are treated as requiring initials, and the
 * fields themselves are superseded by the built-in sign-off block.
 */
export const LEGACY_TEAM_INITIALS_FIELD_IDS = [
  'side_a_team_initials',
  'side_b_team_initials',
  'team_a_team_initials',
  'team_b_team_initials',
] as const;

const LEGACY_FIELD_SLOTS: Record<string, TeamInitialsSlot> = {
  side_a_team_initials: 'team_a',
  team_a_team_initials: 'team_a',
  side_b_team_initials: 'team_b',
  team_b_team_initials: 'team_b',
};

export function isLegacyTeamInitialsField(field: unknown): boolean {
  if (!field || typeof field !== 'object') return false;
  const id = (field as { id?: unknown }).id;
  return typeof id === 'string' && id in LEGACY_FIELD_SLOTS;
}

export function normalizeTeamInitials(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\s.]+/g, '').toUpperCase();
}

export function isValidTeamInitials(normalized: string): boolean {
  return VALID_INITIALS_PATTERN.test(normalized);
}

/**
 * Whether a score sheet schema requires team initials. An explicit
 * `requireTeamInitials` boolean wins; otherwise schemas that still carry the
 * legacy initials fields keep requiring them.
 */
export function isTeamInitialsRequired(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const { requireTeamInitials, fields } = schema as {
    requireTeamInitials?: unknown;
    fields?: unknown;
  };
  if (typeof requireTeamInitials === 'boolean') {
    return requireTeamInitials;
  }
  return Array.isArray(fields) && fields.some(isLegacyTeamInitialsField);
}

/**
 * Which teams must initial a submission. Seeding has a single team (stored in
 * the `team_a` slot); double seeding only needs `team_b` when the match has a
 * second team.
 */
export function getRequiredTeamInitialsSlots(options: {
  scoreType: TeamInitialsScoreType | null | undefined;
  hasTeamB?: boolean;
}): TeamInitialsSlot[] {
  switch (options.scoreType) {
    case 'seeding':
      return ['team_a'];
    case 'bracket':
      return ['team_a', 'team_b'];
    case 'double_seeding':
      return options.hasTeamB ? ['team_a', 'team_b'] : ['team_a'];
    default:
      return [];
  }
}

export interface TeamInitialsValidationResult {
  ok: boolean;
  initials: TeamInitials;
  errors: Partial<Record<TeamInitialsSlot, string>>;
}

export function validateTeamInitials(
  input: unknown,
  requiredSlots: readonly TeamInitialsSlot[],
): TeamInitialsValidationResult {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const initials: TeamInitials = {};
  const errors: Partial<Record<TeamInitialsSlot, string>> = {};

  TEAM_INITIALS_SLOTS.forEach((slot) => {
    const normalized = normalizeTeamInitials(source[slot]);

    if (!requiredSlots.includes(slot)) {
      if (normalized) {
        errors[slot] = 'Initials are not expected for this team.';
      }
      return;
    }

    if (!normalized) {
      errors[slot] = 'Team initials are required.';
    } else if (!isValidTeamInitials(normalized)) {
      errors[slot] = `Initials must be 1–${TEAM_INITIALS_MAX_LENGTH} letters.`;
    } else {
      initials[slot] = normalized;
    }
  });

  return { ok: Object.keys(errors).length === 0, initials, errors };
}

/**
 * Initials recorded on a submission: the dedicated columns, falling back to
 * legacy initials text fields stored inside score_data.
 */
export function getSubmissionTeamInitials(submission: {
  team_a_initials?: string | null;
  team_b_initials?: string | null;
  score_data?: unknown;
}): TeamInitials {
  const initials: TeamInitials = {};
  if (submission.team_a_initials) initials.team_a = submission.team_a_initials;
  if (submission.team_b_initials) initials.team_b = submission.team_b_initials;

  const scoreData = parseScoreData(submission.score_data);
  if (scoreData) {
    Object.entries(LEGACY_FIELD_SLOTS).forEach(([fieldId, slot]) => {
      if (initials[slot]) return;
      const entry = scoreData[fieldId];
      const value =
        entry && typeof entry === 'object' && 'value' in entry
          ? (entry as { value: unknown }).value
          : undefined;
      if (typeof value === 'string' && value.trim()) {
        initials[slot] = value.trim();
      }
    });
  }

  return initials;
}

function parseScoreData(scoreData: unknown): Record<string, unknown> | null {
  if (typeof scoreData === 'string') {
    try {
      const parsed = JSON.parse(scoreData);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return scoreData && typeof scoreData === 'object'
    ? (scoreData as Record<string, unknown>)
    : null;
}

/**
 * Slots whose initials a submission should carry but does not. Empty when the
 * sheet does not require initials.
 */
export function getMissingTeamInitialsSlots(options: {
  schema: unknown;
  scoreType: TeamInitialsScoreType | null | undefined;
  hasTeamB?: boolean;
  submission: Parameters<typeof getSubmissionTeamInitials>[0];
}): TeamInitialsSlot[] {
  if (!isTeamInitialsRequired(options.schema)) return [];
  const recorded = getSubmissionTeamInitials(options.submission);
  return getRequiredTeamInitialsSlots(options).filter(
    (slot) => !recorded[slot],
  );
}
