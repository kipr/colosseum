import { requestJson, requestJsonBody, requestVoid } from './http';
import type { AwardType } from '../../shared/awards';
import type { TeamAwardCounts } from '../../shared/awards';
import type {
  AutomaticAwardSettings,
  AutomaticAwardsPreviewResponse,
  AutomaticAwardsPublic,
  ApplyAutomaticAwardsResponse,
} from '../../shared/automaticAwards';

export interface AwardTemplate {
  id: number;
  name: string;
  description: string | null;
  award_type: AwardType;
}

export interface AwardRecipient {
  id: number;
  event_award_id: number;
  team_id: number;
  team_number: number;
  team_name: string;
}

export interface IndividualRecipient {
  id: number;
  event_award_id: number;
  name: string;
  team_id: number | null;
  team_number: number | null;
  team_name: string | null;
  display_name?: string | null;
}

export interface EventAward {
  id: number;
  event_id: number;
  template_award_id: number | null;
  name: string;
  description: string | null;
  award_type: AwardType;
  sort_order: number;
  recipients: AwardRecipient[];
  individual_recipients: IndividualRecipient[];
}

export interface PublicIndividualRecipient {
  name: string;
  team_number: number | null;
  team_name: string | null;
  display_name: string | null;
}

export interface PublicManualAward {
  name: string;
  description: string | null;
  sort_order: number;
  recipients: {
    team_number: number;
    team_name: string;
    display_name?: string | null;
  }[];
  individual_recipients: PublicIndividualRecipient[];
}

export interface PublicAwards {
  manual: PublicManualAward[];
  automatic: AutomaticAwardsPublic | null;
}

export interface AwardTemplateInput {
  name: string;
  description: string | null;
  award_type: AwardType;
}

export interface EventAwardInput {
  name?: string;
  description?: string | null;
  template_award_id?: number;
  award_type?: AwardType;
  sort_order?: number;
}

export function getAwardTemplates(signal?: AbortSignal) {
  return requestJson<AwardTemplate[]>('/awards/templates', { signal });
}

export function saveAwardTemplate({
  templateId,
  data,
}: {
  templateId?: number;
  data: AwardTemplateInput;
}) {
  return requestJsonBody<AwardTemplate>(
    templateId ? `/awards/templates/${templateId}` : '/awards/templates',
    templateId ? 'PATCH' : 'POST',
    data,
  );
}

export function deleteAwardTemplate({ templateId }: { templateId: number }) {
  return requestVoid(`/awards/templates/${templateId}`, { method: 'DELETE' });
}

export function getEventAwards(eventId: number, signal?: AbortSignal) {
  return requestJson<EventAward[]>(`/awards/event/${eventId}`, { signal }).then(
    (awards) =>
      awards.map((award) => ({
        ...award,
        recipients: award.recipients ?? [],
        individual_recipients: award.individual_recipients ?? [],
      })),
  );
}

export function saveEventAward({
  eventId,
  awardId,
  data,
}: {
  eventId: number;
  awardId?: number;
  data: EventAwardInput;
}) {
  return requestJsonBody<EventAward>(
    awardId ? `/awards/event-awards/${awardId}` : `/awards/event/${eventId}`,
    awardId ? 'PATCH' : 'POST',
    data,
  );
}

export function deleteEventAward({ awardId }: { awardId: number }) {
  return requestVoid(`/awards/event-awards/${awardId}`, { method: 'DELETE' });
}

export function getTeamAwardCounts(eventId: number, signal?: AbortSignal) {
  return requestJson<TeamAwardCounts[]>(
    `/awards/event/${eventId}/team-award-counts`,
    { signal },
  );
}

export function addAwardRecipients({
  awardId,
  teamIds,
}: {
  awardId: number;
  teamIds: number[];
}) {
  return requestJsonBody<unknown>(
    `/awards/event-awards/${awardId}/recipients`,
    'POST',
    { team_ids: teamIds },
  );
}

export function removeAwardRecipient({
  awardId,
  teamId,
}: {
  awardId: number;
  teamId: number;
}) {
  return requestVoid(`/awards/event-awards/${awardId}/recipients/${teamId}`, {
    method: 'DELETE',
  });
}

export function addIndividualRecipient({
  awardId,
  name,
  teamId,
}: {
  awardId: number;
  name: string;
  teamId?: number;
}) {
  return requestJsonBody<unknown>(
    `/awards/event-awards/${awardId}/individual-recipients`,
    'POST',
    { name, ...(teamId != null ? { team_id: teamId } : {}) },
  );
}

export function removeIndividualRecipient({
  awardId,
  recipientId,
}: {
  awardId: number;
  recipientId: number;
}) {
  return requestVoid(
    `/awards/event-awards/${awardId}/individual-recipients/${recipientId}`,
    { method: 'DELETE' },
  );
}

function previewParams(settings?: AutomaticAwardSettings): string {
  if (!settings) return '';
  const params = new URLSearchParams({
    de_top_n: String(settings.de_top_n),
    per_bracket_overall_top_n: String(settings.per_bracket_overall_top_n),
    seeding_top_n: String(settings.seeding_top_n),
    de_award_type: settings.de_award_type,
    per_bracket_overall_award_type: settings.per_bracket_overall_award_type,
    seeding_award_type: settings.seeding_award_type,
  });
  return `?${params.toString()}`;
}

export function getAutomaticAwardPreview(
  eventId: number,
  settings?: AutomaticAwardSettings,
  signal?: AbortSignal,
) {
  return requestJson<AutomaticAwardsPreviewResponse>(
    `/awards/event/${eventId}/automatic/preview${previewParams(settings)}`,
    { signal },
  );
}

export function applyAutomaticAwards({
  eventId,
  data,
}: {
  eventId: number;
  data: AutomaticAwardSettings & { acknowledge_warnings?: boolean };
}) {
  return requestJsonBody<ApplyAutomaticAwardsResponse>(
    `/awards/event/${eventId}/automatic`,
    'POST',
    data,
  );
}

export function getPublicAwards(eventId: number, signal?: AbortSignal) {
  return requestJson<PublicAwards>(`/awards/event/${eventId}/public`, {
    signal,
  }).then((data) => ({
    manual: (data.manual ?? []).map((award) => ({
      ...award,
      recipients: award.recipients ?? [],
      individual_recipients: award.individual_recipients ?? [],
    })),
    automatic: data.automatic ?? null,
  }));
}

export interface AwardReorderResult {
  awardId: number;
  ok: boolean;
  error?: string;
}

export async function reorderEventAwards({
  updates,
}: {
  updates: { awardId: number; sort_order: number }[];
}): Promise<AwardReorderResult[]> {
  return Promise.all(
    updates.map(async (update) => {
      try {
        await saveEventAward({
          eventId: 0,
          awardId: update.awardId,
          data: { sort_order: update.sort_order },
        });
        return { awardId: update.awardId, ok: true };
      } catch (error) {
        return {
          awardId: update.awardId,
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to reorder',
        };
      }
    }),
  );
}
