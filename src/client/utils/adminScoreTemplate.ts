/**
 * Resolve the scoresheet template for the admin score view.
 *
 * The public GET /scoresheet/templates list is judge-facing: it only includes
 * templates linked to setup/active events. Admins still need to open scores
 * for complete/archived events, so this loads GET /scoresheet/templates/:id
 * (auth) instead of matching against that list.
 *
 * ID comparison is string-based so number vs string IDs from Postgres/`pg`
 * still match in the name-based fallback.
 */

export type ScoreTemplateRef = {
  template_id?: unknown;
  template_name?: string | null;
};

export type NamedTemplate = {
  id: unknown;
  name?: string;
};

type FetchLike = (
  input: string,
  init?: { credentials?: RequestCredentials },
) => Promise<Response>;

export function templateIdsMatch(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  const left = String(a).trim();
  const right = String(b).trim();
  if (left === '' || right === '') return false;
  return left === right;
}

export function findTemplateForScore<T extends NamedTemplate>(
  templates: T[],
  score: ScoreTemplateRef,
): T | undefined {
  const byId = templates.find((template) =>
    templateIdsMatch(template.id, score.template_id),
  );
  if (byId) return byId;
  const name = score.template_name?.trim();
  if (!name) return undefined;
  return templates.find((template) => template.name === name);
}

export async function loadAdminScoreTemplate(
  score: ScoreTemplateRef,
  fetchImpl: FetchLike = fetch,
): Promise<unknown | null> {
  const templateId = score.template_id;
  if (templateId != null && String(templateId).trim() !== '') {
    const byId = await fetchImpl(`/scoresheet/templates/${templateId}`, {
      credentials: 'include',
    });
    if (byId.ok) {
      return byId.json();
    }
  }

  const listRes = await fetchImpl('/scoresheet/templates/admin', {
    credentials: 'include',
  });
  if (!listRes.ok) {
    return null;
  }

  const templates = (await listRes.json()) as NamedTemplate[];
  if (!Array.isArray(templates)) {
    return null;
  }

  const found = findTemplateForScore(templates, score);
  if (!found) {
    return null;
  }

  const schemaRes = await fetchImpl(`/scoresheet/templates/${found.id}`, {
    credentials: 'include',
  });
  if (!schemaRes.ok) {
    return null;
  }
  return schemaRes.json();
}
