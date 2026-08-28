# Scoresheet Schema Feature Inventory

This inventory completes step 1 of the implementation sequence in
[`TYPES_AND_SCORE_VALIDATION_PLAN.md`](TYPES_AND_SCORE_VALIDATION_PLAN.md). It
records the schema behavior the application implements today, independent of
what the incomplete types in `src/shared/scoresheetSchema.ts` happen to declare.

## Scope and frequency method

"Supported" means that at least one current application surface interprets a
property and gives it runtime behavior. It does **not** mean that the server
currently validates the property or recomputes its result. Those enforcement
gaps are the subject of the validation plan.

The frequency counts below use the active, competition-oriented templates in
the supplied SQLite database as a point-in-time operational sample (2026-08-27):

- 9 competition templates and 54 score submissions;
- 3 seeding templates with 10 submissions;
- 3 double-elimination templates with 30 submissions; and
- 3 double-seeding templates with 14 submissions.

The intentionally named `default values tests` template is excluded. `T` means
the number of the 9 templates containing the feature; `F` means the number of
field occurrences, recursively including repeatable-group child fields. Counts
show adoption, not a guarantee that every field was filled in every submission.

The checked-in production-oriented sources provide representative fixtures:

| Source                                                                        | What it represents                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `templates/botball-gcer-2026-scoring-fields.json`                             | Current reusable two-sided scoring fields, including both repeatable-group derivations. |
| `templates/botball-2026-scoring-fields.json`                                  | Earlier two-sided scoring fields with scalar inputs and formulas.                       |
| `templates/botball-2026-fall-scoring-fields.json`                             | Alternate rule set using the same scalar, multiplier, total, and layout features.       |
| `templates/botball-seeding-template.json`                                     | Complete seeding schema and the legacy spreadsheet-source shape.                        |
| `templates/botball-de-template.json`                                          | Complete head-to-head schema with bracket selection and winner selection.               |
| `templates/demo-default-values.json` and `templates/test-default-values.json` | Non-production coverage for typed defaults and portable export.                         |

The wizard wraps reusable field arrays with current DB-backed event metadata.
It also adapts `side_a`/`side_b` IDs, formulas, and derived-output references to
`team_a`/`team_b` for double elimination and double seeding.

## Schema-level features

| Feature                       | Purpose and current behavior                                                                                                                                                                                                                                                                                                  |                                                               Frequency |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------: |
| `fields`                      | Ordered list of fields. Order controls rendering and formula evaluation order.                                                                                                                                                                                                                                                |                                                                     9/9 |
| `title`                       | Heading displayed on the judge form and admin views.                                                                                                                                                                                                                                                                          |                                                                     9/9 |
| `layout: "two-column"`        | Renders fields with `column: "left"` and `"right"` side by side. Any other or absent value falls back to the limited single-column path.                                                                                                                                                                                      |                                                                     9/9 |
| `eventId`                     | Scopes team, queue, bracket, chat, and submission operations to an event.                                                                                                                                                                                                                                                     |                                                                     9/9 |
| `scoreDestination: "db"`      | Enables the event-backed submission paths. The current server rejects submissions that are not event scoped, so this is effectively required for usable online scoring.                                                                                                                                                       |                                                                     9/9 |
| `mode: "head-to-head"`        | Selects bracket scoring: bracket-game selection, two teams, winner/result controls, and bracket submission metadata.                                                                                                                                                                                                          |                                                     3/9; 30 submissions |
| `scoreKind: "double_seeding"` | Selects double-seeding queue behavior, separate side totals, solo-run handling, and no winner control.                                                                                                                                                                                                                        |                                                     3/9; 14 submissions |
| `bracketSource`               | Configures DB bracket-game lookup. Current generated schemas use `{type:"db", scope:"event", eventId}`; the client also retains a bracket-specific `{type:"db", bracketId}` compatibility path.                                                                                                                               |                                                     3/9; 30 submissions |
| `teamsDataSource`             | Canonical event-team collection and team-number/name property mapping. Head-to-head consumes it for display lookup; seeding and double-seeding selectors are populated through their DB-backed queues (with legacy seeding dropdowns also declaring the endpoint at field level). New schemas require it for every archetype. | Present in 6/9 legacy samples; actively consumed by 3 bracket templates |
| `gameAreasImage`              | Data URL or URL shown in an optional full-screen game-area reference overlay; the template editor manages it separately from the JSON textarea. Portable export also supports it. It is confirmed in production use even though it is absent from this local sample.                                                          |                0/9 locally; confirmed production use outside the sample |

