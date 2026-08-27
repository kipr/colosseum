# Scoresheet `kind` Discriminator Implementation Plan

Status: proposed.

## Scope anchor

This document is the implementation plan for item 2 in the **Implementation
Sequence** of
[`TYPES_AND_SCORE_VALIDATION_PLAN.md`](TYPES_AND_SCORE_VALIDATION_PLAN.md):

> Replace the transitional `mode`/`scoreKind` schema union with the required
> `kind` discriminated union.

It does not implement item 2 under **Selected Design** (expanded server-side
template validation), which is implementation-sequence item 8.

This step establishes the final compile-time schema contract. It does not yet
change stored JSON or the runtime code that creates and consumes schemas. Those
runtime changes belong to implementation-sequence item 3 and must ship
atomically with the stored-template migration.

## Goal

Make `kind` the single, required TypeScript discriminator for the three
scoresheet archetypes:

| Schema archetype | Shared `kind` / `ScoreType` value | Required variant data |
| ---------------- | --------------------------------- | --------------------- |
| Seeding          | `seeding`                         | Base schema only      |
| Head-to-head     | `bracket`                         | `bracketSource`       |
| Double seeding   | `double_seeding`                  | Base schema only      |

The schema discriminator deliberately reuses the existing database/API
`ScoreType` vocabulary. This avoids translating equivalent category names at
schema, event-template linkage, submission, and persistence boundaries. The
archetype remains named `HeadToHeadScoresheetSchema` in TypeScript because that
describes its behavior, while its shared category value is `bracket`.

At the end of this step, typed application code must be able to narrow a
`ScoresheetSchema` using `schema.kind`, and a schema literal without a supported
`kind` must fail the shared typecheck.

## Current state

`src/shared/scoresheetSchema.ts` currently exposes a transitional union:

- `SeedingScoresheetSchema` is identified by the absence of both legacy
  markers.
- `HeadToHeadScoresheetSchema` requires `mode: 'head-to-head'` and a
  `bracketSource`.
- `DoubleSeedingScoresheetSchema` requires
  `scoreKind: 'double_seeding'`.
- Optional `never` properties make legacy and variant-specific properties
  readable before the union is narrowed.

The canonical types currently have only one direct compile-time contract suite,
`tests/types/scoresheetSchema.test-d.ts`. Runtime components still use `any` for
templates, so changing the union alone will not update their behavior or make
them type safe.

Runtime behavior still infers archetypes in this order:

1. `scoreKind === 'double_seeding'`;
2. `mode === 'head-to-head'` or, in the template route, the presence of
   `bracketSource`; and
3. otherwise seeding.

That runtime behavior remains temporarily unchanged by this step. Item 3 removes
the inference and compatibility behavior after migrating persisted schemas.

## Design decisions

### One required discriminator

Use the existing exported `ScoreType` vocabulary:

```ts
export type ScoreType = 'seeding' | 'bracket' | 'double_seeding';
```

Each concrete schema interface declares the corresponding literal `kind` so
TypeScript can discriminate the union:

```ts
export interface SeedingScoresheetSchema extends ScoresheetSchemaBase {
  kind: 'seeding';
}

export interface HeadToHeadScoresheetSchema extends ScoresheetSchemaBase {
  kind: 'bracket';
  bracketSource: DbBracketSource;
}

export interface DoubleSeedingScoresheetSchema extends ScoresheetSchemaBase {
  kind: 'double_seeding';
}
```

Keep `ScoresheetSchema` as the union of these named interfaces. The named types
are useful to builders and consumers that already know the archetype, while the
union provides normal control-flow narrowing. Do not introduce a separate
schema-kind vocabulary. When code needs the union of discriminator values, use
`ScoresheetSchema['kind']` or `ScoreType`.

### No legacy properties in the canonical model

Remove `mode` and `scoreKind` from all three interfaces. Do not retain them as
deprecated properties, optional properties, or `never` properties. The
canonical type should describe only the post-migration representation.

This is stricter than declaring `mode?: never` and `scoreKind?: never`: those
declarations keep the old property names visible and can encourage code to keep
probing them. Fresh object literals containing either property should instead
fail excess-property checking.

### Narrow before reading variant data

Only `HeadToHeadScoresheetSchema` declares `bracketSource`. Do not add
`bracketSource?: never` to seeding or double-seeding schemas just to allow an
unnarrowed read. Consumers must first establish
`schema.kind === 'bracket'` (or use an exhaustive switch) before reading
`schema.bracketSource`.

