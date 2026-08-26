# Score Sheet Template Schema Guide

This guide explains how to create custom score sheet templates for the Colosseum application.

The executable contract is the Zod model in `src/shared/scoresheetSchema.ts`.
Types are inferred from that schema; this document is a human-readable overview.

## Schema Structure

A template schema is a JSON object with `schemaVersion: 1` and a `fields` array:

```json
{
  "schemaVersion": 1,
  "fields": [
    // Field definitions here
  ]
}
```

Bare field-template arrays (no wrapper object) are unversioned and validated
against the same field schemas.

## Field Types

Every persisted field requires a non-empty `id`, `label`, and `type`. Supported
types: `text`, `number`, `dropdown`, `buttons`, `checkbox`, `calculated`,
`section_header`, `group_header`, `winner-select`, `repeatableGroup`.

### 1. Text Field

Free-form text input for names, comments, etc.

```json
{
  "id": "participant_name",
  "label": "Participant Name",
  "type": "text",
  "required": true,
  "placeholder": "Enter participant name",
  "description": "Full name of the participant"
}
```

**Properties:**

- `id` (required): Unique identifier for the field
- `label` (required): Display label
- `type` (required): "text"
- `required` (optional): Boolean, default false
- `placeholder` (optional): Placeholder text
- `description` (optional): Help text shown below field
- `defaultValue` (optional): Initial string value shown when the scoresheet loads

### 2. Number Field

Numeric input with optional constraints.

```json
{
  "id": "total_score",
  "label": "Total Score",
  "type": "number",
  "required": true,
  "min": 0,
  "max": 100,
  "step": 0.5,
  "defaultValue": 0,
  "description": "Score out of 100"
}
```

**Properties:**

- `id`, `label`, `type`, `required`, `description`: Same as text field
- `min` (optional): Minimum value
- `max` (optional): Maximum value
- `step` (optional): Step increment (default 1)
- `defaultValue` (optional): Initial finite number; must be within `min`/`max` when those are set

### 3. Dropdown Field

Select from predefined options.

```json
{
  "id": "division",
  "label": "Division",
  "type": "dropdown",
  "required": true,
  "options": [
    { "label": "Junior", "value": "junior" },
    { "label": "Senior", "value": "senior" },
    { "label": "Professional", "value": "pro" }
  ],
  "defaultValue": "junior",
  "description": "Select competition division"
}
```

**Properties:**

- `id`, `label`, `type`, `required`, `description`: Same as above
- `options` (required for static lists): Array of objects with `label` and `value`
- `defaultValue` (optional): Must match one of the declared `options[].value` for static dropdowns. For dynamic dropdowns (`dataSource`), it must be a string, number, or boolean.

### 4. Button Field

Multiple choice with visual buttons (only one can be selected).

```json
{
  "id": "performance_rating",
  "label": "Performance Rating",
  "type": "buttons",
  "required": true,
  "options": [
    { "label": "⭐ Excellent", "value": "5" },
    { "label": "👍 Good", "value": "4" },
    { "label": "👌 Fair", "value": "3" },
    { "label": "👎 Poor", "value": "2" },
    { "label": "❌ Very Poor", "value": "1" }
  ],
  "defaultValue": "5",
  "description": "Rate overall performance"
}
```

**Properties:**

- `id`, `label`, `type`, `required`, `description`: Same as above
- `options` (required): Array of objects with `label` and `value`
- `defaultValue` (optional): Must match one of the declared `options[].value`

**Note:** You can use emojis in labels for visual appeal!

### 5. Checkbox Field

Boolean (true/false) field.

```json
{
  "id": "disqualified",
  "label": "Disqualification",
  "type": "checkbox",
  "checkboxLabel": "Participant was disqualified",
  "defaultValue": false,
  "description": "Check if participant violated rules"
}
```

**Properties:**

