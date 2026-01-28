# Multi-Sheet Configuration Guide

This guide explains how to use multiple sheets from the same (or different) spreadsheets for different purposes.

## Sheet Purposes

The system supports two types of sheet configurations:

### 1. **Data Source Sheets**

Used to populate dropdown fields in scoresheets.

**Example:** Teams sheet with columns:

```
| Team Number | Team Name            |
|-------------|----------------------|
| 101         | Robotics Wizards     |
| 102         | Tech Titans          |
```

**Purpose:** `data`

- Provides options for dynamic dropdowns
- Read-only (app never writes to these sheets)
- Can have multiple data source sheets active simultaneously

### 2. **Score Submission Sheets**

Where accepted scores are written after admin approval.

**Example:** Seeding sheet for storing final scores:

```
| Team Number | Team Name | Round 1 | Round 2 | Round 3 |
|-------------|-----------|---------|---------|---------|
| 101         | ...       | 250     | 300     | 275     |
```

**Purpose:** `scores`

- Receives approved score submissions
- Written to when admin clicks "Accept" on a score
- Can have multiple score sheets active (different events, divisions, etc.)

## Setting Up Multiple Sheets

### Example Configuration for Botball Tournament:

**Spreadsheet:** "2026 Fall Scoring Template"

Link the following sheets:

1. **Teams Sheet** (Data Source)
   - Sheet Name: `Teams`
   - Purpose: `Data Source`
   - Used for: Populating team number/name dropdowns

2. **Seeding Sheet** (Score Submissions)
   - Sheet Name: `Seeding`
   - Purpose: `Score Submissions`
   - Used for: Writing accepted seeding round scores

You can also link additional sheets like:

3. **Double Elimination Sheet** (Score Submissions)
   - Sheet Name: `Double Elim`
   - Purpose: `Score Submissions`
   - Used for: Writing double elimination scores

## How To Link Multiple Sheets

1. Go to **Admin → Spreadsheets** tab
2. Click **"Browse My Google Drive"**
3. Select your spreadsheet
4. Click **"Link"**
5. **Select the sheet** from the dropdown (e.g., "Teams")
6. **Select the purpose**:
   - "Data Source" for sheets that populate dropdowns
   - "Score Submissions" for sheets that receive scores
7. Click **"Link Spreadsheet"**
8. Repeat for each sheet you need

## Multiple Active Configurations

Unlike the old system, you can now have **multiple active configurations** at once:

✅ **Multiple data source sheets** - For different dropdown sources
✅ **Multiple score submission sheets** - For different scoring categories
✅ **Same spreadsheet, different sheets** - All can be active
✅ **Different spreadsheets** - Can have configs from multiple spreadsheets

## How Scores Are Submitted

When an admin accepts a score:

1. The system finds the **score submission sheet** for that template's owner
2. Extracts the score values
3. Appends a new row to that sheet
4. The row contains all the field values in order

## Best Practices

1. **Use clear sheet names** - "Teams", "Seeding", "Finals", etc.
2. **Set up data sources first** - Link Teams sheet before creating scoresheets
3. **Match column order** - Your score sheet columns should match the field order in your template
4. **Test with one score** - Accept one pending score to verify it writes to the correct sheet
5. **Keep purposes separate** - Don't use the same sheet for both data and scores

## Troubleshooting

**Dropdown shows no options:**

- Make sure you linked a sheet with purpose "Data Source"
- Verify the sheet name in your template's `dataSource.sheetName` matches exactly
- Check that the sheet has the columns specified in `labelField` and `valueField`

**Accepted scores go to wrong sheet:**

- Verify you have a sheet linked with purpose "Score Submissions"
- Make sure it's the active config for the template owner
- Check the spreadsheet in Admin → Spreadsheets tab

**"This sheet configuration already exists" error:**

- You're trying to link the same spreadsheet + sheet + purpose combination again
- Either delete the existing one first or use a different sheet/purpose

## Example: Complete Botball Setup

**Spreadsheet:** "2026 Fall Scoring Template"

**Linked Sheets:**

1. `Teams` - Data Source - Provides team list for dropdowns
2. `Seeding` - Score Submissions - Receives seeding round scores
3. `Double Elim` - Score Submissions - Receives playoff scores
4. `Match Schedule` - Data Source - Could provide match numbers

All four can be active simultaneously!
