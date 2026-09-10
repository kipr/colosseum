/**
 * Team-initials certification for event-scoped scoresheets.
 *
 * Initials are client chrome (like match result / winner), not scoring fields.
 * They are still persisted in score_data under stable ids so historical rows
 * and the admin score viewer keep working.
 */

export type EventScoreType = 'seeding' | 'bracket' | 'double_seeding';

export const SEEDING_TEAM_INITIALS_ID = 'side_a_team_initials';
export const TEAM_A_INITIALS_ID = 'team_a_team_initials';
export const TEAM_B_INITIALS_ID = 'team_b_team_initials';
export const LEGACY_SIDE_B_INITIALS_ID = 'side_b_team_initials';

export const TEAM_INITIALS_FIELD_IDS = [
  SEEDING_TEAM_INITIALS_ID,
  LEGACY_SIDE_B_INITIALS_ID,
  TEAM_A_INITIALS_ID,
  TEAM_B_INITIALS_ID,
] as const;

const TEAM_INITIALS_FIELD_ID_SET: ReadonlySet<string> = new Set(
  TEAM_INITIALS_FIELD_IDS,
);

const TEAM_INITIALS_ALIASES: Record<string, readonly string[]> = {
  [SEEDING_TEAM_INITIALS_ID]: [SEEDING_TEAM_INITIALS_ID, TEAM_A_INITIALS_ID],
  [TEAM_A_INITIALS_ID]: [TEAM_A_INITIALS_ID, SEEDING_TEAM_INITIALS_ID],
  [TEAM_B_INITIALS_ID]: [TEAM_B_INITIALS_ID, LEGACY_SIDE_B_INITIALS_ID],
};

export interface TeamInitialsSlot {
  id: string;
  label: string;
}

export interface TeamInitialsScoreEntry {
  label: string;
  value: string;
  type: 'text';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTeamInitialsFieldId(id: string | undefined | null): boolean {
  return id != null && TEAM_INITIALS_FIELD_ID_SET.has(id);
}

export function stripTeamInitialsFields<T extends { id?: string }>(
  fields: T[] | null | undefined,
): T[] {
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields.filter((field) => !isTeamInitialsFieldId(field?.id));
}

export function isEventScopedScoresheet(schema: unknown): boolean {
  if (!isPlainObject(schema)) {
    return false;
  }
  const eventId = Number(schema.eventId);
  return (
    Number.isInteger(eventId) && eventId > 0 && schema.scoreDestination === 'db'
  );
}

/**
 * Show / require the client certification UI.
 * Event-scoped sheets always require initials. Non-event sheets can opt in
 * with `requireTeamInitials: true` (e.g. portable export).
 */
export function shouldRequireTeamInitials(schema: unknown): boolean {
  if (isEventScopedScoresheet(schema)) {
    return true;
  }
  return isPlainObject(schema) && schema.requireTeamInitials === true;
}

export function inferEventScoreType(schema: unknown): EventScoreType | null {
  if (!shouldRequireTeamInitials(schema) || !isPlainObject(schema)) {
    return null;
  }
  if (schema.mode === 'head-to-head') {
    return 'bracket';
  }
  if (schema.scoreKind === 'double_seeding') {
    return 'double_seeding';
  }
  return 'seeding';
}

export function getRequiredTeamInitialsSlots(input: {
  scoreType: EventScoreType;
  hasTeamB?: boolean;
}): TeamInitialsSlot[] {
  if (input.scoreType === 'seeding') {
    return [{ id: SEEDING_TEAM_INITIALS_ID, label: 'Team Initials' }];
  }

  const slots: TeamInitialsSlot[] = [
    { id: TEAM_A_INITIALS_ID, label: 'Team A Initials' },
  ];
  if (input.hasTeamB !== false) {
    slots.push({ id: TEAM_B_INITIALS_ID, label: 'Team B Initials' });
  }
  return slots;
}

export function readScoreDataText(scoreData: unknown, fieldId: string): string {
  if (!isPlainObject(scoreData)) {
    return '';
  }
  const entry = scoreData[fieldId];
  if (typeof entry === 'string' || typeof entry === 'number') {
    return String(entry).trim();
  }
  if (isPlainObject(entry) && entry.value != null) {
    return String(entry.value).trim();
  }
  return '';
}

export function readTeamInitialsValue(
  scoreData: unknown,
  slotId: string,
): string {
  const aliases = TEAM_INITIALS_ALIASES[slotId] ?? [slotId];
  for (const id of aliases) {
    const value = readScoreDataText(scoreData, id);
    if (value) {
      return value;
    }
  }
  return '';
}

export function getMissingTeamInitialsError(
  scoreData: unknown,
  slots: TeamInitialsSlot[],
): string | null {
  const missing = slots.filter(
    (slot) => !readTeamInitialsValue(scoreData, slot.id),
  );
  if (missing.length === 0) {
    return null;
  }
  if (missing.length === 1) {
    return `${missing[0].label} are required`;
  }
  return 'Team initials are required for each participating team';
}

export function buildTeamInitialsScoreEntries(
  values: Record<string, unknown>,
  slots: TeamInitialsSlot[],
): Record<string, TeamInitialsScoreEntry> {
  const entries: Record<string, TeamInitialsScoreEntry> = {};
  slots.forEach((slot) => {
    entries[slot.id] = {
      label: slot.label,
      value: String(values[slot.id] ?? '').trim(),
      type: 'text',
    };
  });
  return entries;
}

export function portableTeamInitialsFields(): Array<{
  id: string;
  label: string;
  type: 'text';
  required: true;
  column: 'left';
  placeholder: string;
}> {
  return [
    {
      id: SEEDING_TEAM_INITIALS_ID,
      label: 'Team Initials',
      type: 'text',
      required: true,
      column: 'left',
      placeholder: 'Initials of team representative',
    },
  ];
}
