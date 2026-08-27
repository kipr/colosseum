# Type Safety and Score Validation Plan

Status: proposed, not yet implemented.

This document records the discussion and decisions about removing the 13
file-wide `eslint-disable @typescript-eslint/no-explicit-any` directives in the
scoresheet client and improving the integrity of submitted scores.

## Context

The client currently has 13 files with a file-wide disable for explicit `any`:

- `src/client/pages/Judge.tsx`
- `src/client/pages/Scoresheet.tsx`
- `src/client/components/AccessCodeModal.tsx`
- `src/client/components/ScoresheetForm.tsx`
- `src/client/components/scoresheetUtils.ts`
- `src/client/components/admin/FieldTemplateModal.tsx`
- `src/client/components/admin/ScoreSheetEditorModal.tsx`
- `src/client/components/admin/ScoreSheetWizard.tsx`
- `src/client/components/admin/ScoreSheetsTab.tsx`
- `src/client/components/admin/ScoreViewModal.tsx`
- `src/client/components/admin/ScoringTab.tsx`
- `src/client/components/admin/TemplateEditorModal.tsx`
- `src/client/components/admin/TemplatePreviewModal.tsx`

There are additional line-level suppressions in server framework boundaries and
tests. Those are related cleanup, but they are not the main source of the
scoresheet typing problem and should be handled separately.

The shared scoresheet types in `src/shared/scoresheetSchema.ts` already provide a
useful discriminated union for basic field types. However, the client uses schema
features that are not represented there, including structured data sources,
cascades, derived repeatable-group values, automatic row handling, score
destinations, bracket sources, and display/calculation flags. Replacing `any`
with the current `ScoresheetField` type would therefore be incomplete and would
encourage casts rather than genuine type safety.

The current feature and production-usage baseline is recorded in
[`SCORESHEET_SCHEMA_FEATURE_INVENTORY.md`](SCORESHEET_SCHEMA_FEATURE_INVENTORY.md).
It distinguishes behavior implemented by the application from properties that
are merely accepted, documented, or present in the partial shared types.

## Options Considered

The discussion considered four approaches. Scores are from 1 to 5, where 5 is
best or easiest.

| Approach                                               | Robustness | Implementation ease | Maintenance ease | Future compatibility |
| ------------------------------------------------------ | ---------: | ------------------: | ---------------: | -------------------: |
| Replace each `any` with local types or `unknown`       |          3 |                   4 |                2 |                    3 |
| Complete a shared compile-time domain model            |          4 |                   3 |                5 |                    4 |
| Use runtime schemas as the source of truth             |          5 |                   2 |                4 |                    5 |
| Combine shared types with targeted boundary validation |          5 |                   3 |                5 |                    5 |

Local replacement would be quick, but it would duplicate subtly different
versions of scoresheet, field, and score-data types across large components.

A complete shared TypeScript model would make changes visible to every consumer
and allow normal `field.type` narrowing. By itself, however, it would not prove
that network, storage, or database JSON conforms to those types at runtime.

A runtime-schema library such as Zod could combine runtime decoding and static
types, but it would add a client dependency and more machinery than this project
needs. Templates have one trusted author and are written and tested well before
an event. Full validation on every client read would consequently provide little
additional value.

The selected approach is a shared compile-time model plus focused,
dependency-free validation at authoritative server boundaries.

## Trust Model

### Templates

There is one template author. Templates are prepared and exercised in advance,
so accidental schema and scoring mistakes are likely to be found before an
event. The application does not need to treat every template response as hostile
input.

Server-side validation when a scoresheet template or reusable field template is
created or updated is still useful. It makes structural mistakes fail at Save
time, prevents unsupported data from entering the database, and covers bugs,
old clients, imports, migrations, or manual database changes.

Read-side client validation should be deliberately shallow. For example, loading
a template from `sessionStorage` only needs to establish that the parsed value is
an object with a schema and a fields array before passing it to typed application
code. Repeating the complete schema validator after every `response.json()` is
not warranted.

