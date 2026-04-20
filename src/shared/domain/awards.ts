/**
 * Public-facing shapes for the combined awards endpoint
 * (`GET /awards/event/:eventId/public`).
 *
 * Manual awards are admin-curated rows from `event_awards` (excluding
 * auto-generated entries). Automatic awards are derived at read time from
 * scores/rankings — see {@link AutomaticAwardsPublic}.
 */

import type { AutomaticAwardsPublic, PublicAwardTeam } from './automaticAwards';

export type PublicAwardRecipient = PublicAwardTeam;

export interface PublicManualAward {
  name: string;
  description: string | null;
  sort_order: number;
  recipients: PublicAwardRecipient[];
}

export interface PublicEventAwardsResponse {
  manual: PublicManualAward[];
  automatic: AutomaticAwardsPublic;
}
