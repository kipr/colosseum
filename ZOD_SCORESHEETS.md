# Scoresheet Schema: Zod Migration Plan

## Relationship to `ZOD_ROLLOUT.md`

`ZOD_ROLLOUT.md` is the governing document for Zod conventions in this repo.
This plan is the detailed design for its **Phase 4** item "Scoresheet templates."
Where the two documents disagree, this section records the deviation and its
justification. Nothing here silently overrides the rollout guide; if a deviation
is accepted, `ZOD_ROLLOUT.md` must be updated in the same pull request.

| `ZOD_ROLLOUT.md` position                                                                     | This plan                                                                                                                                                                                          | Justification                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 4: "keep `validateScoresheetSchema` as the template-aware step"                         | Replaces its body with a Zod parse, keeping the exported function as a thin wrapper                                                                                                                | The rollout guide assumed the template-aware step could not be expressed declaratively. Sections 3–4 below show it can. The function survives as an export; only its implementation moves. |
| §9: "Keep server schemas server-only unless client runtime validation has a specific benefit" | Places the canonical schema in `src/shared/`, so Zod enters the browser bundle                                                                                                                     | Accepted cost, argued in §8. If the argument is rejected, the fallback is server-only parsing plus a generated transport type for the client.                                              |
| §3: template request schemas live in `src/server/validation/templates.ts`                     | Canonical _document_ model lives in `src/shared/scoresheetSchema.ts`; the HTTP _envelope_ (`name`, `description`, `accessCode`, `eventId`, `schema`) lives in `src/server/validation/templates.ts` | Preserves the domain-file convention. The document model is shared because the client and the export tool both need it; the request envelope is not shared.                                |
| Phase 4 names the score entry type `ScoreFieldEntry` (`{ value, type?, label? }`)             | Uses that exact name and extends it with `derived?`                                                                                                                                                | Naming drift resolved in favor of the rollout guide.                                                                                                                                       |

`ZOD_ROLLOUT.md` §7 (strictness) and §8 (structural vs. domain vs. persistence
layering) apply unchanged. In particular, no Zod refinement may perform a
database query.

## Current state (verified)

Before proposing changes, these are the measured facts the plan is built on.

- `src/shared/scoresheetSchema.ts` contains **no Zod**. It is handwritten
  TypeScript interfaces plus a hand-rolled `validateScoresheetSchema`.
  Zod 4.4.3 is already a dependency and is used only under
  `src/server/validation/`.
- `validateScoresheetSchema` is **deliberately lenient**: any object without a
  `fields` array returns `{ ok: true, errors: [] }`. There is an explicit test
  for this at `tests/shared/scoresheetSchema.test.ts:11`.
- The server reads exactly **three** schema-level properties: `scoreKind`,
  `mode`, and `bracketSource`, all inside `inferTemplateType`
  (`src/server/routes/scoresheet.ts:17-34`). `bracketSource` is tested for
  _presence only_, and an HTTP test passes the literal value `true`.
- Storage is opaque `TEXT` on both SQLite and PostgreSQL. No `jsonb`, no SQL
  JSON operators. There are six `JSON.parse` sites: five in
  `src/server/routes/scoresheet.ts` and one in
  `src/server/routes/fieldTemplates.ts`.
- `templates/` holds nine files in **three different shapes**: six bare field
  arrays, two full schema objects, one `{ name, description, schema }` wrapper.
- Across those files there are 544 field definitions. **All 544 already have a
  non-empty `id` and `label`.** Type distribution: `number` 296, `calculated`
  94, `group_header` 70, `buttons` 28, `section_header` 16, `checkbox` 13,
  `text` 11, `repeatableGroup` 11, `dropdown` 4, `winner-select` 1.
- Client scoresheet code carries 158 `: any` annotations and 10 file-level
  `eslint-disable @typescript-eslint/no-explicit-any` directives across 11
  files, concentrated in `ScoresheetForm.tsx` (53), `scoresheetUtils.ts` (43),
  and `ScoreViewModal.tsx` (37).
- `npm run typecheck:client` **already fails** with 32 errors, 27 of which are
  unused `React` imports under `noUnusedLocals`. Only five relate to
  scoresheets. `npm run build` does not run it (`build:client` is `vite build`).

## Core decision

