/**
 * Reusable scoring field templates (`scoresheet_field_templates`).
 *
 * `FieldTemplateRow` mirrors the persisted row plus the `fields_json` text
 * column. `FieldTemplateWithFields` is the shape served by
 * `GET /field-templates/:id` (and used by the score-sheet wizard) where
 * `fields_json` has been parsed into a typed `ScoresheetField[]`.
 */

import type { ScoresheetField } from './scoresheetSchema';

export interface FieldTemplateRow {
  id: number;
  name: string;
  description: string | null;
  fields_json: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface FieldTemplateWithFields extends Omit<
  FieldTemplateRow,
  'fields_json'
> {
  fields: ScoresheetField[];
}
