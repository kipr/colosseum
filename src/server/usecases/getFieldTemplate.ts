import type { Database } from '../database/connection';
import type {
  FieldTemplateRow,
  FieldTemplateWithFields,
} from '../../shared/domain/fieldTemplate';
import type { ScoresheetField } from '../../shared/domain/scoresheetSchema';

export interface GetFieldTemplateParams {
  db: Database;
  templateId: number | string;
}

export type GetFieldTemplateResult =
  | { ok: true; template: FieldTemplateWithFields }
  | { ok: false; status: 404; error: string };

/** Fetch a single field template, parsing `fields_json` into a typed array. */
export async function getFieldTemplate(
  params: GetFieldTemplateParams,
): Promise<GetFieldTemplateResult> {
  const { db, templateId } = params;

  const template = await db.get<FieldTemplateRow>(
    'SELECT * FROM scoresheet_field_templates WHERE id = ?',
    [templateId],
  );

  if (!template) {
    return { ok: false, status: 404, error: 'Field template not found' };
  }

  const { fields_json, ...rest } = template;
  return {
    ok: true,
    template: {
      ...rest,
      fields: JSON.parse(fields_json) as ScoresheetField[],
    },
  };
}
