/**
 * Query keys are namespaced by authorization scope so cache entries cannot
 * leak across roles:
 * - `public` — unauthenticated spectator data
 * - `admin` — authenticated staff/admin data (this namespace includes
 *   authenticated staff; it does not imply an `isAdmin` permission check)
 * - `judge` — access-code judge-session data (added with those consumers)
 *
 * Include every input that changes the response. Do not share entries across
 * namespaces unless the payload and authorization contract are identical.
 */
export const publicEventsKey = ['public', 'events'] as const;

export const publicEventsKeys = {
  all: () => publicEventsKey,
};

export const authUserKey = ['auth', 'user'] as const;

export const judgeScopeKey = ['judge'] as const;

export function normalizeUserId(userId: number | string): number {
  return Number(userId);
}

export function adminScopeKey(userId: number | string) {
  return ['admin', normalizeUserId(userId)] as const;
}

export function adminEventsKey(userId: number | string) {
  return [...adminScopeKey(userId), 'events'] as const;
}

export const adminKeys = {
  scope: adminScopeKey,
  events: adminEventsKey,
};

export function adminEventKey(
  userId: number | string,
  eventId: number | string,
) {
  return [...adminScopeKey(userId), 'event', Number(eventId)] as const;
}

export function publicEventKey(eventId: number | string) {
  return ['public', 'event', Number(eventId)] as const;
}

export const publicTemplatesKey = ['public', 'templates'] as const;
export const teamsKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'teams'] as const;
export const templatesKey = (userId: number) =>
  [...adminScopeKey(userId), 'templates'] as const;
export const templateDetailKey = (userId: number, templateId: number) =>
  [...adminScopeKey(userId), 'template', Number(templateId)] as const;
export const fieldTemplatesKey = (userId: number) =>
  [...adminScopeKey(userId), 'field-templates'] as const;
export const seedingKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'seeding'] as const;
export const doubleSeedingKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'double-seeding'] as const;
export const overallKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'overall'] as const;
export const bracketsKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'brackets'] as const;
export const bracketKey = (
  userId: number,
  eventId: number,
  bracketId: number,
) => [...adminEventKey(userId, eventId), 'bracket', Number(bracketId)] as const;
export const assignedTeamsKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'assigned-teams'] as const;
export const documentationKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'documentation'] as const;
export const globalDocCategoriesKey = (userId: number) =>
  [...adminScopeKey(userId), 'documentation-global-categories'] as const;
export const awardsKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'awards'] as const;
export const awardTemplatesKey = (userId: number) =>
  [...adminScopeKey(userId), 'award-templates'] as const;
export const auditKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'audit'] as const;
export const auditEntityKey = (
  userId: number,
  entityType: string,
  entityId: number,
) => [...adminScopeKey(userId), 'audit-entity', entityType, entityId] as const;

export const scoresKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'scores'] as const;
export const queueKey = (userId: number, eventId: number) =>
  [...adminEventKey(userId, eventId), 'queue'] as const;
export const judgeSessionKey = (generation: string) =>
  [...judgeScopeKey, generation] as const;
export const judgeEventKey = (generation: string, eventId: number) =>
  [...judgeSessionKey(generation), 'event', Number(eventId)] as const;

export interface ScoreListKeyFilters {
  page: number;
  limit: number;
  status: string | null;
  scoreType: string | null;
}

export interface QueueKeyFilters {
  statuses: string[];
  queueType: string | null;
}

export function normalizeScoreListFilters(filters: {
  page: number;
  limit: number;
  status?: string | null;
  scoreType?: string | null;
}): ScoreListKeyFilters {
  return {
    page: Number(filters.page),
    limit: Number(filters.limit),
    status: filters.status || null,
    scoreType: filters.scoreType || null,
  };
}

export function normalizeQueueFilters(filters: {
  statuses?: readonly string[];
  queueType?: string | null;
}): QueueKeyFilters {
  return {
    statuses: [...(filters.statuses ?? [])].sort(),
    queueType:
      filters.queueType && filters.queueType !== 'all'
        ? filters.queueType
        : null,
  };
}