### Scoring archetype selection

The effective discriminator order is:

1. `scoreKind === "double_seeding"`;
2. otherwise `mode === "head-to-head"` (or, for server-side template-type
   inference only, the presence of `bracketSource`);
3. otherwise seeding.

These markers are behavior-bearing discriminants and should be modeled as such,
instead of leaving `mode` and `scoreKind` as unrestricted strings.

## Field types

| Type              | Purpose and current behavior                                                                                                                                         | Operational frequency |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------: |
| `text`            | Free-form string input. `autoPopulated` makes the top-level control read-only.                                                                                       |           9/9 T, 42 F |
| `number`          | Numeric input with UI min/max clamping and step metadata. Blank top-level values are submitted as `0`; values are currently stored as entered strings in many cases. |          9/9 T, 831 F |
| `dropdown`        | Static `options`, a DB-backed team selector, or the special bracket-game selector. Queue-backed seeding hides its schema team dropdown in favor of a queue selector. |            6/9 T, 6 F |
| `buttons`         | Single-choice button group backed by `options`.                                                                                                                      |           9/9 T, 90 F |
| `checkbox`        | Boolean checkbox. In current competition schemas it is used only inside repeatable groups.                                                                           |           9/9 T, 90 F |
| `calculated`      | Read-only value produced by a formula. Calculated values are included in submissions and are not yet recomputed by the server.                                       |          9/9 T, 165 F |
| `section_header`  | Major visual divider, commonly one per side. It is omitted from submitted score data.                                                                                |           9/9 T, 18 F |
| `group_header`    | Smaller visual divider within a side. It is omitted from submitted score data.                                                                                       |          9/9 T, 144 F |
| `winner-select`   | Specialized Team A/Team B winner control using the selected bracket game and `team_a_total`/`team_b_total`; declared `options` are not used to render it.            |            3/9 T, 3 F |
| `repeatableGroup` | Table of repeated interactive child fields with automatic row management and optional registered derivation logic.                                                   |           9/9 T, 90 F |

Repeatable groups recursively support only `text`, `number`, `dropdown`,
`buttons`, and `checkbox` children. Nested calculated fields, headers,
winner-selects, and repeatable groups are not rendered.

## Common and type-specific field properties

