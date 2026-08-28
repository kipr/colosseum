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
an object with a schema, a supported `kind`, and a fields array before passing it
to typed application code. Repeating the complete schema validator after every
`response.json()` is not warranted.

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

Use one required schema discriminator instead of encoding the scoring archetype
through the presence or absence of `mode` and `scoreKind`:

```ts
type ScoresheetSchema = ScoresheetSchemaBase &
  (
    | { kind: 'seeding' }
    | {
        kind: 'bracket';
        bracketSource: DbBracketSource;
      }
    | { kind: 'double_seeding' }
  );
```

The `kind` values are the existing `ScoreType` values: `seeding`, `bracket`,
and `double_seeding`. Reusing that vocabulary avoids a translation layer and
keeps schema branching, event-template linkage, submission DTOs, and persisted
score categories aligned.

`ScoresheetSchemaBase` requires `teamsDataSource: DbTeamsDataSource`, because
all three archetypes ultimately select teams from the event's DB-backed team
collection even though their selection UI differs.

`kind` is the sole archetype discriminator. Remove schema-level `mode` and
`scoreKind` from the supported model rather than retaining them as deprecated or
optional properties. Consumers must narrow on `kind` before reading
variant-specific sources; the shared type should not use optional `never`
properties merely to make those properties readable before narrowing.

Migrate templates directly while the application is between competition
seasons. Add an idempotent, transactional data migration that parses every
stored `scoresheet_templates.schema`, maps current unambiguous schemas to the
three `kind` values, removes `mode` and `scoreKind`, and writes the canonical JSON
back to the database. The migration must stop with a diagnostic identifying the
template if JSON is malformed, both old discriminators are present, or an old
discriminator has an unsupported value. Update schema builders, supported
checked-in templates, fixtures, and exports in the same change.

Do not add runtime normalization or a compatibility fallback for schemas missing
`kind`. Once the migration has run, template reads, writes, imports, and
validation should require the new discriminator. Checked-in examples that still
depend on unsupported spreadsheet sources must be retired or converted to DB
sources rather than made valid by the discriminator migration.

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

