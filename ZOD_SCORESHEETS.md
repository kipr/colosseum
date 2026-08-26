## Proposed migration plan

The core decision: Zod definitions in [scoresheetSchema.ts](/workspaces/colosseum/src/shared/scoresheetSchema.ts) become the sole authoritative contract. All TypeScript types are derived with `z.infer`; no parallel handwritten interfaces or separate validation rules remain.

### 1. Inventory and lock down the schema dialect

Create a schema-property inventory from:

- Checked-in JSON under `templates/`
- `ScoreSheetWizard` and schema builders in `scoresheetUtils`
- `ScoresheetForm`, previews, and `ScoreViewModal`
- Existing database templates and field templates
- Portable scoresheet exporter
- Tests that intentionally exercise legacy shapes

Document each property as canonical, legacy, or unsupported. Important currently-untyped areas include:

- Schema-level sources, modes, layouts, destinations, images, and event IDs
- Static, database, bracket, and legacy sheet data sources
- Both cascade formats
- Calculated-field presentation flags
- Repeatable-group configuration and derived Botball calculations

Add a test that parses every checked-in template. This becomes the first compatibility gate.

### 2. Introduce a versioned canonical schema

Add a required `schemaVersion`, treating existing unversioned documents as legacy version 0 and the new canonical shape as version 1.

The public contract should look conceptually like:

```ts
export const scoresheetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string().optional(),
  layout: scoresheetLayoutSchema.optional(),
  mode: scoresheetModeSchema.optional(),
  scoreKind: scoreKindSchema.optional(),
  eventId: positiveIdSchema.nullable().optional(),
  scoreDestination: scoreDestinationSchema.optional(),
  bracketSource: bracketSourceSchema.optional(),
  teamsDataSource: teamsDataSourceSchema.optional(),
  gameAreasImage: imageDataSchema.optional(),
  fields: z.array(scoresheetFieldSchema),
});

export type ScoresheetSchema = z.infer<typeof scoresheetSchema>;
```

Use strict objects so misspelled properties fail loudly. If arbitrary extensions are needed, add an explicit `metadata: z.record(z.string(), z.unknown())` instead of broadly allowing unknown keys.

### 3. Model fields as a discriminated union

Define shared primitives, then one schema per field type:

- `text`
- `number`
- `dropdown`
- `buttons`
- `checkbox`
- `calculated`
- `section_header`
- `group_header`
- `winner-select`
- `repeatableGroup`

All persisted/renderable fields should have non-empty `id`, `label`, and `type`. The raw JSON editor can remain a string while editing; it does not need a loosely typed “draft” object.

Important structural decisions:

- `buttons.options` is required and non-empty.
- A dropdown explicitly uses static options or a recognized data source.
- Calculated fields require a formula.
- Repeatable-group children are limited to the field types the UI actually renders.
- Repeatable-group rows become `Record<string, ScoresheetValue>`.
- Source and cascade variants use discriminated unions.
- Derived configurations use a union keyed by `derived.type`.

Types such as `RepeatableGroupField`, `CalculatedField`, and `ScoresheetFieldOption` should all be `z.infer` aliases.

### 4. Move semantic validation into refinements

Replace the current hand-written `validateScoresheetSchema` logic with `superRefine` rules colocated with the Zod definitions:

- IDs are unique within a schema and within each repeatable group.
- `min <= max`; `step > 0`; row limits are consistent.
- Defaults match their field type and numeric constraints.
- Static defaults match an option value.
- Repeatable defaults contain only known child IDs and valid child values.
- Unsupported `startValue` produces a targeted migration error.
- Derived output mappings point to valid compatible fields.
- Schema mode/source combinations are coherent.
- Data sources contain the fields required by their source type.

Formula reference validation should initially be conservative. Validate syntax and known references where reliable, but do not reject legitimate formula tokens until the formula evaluator has a defined grammar.

Retain compatibility exports temporarily:

```ts
export function validateScoresheetSchema(input: unknown) {
  const result = scoresheetSchema.safeParse(input);
  return result.success
    ? { ok: true, errors: [] }
    : { ok: false, errors: formatZodIssues(result.error.issues) };
}
```

That wrapper delegates to Zod; it contains no independent rules.

