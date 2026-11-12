# Botball Fall seeding workbook mapping

Source: `Botball_Fall_Seeding_Scoresheet.xlsx`, sheet `Seeding Scoresheet`.
The workbook title is “Theme Budget: $0”; it does not state a season year.

## Template organization

This is one whole-board score, rather than two side totals. Use a single-column
schema with object bonuses, five named zones, a round subtotal, and an overall
multiplier. Keep team and round metadata in the existing Colosseum fields.

`templates/botball-26-27-fall-scoring-fields.json` is a scoring-field JSON array.
Paste the entire file into the field-template editor, then select that template
when creating a seeding scoresheet. The wizard supplies team and round metadata.
Fields use the left column of the existing layout, with a full-width grand total.
The wizard preserves the template's own grand total instead of appending A+B.
It preserves the workbook arithmetic. The rule questions below concern details
the workbook does not specify; older templates in `templates/archive/` describe
other games.

For each zone, put its two pom inputs, calculated bonus, and duck qualification
together. The workbook separates pom scoring and duck qualification into two
tables, but they describe the same five physical zones. Grouping them reduces
backtracking during judging. The multiplier still applies to the entire round.

## Workbook arithmetic

| Source cells     | Meaning               | Translation                                                                                                             |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| C9:E18           | Ten object conditions | Count × fixed points, with a calculated result per condition                                                            |
| B22:C26, E22:E26 | Five pom zones        | If same-color count = 5: 25; otherwise if ≥ 1: that count; otherwise if unique-color count ≥ 2: its square; otherwise 0 |
| E28              | Round subtotal        | Sum of ten object results and five zone bonuses                                                                         |
| B32:B37          | Duck qualification    | Sum of five yes/no values for exactly one smaller duck                                                                  |
| B38              | Global multiplier     | Qualifying zone count clamped to 1–5                                                                                    |
| E40              | Total                 | Round subtotal × global multiplier                                                                                      |

Point values, in workbook order: 1, 7, 3, 15, 3, 20, 20, 15, 15, 50.
Yes/no conditions use numeric 0/1 buttons; cup orientation allows 0–2.
Other object counts have no invented maximum. Both pom counts allow 0–5.
Scoring inputs start at zero, matching the workbook. Zone names remain Zone 1–5
because the workbook calls them placeholders.

Calculated fields appear after their dependencies, as required by
`calculateFormulaValues`. Use multiplication for squares and ternaries for
Excel IF/MAX/MIN: the current evaluator replaces identifier tokens, so JavaScript
Math calls are not supported safely by this evaluator. The template uses numeric
`== 5` because its special handling of `===` coerces the compared field to a string.

## Rules to settle before using this at an event

1. **Pom interpretation:** Does “same-color count” mean poms matching the zone,
   the size of a same-color set, or a mutually exclusive scoring mode? The
   workbook is explicit about arithmetic but does not define the counts. A
   same-color count of 1 and unique-color count of 5 scores **1**, not 25 or 26.
   The template preserves that priority. Do not silently choose the larger score.
2. **Base score overlap:** Does an object earning a specific bonus also count
   toward the base score when it satisfies that condition? The workbook adds
   the base and all bonuses without enforcing exclusivity. Keep a separate
   base-count input until the rules establish how objects overlap.
3. **Cup overlap:** Can nesting and flat/upright bonuses both apply? The workbook
   adds both; the template does too.
4. **Physical limits and names:** Confirm inventory limits, whether the two pom
   counts have a combined cap, and the actual zone names. No cross-field cap can
   be inferred from the spreadsheet.
5. **Scope:** Confirm that the five duck zones are the same five pom zones, and
   whether this whole-board calculation is also intended for double seeding or
   elimination. Do not infer two independently scored sides from older templates.

The workbook contains no Excel data-validation rules; its labels supply the
input bounds above. These template bounds guide entry but are not a substitute for
server-side rule validation.

## Colosseum changes worth considering

The flat template is enough to check rules and arithmetic. For a compact judge UI,
a reusable **fixed-row table** would better express five persistent named zones:

| Zone     | Same-color poms | Unique-color poms | Pom bonus  | Exactly one smaller duck |
| -------- | --------------- | ----------------- | ---------- | ------------------------ |
| Zone 1–5 | 0–5             | 0–5               | Calculated | Yes/No                   |

Prefer an explicit fixed-row schema concept over treating zones as an editable
list. Existing `repeatableGroup` rendering and calculations rely on specialized
Botball derived handlers; arbitrary child formulas and generic reductions are
not currently available through that path. Adding another game-specific handler
would solve only this instance.

A generic implementation should cover stable row IDs and labels, numeric and
button cells, row-local formulas, declared aggregate outputs, validation of cell
values and formula references, and saved row data. Calculated outputs should feed
the existing grand-total field. Carry the same behavior through judge entry,
preview, saved-score review/edit, and portable export. Portable export currently
does not support repeatable groups, so it needs explicit coverage if that route
is used. Preserve old flat schemas and avoid changing tournament ranking logic:
this workbook still produces one numeric score.

After the rule questions are resolved, decide whether that table improvement is
worth implementing now. The template provides a working arithmetic reference without
committing Colosseum to a new schema representation prematurely.

## Workbook parity audit

The supplied workbook has SHA-256
`b09144270117b484ec61a452920585c2bcfa402c6dfa574cb6f507f2fcf1878e`.
Its one sheet has no hidden scoring sheets, comments, or data-validation rules.
All ten object point values, five zone formulas, subtotal, qualification count,
multiplier, and total agree with the template. No scoring change was necessary.

`tests/fixtures/botball-fall-workbook.json` preserves the workbook's populated
cells, original formulas (with Excel shared formulas expanded), cached defaults,
and source hash. It was extracted directly from the XLSX ZIP/XML, without using
the template. The binary workbook is not required in CI; when present locally,
the test also checks its hash so a changed source cannot go unnoticed.

`tests/client/botballFallWorkbook.test.ts` evaluates those Excel formulas with an
independent reference evaluator and compares every calculated template output:

- All 36 allowed same/unique pom pairs in each of five zones, including inputs
  where both counts are nonzero and one unique pom earns no bonus.
- Each object bonus independently, across all 32 duck-zone patterns.
- Every combination of four yes/no object bonuses and 0–2 upright cups, across
  all 32 duck patterns, with simultaneous object and pom points.
- 512 deterministic mixed boards, numeric strings from form entry, blank inputs,
  and the workbook's zero defaults and 1x initial multiplier.
- Exact input/output coverage, defaults, bounds, point-value suffixes, unique
  IDs, formula dependency ordering, and exactly one grand total.

This checks 3,542 board configurations. The previous test referred to a deleted
draft filename; it now loads the actual season template. Run it with:

```sh
npm run test:run -- tests/client/botballFallWorkbook.test.ts
```

Parity is for the input domain described by the workbook labels. Unlike the
spreadsheet's unrestricted cells, the template offers yes/no buttons and bounds
for pom and cup counts. The audit does not establish additional game rules,
inventory limits, or cross-field exclusions absent from the workbook.