| Property             | Applies to                               | Purpose and current behavior                                                                                                                                            |                                Operational frequency |
| -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------: |
| `id`                 | All behavior-bearing fields              | Score-data key, formula identifier, cascade target, and React key. IDs are effectively required and must be unique, but save-time validation does not enforce that yet. |                                       9/9 T, 1,479 F |
| `label`              | All fields                               | Human-readable field/header text and the label copied into submitted score entries.                                                                                     |                                       9/9 T, 1,479 F |
| `type`               | All fields                               | Selects rendering, initialization, calculation, and submission behavior.                                                                                                |                                       9/9 T, 1,479 F |
| `column`             | Top-level fields                         | `left`/`right` placement for two-column schemas. Uncolumned interactive fields render in the header area; uncolumned grand totals render at the bottom.                 |                                         9/9 T, 951 F |
| `required`           | Interactive fields                       | Sets browser required state. It is not currently enforced against direct submissions by the server.                                                                     |                                         9/9 T, 576 F |
| `placeholder`        | Text and number fields                   | Empty-control hint.                                                                                                                                                     |                                          9/9 T, 45 F |
| `suffix`             | Displayed fields/groups                  | Appends scoring-unit or multiplier text to the label. It has no calculation semantics.                                                                                  |                                         9/9 T, 506 F |
| `min`, `max`, `step` | Number fields                            | Configure HTML number inputs and client-side clamping/steppers. The server does not yet enforce them.                                                                   | `min` 831 F; `max` 810 F; `step` 815 F, all in 9/9 T |
| `options`            | Dropdowns, buttons, winner-select        | Label/value pairs for static choices. Winner-select rendering is hard-coded rather than option-driven.                                                                  |                                          9/9 T, 93 F |
| `formula`            | Calculated fields                        | Expression evaluated against raw values, previously calculated fields, and registered derived outputs.                                                                  |                                         9/9 T, 165 F |
| `isTotal`            | Calculated fields                        | Applies total styling/font weight; it does not change calculation or submission semantics.                                                                              |                                          9/9 T, 18 F |
| `isGrandTotal`       | Calculated fields                        | Applies grand-total styling and causes a bottom-of-form render pass.                                                                                                    |                                           3/9 T, 3 F |
| `isMultiplier`       | Number/buttons fields                    | Applies multiplier styling and label text only; the formula must still perform the multiplication.                                                                      |                                         9/9 T, 146 F |
| `autoPopulated`      | Primarily text fields                    | Disables manual editing. Queue, bracket, or cascade code is responsible for supplying the value.                                                                        |                                          9/9 T, 43 F |
| `defaultValue`       | Interactive fields and repeatable groups | Initial/reset value. Types and bounds are checked at template/field-template save and portable export.                                                                  |           0/9 competition T; demo/test fixtures only |

`defaultValue` accepts a string for `text`, a finite number for `number`, a
string/number/boolean matching static options for `dropdown` and `buttons`, a
boolean for `checkbox`, and an array of child-value objects for
`repeatableGroup`. It is prohibited on calculated/header/winner fields. The
legacy `startValue` property is explicitly rejected.

## Dynamic data and cascades

Two dropdown source variants have runtime support:

| Configuration                                              | Purpose                                                                                    | Frequency |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------: |
| `dataSource: {type:"db", eventId, labelField, valueField}` | Loads event teams into a dropdown. `labelField` and `valueField` default to `team_number`. |     3/9 T |
| `dataSource: {type:"bracket"}`                             | Uses games loaded through schema-level `bracketSource`.                                    |     3/9 T |

For a non-head-to-head DB dropdown, `cascades: {targetField, sourceField}` copies
a property from the selected source row into one other field. This shape is used
by all 3 seeding templates, although their dropdown is normally replaced by the
queue UI. Bracket schemas contain a multi-target mapping form of `cascades`, but
the current bracket selection handler populates the fixed team fields directly;
it does not interpret that mapping. Spreadsheet-style sources with `sheetName`
and `range` remain in older checked-in examples but are no longer loaded by the
React client.

## Repeatable-group features

| Property             | Purpose and current behavior                                                                                                                                     | Operational frequency |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------: |
| `fields`             | Child column definitions; only the five interactive child types listed above render.                                                                             |           9/9 T, 90 F |
| `rowLabel`           | Header and numbered-row label; defaults to `Row`.                                                                                                                |           9/9 T, 90 F |
| `minRows`            | Minimum initialized row count; positive values are floored, otherwise the runtime uses 1.                                                                        |           9/9 T, 90 F |
| `autoAppendBlankRow` | Adds a blank row when the last row receives data.                                                                                                                |           9/9 T, 90 F |
| `pruneBlankRows`     | Removes blank rows before derivation and submission.                                                                                                             |           9/9 T, 90 F |
| `derived`            | Selects a registered domain helper and maps its aggregate values to top-level formula/score IDs. Derived row metadata is also stored with the group score entry. |           9/9 T, 90 F |

There are exactly two implemented derived registries:

