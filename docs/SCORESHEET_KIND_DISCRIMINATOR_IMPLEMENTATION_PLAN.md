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

# Item 3 implementation plan: runtime cutover and stored-template migration

Status: completed.

This section extends the item 2 plan with the implementation-sequence item 3
needed to make the compile-time contract the only runtime representation. The
cutover includes production data, runtime readers and writers, checked-in
templates, and historical-score viewing. It deliberately does not include the
expanded field-by-field validation planned for item 8.

## Migration mechanism decision

Implement the conversion as source-controlled TypeScript application migration
code, not as a hand-written production-only SQL update. Expose the same code
through a dry-run command and invoke its apply mode during database
initialization before the HTTP server starts accepting traffic.

The JSON is stored in a `TEXT` column and the conversion is conditional. A safe
migration needs to parse JSON, distinguish three archetypes, validate
conflicting signals, report template IDs and names, compare event linkage, and
behave identically in PostgreSQL and SQLite tests. Encoding all of that in a
one-off PostgreSQL expression would be harder to review and would leave no
executable regression test for the production transformation.

SQL and database commands still have a useful operational role: take a backup,
inspect the affected rows, and verify the result. They should not be a second
implementation of the transformation.

## Historical-template safety requirements

The migration must process every row in `scoresheet_templates`, not only active
templates or templates linked to current events. Historical score submissions
refer to those rows through `score_submissions.template_id` and the admin score
view needs their field definitions and labels.

The following are non-negotiable invariants:

- update each template row in place and preserve its `id`, access code, active
  state, event links, fields, field order, formulas, labels, images, and other
  schema properties;
- do not delete and recreate templates, and do not rewrite
  `score_submissions.score_data`;
- limit the automatic JSON change to adding the canonical `kind` and removing
  `mode` and `scoreKind`;
- include inactive, unlinked, and old-event templates in preflight, migration,
  and verification;
- roll back every template update if any one row is malformed, ambiguous, or
  inconsistent with its event-template linkage; and
- never retire or delete a production database template merely because a
  checked-in example with a similar shape is being retired.

Updating rows in place keeps every existing `score_submissions.template_id`
valid. This preserves viewing against the template version currently stored in
the database. It cannot reconstruct an older schema version that an admin may
have overwritten before this migration; exact per-submission schema snapshots
would be a separate template-versioning feature.

The current score modal has an additional historical-viewing gap unrelated to
JSON conversion: it looks up a score's template through the public template
list, which excludes inactive templates and templates belonging only to old
events. Item 3 must close that gap as part of the cutover rather than treating a
successful database update as sufficient.

## 1. Implement one deterministic transformer

Add a dependency-free function in a server database-migration module that
accepts a template identifier, name, raw schema text, and linked
`template_type` values. It should return either the canonical serialized schema
plus a changed/unchanged result, or a diagnostic containing the template ID and
name.

Use own-property checks rather than truthiness for discriminator keys. Apply
these rules:

1. Reject non-object JSON, malformed JSON, unsupported `kind`, `mode`, or
   `scoreKind` values, and the simultaneous presence of both legacy property
   names.
2. Treat supported existing `kind` as a canonical signal. This makes the
   migration idempotent.
3. Map `scoreKind: 'double_seeding'` to `kind: 'double_seeding'`.
4. Map `mode: 'head-to-head'` to `kind: 'bracket'`.
5. Preserve the current route's last legacy case by mapping a schema with no
   explicit discriminator but with `bracketSource` to `kind: 'bracket'`.
6. Map a schema with no discriminator and no `bracketSource` to
   `kind: 'seeding'`, matching current runtime behavior.
7. If canonical and legacy signals coexist, accept them only when every signal
   agrees; otherwise fail. Remove the agreeing legacy property from the output.
8. Require a bracket schema to have a structurally valid DB
   `bracketSource`. Reject `bracketSource` on seeding and double-seeding schemas
   rather than silently changing archetype semantics.
9. Compare the resulting `kind` with every associated
   `event_scoresheet_templates.template_type`. Fail if any linkage disagrees.
10. Delete `mode` and `scoreKind`, write `kind`, and leave all unrelated values
    semantically unchanged.

The migration should report all invalid templates in dry-run mode so they can
be fixed in one maintenance pass. Apply mode must make no changes if preflight
finds any error.

Do not put this transformer on a request read path. It is migration code, not a
compatibility decoder, and legacy schemas must not remain accepted after the
cutover.

## 2. Add transactional database orchestration

Add a migration function that loads all template rows and their distinct event
link types, transforms all rows, and updates changed rows in one transaction.
If enumeration must happen inside the transaction, extend the shared
`Transaction` interface and both database adapters with `all`; do not read rows
before the transaction and then assume they are unchanged.

