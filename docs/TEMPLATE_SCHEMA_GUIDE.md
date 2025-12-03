# Score Sheet Template Schema Guide

This guide explains how to create custom score sheet templates for the Colosseum application.

## Schema Structure

A template schema is a JSON object with a `fields` array containing field definitions:

```json
{
  "fields": [
    // Field definitions here
  ]
}
```

## Field Types

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
  "description": "Score out of 100"
}
```

**Properties:**
- `id`, `label`, `type`, `required`, `description`: Same as text field
- `min` (optional): Minimum value
- `max` (optional): Maximum value
- `step` (optional): Step increment (default 1)

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
  "description": "Select competition division"
}
```

**Properties:**
- `id`, `label`, `type`, `required`, `description`: Same as above
- `options` (required): Array of objects with `label` and `value`

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
  "description": "Rate overall performance"
}
```

**Properties:**
- `id`, `label`, `type`, `required`, `description`: Same as above
- `options` (required): Array of objects with `label` and `value`

**Note:** You can use emojis in labels for visual appeal!

### 5. Checkbox Field

Boolean (true/false) field.

```json
{
  "id": "disqualified",
  "label": "Disqualification",
  "type": "checkbox",
  "checkboxLabel": "Participant was disqualified",
  "description": "Check if participant violated rules"
}
```

**Properties:**
- `id`, `label`, `type`, `description`: Same as above
- `checkboxLabel` (optional): Text shown next to checkbox

## Complete Example Templates

### Example 1: Competition Scoring

```json
{
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

## Best Practices

1. **Use descriptive IDs**: Make field IDs clear and unique (e.g., `technical_score` not `ts1`)

2. **Provide descriptions**: Help users understand what to enter in each field

3. **Set appropriate constraints**: Use `min`, `max`, `step` for number fields to prevent invalid data

4. **Order matters**: Fields appear in the order defined in the schema

5. **Required vs Optional**: Mark critical fields as required, but don't overdo it

6. **Button labels**: Keep them concise but clear. Emojis can help with visual scanning

7. **Test your schema**: Create a template in the admin panel and test it before deploying

## Tips for PDF Templates

When converting a PDF scoresheet to JSON:

1. Identify all input areas (boxes, checkboxes, radio buttons)
2. Map each to an appropriate field type
3. Preserve the logical grouping and order
4. Add descriptions for clarity
5. Use dropdowns for limited options instead of text fields
6. Use buttons for Likert scales or ratings

## Schema Validation

The system expects:
- Valid JSON syntax
- A `fields` array at the root
- Each field has at least `id`, `label`, and `type`
- Option-based fields (dropdown, buttons) have an `options` array
- All IDs are unique within the template

Invalid schemas will be rejected with an error message.