Zod definitions in `src/shared/scoresheetSchema.ts` become the sole
authoritative contract for the scoresheet _document_. All TypeScript types are
derived with `z.infer`; no parallel handwritten interfaces or separate
validation rules remain.

This does **not** extend to submitted `scoreData` contents, which stay an
envelope-at-the-boundary plus a template-aware service, per `ZOD_ROLLOUT.md` §8.

---

## 0. Audit real data before designing the normalizer

**This step comes first and gates section 5.**

Several migrations proposed in earlier drafts of this plan turned out to have no
supporting evidence in the repository — every checked-in field already has an
`id` and a `label`, so "add deterministic IDs to headers" and "convert
field-template `name` to `id`/`label`" may be repairing shapes that do not
exist. Writing and testing normalizers for hypothetical data is wasted work.

Build the read-only audit described in section 6 _before_ the legacy
normalizer, run it against a production database dump, and let its output
decide which migrations get written. Section 5 lists candidates, not
commitments.

## 1. Inventory and lock down the schema dialect

Under `z.strictObject`, an unlisted property is a hard rejection rather than a
silently ignored extra. The inventory therefore has to be exhaustive before
strictness is switched on.

### Field-level properties observed in `templates/`

Complete, machine-extracted from all 544 field definitions including
repeatable-group children:

```text
autoAppendBlankRow  autoPopulated  cascades      checkboxLabel  column
dataSource          defaultValue   derived       description    fields
formula             id             isGrandTotal  isMultiplier   isTotal
label               max            min           minRows        options
placeholder         pruneBlankRows required      rowLabel       step
suffix              type
```

Nine of these are **absent from the current TypeScript interfaces entirely**:
`autoAppendBlankRow`, `autoPopulated`, `cascades`, `derived`, `isMultiplier`,
`isTotal`, `pruneBlankRows`, `rowLabel`, `suffix`. Each must be modeled or
explicitly rejected.

### Schema-level properties

| Property                                   | Source                                          | Notes                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`, `layout`, `fields`                | checked-in templates                            | canonical                                                                                                                                         |
| `mode`                                     | `botball-de-template.json`, `inferTemplateType` | canonical                                                                                                                                         |
| `bracketSource`                            | `botball-de-template.json`, builders            | see legacy `bracketId` below                                                                                                                      |
| `teamsDataSource`                          | `botball-de-template.json`, builders            | canonical                                                                                                                                         |
| `description`                              | current TS interface, wrapper fixture           | canonical                                                                                                                                         |
| `eventId`, `scoreDestination`, `scoreKind` | emitted by `scoresheetUtils` builders           | canonical                                                                                                                                         |
| `gameAreasImage`                           | written by `TemplateEditorModal` on save        | canonical                                                                                                                                         |
| `queueConfig`, `useQueueForSeeding`        | rejected by the portable exporter               | **no producer exists in the repo.** Confirm against the §0 audit; if absent from real data, delete the exporter guards rather than modeling them. |

### Known legacy shapes

- **`bracketSource.bracketId`.** `TemplateEditorModal` deliberately preserves it
  on save and surfaces it in the UI as "Legacy bracket metadata". `DbBracketSource`
  in `scoresheetUtils.ts:24-29` declares it. A strict `bracketSourceSchema` must
  model it or the editor's preserve-on-save behavior breaks.
- **`bracketSource: true`.** A boolean, not an object. Used by
  `tests/http/scoresheet.extra.test.ts:290` because `inferTemplateType` only
  checks for key presence.
- **Two cascade formats.** Format A is `{ targetField, sourceField }`
  (`botball-seeding-template.json`; handled at `ScoresheetForm.tsx:754-768`).
  Format B is a map from target field id to a dot path such as
  `"team1.teamNumber"` (`botball-de-template.json`; emitted by
  `buildDoubleEliminationSchema`). **Format B is never interpreted at runtime** —
  head-to-head team population goes through `handleBracketGameSelect` instead.
  Decide deliberately: model it, or delete it as dead configuration.
- **Sheets-era data sources.** `dataSource.sheetName` / `range` appear in
  `botball-seeding-template.json` and `botball-de-template.json`. No client code
  reads them; `loadDynamicData` only handles `type: 'db'` and `type: 'bracket'`.

Document each property as canonical, legacy, or unsupported. Add a test that
parses every checked-in template. That test is the first compatibility gate —
but see section 2 for why it needs a shape discriminator to work at all.

## 2. Versioned canonical schema, with an explicit shape discriminator

### Three document shapes, not one

The parser cannot assume its input is a schema object. Checked-in and stored
data arrive in three shapes, and the portable exporter already normalizes all
three at `export-html.mjs:38-70`:

1. A **full schema** object (`{ layout, title, fields, ... }`).
2. A **bare field array** (six of nine files in `templates/`; also the on-disk
   shape of `scoresheet_field_templates.fields_json`).
3. A **wrapper** (`{ name, description, schema }`), used by the portable
   exporter's fixtures.

Define the shape discriminator as the first stage of the pipeline, before any
version check. Shapes 2 and 3 resolve to shape 1 (or to a field array) by
structural inspection, not by a version marker.

### Versioning field templates

A bare JSON array has nowhere to carry `schemaVersion`. Two options, and the
plan must pick one before implementation:

- **(a)** Add a `schema_version INTEGER NOT NULL DEFAULT 0` column to
  `scoresheet_field_templates` and version the row rather than the document.
- **(b)** Declare field-template arrays permanently unversioned and validate
  them against the _field_ schemas only, with legacy normalization always
  applied on read.

Option (b) is cheaper and matches the fact that field templates carry no
schema-level properties. Option (a) is required if field-level shapes ever need
a breaking change. **Recommendation: (b).**

### The contract

```ts
export const scoresheetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string().optional(),
  description: z.string().optional(),
  layout: scoresheetLayoutSchema.optional(),
  mode: scoresheetModeSchema.optional(),
  scoreKind: scoreKindSchema.optional(),
  eventId: positiveId.nullable().optional(),
  scoreDestination: scoreDestinationSchema.optional(),
  bracketSource: bracketSourceSchema.optional(),
  teamsDataSource: teamsDataSourceSchema.optional(),
  gameAreasImage: imageDataSchema.optional(),
  fields: z.array(scoresheetFieldSchema),
});