Wire apply mode into database initialization after schema creation and before
the server begins listening. Repeated startup must produce zero changes after a
successful first run. Also add a command such as:

```bash
npm run migrate:scoresheet-kind -- --check
```

The check mode must connect to the configured database, run the identical
classification and linkage checks without writing, print one line per template
with its current and target archetype, include the number of referencing score
submissions, and exit nonzero on any blocker.

Because the old application cannot consume canonical-only templates and the new
application must not consume legacy templates, production deployment requires
a maintenance window or equivalent deployment barrier. Stop old writers before
apply mode begins and do not start them again after the transaction commits.
Idempotency protects retries and normal restarts; it is not a substitute for
this cutover ordering.

## 3. Preserve historical score rendering

Change the authenticated score-history response in
`src/server/routes/scores.ts` to select the referenced template schema directly
with each score row, regardless of template `is_active` state or event status.
Parse it at the server boundary and return it as the score's template schema.
Do not make the client search the public judge template list.

Update `ScoreViewModal.tsx` to use the schema supplied with the selected score.
Keep the raw score-data fallback for a genuinely missing or unparsable schema,
but do not silently substitute a different template by matching its name.
Template names are not stable identifiers.

Also replace hard deletion of scoresheet templates with archival
(`is_active = false`), at least whenever a template has score submissions. The
current foreign key uses `ON DELETE CASCADE`, so a physical delete can erase the
old scores whose display this plan is intended to preserve. The admin list and
judge list may continue to hide archived templates, while authenticated score
history must still be able to join them.

Add an integration test with an inactive template linked only to a completed
event and an existing score submission. It must prove that:

- migration preserves the template ID and submission foreign key;
- the score-history API returns the migrated schema;
- the modal does not request or depend on the public template list; and
- archiving the template leaves the score and its rendered field structure
  available.

## 4. Cut over server writes and inference

Strengthen `validateScoresheetSchema` only as far as this item requires:

- require `kind` to be `seeding`, `bracket`, or `double_seeding`;
- reject own properties named `mode` or `scoreKind`;
- require `bracketSource` for `kind: 'bracket'` and reject it for the other two
  kinds; and
- retain the existing default-value validation until the broader item 8 work.

Remove `inferTemplateType` from `src/server/routes/scoresheet.ts`. After schema
validation succeeds, use `schema.kind` directly when inserting
`event_scoresheet_templates.template_type`. Create and update requests with a
missing or unsupported kind or any legacy marker must return a 400 response.

Read paths should parse database JSON from `unknown` and perform a shallow
canonical discriminator check. They must report corrupt post-migration data;
they must not infer a kind from missing properties or cast legacy JSON to
`ScoresheetSchema`.

## 5. Cut over client builders and consumers

Update every schema builder in the same release:

- `ScoreSheetWizard.tsx` emits `kind: 'seeding'`;
- `buildDoubleEliminationSchema` emits `kind: 'bracket'` and no `mode`;
- `buildDoubleSeedingSchema` emits `kind: 'double_seeding'` and no
  `scoreKind`; and
- the manual editor's new-schema example includes a valid `kind` and the
  event-backed base properties it can derive from its `eventId` prop.

Update `ScoresheetForm.tsx` to derive head-to-head, double-seeding, and seeding
behavior solely from `schema.kind`. Narrow before accessing `bracketSource`.
Update `TemplateEditorModal.tsx` to identify bracket schemas only from
`kind: 'bracket'`; remove UI text and branches that promise support for legacy
bracket markers.

Where these files remain broadly untyped as part of the staged typing plan, add
small boundary predicates or local discriminated types instead of creating a
second inference helper.

## 6. Update checked-in templates and portable export

Audit files by shape rather than adding `kind` mechanically to every JSON file.
Reusable field arrays are not complete `ScoresheetSchema` objects and do not
need a discriminator. Complete online schemas must use canonical `kind` and DB
sources.

For `botball-de-template.json` and `botball-seeding-template.json`, either
convert unsupported spreadsheet sources to real DB-backed sources with an
explicit event-scoping strategy or move/rename them as documented legacy
examples that cannot be imported. Do not make a spreadsheet-backed schema look
canonical by changing only its discriminator.

Update the portable exporter and README to branch on `kind`. Portable V1 should
accept only the seeding-compatible archetype and reject `bracket` and
`double_seeding` with explicit messages. If bare field-array input remains
supported, document it as a portable input shorthand rather than a canonical
online scoresheet schema.

## 7. Test the migration and atomic cutover

Add focused unit tests for the pure transformer covering:

