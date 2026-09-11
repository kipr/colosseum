import type { EventStatus } from '../utils/eventStatus';

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