- `id`, `label`, `type`, `description`: Same as above
- `checkboxLabel` (optional): Text shown next to checkbox
- `defaultValue` (optional): Boolean initial checked state

## Complete Example Templates

### Example 1: Competition Scoring

```json
{
  "schemaVersion": 1,
  "fields": [
    {
      "id": "judge_name",
      "label": "Judge Name",
      "type": "text",
      "required": true,
      "placeholder": "Your name"
    },
    {
      "id": "technical_skill",
      "label": "Technical Skill",
      "type": "number",
      "required": true,
      "min": 0,
      "max": 10,
      "step": 0.1,
      "description": "Score technical execution (0-10)"
    },
    {
      "id": "artistic_merit",
      "label": "Artistic Merit",
      "type": "number",
      "required": true,
      "min": 0,
      "max": 10,
      "step": 0.1,
      "description": "Score artistic presentation (0-10)"
    },
    {
      "id": "difficulty",
      "label": "Difficulty Level",
      "type": "dropdown",
      "required": true,
      "options": [
        { "label": "Easy (1.0x)", "value": "1.0" },
        { "label": "Medium (1.2x)", "value": "1.2" },
        { "label": "Hard (1.5x)", "value": "1.5" },
        { "label": "Expert (2.0x)", "value": "2.0" }
      ]
    },
    {
      "id": "overall_impression",
      "label": "Overall Impression",
      "type": "buttons",
      "required": true,
      "options": [
        { "label": "⭐⭐⭐⭐⭐ Outstanding", "value": "5" },
        { "label": "⭐⭐⭐⭐ Excellent", "value": "4" },
        { "label": "⭐⭐⭐ Good", "value": "3" },
        { "label": "⭐⭐ Fair", "value": "2" },
        { "label": "⭐ Needs Improvement", "value": "1" }
      ]
    },
    {
      "id": "time_violation",
      "label": "Time Violation",
      "type": "checkbox",
      "checkboxLabel": "Exceeded time limit"
    },
    {
      "id": "comments",
      "label": "Additional Comments",
      "type": "text",
      "placeholder": "Optional feedback"
    }
  ]
}
```

### Example 2: Product Evaluation

```json
{
  "schemaVersion": 1,
  "fields": [
    {
      "id": "product_name",
      "label": "Product Name",
      "type": "text",
      "required": true
    },
    {
      "id": "category",
      "label": "Product Category",
      "type": "dropdown",
      "required": true,
      "options": [
        { "label": "Electronics", "value": "electronics" },
        { "label": "Clothing", "value": "clothing" },
        { "label": "Food & Beverage", "value": "food" },
        { "label": "Other", "value": "other" }
      ]
    },
    {
      "id": "quality",
      "label": "Quality Rating",
      "type": "buttons",
      "required": true,
      "options": [
        { "label": "Excellent", "value": "5" },
        { "label": "Good", "value": "4" },
        { "label": "Average", "value": "3" },
        { "label": "Below Average", "value": "2" },
        { "label": "Poor", "value": "1" }
      ]
    },
    {
      "id": "value_score",
      "label": "Value for Money",
      "type": "number",
      "required": true,
      "min": 1,
      "max": 10,
      "description": "Rate value (1-10)"
    },
    {
      "id": "recommend",
      "label": "Recommendation",
      "type": "checkbox",
      "checkboxLabel": "I would recommend this product"
    },
    {
      "id": "notes",
      "label": "Notes",
      "type": "text",
      "placeholder": "Additional observations"
    }
  ]
}
```

### Example 3: Sports Match Scoring

