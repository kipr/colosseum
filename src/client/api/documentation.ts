import { requestJson, requestJsonBody, requestVoid } from './http';

export interface DocCategory {
  id: number;
  event_id: number;
  ordinal: number;
  name: string;
  weight: number;
  max_score: number;
}

export interface GlobalDocCategory {
  id: number;
  name: string;
  weight: number;
  max_score: number;
}

export interface DocSubScore {
  category_id: number;
  category_name: string;
  ordinal: number;
  max_score: number;
  weight: number;
  score: number;
}

export interface DocScore {
  id: number;
  event_id: number;
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  overall_score: number | null;
  scored_at: string | null;
  sub_scores?: DocSubScore[];
}

export interface PublicDocumentation {
  categories: Omit<DocCategory, 'event_id'>[];
  scores: Omit<DocScore, 'id' | 'event_id' | 'scored_at'>[];
}

export interface DocSubScoreInput {
  category_id: number;
  score: number;
}

export function getGlobalDocCategories(signal?: AbortSignal) {
  return requestJson<GlobalDocCategory[]>(
    '/documentation-scores/global-categories',
    { signal },
  );
}

export function getDocCategories(eventId: number, signal?: AbortSignal) {
  return requestJson<DocCategory[]>(
    `/documentation-scores/categories/event/${eventId}`,
    { signal },
  );
}

export function getDocScores(eventId: number, signal?: AbortSignal) {
  return requestJson<DocScore[]>(`/documentation-scores/event/${eventId}`, {
    signal,
  });
}

export function getPublicDocumentation(eventId: number, signal?: AbortSignal) {
  return requestJson<PublicDocumentation>(
    `/documentation-scores/event/${eventId}/public`,
    { signal },
  );
}

export function saveDocCategory({
  event_id,
  ordinal,
  name,
  weight,
  max_score,
  category_id,
}: {
  event_id: number;
  ordinal: number;
  name?: string;
  weight?: number;
  max_score?: number;
  category_id?: number;
}) {
  return requestJsonBody<DocCategory>(
    '/documentation-scores/categories',
    'POST',
    {
      event_id,
      ordinal,
      name,
      weight,
      max_score,
      category_id,
    },
  );
}

export function updateDocCategoryOrdinal({
  categoryId,
  eventId,
  ordinal,
}: {
  categoryId: number;
  eventId: number;
  ordinal: number;
}) {
  return requestJsonBody<DocCategory>(
    `/documentation-scores/categories/${categoryId}?event_id=${eventId}`,
    'PATCH',
    { ordinal },
  );
}

export function deleteDocCategory({
  categoryId,
  eventId,
}: {
  categoryId: number;
  eventId: number;
}) {
  return requestVoid(
    `/documentation-scores/categories/${categoryId}?event_id=${eventId}`,
    { method: 'DELETE' },
  );
}

export function saveDocTeamScore({
  eventId,
  teamId,
  sub_scores,
}: {
  eventId: number;
  teamId: number;
  sub_scores: DocSubScoreInput[];
}) {
  return requestJsonBody<DocScore>(
    `/documentation-scores/event/${eventId}/team/${teamId}`,
    'PUT',
    { sub_scores },
  );
}

export function clearDocTeamScore({
  eventId,
  teamId,
}: {
  eventId: number;
  teamId: number;
}) {
  return requestVoid(`/documentation-scores/event/${eventId}/team/${teamId}`, {
    method: 'DELETE',
  });
}

export interface DocImportRowResult {
  index: number;
  ok: boolean;
  error?: string;
}

export async function importDocTeamScores({
  eventId,
  rows,
}: {
  eventId: number;
  rows: { teamId: number; sub_scores: DocSubScoreInput[]; index: number }[];
}): Promise<DocImportRowResult[]> {
  const results: DocImportRowResult[] = [];
  for (const row of rows) {
    try {
      await saveDocTeamScore({
        eventId,
        teamId: row.teamId,
        sub_scores: row.sub_scores,
      });
      results.push({ index: row.index, ok: true });
    } catch (error) {
      results.push({
        index: row.index,
        ok: false,
        error: error instanceof Error ? error.message : 'request failed',
      });
    }
  }
  return results;
}
