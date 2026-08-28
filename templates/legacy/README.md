# Legacy spreadsheet scoresheet examples

These JSON files are complete historical scoresheet examples that still use
spreadsheet-backed sources (`sheetName` / range lookups) rather than the
canonical DB-backed `teamsDataSource` and `bracketSource` used by the online
app.

They are **not** importable as Colosseum scoresheet templates. Do not add a
canonical `kind` discriminator to make them look like supported online schemas.

- `botball-seeding-template.json` — seeding-style field layout with spreadsheet
  team lookup.
- `botball-de-template.json` — head-to-head field layout with spreadsheet
  bracket lookup and `winner-select`.

Canonical online schemas are produced by the admin wizard and must include
`kind: "seeding" | "bracket" | "double_seeding"` plus DB sources. Reusable
field-array files in `templates/` are not complete schemas and do not need a
discriminator.

Portable V1 export may still consume seeding-compatible field arrays or schemas
as a shorthand; it rejects `kind: "bracket"` and `kind: "double_seeding"`.
