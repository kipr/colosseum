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