export type ScoresheetSchema = z.infer<typeof scoresheetSchema>;
```

`positiveId` already exists in `src/server/validation/primitives.ts`, but
`src/shared/` **cannot import from `src/server/`** — `tsconfig.client.json`
includes only `src/client` and `src/shared`. Move the shared primitives
(`positiveId`, `trimmedNonEmptyString`) into `src/shared/validationPrimitives.ts`
and re-export them from the server module, so there is still one definition.

Use strict objects so misspelled properties fail loudly. If arbitrary extensions
are needed, add an explicit `metadata: z.record(z.string(), z.unknown())`
instead of broadly allowing unknown keys.

## 3. Model fields as a discriminated union

Define shared primitives, then one schema per field type: `text`, `number`,
`dropdown`, `buttons`, `checkbox`, `calculated`, `section_header`,
`group_header`, `winner-select`, `repeatableGroup`.

All persisted and renderable fields require a non-empty `id`, `label`, and
`type`. This is already true of all 544 checked-in fields, so it costs nothing
today; the §0 audit determines whether it costs anything in production data. The
raw JSON editor keeps its string state while editing and does not need a loosely
typed draft object.

Structural decisions:

- `buttons.options` is required and non-empty.
- A dropdown explicitly uses static options or a recognized data source.
- Calculated fields require a formula.
- Repeatable-group children are limited to the five types the UI actually
  renders inside a group (`text`, `number`, `dropdown`, `buttons`, `checkbox`,
  per `ScoresheetForm.tsx:1504-1507`). This deliberately avoids a recursive
  discriminated union, which Zod handles poorly.
- Repeatable-group rows are `Record<string, ScoresheetValue>` where
  `ScoresheetValue` is the **scalar** union defined in section 8. Rows are not
  themselves a `ScoresheetValue`; the row array is.
- Source and cascade variants use discriminated unions.
- Derived configurations use a union keyed by `derived.type`
  (`botballCubeStacks`, `botballStartBoxCubes`).

`RepeatableGroupField`, `CalculatedField`, and `ScoresheetFieldOption` all
become `z.infer` aliases.

## 4. Move semantic validation into refinements

Replace the body of `validateScoresheetSchema` with `superRefine` rules
colocated with the Zod definitions:

- IDs are unique within a schema and within each repeatable group.
- `min <= max`; `step > 0`; row limits are consistent.
- Defaults match their field type and numeric constraints.
- Static defaults match an option value.
- Repeatable defaults contain only known child IDs and valid child values.
- Unsupported `startValue` produces a targeted migration error.
- Derived output mappings point to valid, compatible fields.
- Schema mode/source combinations are coherent.
- Data sources contain the fields required by their source type.

Per `ZOD_ROLLOUT.md` §1, prefer unions where a union expresses the rule; reserve
`superRefine` for relationships a union cannot encode. Nothing above may query
the database.

Formula reference validation stays conservative. Validate syntax and known
references where reliable, but do not reject legitimate formula tokens until the
formula evaluator has a defined grammar.

### The compatibility wrapper is a behavior change

```ts
export function validateScoresheetSchema(input: unknown) {
  const result = parseScoresheetSchema(input);
  return result.success
    ? { ok: true, errors: [] }
    : { ok: false, errors: formatZodIssues(result.error.issues) };
}
```

This is **not** behavior-preserving, and the plan should not pretend otherwise.
Today the function accepts any object lacking a `fields` array. After the
change it requires `fields` and `schemaVersion`. Consequences to budget for:

- `tests/shared/scoresheetSchema.test.ts:11` asserts the lenient behavior and
  must be rewritten to assert the strict behavior.
- Two HTTP tests post schemas with no `fields` at all:
  `schema: { mode: 'head-to-head' }` (`scoresheet.extra.test.ts:272`) and
  `schema: { bracketSource: true }` (`:290`).
- Roughly 50 `schema:` payloads across five test files
  (`scoresheet.extra`, `scoresheetTemplatesEventScope`,
  `scoresheetDoubleSeedingInference`, `rateLimit`,
  `portableScoresheetExport`) need `schemaVersion: 1` and a `fields` array.

Do this test churn in the first pull request, alongside the canonical model, so
the compatibility surface is reviewed in one place.

## 5. Legacy normalization layer

Do not make the canonical schema permissive to accommodate old data. Add:

```ts
normalizeLegacyScoresheetSchema(input: unknown): unknown
parseScoresheetSchema(input: unknown): SafeParseResult<ScoresheetSchema>
```

Pipeline:

```text
unknown input
    │
    ▼