`teamsDataSource` remains required in `ScoresheetSchemaBase`, so it is available
for all three archetypes without narrowing. No other schema or field types are
changed in this step.

### No runtime compatibility decoder

Do not add a function that converts missing `kind`, `mode`, `scoreKind`, or the
presence of `bracketSource` into a canonical typed schema. The agreed cutover is
a direct data migration with no runtime compatibility period. Adding a decoder
in item 2 would create a second migration policy and make it easier for legacy
schemas to continue entering the system.

## Implementation steps

### 1. Replace the shared union contract

Edit `src/shared/scoresheetSchema.ts`:

1. Move the existing `ScoreType` declaration next to the schema-level
   declarations if needed for readability; do not change its values or export
   name.
2. Remove the transitional-model TODO and rewrite its surrounding comments to
   describe `kind` as the sole archetype discriminator.
3. Add the required literal `kind` to each concrete schema interface.
4. Remove all interface declarations for `mode`, `scoreKind`, and the optional
   `never` form of `bracketSource`.
5. Keep `bracketSource: DbBracketSource` required only on
   `HeadToHeadScoresheetSchema`.
6. Leave the existing `ScoresheetSchema` union, `ScoresheetSchemaBase`,
   `DbBracketSource`, `DbTeamsDataSource`, and `ScoreType` names intact. Ensure
   `ScoresheetSchema['kind']` and `ScoreType` contain the same literals.
7. Search the shared module's comments for descriptions of transitional
   inference and update only comments that claim the compile-time model accepts
   legacy markers. Do not strengthen the runtime validator in this step.

The change should be declaration-only: it must not emit JavaScript or alter a
runtime code path.

### 2. Convert the positive compile-time fixtures

Edit `tests/types/scoresheetSchema.test-d.ts`:

1. Add a type-level equality assertion proving that `ScoresheetSchema['kind']`
   and `ScoreType` contain exactly the same literals.
2. Add `kind: 'seeding'` to the seeding fixture.
3. Replace `mode: 'head-to-head'` with `kind: 'bracket'` in the head-to-head
   fixture and retain its required `bracketSource`.
4. Replace `scoreKind: 'double_seeding'` with `kind: 'double_seeding'` in the
   double-seeding fixture.
5. Keep the fixtures checked with `satisfies` rather than broad type assertions,
   preserving literal types and excess-property checks.

### 3. Add discriminator and narrowing contract tests

Extend `tests/types/scoresheetSchema.test-d.ts` with compile-time assertions for
the behavior this step is intended to guarantee:

- all three canonical schema literals are accepted;
- an exhaustive `switch (schema.kind)` can handle every variant;
- `schema.bracketSource` is available in the `bracket` branch;
- reading `schema.bracketSource` before narrowing is a type error;
- a head-to-head schema without `bracketSource` is rejected;
- a schema with no `kind` is rejected, even when the other base properties are
  valid;
- unsupported `kind` values are rejected;
- alternate schema spellings such as `kind: 'head-to-head'` and
  `kind: 'double-seeding'` are rejected;
- legacy `mode` and `scoreKind` properties are rejected on fresh schema
  literals; and
- seeding or double-seeding literals with a `bracketSource` are rejected.

Use `@ts-expect-error` on the smallest expression that is expected to fail. The
shared typecheck must fail if any negative example unexpectedly becomes valid.
For exhaustiveness, assign the switch default value to `never` rather than
depending on a runtime assertion helper.

### 4. Confirm the step has no accidental runtime reach

Before finishing, search the repository for direct imports of
`ScoresheetSchema`, `SeedingScoresheetSchema`,
`HeadToHeadScoresheetSchema`, and `DoubleSeedingScoresheetSchema`.

At the current baseline, only `src/shared/scoresheetSchema.ts` and
`tests/types/scoresheetSchema.test-d.ts` directly use the canonical schema
union. If a new runtime consumer has appeared, inspect it rather than assuming
the change remains type-only:

- update it to narrow on `kind` only if it already receives post-migration
  canonical data; or
- leave its runtime cutover for item 3 and document why it cannot yet adopt the
  new type.

Do not make an unvalidated legacy JSON object satisfy the new type with `as
ScoresheetSchema`.

### 5. Record completion without misrepresenting runtime status

Once the type change and tests are merged, mark implementation-sequence item 2
as completed in `docs/TYPES_AND_SCORE_VALIDATION_PLAN.md` if project convention
is to update the sequence as work lands.

