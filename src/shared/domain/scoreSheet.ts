/**
 * Admin-facing score sheet projections returned by
 * `GET /scoresheet/templates/admin`. The columns enumerated here must stay
 * aligned with the SELECT list in `src/server/routes/scoresheet.ts`.
 */

export interface AdminScoreSheetSummary {
  id: number;
  name: string;
  description: string | null;
  access_code: string | null;
  created_at: string;
  is_active: boolean;
  spreadsheet_config_id: number | null;
  spreadsheet_name: string | null;
  sheet_name: string | null;
}