shape discriminator  (bare array | wrapper | schema object)
    │
    ├─ schemaVersion === 1 ─────────────┐
    │                                   ▼
    └─ unversioned legacy normalizer → canonical Zod parser
                                        │
                                        ▼
                               ScoresheetSchema
```

Candidate deterministic migrations, **each conditional on the §0 audit finding
matching data**:

- Adding `schemaVersion`.
- Normalizing Sheets-era `dataSource` (`sheetName`/`range`) into an explicit
  source variant, or rejecting it as unsupported.
- Preserving `bracketSource.bracketId` and normalizing `bracketSource: true`
  into the canonical object form.
- Converting field-template `name` properties to `id`/`label` — **no evidence
  this shape exists; do not implement without audit confirmation.**
- Adding deterministic IDs to headers where no references depend on them —
  **also unconfirmed; all checked-in headers already have IDs.**

Do not invent IDs or semantics for scoring fields. Report those for manual
repair.

### Normalization runs on writes too

The rollout in section 6 begins with "strict validation for all new writes,"
but nothing produces a version-1 document until the wizard, the builders in
`scoresheetUtils`, and the raw JSON textarea in `TemplateEditorModal` are all
updated. In the interim, an admin who opens an existing template and clicks save
is performing a write of legacy content.

Therefore the write path is **normalize, then parse strictly** — not parse
strictly alone. The response reports whether normalization was applied so the
editor can show the admin what changed. Only after the audit confirms zero
remaining legacy documents does the write path drop its normalizer.

## 6. Audit persisted data before enforcing strict reads

Add a read-only audit command covering both SQLite and PostgreSQL that reports,
per row:

- Template or field-template ID and name.
- Exact Zod issue path.
- Whether automatic normalization is available.
- The proposed normalized result, without writing it.

There is **no existing infrastructure for this**: the repository has no
`scripts/` directory and no data-migration tooling
(`src/server/database/schema/runner.ts` is idempotent DDL only). Budget for a
new `scripts/` entry point plus an npm script, and extend the `lint` and
`pretty` globs to cover it (both are currently hardcoded to `src`).

Then add an explicit migration command for safe conversions. Rollout:

1. Normalize-then-strictly-validate all new writes.
2. Legacy normalization on reads with structured warnings.
3. Audit and migrate production data.
4. Exclude still-invalid templates from judge and public endpoints while
   exposing their errors to admins.
5. Remove the legacy read path in a later cleanup release.

### Strictness on judge read paths is a product decision

`ZOD_ROLLOUT.md` §7 recommends strict bodies for admin mutations but suggests
stripping unknown keys for judge-facing clients. Template create and update are
admin operations, so strict is correct there. But the same canonical schema is
applied when _reading_ persisted rows on judge paths — `GET /templates`
(`scoresheet.ts:72`) and `POST /templates/:id/verify` (`:193`). Strict-parsing a
stored row on a judge path means one bad row can break scoring mid-tournament.

Step 4 above is the mitigation, but it changes behavior for judges and needs an
explicit decision and a tournament-day fallback, not a footnote. The recommended
fallback is: serve the row with a structured warning rather than failing the
request, and surface the failure to admins out of band.

## 7. Apply parsing at every boundary

Server:

- Validate POST/PUT template bodies with `validateRequest` from
  `src/server/validation/middleware.ts`, using an envelope schema in
  `src/server/validation/templates.ts` that composes the shared document model.
  This replaces the current manual `req.body` destructuring at
  `scoresheet.ts:238-252` and `fieldTemplates.ts:53-68`.
- Validate field-template arrays with the same field schemas.
- Parse database JSON immediately after `JSON.parse`, at all six sites.
- Persist the normalized parsed value, not the original request object.
- Have `inferTemplateType` accept only canonical parsed schemas. Note this
  narrows it from presence-checking `bracketSource` to reading a typed variant.

Client:

- Treat `response.json()` as `unknown`.
- Parse template-list, template-detail, and verified-template responses with
  shared response schemas. Include `src/client/pages/Scoresheet.tsx`, which
  rehydrates a template from `sessionStorage` with only a structural check.
- Keep the existing raw-score fallback when a historical template cannot be
  parsed.
- Show actionable schema errors in the admin editor. The server already returns
  a structured `errors[]` array; `TemplateEditorModal.tsx:223` currently
  discards it and alerts "Failed to save template." Render the issues instead.

## 8. Migrate consumers from `any`

Order, chosen so each step's types are available to the next:

1. Schema builders in `scoresheetUtils` (43 `any`).
2. Repeatable-group helpers.
3. `ScoreSheetWizard` (5 `any`).
4. `ScoresheetForm` (53 `any`).
5. `TemplateEditorModal`, `FieldTemplateModal`, `TemplatePreviewModal` (19 `any`
   combined).
6. `ScoreViewModal` (37 `any`).

Builders use `satisfies ScoresheetSchema` or return `ScoresheetSchema`, so
generated schemas are checked at compile time.

For dynamic submitted values, use `unknown` rather than forcing a false static
type. The entry type name follows `ZOD_ROLLOUT.md` Phase 4:

```ts
export type ScoresheetValue = string | number | boolean | null;

