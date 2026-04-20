import type { Database } from '../database/connection';
import type { FieldTemplateRow } from '../../shared/domain/fieldTemplate';

export interface UpdateFieldTemplateParams {
  db: Database;
  templateId: number | string;
  body: Record<string, unknown>;
}

export type UpdateFieldTemplateResult =
  | { ok: true; template: FieldTemplateRow | undefined }
  | { ok: false; status: 400; error: string };

/** Replace a field template's name/description/fields. */
export async function updateFieldTemplate(
  params: UpdateFieldTemplateParams,
): Promise<UpdateFieldTemplateResult> {
  const { db, templateId, body } = params;

  const name = body.name as string | undefined;
  const description = body.description as string | undefined;
  const fields = body.fields as unknown;

  if (!name || fields === undefined || fields === null) {
    return {
      ok: false,
      status: 400,
      error: 'Name and fields are required',
    };
  }

  await db.run(
    `UPDATE scoresheet_field_templates 
     SET name = ?, description = ?, fields_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name, description ?? null, JSON.stringify(fields), templateId],
  );

  const template = await db.get<FieldTemplateRow>(
    'SELECT * FROM scoresheet_field_templates WHERE id = ?',
    [templateId],
  );

  return { ok: true, template };
}
