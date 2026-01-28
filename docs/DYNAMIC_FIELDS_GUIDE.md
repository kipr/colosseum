# Dynamic Fields Guide

This guide explains how to create scoresheet fields that dynamically pull data from Google Sheets.

## Dynamic Dropdowns

You can configure dropdown fields to pull their options from a Google Sheet instead of hardcoding them.

### Basic Dynamic Dropdown

```json
{
  "id": "team_number",
  "label": "Team Number",
  "type": "dropdown",
  "required": true,
  "dataSource": {
    "sheetName": "Teams",
    "range": "A1:B",
    "labelField": "Team Number",
    "valueField": "Team Number"
  }
}
```

**Properties:**

- `sheetName` (required): Name of the sheet tab in your spreadsheet
- `range` (optional): Cell range to read (e.g., "A1:B" for columns A and B). Defaults to all columns.
- `labelField` (required): Column header name to use for the display label
- `valueField` (required): Column header name to use for the stored value

**How it works:**

1. The app reads the specified sheet and range
2. First row must contain column headers
3. Each subsequent row becomes a dropdown option
4. The `labelField` column is shown to users
5. The `valueField` column is saved when submitted

## Cascading Fields

You can make one field auto-populate based on another field's selection.

### Example: Team Number → Team Name

```json
{
  "id": "team_number",
  "label": "Team Number",
  "type": "dropdown",
  "required": true,
  "dataSource": {
    "sheetName": "Teams",
    "range": "A1:C",
    "labelField": "Team Number",
    "valueField": "Team Number"
  },
  "cascades": {
    "targetField": "team_name",
    "sourceField": "Team Name"
  }
},
{
  "id": "team_name",
  "label": "Team Name",
  "type": "text",
  "required": true,
  "autoPopulated": true,
  "placeholder": "Select team number first"
}
```

**Cascades Properties:**

- `targetField` (required): ID of the field to auto-populate
- `sourceField` (required): Column name from the data source to use for population

**How it works:**

1. User selects a team number from the dropdown
2. The app finds the matching row in the sheet data
3. It extracts the value from the `sourceField` column (e.g., "Team Name")
4. It automatically fills the `targetField` (team_name) with that value

**Auto-populated field:**

- Add `"autoPopulated": true` to the target field
- This makes it read-only (users can't edit it)
- It will be filled automatically when the source field changes

## Example Spreadsheet Structure

For the example above, your "Teams" sheet should look like:

| Team Number | Team Name        | School             |
| ----------- | ---------------- | ------------------ |
| 101         | Robotics Wizards | Lincoln High       |
| 102         | Tech Titans      | Washington Academy |
| 103         | Code Crushers    | Jefferson School   |

When a user selects "101" from the Team Number dropdown, "Robotics Wizards" automatically fills the Team Name field.

## Multiple Cascading Fields

You can cascade multiple fields from one selection:

```json
{
  "id": "team_number",
  "label": "Team Number",
  "type": "dropdown",
  "dataSource": {
    "sheetName": "Teams",
    "range": "A1:D",
    "labelField": "Team Number",
    "valueField": "Team Number"
  },
  "cascades": {
    "targetField": "team_name",
    "sourceField": "Team Name"
  }
},
{
  "id": "team_name",
  "label": "Team Name",
  "type": "text",
  "autoPopulated": true
},
{
  "id": "school",
  "label": "School",
  "type": "text",
  "autoPopulated": true
}
```

**Note:** Currently, cascades only support one target field. For multiple fields, you would need to create separate cascade configurations (this feature can be extended if needed).

## Best Practices

1. **Always include headers**: First row of your sheet range must have column headers
2. **Match field names exactly**: `labelField` and `valueField` must match your header names exactly
3. **Keep ranges focused**: Only include columns you need to improve performance
4. **Use meaningful IDs**: Field IDs should be descriptive (e.g., `team_number` not `field1`)
5. **Test with sample data**: Verify your sheet structure before deploying to judges

## Limitations

- Dynamic data is fetched when the scoresheet loads
- If spreadsheet data changes during scoring, judges need to refresh
- Large datasets (>1000 rows) may slow down initial load
- Requires an active spreadsheet configuration

## Error Handling

If the sheet or range cannot be read:

- The dropdown will fall back to static options if provided
- Otherwise, it will be empty with just "Select..." option
- Check browser console for specific errors
