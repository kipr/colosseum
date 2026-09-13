import {
  requestJson,
  requestJsonBody,
  requestVoid,
  requestVoidBody,
  ApiParseError,
} from './http';
import type {
  ScoresheetField,
  ScoresheetSchema,
} from '../../shared/scoresheetSchema';

export interface TemplateSummary {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  access_code?: string;
}
export interface TemplateDetail extends TemplateSummary {
  schema: ScoresheetSchema;
}
export interface PublicTemplate extends Omit<TemplateDetail, 'access_code'> {
  event_id: number;
  event_name: string;
  event_date: string | null;
  event_status: string;
}
export interface FieldTemplate extends Omit<TemplateSummary, 'access_code'> {
  fields: ScoresheetField[];
}
export interface TemplateInput {
  name: string;
  description: string;
  accessCode: string;
  schema: ScoresheetSchema;
}
export interface FieldTemplateInput {
  name: string;
  description: string;
  fields: ScoresheetField[];
}
export function getPublicTemplates(signal?: AbortSignal) {
  return requestJson<PublicTemplate[]>('/scoresheet/templates', { signal });
}
export function getTemplates(eventId?: number, signal?: AbortSignal) {
  return requestJson<TemplateSummary[]>(
    `/scoresheet/templates/admin${eventId == null ? '' : `?eventId=${eventId}`}`,
    { signal },
  );
}
export function getTemplate(templateId: number, signal?: AbortSignal) {
  return requestJson<TemplateDetail>(`/scoresheet/templates/${templateId}`, {
    signal,
  });
}
export function verifyTemplate({
  templateId,
  accessCode,
}: {
  templateId: number;
  accessCode: string;
}) {
  return requestJsonBody<TemplateDetail>(
    `/scoresheet/templates/${templateId}/verify`,
    'POST',
    { accessCode },
  );
}
export async function getFieldTemplates(
  signal?: AbortSignal,
): Promise<FieldTemplate[]> {
  const rows = await requestJson<
    (Omit<FieldTemplate, 'fields'> & { fields_json: string })[]
  >('/field-templates', { signal });
  try {
    return rows.map(({ fields_json, ...row }) => ({
      ...row,
      fields: JSON.parse(fields_json) as ScoresheetField[],
    }));
  } catch {
    throw new ApiParseError('Invalid field-template JSON');
  }
}
export function saveTemplate({
  templateId,
  eventId,
  data,
}: {
  templateId?: number;
  eventId: number;
  data: TemplateInput;
}) {
  return requestJsonBody<TemplateDetail>(
    templateId
      ? `/scoresheet/templates/${templateId}`
      : '/scoresheet/templates',
    templateId ? 'PUT' : 'POST',
    { ...data, eventId },
  );
}
export function deleteTemplate({ templateId }: { templateId: number }) {
  return requestVoid(`/scoresheet/templates/${templateId}`, {
    method: 'DELETE',
  });
}
export function saveFieldTemplate({
  templateId,
  data,
}: {
  templateId?: number;
  data: FieldTemplateInput;
}) {
  return requestVoidBody(
    templateId ? `/field-templates/${templateId}` : '/field-templates',
    templateId ? 'PUT' : 'POST',
    data,
  );
}
export function deleteFieldTemplate({ templateId }: { templateId: number }) {
  return requestVoid(`/field-templates/${templateId}`, { method: 'DELETE' });
}
