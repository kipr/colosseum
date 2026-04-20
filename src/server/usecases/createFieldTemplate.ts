import type { Database } from '../database/connection';
import type { FieldTemplateRow } from '../../shared/domain/fieldTemplate';

export interface CreateFieldTemplateParams {
  db: Database;
  body: Record<string, unknown>;
  userId: number;
}

export type CreateFieldTemplateResult =
  | { ok: true; template: FieldTemplateRow }
  | { ok: false; status: 400; error: string };

/**
 * Create a field template. Validates `name` and `fields` (must be an array);
 * persists `fields` as a JSON string.
 */
export async function createFieldTemplate(
  params: CreateFieldTemplateParams,
): Promise<CreateFieldTemplateResult> {
  const { db, body, userId } = params;

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

  if (!Array.isArray(fields)) {
    return { ok: false, status: 400, error: 'Fields must be an array' };
  }

  const result = await db.run(
    `INSERT INTO scoresheet_field_templates (name, description, fields_json, created_by)
     VALUES (?, ?, ?, ?)`,
    [name, description ?? null, JSON.stringify(fields), userId],
  );

  const template = await db.get<FieldTemplateRow>(
    'SELECT * FROM scoresheet_field_templates WHERE id = ?',
    [result.lastID],
  );

  return { ok: true, template: template as FieldTemplateRow };
}
