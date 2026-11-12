# Botball Fall seeding workbook mapping

Source: `Botball_Fall_Seeding_Scoresheet.xlsx`, sheet `Seeding Scoresheet`.
The workbook title is “Theme Budget: $0”; it does not state a season year.

## Proposed organization

This is one whole-board score, rather than two side totals. Use a single-column
schema with object bonuses, five named zones, a round subtotal, and an overall
multiplier. Keep team and round metadata in the existing Colosseum fields.

`templates/botball-fall-workbook-seeding-draft.json` is a scoring-field JSON array.
Paste the entire file into the field-template editor, then select that template
when creating a seeding scoresheet. The wizard supplies team and round metadata.
Fields use the left column of the existing layout, with a full-width grand total.
The wizard preserves the template's own grand total instead of appending A+B.
It is a draft pending the rule questions below and does not replace the existing
2026 fall fields, which describe another game.

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
Math calls are not supported safely by this evaluator. The draft uses numeric
`== 5` because its special handling of `===` coerces the compared field to a string.

## Rules to settle before using this at an event

1. **Pom interpretation:** Does “same-color count” mean poms matching the zone,
   the size of a same-color set, or a mutually exclusive scoring mode? The
   workbook is explicit about arithmetic but does not define the counts. A
   same-color count of 1 and unique-color count of 5 scores **1**, not 25 or 26.
   The draft preserves that priority. Do not silently choose the larger score.
2. **Base score overlap:** Does an object earning a specific bonus also count
   toward the base score when it satisfies that condition? The workbook adds
   the base and all bonuses without enforcing exclusivity. Keep a separate
   base-count input until the rules establish how objects overlap.
3. **Cup overlap:** Can nesting and flat/upright bonuses both apply? The workbook
   adds both; the draft does too.
4. **Physical limits and names:** Confirm inventory limits, whether the two pom
   counts have a combined cap, and the actual zone names. No cross-field cap can
   be inferred from the spreadsheet.
5. **Scope:** Confirm that the five duck zones are the same five pom zones, and
   whether this whole-board calculation is also intended for double seeding or
   elimination. Do not infer two independently scored sides from older templates.

The workbook contains no Excel data-validation rules; its labels supply the
input bounds above. These draft bounds guide entry but are not a substitute for
server-side rule validation.

## Colosseum changes worth considering

The flat draft is enough to check rules and arithmetic. For a compact judge UI,
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
worth implementing now. The draft provides a working arithmetic reference without
committing Colosseum to a new schema representation prematurely.
