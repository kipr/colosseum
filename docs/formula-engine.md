# Shared score formulas

Judge scoresheets, pending-score edits, and newly exported portable sheets use
one parser, dependency compiler, and AST evaluator. The language and coercion
rules are specified in [formula_grammer.txt](formula_grammer.txt). There is no
JavaScript evaluation fallback.

Compilation parses each formula once per effective schema. References resolve
only to declared top-level scalar inputs, repeatable-group derived outputs,
and calculated fields. Row children remain scoped to their rows; row-level calculated fields are rejected as unsupported. Calculated
fields are evaluated in deterministic dependency order, including forward
references. References in both ternary branches and both OR operands count
for dependency validation. Unknown references, duplicate IDs/producers, and
cycles are rejected; a cycle diagnostic includes its dependency path.

A formula takes precedence over a derived output with the same ID (used by GCER
sheets). A calculated field without a formula must have a derived producer.
Derived outputs cannot collide with editable fields. Missing editable values
are zero; missing required derived outputs are errors. Saved/submitted
calculated values never become input bindings. Failed dependencies invalidate
their dependents; unrelated valid calculations remain available.

Diagnostics have stable codes (for example `EXPECTED_EXPRESSION`,
`UNKNOWN_REFERENCE`, `DEPENDENCY_CYCLE`, `INVALID_NUMBER`,
`MISSING_DERIVED_OUTPUT`, and `FAILED_DEPENDENCY`), a readable message, and a
calculated field ID where applicable. Parse/reference diagnostics include a
zero-based UTF-16 source offset; dependency errors include a path when useful.
Consumers show field errors and an accessible summary, show failed totals as
unavailable, disable writes, and independently guard submit/save/download
handlers. Template and field-template writes use the existing HTTP 400
`error`/`errors` response. Schema markers with no fields remain valid.

Accepted/rejected scores remain viewable with their original saved totals.
Pending-score edits recalculate against the current template and require
valid formulas to save. Existing records are not migrated or rewritten.
Server-side recomputation of submitted scores is outside this change.

## Portable sheets

Run `npm run export:scoresheet -- --input template.json --output sheet.html`.
The TypeScript CLI validates the schema and bundles the runtime and shared
engine with Vite into inline browser JavaScript. Generated sheets work offline,
retain draft saving/reset, embed optional reference images, and guard JSON downloads when calculations fail.
Existing exported HTML must be regenerated to receive these rules.
Repeatable-group portable export remains unsupported.

## Read-only rollout audit

Run `npx ts-node tools/audit-score-formulas.ts` to audit repository fixtures.
Before rollout, set `DATABASE_URL` for the deployment being audited and run
`npx ts-node tools/audit-score-formulas.ts --database`. The audit reads complete
templates and field-template arrays inside a read-only transaction, reports
invalid template IDs/names and diagnostics as JSON lines, and exits nonzero
if any are invalid. It imports no server initialization or migrations and
never rewrites templates or historical scores. Correct reported templates
explicitly before rollout; rerun the audit against the deployment database.