Replace `eval()` with a constrained formula evaluator that implements the
permitted language in [Permitted Formula Grammar](#permitted-formula-grammar).
The evaluator should parse or tokenize that language and reject every
unsupported token. Do not attempt to sanitize arbitrary JavaScript.

Place the evaluator in `src/shared` and use the same implementation for client
display, server calculation, and the portable scoresheet runtime. Pure derived
scoring helpers, including repeatable-group/Botball calculations currently
needed only by the client, should likewise move to a shared location or be
exposed through a shared registry so the server can recompute them.

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

## Permitted Formula Grammar

The safety goal is not to sanitize JavaScript. It is to stop parsing JavaScript.
A formula is a closed expression over field values that always yields a finite
number. Anything outside the token alphabet is a template-save error; anything
that does not type-check is also rejected. There is no `eval`, `new Function`,
member access, or call syntax.

This language is specified now so the shared parser and evaluator in sequence
step 9 are an implementation of a closed design rather than a second design
debate. Checked-in official formulas have been rewritten onto this subset.

Official scoring idioms that the language must cover:

- a weighted sum: `(poms * 2) + (cubes * 5)`
- a 2x / on-off multiplier: `subtotal * (botguy === '1' ? 2 : 1)`
- an identity-if-zero multiplier: `subtotal * (count > 0 ? count : 1)`
- a default-to-1 combined multiplier: `(a + b) || 1`
- a pass-through or sum of earlier calculated or derived IDs

JavaScript constructs observed in historical templates that are **not** part of
the language:

- bare truthiness (`field ? field : 0`), which is equivalent to `field` once
  blanks coerce to `0`
- boolean `||` (`a > 0 || b > 0`); the GCER pom-baskets formula uses numeric
  `|| 1` instead

### Tokens

- Identifier: `[a-z][a-z0-9_]*` — field IDs, earlier calculated IDs, and
  derived output IDs
- Number: `[0-9]+(\.[0-9]+)?` — no sign and no exponent (`1e3` is illegal)
- String: `'[a-zA-Z0-9_]*'` — single quotes, no escapes, no interior quotes
- Operators: `+` `*` `||` `>` `===` `?` `:`
- Grouping: `(` `)`
- Whitespace: space, tab, newline (insignificant)

No other characters. In particular the lexer rejects `.`, `[`, `]`, `,`, `;`,
backticks, double quotes, `/`, `%`, `&`, a single `|`, `=` except as part of
`===`, `-`, `!`, `{`, `}`, comments, and keywords.

### Grammar

```
formula         = numeric ;

numeric         = coalesce [ "?" numeric ":" numeric ] ;
coalesce        = additive { "||" additive } ;
additive        = multiplicative { "+" multiplicative } ;
multiplicative  = primary { "*" primary } ;
primary         = NUMBER | IDENTIFIER | "(" numeric ")" ;
```

Comparisons are not numeric. They are only legal as a ternary condition. The
parser still accepts them in the `numeric` slot with JavaScript-like precedence
(`?:` lowest, then `||`, then `===` / `>`, then `+`, then `*`) so existing
formulas keep the same grouping. The type checker then rejects any comparison
that is not the condition of `?:`.

Type rules:

- The top-level result must be a number.
- `+`, `*`, and `||` operands must be numbers. `||` means "if left is `0`, use
  right" (numeric zero-coalesce, not boolean OR).
- `>` operands must be numbers; the result is boolean.
- `===` is `number === number` or `identifier === string`. The identifier on
  the string form uses the raw stored value with no numeric coerce. The result
  is boolean.
- A ternary condition must be boolean; both branches must be numbers.
- String tokens are only legal as the right-hand side of `===`.
- `a || b ? c : d` is `(a || b) ? c : d`, which is a type error (a number used
  as a condition). Write a comparison.

This is the actual narrowing: the same symbols as a tiny JavaScript subset, but
truthy numbers and boolean `||` are illegal.

### Evaluation environment

Each identifier is looked up in a map of already-computed values. Never as a
JavaScript name.

Coercion when an identifier is used as a number:

- missing, `''`, `null`, `undefined` → `0`
- `false` → `0`, `true` → `1`
- finite number → itself
- numeric string → that number
- any other value → evaluation error (do not use `Number("small") || 0`)

`===` with a string uses the raw stored value, so button and dropdown strings
stay `'1'` rather than `1`. That replaces the current
`formula.includes(`${fieldId} ===`)` quoting hack in the judge form, admin
score viewer, and portable scoresheet runtime.

Missing or blank values coercing to `0` makes `field ? field : 0` redundant,
which is why those wrappers were deleted from checked-in templates.

The result must be a finite number. `NaN` and `Infinity` are evaluation errors.
At template save, unknown identifiers and forward references to calculated
fields are errors. At score time, a parse, type, or evaluation failure must not
become a silent `0` on the server (reject the submission). Client preview may
still show `0`.

Limits: formula length 1024 characters; AST depth 32. Current official formulas
are well under both (longest about 300 characters).

### Explicitly out of v1

- `-`, `/`, `%`, `**`, unary minus, `&&`, `==`, `!==`, `<`, `<=`, `>=`
- Function calls (`min`, `max`, or anything else) — there is no call
  production, so `ident(` is always a parse error
- Property or index access, assignment, comma, `new`, `typeof`, and the
  literals `true` / `false` / `null`
- Forward references, and identifiers that are not in-scope field or output IDs

Binary `-` can be added later without changing the safety model. `/` and calls
should stay out unless a real template needs them.

When sequence step 9 lands, `tools/portable-scoresheet/runtime.js` must use the
same shared evaluator rather than keeping a second `eval()` implementation.

### Accepted examples

- `side_a_score + side_b_score`
- `(poms * 2) + (cubes * 5)`
- `subtotal * (botguy === '1' ? 2 : 1)`
- `subtotal * (count > 0 ? count : 1)`
- `((drum === '1' ? 2 : 0) + (botguy === '1' ? 2 : 0)) || 1`

### Rejected examples

- `constructor.constructor("alert(1)")()` — call, member access, and illegal
  string escaping
- `field ? field : 0` — number used as a condition
- `a > 0 || b > 0` — boolean `||`
- `sum / 2`, `base - penalty`, `max(a, 1)`, `field == '1'`, `"1"`, `1e3`,
  comments, `true`

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
2. **Completed:** replace the transitional `mode`/`scoreKind` schema union with
   the required `kind` discriminated union (see
   [`SCORESHEET_KIND_DISCRIMINATOR_IMPLEMENTATION_PLAN.md`](SCORESHEET_KIND_DISCRIMINATOR_IMPLEMENTATION_PLAN.md)).
3. Add and run the direct stored-template migration; update schema builders,
   supported checked-in templates, fixtures, exports, and validators atomically.
4. Complete the remaining shared compile-time types.
5. Type `scoresheetUtils.ts` and its pure scoring helpers.
6. Type `ScoresheetForm.tsx`, `ScoreViewModal.tsx`, and
   `TemplatePreviewModal.tsx`, followed by the smaller files.
7. Remove all 13 file-wide lint suppressions.
8. Expand server-side template and field-template write validation.
9. **Grammar specified:** implement the shared safe evaluator for the
   [permitted formula language](#permitted-formula-grammar). Swap it into the
   judge form, admin score viewer, and portable scoresheet runtime.
10. Move or expose derived scoring helpers so they can run on the server.
11. Implement the canonical server score-validation/calculation service.
12. Route judge submission and admin score edits through that service.
13. Establish the active-event/template-version policy.
14. Clean up the remaining line-level `any` suppressions in database,
    Passport/Express, session-store, route, and test boundaries separately.

Except for the deliberate template-discriminator data migration, the type-only
stages should remain behavior-preserving. The migration and all updated readers
and writers must ship atomically; there is intentionally no runtime compatibility
period. Server-authoritative calculation should be introduced with comparison
logging or tests against known scores before it begins rejecting mismatches at
live events.

The compile-time model includes `gameAreasImage`, which is used in production,
and `maxRows`, whose client and server enforcement remains future work. It does
not include legacy spreadsheet-related source keys. Canonical number entries use
JSON numbers; finite historical numeric strings require a one-time migration
before strict typed consumers are adopted. Repeatable-group derivations use a
generic registry contract so the permanent shared model does not encode fields
or outputs from a particular year's game.

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

Migration tests should cover all three old archetypes, verify removal of `mode`
and `scoreKind`, prove the migration is idempotent, and verify that malformed or
ambiguous templates fail with their template ID. After migration, template
validation and shallow client boundary checks must reject schemas without a
supported `kind`.

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
