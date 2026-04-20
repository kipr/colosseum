import { EventStatus } from './eventStatus';

/**
 * Event statuses that should be hidden from public / spectator consumers.
 *
 * Used both server-side to gate REST endpoints and (transitively) client-side
 * via the predicates below to avoid divergence between layers.
 */
export const SPECTATOR_EXCLUDED_STATUSES: readonly EventStatus[] = ['archived'];

const SPECTATOR_EXCLUDED_SET = new Set<string>(SPECTATOR_EXCLUDED_STATUSES);

/**
 * Pure predicate: should an event with the given status be visible to
 * spectators / public consumers?
 */
export function isStatusSpectatorVisible(
  status: EventStatus | string,
): boolean {
  return !SPECTATOR_EXCLUDED_SET.has(status);
}

/**
 * Pure predicate: have final scores (documentation, bracket rankings, overall)
 * been released for spectator consumption?
 *
 * Final scores are released only when the event is `complete` *and* the admin
 * has flipped the spectator release flag.
 */
export function isFinalScoresReleasedFor(
  status: EventStatus | string,
  spectatorResultsReleased: boolean | number | null | undefined,
): boolean {
  return status === 'complete' && !!spectatorResultsReleased;
}
