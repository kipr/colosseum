# Portable Scoresheet Export (V1)

This tool generates a **single self-contained HTML file** for offline score entry.

## Usage

```bash
npm run export:scoresheet -- \
  --input templates/botball-seeding-template.json \
  --output dist/portable/botball-seeding.html
```

Then share `dist/portable/botball-seeding.html`. The recipient can open it directly using `file://` in a browser.

## Accepted Input Shapes

The input JSON can be one of:

1. Full template object:

```json
{ "name": "...", "description": "...", "schema": { "title": "...", "layout": "two-column", "fields": [] } }
```

2. Bare schema object:

```json
{ "title": "...", "layout": "two-column", "fields": [] }
```

(For compatibility, field-array-only JSON is also accepted.)

## V1 Supported Features

- Seeding-style calculator behavior
- `text`, `number`, `dropdown`, `buttons`, `checkbox`, `calculated`, `section_header`, `group_header`
- `two-column` layout
- Formula recalculation
- Reset button
- Optional `gameAreasImage`
- Draft autosave in `localStorage`
- Download entered/calculated values as JSON

## V1 Rejected Features (fail-fast)

- `mode === "head-to-head"`
- `winner-select` fields
- `dataSource.type === "db"`
- `dataSource.type === "bracket"`
- `scoreDestination === "db"`
- Queue-specific schema assumptions

## Distribution Notes

- Output HTML is fully inlined (no external CSS/JS files required).
- The page is designed to make zero network requests.
- If users clear browser site data, local draft data will be removed.
