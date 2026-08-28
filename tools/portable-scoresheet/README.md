# Portable Scoresheet Export (V1)

This tool generates a **single self-contained HTML file** for offline score entry.

## Usage

```bash
npm run export:scoresheet -- \
  --input templates/demo-default-values.json \
  --output dist/portable/demo-default-values.html
```

For a small demo that pre-fills controls with `defaultValue` (a bare fields array, also pasteable into Admin → Field Templates):

```bash
npm run export:scoresheet -- \
  --input templates/demo-default-values.json \
  --output dist/portable/demo-default-values.html
```

Then share the generated HTML. The recipient can open it directly using `file://` in a browser.

## Accepted Input Shapes

The input JSON can be one of:

1. Full template object:

```json
{
  "name": "...",
  "description": "...",
  "schema": { "title": "...", "layout": "two-column", "fields": [] }
}
```

2. Bare schema object:

```json
{ "title": "...", "layout": "two-column", "fields": [] }
```

3. Field-array-only JSON, accepted as a portable input shorthand rather than a
   canonical online scoresheet schema:

```json
[{ "id": "score", "label": "Score", "type": "number" }]
```

Canonical online schemas use `kind: "seeding" | "bracket" | "double_seeding"`.
Portable V1 accepts seeding-compatible input, including schemas with
`kind: "seeding"` and shorthand input that omits `kind`.

## V1 Supported Features

- Seeding-style calculator behavior
- `text`, `number`, `dropdown`, `buttons`, `checkbox`, `calculated`, `section_header`, `group_header`
- Official `defaultValue` on interactive fields (`text`, `number`, `dropdown`, `buttons`, `checkbox`)
- `two-column` layout
- Formula recalculation
- Reset button (restores each field to its schema `defaultValue`, or the type empty default when omitted)
- Optional `gameAreasImage`
- Draft autosave in `localStorage`
- Download entered/calculated values as JSON

## Default Values

Portable scoresheets honor the same `defaultValue` rules as the main app:

- Values are applied on first load and again when **Reset** is clicked
- Typed defaults are validated at export time (wrong types, out-of-range numbers, and unknown option values fail the export)
- `startValue` is rejected
- When `defaultValue` is omitted: checkbox → `false`, buttons → first option, other inputs → empty

## V1 Rejected Features (fail-fast)

- `kind === "bracket"` or `kind === "double_seeding"`
- `winner-select` fields
- `dataSource.type === "db"`
- `dataSource.type === "bracket"`
- `scoreDestination === "db"`
- Queue-specific schema assumptions
- Invalid or unsupported `defaultValue` / `startValue` entries

## Distribution Notes

- Output HTML is fully inlined (no external CSS/JS files required).
- The page is designed to make zero network requests.
- If users clear browser site data, local draft data will be removed.