- all three legacy archetypes;
- bracket presence inference with no old explicit marker;
- already-canonical input and a second idempotent pass;
- removal of legacy keys while preserving every unrelated nested value;
- malformed JSON and non-object JSON;
- unsupported spellings and unsupported old marker values;
- simultaneous old markers, conflicting canonical/legacy signals, missing or
  invalid bracket source, and variant-incompatible bracket source; and
- matching, missing, multiple matching, and conflicting event-template links.

Add database integration tests proving all-row conversion, inactive and
unlinked template conversion, rollback when one of several rows is invalid,
preservation of template and score IDs, and zero writes on a second run. Run
these against SQLite through the normal database abstraction and add adapter or
PostgreSQL coverage for any dialect-specific orchestration.

Replace existing HTTP and client assertions about `mode`, `scoreKind`, missing
markers, and `bracketSource` inference with assertions about required `kind`.
Add negative HTTP tests showing that legacy or missing discriminators can no
longer enter the database.

## 8. Production runbook

Before the release:

1. Build the release artifact and run the migration check command against a
   recent production snapshot or read-only clone.
2. Resolve every reported malformed, ambiguous, source-invalid, or
   linkage-mismatched template by ID. Do not delete it to make preflight pass.
3. Exercise at least one old score from each archetype against the candidate
   build.
4. Take a provider-level database snapshot immediately before the maintenance
   window. Also keep a narrow logical backup if operationally convenient:

   ```bash
   pg_dump "$DATABASE_URL" --data-only --column-inserts \
     --table=public.scoresheet_templates \
     --table=public.event_scoresheet_templates \
     --table=public.score_submissions \
     > scoresheet-kind-backup.sql
   ```

During the release, stop the old application, run check mode again, run the
application migration/apply path, and then start only the new build. If the
transaction fails, it leaves all templates in the legacy form and the old build
can be restarted while the reported rows are repaired.

After apply mode, use read-only PostgreSQL checks such as:

```sql
SELECT id, name
FROM scoresheet_templates
WHERE schema::jsonb->>'kind' IS NULL
   OR schema::jsonb->>'kind' NOT IN ('seeding', 'bracket', 'double_seeding')
   OR schema::jsonb ? 'mode'
   OR schema::jsonb ? 'scoreKind';

SELECT st.id, st.name, est.template_type, st.schema::jsonb->>'kind' AS kind
FROM scoresheet_templates st
JOIN event_scoresheet_templates est ON est.template_id = st.id
WHERE est.template_type IS DISTINCT FROM st.schema::jsonb->>'kind';
```

Both queries must return zero rows. Then smoke-test active judge forms for all
three archetypes and authenticated viewing of old accepted scores, including an
inactive template and an event no longer in setup/active status.

Rollback after a successful commit requires rolling back the application and
restoring the pre-migration database snapshot or logical backup together. Do
not run the old application against canonical-only templates or reverse only
some rows by hand.

## Item 3 file impact

| Area                                                   | Planned change                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Server database migration module and tests             | Add the pure transformer, dry-run reporting, transactional apply, idempotency, and rollback coverage.                                    |
| `src/server/database/connection.ts` and initialization | Support transactional enumeration if needed and run migration before serving.                                                            |
| `src/shared/scoresheetSchema.ts`                       | Add the shallow runtime discriminator/legacy-key validation required at template boundaries.                                             |
| `src/server/routes/scoresheet.ts`                      | Remove inference, persist linkage from `kind`, reject legacy writes, and archive instead of destructively deleting referenced templates. |
| `src/server/routes/scores.ts` and `ScoreViewModal.tsx` | Carry the referenced schema with historical scores, including inactive and old-event templates.                                          |
| Client builders, form, and editor                      | Emit and consume `kind` only.                                                                                                            |
| Complete checked-in schemas and portable export        | Convert or explicitly retire legacy online schemas and reject unsupported portable kinds.                                                |
| HTTP, client, migration, and export tests              | Replace legacy expectations and add cutover and historical-viewing coverage.                                                             |

## Item 3 acceptance criteria

Item 3 is complete when:

- every production template row has exactly one supported `kind`, no `mode`,
  and no `scoreKind`;
- template IDs and score-submission references are unchanged;
- old scores remain viewable even when their template is inactive or their
  event is no longer public;
- deleting from the admin UI cannot cascade-delete historical scores;
- builders, readers, form behavior, linkage persistence, and export checks use
  `kind` only;
- request paths contain no compatibility inference for missing `kind`;
- the migration is diagnostic, transactional, idempotent, and tested for
  rollback;
- production preflight and post-migration verification report no invalid or
  mismatched templates; and
- formatting, lint, all typechecks, the full test suite, and the production
  build pass.
