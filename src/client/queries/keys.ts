/**
 * Query keys are namespaced by authorization scope so cache entries cannot
 * leak across roles:
 * - `public` — unauthenticated spectator data
 * - `admin` — authenticated staff/admin data (added with those consumers)
 * - `judge` — access-code judge-session data (added with those consumers)
 *
 * Include every input that changes the response. Do not share entries across
 * namespaces unless the payload and authorization contract are identical.
 */
export const publicEventsKey = ['public', 'events'] as const;

export const publicEventsKeys = {
  all: () => publicEventsKey,
};