```json
{
  "schemaVersion": 1,
  "fields": [
    {
      "id": "sport",
      "label": "Sport",
      "type": "dropdown",
      "required": true,
      "options": [
        { "label": "Basketball", "value": "basketball" },
        { "label": "Soccer", "value": "soccer" },
        { "label": "Tennis", "value": "tennis" },
        { "label": "Volleyball", "value": "volleyball" }
      ]
    },
    {
      "id": "team_a_score",
      "label": "Team A Score",
      "type": "number",
      "required": true,
      "min": 0
    },
    {
      "id": "team_b_score",
      "label": "Team B Score",
      "type": "number",
      "required": true,
      "min": 0
    },
    {
      "id": "winner",
      "label": "Winner",
      "type": "buttons",
      "required": true,
      "options": [
        { "label": "Team A", "value": "team_a" },
        { "label": "Team B", "value": "team_b" },
        { "label": "Draw", "value": "draw" }
      ]
    },
    {
      "id": "overtime",
      "label": "Overtime",
      "type": "checkbox",
      "checkboxLabel": "Match went to overtime"
    },
    {
      "id": "mvp",
      "label": "MVP (Most Valuable Player)",
      "type": "text",
      "placeholder": "Player name"
    }
  ]
}
```

## Default Values

Interactive fields may include an optional `defaultValue` that pre-fills the control when a scoresheet is opened (and when a portable scoresheet is reset).

Accepted shapes:

| Field type | `defaultValue` type | Extra rules |
| --- | --- | --- |
| `text` | `string` | — |
| `number` | finite `number` | Must respect `min` / `max` when set |
| `dropdown` | `string` \| `number` \| `boolean` | Must match an `options[].value` when options are static |
| `buttons` | `string` \| `number` \| `boolean` | Must match an `options[].value` |
| `checkbox` | `boolean` | — |
| `repeatableGroup` | array of row objects | Each cell is validated against the child field type |

`defaultValue` is **not** allowed on `calculated`, `section_header`, `group_header`, or `winner-select` fields.

Additional types not shown in the numbered examples above:

- `calculated` — requires `formula`; may set `isTotal` / `isGrandTotal`
- `section_header` / `group_header` — layout labels; `id` and `label` required
- `winner-select` — head-to-head winner control; optional `options`
- `repeatableGroup` — child fields limited to `text`, `number`, `dropdown`, `buttons`, `checkbox`

The legacy `startValue` property is no longer supported and will be rejected.

### Repeatable group example

```json
{
  "id": "stacks",
  "label": "Stacks",
  "type": "repeatableGroup",
  "fields": [
    { "id": "count", "label": "Count", "type": "number", "min": 0, "max": 5 },
    { "id": "notes", "label": "Notes", "type": "text" }
  ],
  "defaultValue": [
    { "count": 1, "notes": "Starter row" }
  ]
}
```

## Best Practices

1. **Use descriptive IDs**: Make field IDs clear and unique (e.g., `technical_score` not `ts1`)

2. **Provide descriptions**: Help users understand what to enter in each field

3. **Set appropriate constraints**: Use `min`, `max`, `step` for number fields to prevent invalid data

4. **Order matters**: Fields appear in the order defined in the schema

5. **Required vs Optional**: Mark critical fields as required, but don't overdo it

6. **Button labels**: Keep them concise but clear. Emojis can help with visual scanning

7. **Use `defaultValue` carefully**: Prefer defaults that match the real starting state of a match; invalid defaults are rejected when saving templates or exporting portable scoresheets

8. **Test your schema**: Create a template in the admin panel and test it before deploying

## Tips for PDF Templates

When converting a PDF scoresheet to JSON:

1. Identify all input areas (boxes, checkboxes, radio buttons)
2. Map each to an appropriate field type
3. Preserve the logical grouping and order
4. Add descriptions for clarity
5. Use dropdowns for limited options instead of text fields
6. Use buttons for Likert scales or ratings

## Schema Validation

When creating or updating templates (and when exporting portable HTML), the system validates:

- Valid JSON syntax
- Schema objects include `schemaVersion: 1` and a `fields` array
- Field `id`, `label`, and `type` are present
- `defaultValue` entries match the field type rules above
- Option-based defaults match declared options
- `startValue` is rejected (use `defaultValue`)

Invalid schemas are rejected with an actionable error message.
