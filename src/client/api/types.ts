import type { EventStatus } from '../utils/eventStatus';

/**
 * Session user payload from GET /auth/user.
 * `name` and `isAdmin` are optional because the handler forwards those
 * fields from Passport as-is (`name`, `is_admin`).
 */
export interface SessionUser {
  id: number;
  email: string;
  name?: string;
  isAdmin?: boolean;
}

/**
 * Public event payload from GET /events/public.
 * Internal fields such as spectator_results_released are not included;
 * release state is exposed as final_scores_available.
 */
export interface PublicEvent {
  id: number;
  name: string;
  status: EventStatus | string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  double_seeding_rounds: number;
  final_scores_available: boolean;
}