Do not update `docs/SCORESHEET_SCHEMA_FEATURE_INVENTORY.md` to say runtime uses
`kind` yet. Until item 3 lands, that inventory correctly describes the current
client/server behavior and checked-in data.

## File impact

| File                                      | Planned change                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/shared/scoresheetSchema.ts`          | Reuse the `ScoreType` vocabulary for `kind` and replace the transitional schema interfaces. |
| `tests/types/scoresheetSchema.test-d.ts`  | Convert positive fixtures and add negative/narrowing coverage.                              |
| `docs/TYPES_AND_SCORE_VALIDATION_PLAN.md` | Optionally mark sequence item 2 completed after the implementation merges.                  |

No database schema file or migration is part of this step.

## Explicitly deferred to item 3

The following known runtime locations still create, infer, inspect, reject, or
test legacy schema markers. They must be handled with the stored-template
migration in the next implementation item, not partially changed here:

- `src/server/routes/scoresheet.ts`: replace `inferTemplateType` legacy-marker
  precedence and `bracketSource`-presence inference with exhaustive `kind`
  mapping after write validation establishes the canonical shape.
- `src/client/components/scoresheetUtils.ts`: make the double-elimination and
  double-seeding builders emit `kind: 'bracket'` and
  `kind: 'double_seeding'`, respectively.
- `src/client/components/admin/ScoreSheetWizard.tsx`: make seeding generation
  emit `kind: 'seeding'`.
- `src/client/components/ScoresheetForm.tsx`: derive behavior from `kind` and
  narrow before accessing `bracketSource`.
- `src/client/components/admin/TemplateEditorModal.tsx`: identify bracket
  schemas from `kind`, not legacy markers or source presence.
- `tools/portable-scoresheet/export-html.mjs` and its README: reject unsupported
  canonical kinds instead of checking `schema.mode`.
- `templates/botball-de-template.json` and any complete seeding templates:
  replace or add the canonical discriminator while separately retiring or
  converting unsupported spreadsheet sources as required by item 3.
- HTTP and client tests that currently assert `mode`, `scoreKind`, missing
  markers, or `bracketSource` inference.
- `validateScoresheetSchema`: require a supported `kind` and reject legacy
  markers at the write boundary only as part of the atomic runtime cutover.
- the idempotent, transactional migration of every stored
  `scoresheet_templates.schema` JSON value.

This separation matters because changing a builder or reader in item 2 would
create mixed-format runtime data. Conversely, strengthening the validator before
the migration and builders land would prevent existing templates from being
saved.

## Verification

Run the focused contract check first:

```bash
npm run typecheck:shared
```

Then run formatting and the full repository verification required by the parent
plan:

```bash
npx prettier --check src/shared/scoresheetSchema.ts \
  tests/types/scoresheetSchema.test-d.ts \
  docs/SCORESHEET_KIND_DISCRIMINATOR_IMPLEMENTATION_PLAN.md
npm run pretty
npm run lint
npm run typecheck:client
npm run typecheck:server
npm run test:run
npm run build
```

The client and server checks are regression checks: item 2 should not change
runtime output, HTTP behavior, checked-in JSON, or generated assets.

## Acceptance criteria

Item 2 is complete when all of the following are true:

- `ScoresheetSchema` is discriminated solely by required `kind` literals.
- The exact supported schema values are `seeding`, `bracket`, and
  `double_seeding`, matching `ScoreType` exactly.
- Neither `mode` nor `scoreKind` appears in a canonical schema interface.
- Only the head-to-head interface exposes `bracketSource`.
- No optional `never` properties are used to permit pre-narrowing access to
  variant-specific properties.
- Compile-time tests prove positive construction, negative legacy cases, and
  control-flow narrowing.
- `ScoreType` remains unchanged.
- No runtime builder, reader, validator, template JSON, or database row is
  partially migrated in this step.
- The focused typecheck and the repository verification suite pass.

## Delivery and item 3 handoff

The item 2 implementation can be reviewed as an isolated type-contract commit,
but it creates a deliberate temporary distinction between the canonical
TypeScript model and runtime legacy JSON. If the deployment process publishes
every merged commit, deliver items 2 and 3 in one non-deployed branch or one PR
so this intermediate state is never treated as a completed runtime migration.

Item 3 must use the exact `kind` literals fixed here, migrate stored templates,
and update all runtime readers and writers in one release. It must not introduce
a fallback for schemas without `kind`.