### Judges

Judges are generally trusted, but they are often volunteer coaches of competing
teams. A judge with a valid session can modify the browser client or submit an
HTTP request directly. Therefore the server must not treat client-calculated
scores as authoritative.

The current submission route validates important event, team, bracket-game, and
double-seeding relationships. It does not validate all submitted field values
against the selected template, and later acceptance logic consumes submitted
values such as `grand_total`, `team1_score`, `team2_score`, `team_a_total`, and
`team_b_total`. Admin review is valuable but is not a substitute for preventing a
plausible forged total.

Server-side score validation and calculation is consequently a required part of
this plan, not an optional future hardening step.

## Selected Design

### 1. Complete the shared TypeScript model

Extend `src/shared/scoresheetSchema.ts`, or split closely related declarations
into additional files under `src/shared`, to define:

- The complete scoresheet schema and every supported field variant.
- Structured data-source, cascade, bracket-source, and derived-output types.
- Primitive input values, repeatable-group rows, score entries, and score data.
- Stored/API template records and template summaries.
- Score-submission DTOs used by both the client and server.

Keep an explicit distinction between:

- raw input supplied by a judge;
- calculated or derived values;
- server-owned identifiers and metadata; and
- the canonical score record stored in `score_submissions`.

Application code should use concrete types. `unknown` should be reserved for
actual boundaries such as JSON parsing, request bodies, and generic database
normalization. It should be narrowed rather than cast through `any`.

### 2. Keep template validation server-side and focused

Continue using dependency-free domain validators for the two logical template
write boundaries:

1. scoresheet template create/update; and
2. field template create/update.

Expand the existing validators to cover the supported schema rather than only
default-value rules. Useful checks include:

- supported field types and property types;
- required and unique field IDs;
- valid options, defaults, number bounds, and steps;
- well-formed repeatable-group child fields;
- valid references from formulas, cascades, and derived outputs;
- valid data-source and bracket-source configurations; and
- incompatible property combinations.

These should remain straightforward domain functions, not a home-grown generic
schema-validation framework. They do not need to run throughout the client.

### 3. Make the server authoritative for scores

Create one score-normalization and calculation service used by every path that
can create or change score data. At minimum this includes judge submission and
admin score editing. Acceptance should either operate only on canonical data
produced by this service or revalidate legacy/noncanonical records before using
them.

For a submission, the server should:

1. Load the template identified by the judge's scoped session.
2. Parse and validate the stored template schema.
3. Require `scoreData` to be a plain object of score entries.
4. Validate submitted input fields recursively against the template.
5. Enforce required fields, primitive types, finite numeric values, bounds,
   steps, option membership, and repeatable-group row structure.
6. Validate dynamic selections against their authoritative database source when
   applicable, rather than trusting a submitted label or hidden ID.
7. Reject unknown judge-controlled fields unless they are part of an explicitly
   allowed compatibility policy.
8. Derive event, team, match, bracket, queue, and other server-owned identifiers
   from authenticated/session and database state wherever possible.
9. Recalculate calculated fields and derived outputs on the server.
10. Construct and store a canonical score record from validated raw inputs and
    server-computed values.

Client-supplied calculated values may be omitted entirely. If they are retained
for diagnostics or optimistic UI, the server should compare them with its own
result and reject or audit a mismatch; it must never accept them as the official
score merely because they have the expected shape.

Result-specific invariants already enforced for bracket and double-seeding
scores should remain in place and be integrated with this common pipeline.

### 4. Share safe calculation logic

The client currently evaluates template formulas with `eval()` in both the judge
form and the administrative score viewer. This has two problems:

- the server cannot safely use the same implementation to establish an
  authoritative result; and
- a malicious or corrupted template formula can execute JavaScript in the
  browser of a judge or administrator.

Replace `eval()` with a constrained formula evaluator supporting only the
operators and comparisons required by official templates. The evaluator should
parse or tokenize the permitted expression language and reject every unsupported
token. Do not attempt to sanitize arbitrary JavaScript.