### 5. Add an explicit legacy normalization layer

Do not make the canonical schema permissive to accommodate old data. Instead add:

```ts
normalizeLegacyScoresheetSchema(input: unknown): unknown
parseScoresheetSchema(input: unknown): ScoresheetSchema
```

The parsing pipeline is:

```text
unknown input
    │
    ├─ schemaVersion: 1 ───────────────┐
    │                                  ▼
    └─ unversioned legacy normalizer → canonical Zod parser
                                       │
                                       ▼
                              ScoresheetSchema
```

Safe deterministic migrations can include:

- Adding `schemaVersion`
- Normalizing known legacy sheet sources into an explicit source variant
- Converting known field-template `name` properties to `id`/`label`
- Adding deterministic IDs to headers when no references depend on them

Do not invent IDs or semantics for scoring fields. Report those for manual repair.

### 6. Audit persisted data before enforcing strict reads

Add a read-only audit command for both SQLite and PostgreSQL that reports:

- Template or field-template ID and name
- Exact Zod issue path
- Whether automatic normalization is available
- The proposed normalized result without writing it

Then add an explicit migration command for safe conversions. Unrepairable active templates should not silently reach judges. Recommended rollout:

1. Strict validation for all new writes.
2. Legacy normalization on reads with structured warnings.
3. Audit and migrate production data.
4. Exclude still-invalid templates from judge/public endpoints while exposing their errors to admins.
5. Remove the legacy read path in a later cleanup release.

### 7. Apply parsing at every boundary

Server boundaries:

- Validate POST/PUT template bodies with the canonical schema.
- Validate field-template arrays using the same field schemas.
- Parse database JSON immediately after `JSON.parse`.
- Persist the normalized parsed value, not the original request object.
- Have `inferTemplateType` accept only canonical parsed schemas.

Client boundaries:

- Treat `response.json()` as `unknown`.
- Parse template-list, template-detail, and verified-template responses with shared response schemas.
- Keep the existing raw-score fallback when a historical template cannot be parsed.
- Show actionable schema errors in the admin editor rather than “Failed to save.”

The browser check is intentional defense in depth even though the server also validates.

### 8. Migrate consumers from `any`

Suggested order:

1. Schema builders in `scoresheetUtils`
2. Repeatable-group helpers
3. `ScoreSheetWizard`
4. `ScoresheetForm`
5. Template preview/editor components
6. `ScoreViewModal`

Builders should use `satisfies ScoresheetSchema` or return `ScoresheetSchema`, ensuring generated schemas are checked at compile time.

For dynamic submitted values, use `unknown` rather than forcing a false static type:

```ts
export type ScoresheetValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>[];

export interface ScoreDataEntry {
  label?: string;
  type?: ScoresheetFieldType;
  value: unknown;
  derived?: RepeatableGroupDerivedResult;
}
```

Once `normalizeRepeatableGroupRows` returns typed rows and template parsing yields `ScoresheetSchema`, the current `ScoreViewModal` errors disappear without casts.

### 9. Eliminate remaining duplicate validation

The portable exporter currently implements its own scoresheet/default validation. Convert it to a TypeScript entry point runnable through `ts-node`, and import the canonical parser.

Portable-only restrictions—such as rejecting database sources—remain a separate refinement layered on top of the canonical schema. They are capability rules, not duplicate schema definitions.

Update the schema guide from the canonical model and add `schemaVersion` to every checked-in example.

### 10. Verification and acceptance criteria

Required coverage:

- Positive test for every field and source variant
- Negative test for every refinement
- Legacy normalization fixtures
- Every checked-in template parses
- Every schema builder’s output parses
- API create/update rejects structurally invalid schemas
- Database reads handle invalid historical data deliberately
- Client displays a useful error or fallback for malformed payloads
- Portable export uses the shared parser
- Zod-inferred type tests for union narrowing
- No schema-related `any` suppressions in migrated consumers

Final verification:

```sh
npm run pretty
npm run lint
npm run typecheck:client
npm run typecheck:server
npm run test:run
npm run build
```

I would implement this as three reviewable changes: canonical Zod model and tests, legacy/server migration, then client and utility typing. That keeps the compatibility risks separate from the large `any` cleanup.