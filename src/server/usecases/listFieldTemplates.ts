import type { Database } from '../database/connection';
import type { FieldTemplateRow } from '../../shared/domain/fieldTemplate';

export interface ListFieldTemplatesParams {
  db: Database;
}

export type ListFieldTemplatesResult = {
  ok: true;
  templates: FieldTemplateRow[];
};

/** List all field templates ordered by most-recently created. */
export async function listFieldTemplates(
  params: ListFieldTemplatesParams,
): Promise<ListFieldTemplatesResult> {
  const { db } = params;
  const templates = await db.all<FieldTemplateRow>(
    'SELECT * FROM scoresheet_field_templates ORDER BY created_at DESC',
  );
  return { ok: true, templates };
}