Place the evaluator in `src/shared` and use the same implementation for client
display and server calculation. Pure derived scoring helpers, including
repeatable-group/Botball calculations currently needed only by the client,
should likewise move to a shared location or be exposed through a shared
registry so the server can recompute them.

### 5. Address template changes during an event

Server calculation must use the schema that governed the submitted score.
Changing a template while scores are pending could otherwise cause the server to
interpret old input with new rules.

Before implementation, choose and test one explicit policy:

- prevent scoring-relevant template edits once an associated event is active;
- version templates and store the version/hash on each score submission; or
- snapshot the scoring-relevant schema with each submission.

Template versioning is the most compatible long-term option. Preventing active
event edits is simpler if operational practice already treats templates as
frozen.

## What This Protects Against

The selected design protects against:

- a judge bypassing client controls or sending a direct request;
- omitted required values and invalid option choices;
- out-of-range, non-finite, or incorrectly typed values;
- fabricated calculated totals or derived outputs;
- hidden identifiers being changed to refer to another team, match, or event;
- malformed repeatable-group data;
- stale or modified client code submitting an unsupported shape;
- accidental malformed templates being stored;
- schema/client/server drift becoming a silent scoring error; and
- executable JavaScript being introduced through a template formula.

It does not prove that a template author's formula matches the competition rules,
that the intended fields were chosen, or that the form is operationally usable.
Advance template testing remains necessary for those concerns.

## Implementation Sequence

1. **Completed:** inventory the currently supported schema features and
   representative production templates (see
   [`SCORESHEET_SCHEMA_FEATURE_INVENTORY.md`](SCORESHEET_SCHEMA_FEATURE_INVENTORY.md)).
2. Complete the shared compile-time types without changing runtime behavior.
3. Type `scoresheetUtils.ts` and its pure scoring helpers.
4. Type `ScoresheetForm.tsx`, `ScoreViewModal.tsx`, and
   `TemplatePreviewModal.tsx`, followed by the smaller files.
5. Remove all 13 file-wide lint suppressions.
6. Expand server-side template and field-template write validation.
7. Define the permitted formula grammar and implement the shared safe evaluator.
8. Move or expose derived scoring helpers so they can run on the server.
9. Implement the canonical server score-validation/calculation service.
10. Route judge submission and admin score edits through that service.
11. Establish the active-event/template-version policy.
12. Clean up the remaining line-level `any` suppressions in database,
    Passport/Express, session-store, route, and test boundaries separately.

The type-only stages should remain behavior-preserving. Server-authoritative
calculation should be introduced with comparison logging or tests against known
scores before it begins rejecting mismatches at live events.

## Verification

Unit tests should cover every field type and validation rule, including nested
repeatable groups, formula parsing, and derived helpers. Important negative cases
include:

- a direct submission with an altered total;
- a value outside its configured bounds;
- a dropdown value not present in its options;
- a team or game ID from another event;
- an extra calculated field supplied by the client;
- malformed repeatable-group rows;
- unsupported formula tokens or function calls; and
- a submission made against a different template than the judge session.

Integration tests should exercise submit, edit, and accept paths and prove that
the stored and accepted score is the server-computed value. Existing official
templates should be run through the expanded template validator and used as
golden calculation fixtures.

Before merging each stage, run:

```bash
npm run pretty
npm run lint
npm run typecheck:client
npm run typecheck:server
npm run test:run
npm run build
```

## Conclusion

Colosseum should not add a general runtime-schema library to the client. Its 13
file-wide explicit-`any` suppressions should be removed by completing and reusing
a shared TypeScript domain model. Template runtime validation should remain a
small, dependency-free server concern at the two template write boundaries,
with only shallow structural checks in the client.

Because judges may have a competitive interest, the server must independently
validate raw score inputs and calculate official totals. Client calculations are
for interaction and preview only. A constrained shared formula evaluator,
server-capable derived scoring helpers, and an explicit template-version policy
are necessary parts of making that guarantee robust and maintainable.
