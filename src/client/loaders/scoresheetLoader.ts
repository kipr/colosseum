import { redirect, type LoaderFunctionArgs } from 'react-router-dom';
import type { ScoresheetSchema } from '../../shared/scoresheetSchema';
import { scoresheetPath } from '../utils/routes';

export interface JudgeScoresheetTemplate {
  id: number;
  name: string;
  description?: string | null;
  schema: ScoresheetSchema & {
    fields: NonNullable<ScoresheetSchema['fields']>;
  };
}

function parseTemplateId(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;

  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function notFound(): Response {
  return new Response('Scoresheet not found.', {
    status: 404,
    statusText: 'Not Found',
  });
}

export async function scoresheetLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<JudgeScoresheetTemplate | Response> {
  const templateId = parseTemplateId(params.templateId);
  if (templateId === null) throw notFound();

  const response = await fetch(`/scoresheet/judge/templates/${templateId}`, {
    credentials: 'include',
    signal: request.signal,
  });

  if (response.status === 401 || response.status === 403) {
    return redirect('/judge');
  }
  if (response.status === 404) throw notFound();
  if (!response.ok) throw response;

  const template = (await response.json()) as JudgeScoresheetTemplate;
  if (!template.schema || !Array.isArray(template.schema.fields)) {
    throw new Error('The scoresheet template has an invalid schema.');
  }

  return template;
}

export function legacyScoresheetLoader({ request }: LoaderFunctionArgs) {
  const templateId = parseTemplateId(
    new URL(request.url).searchParams.get('template'),
  );

  return redirect(templateId === null ? '/judge' : scoresheetPath(templateId));
}