| `derived.type`         | Purpose                                                                                                                                                       |        Frequency |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------: |
| `botballStartBoxCubes` | Scores cube type, quantity, and optional pallet multiplier; exposes `subtotal`.                                                                               | 9/9 T, 36 groups |
| `botballCubeStacks`    | Scores sorted/unsorted cube equivalents using configured `sortedValue` and `unsortedValue`; exposes `sortedEquivalent`, `unsortedEquivalent`, and `subtotal`. | 9/9 T, 54 groups |

`derived.outputs` maps those named outputs to top-level field IDs. The outputs
are injected into formula evaluation and emitted as normal score entries so
existing total and review paths can consume them.

## Formula usage

The 165 calculated fields in the operational sample all use addition; 144 use
multiplication, 110 use a ternary, 90 use a comparison, 18 use strict equality,
and 4 use logical OR. Current expressions also rely on parentheses and references
to calculated fields defined earlier in `fields`.

The runtime currently substitutes field identifiers and calls JavaScript
`eval()`, so arbitrary JavaScript is still technically accepted at evaluation
time. That observed `eval()` surface is **not** the permitted language. The
closed grammar, type rules, and accepted/rejected examples are specified in
[`TYPES_AND_SCORE_VALIDATION_PLAN.md`](TYPES_AND_SCORE_VALIDATION_PLAN.md)
under Permitted Formula Grammar.

Two historical JavaScript idioms were present in checked-in templates and have
been rewritten onto that subset:

- bare truthiness (`field ? field : 0`) became the field itself, because blanks
  coerce to `0`
- boolean `||` in the GCER pom-baskets formulas (`a > 0 || b > 0 ? … : 1`)
  became numeric zero-coalesce (`(inner) || 1`)

Numeric `|| 1` (default-to-1 combined multiplier) remains legal. The 2026
pom-baskets formula was not rewritten into the GCER form: when both multipliers
are 0 it currently yields `2`, not `1`.

## Surface differences and non-features

The following accepted or declared properties must not be mistaken for fully
supported behavior:

| Property/configuration                     | Current status                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxRows`                                  | Supported by the shared type but not yet enforced; automatic append, submission validation, and server validation must enforce it in a later stage. |
| `schemaVersion`                            | Present on one operational template but not read by application code; passive metadata only.                                                        |
| `schema.description` / field `description` | Rendered by portable export, not by the main React judge form or admin score view.                                                                  |
| `checkboxLabel`                            | Documented and present in fixtures but ignored by both current renderers; the normal field `label` is shown instead.                                |
| Bracket `cascades` mapping                 | Emitted and stored, but bracket population is hard-coded to the standard team field IDs.                                                            |
| Arbitrary `layout` strings                 | Only the exact `two-column` value has specialized behavior.                                                                                         |
| Spreadsheet `dataSource` / `bracketSource` | Retained in older JSON examples, but the current online client loads only DB-backed sources.                                                        |
| `winner-select.options`                    | Stored but ignored by the specialized winner renderer.                                                                                              |

Portable scoresheet V1 is intentionally a smaller surface: it supports scalar
interactive fields, calculated fields, headers, two-column layout, defaults,
formulas, and `gameAreasImage`; it rejects DB/queue sources, head-to-head mode,
winner-select, and repeatable groups.

Finally, current write validation only checks the outer schema/fields shape and
the `defaultValue`/`startValue` rules. Browser controls provide most other field
validation, while the submission route validates event/team/game relationships
but trusts submitted field values and calculated totals. Frequency in this
inventory therefore describes real client usage, not current server authority.

The canonical compile-time score model uses JSON numbers for `number` fields;
numeric strings are not supported. Before strict consumers adopt that model, a
one-time data migration must convert finite historical numeric strings to JSON
numbers and report any nonnumeric values. This type-model stage does not perform
that migration or change current form and storage behavior.

Repeatable-group derivations are modeled as an extensible registry protocol:
the shared schema defines a derivation identifier, primitive parameters, output
field mappings, numeric aggregates, and optional row metadata. Game-specific
derivation configuration and result types belong with their registered helpers,
not in the permanent shared scoresheet vocabulary.