export type RepeatableGroupRows = Record<string, ScoresheetValue>[];

export interface ScoreFieldEntry {
  label?: string;
  type?: ScoresheetFieldType;
  value: unknown;
  derived?: RepeatableGroupDerivedResult;
}
```

Once `normalizeRepeatableGroupRows` returns `RepeatableGroupRows` and template
parsing yields `ScoresheetSchema`, the three `ScoreViewModal` type errors
resolve without casts.

### On putting Zod in the browser bundle

`ZOD_ROLLOUT.md` §9 says to keep schemas server-only absent a specific benefit.
The specific benefits here are that the admin editor needs issue paths to
highlight the offending JSON before a round trip, and that the portable exporter
and the client must agree on one field model. The cost is Zod's runtime in the
client bundle for the first time.

If that cost is judged too high, the fallback is to keep parsing server-only,
export only `z.infer` types to the client (types are erased at build time), and
have the editor render server-returned issues rather than computing them
locally. Decide this explicitly in the first pull request; it determines whether
`src/shared/scoresheetSchema.ts` imports Zod at all.

## 9. Eliminate remaining duplicate validation

`tools/portable-scoresheet/export-html.mjs` re-implements the `defaultValue`
rules at lines 143-233. It should import the canonical parser instead.

Converting it to a ts-node entry point is more involved than it appears:

- `tools/` is included in **no** tsconfig. The root config includes only
  `src/server` and `src/shared` with `rootDir: ./src`.
- `npm run lint` and `npm run pretty` are hardcoded to `src`, so a TypeScript
  file under `tools/` would be neither linted nor formatted.
- The file is native ESM with top-level `await`, so ts-node needs `--esm`.

Two viable paths. **Preferred:** keep the tool as `.mjs` and import the built
`dist/shared/scoresheetSchema.js`, adding a build step to the
`export:scoresheet` script. **Alternative:** add `tsconfig.tools.json`, extend
the lint and pretty globs, and run under `ts-node --esm`. Pick one before
starting; do not discover the ESM friction mid-change.

Portable-only restrictions — rejecting database sources, `repeatableGroup`,
`winner-select`, and non-`two-column` layouts — remain a separate refinement
layered on top of the canonical schema. They are capability rules, not duplicate
schema definitions.

`docs/TEMPLATE_SCHEMA_GUIDE.md` needs more than a refresh: it documents only
five field types (text, number, dropdown, buttons, checkbox) and omits
`calculated`, both header types, `winner-select`, and `repeatableGroup`. Treat
it as a rewrite from the canonical model, and add `schemaVersion` to every
example.

## 10. Verification and acceptance criteria

Required coverage:

- Positive test for every field and source variant.
- Negative test for every refinement.
- Legacy normalization fixtures, one per migration the §0 audit justifies.
- Every checked-in template parses, in all three document shapes.
- Every schema builder's output parses.
- API create/update rejects structurally invalid schemas.
- Database reads handle invalid historical data deliberately.
- Client displays a useful error or fallback for malformed payloads.
- Portable export uses the shared parser.
- Zod-inferred type tests for union narrowing.
- No schema-related `any` suppressions in migrated consumers.

Verification commands:

```sh
npm run pretty
npm run lint
npm run typecheck:server
npm run test:run
npm run build
```

`npm run typecheck:client` is **excluded** because it already fails with 32
pre-existing errors, 27 of them unused `React` imports under `noUnusedLocals`,
plus a real arity bug at `BracketLikeView.tsx:173`. Only five relate to
scoresheets, and those five are expected to disappear as part of section 8.

Two of the listed commands are also red before this work starts:

- `npm run pretty` fails on `AuditTab.tsx`, `AwardRecipientModal.tsx`, and
  `QueueTab.tsx`.
- `npm run typecheck:client` fails as described above.

`npm run lint`, `npm run typecheck:server`, and `npm run build` are green.

The prerequisite pull request below should clear both, and wire
`typecheck:client` into `npm run build` so the drift cannot recur. Until it
lands, the scoresheet-specific criterion is: _`typecheck:client` reports no
errors in `ScoreViewModal.tsx`, and `npm run pretty` reports no newly failing
files._

## Pull request sequence

1. **Prerequisite** — clear the 32 `typecheck:client` errors and the three
   Prettier failures, then add `typecheck:client` to the build. Independent of
   this work; unblocks the acceptance criteria.
2. **Audit** — the read-only audit command from §0/§6, plus `scripts/`
   infrastructure and lint/pretty glob updates. Ship and run it before
   designing the normalizer.
3. **Canonical model** — Zod definitions, refinements, the compatibility
   wrapper, the shape discriminator, and the ~50 test payload updates from §4.
4. **Server and legacy** — request envelopes in `validation/templates.ts`,
   parsing at the six `JSON.parse` sites, the normalizer targeting audited
   shapes, and the migration command.
5. **Client utilities** — `scoresheetUtils` and the repeatable-group helpers.
6. **Client components** — `ScoresheetForm`, the wizard, the editors, and
   `ScoreViewModal`.

Splitting 5 and 6 matters: `ScoresheetForm.tsx` is 2299 lines and
`scoresheetUtils.ts` is 789, and together with `ScoreViewModal` they hold 133 of
the 158 `any` annotations. One pull request covering all of them would not be
reviewable.
