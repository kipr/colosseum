# Botball Seeding Scoresheet Setup Guide

Quick guide to set up the 2026 Botball Fall Tournament Seeding scoresheet.

## Prerequisites

1. Google Spreadsheet: **"2026 Fall Scoring Template"** (or similar)
2. Two sheets in that spreadsheet:
   - **Teams** - Contains team data
   - **Seeding** - Will receive approved scores

## Step 1: Prepare Your Spreadsheet

### Teams Sheet Structure

The Teams sheet should have these columns (in this order):

```
| Team Number | Team Name            |
|-------------|----------------------|
| 101         | Robotics Wizards     |
| 102         | Tech Titans          |
| 103         | Code Crushers        |
```

**Important:**
- First row MUST be headers: "Team Number" and "Team Name"
- Team Number column (A) contains the numbers
- Team Name column (B) contains the full team names

### Seeding Sheet Structure

The Seeding sheet should have team rows with round columns.

**Required structure:**
```
| Team Number | Team Name            | Seed 1 | Seed 2 | Seed 3 |
|-------------|----------------------|--------|--------|--------|
| 101         | Robotics Wizards     |        |        |        |
| 102         | Tech Titans          |        |        |        |
| 103         | Code Crushers        |        |        |        |
```

**Important:**
- First row MUST have headers: "Team Number" (or "Team #"), "Team Name", "Seed 1", "Seed 2", "Seed 3"
- Each team gets one row
- When a Round 1 score is accepted, it writes to the "Seed 1" column for that team
- When a Round 2 score is accepted, it writes to the "Seed 2" column
- When a Round 3 score is accepted, it writes to the "Seed 3" column
- The value written is the **Total Score (A + B)** from the scoresheet

## Step 2: Link the Sheets in Admin Panel

### 2.1 Link Teams Sheet (Data Source)

1. Go to **Admin → Spreadsheets** tab
2. Click **"Browse My Google Drive"**
3. Navigate to your location (My Drive, Shared Drive, etc.)
4. Find **"2026 Fall Scoring Template"**
5. Click **"Link"**
6. Modal appears:
   - **Sheet**: Select `Teams`
   - **Purpose**: Select `Data Source (for dropdowns like Teams list)`
7. Click **"Link Spreadsheet"**

### 2.2 Link Seeding Sheet (Score Submissions)

1. Click **"Browse My Google Drive"** again
2. Find the same **"2026 Fall Scoring Template"**
3. Click **"Link"**
4. Modal appears:
   - **Sheet**: Select `Seeding`
   - **Purpose**: Select `Score Submissions (where accepted scores go)`
5. Click **"Link Spreadsheet"**

### Verification

Go to **Admin → Spreadsheets** tab. You should see:

```
Spreadsheet                      | Sheet   | Purpose           | Status
2026 Fall Scoring Template       | Teams   | Data Source       | Active
2026 Fall Scoring Template       | Seeding | Score Submissions | Active
```

## Step 3: Create the Template

1. Go to **Admin → Templates** tab
2. Click **"+ Create New Template"**
3. Fill in:
   - **Name**: `2026 Botball Fall Tournament - Seeding`
   - **Description**: `Seeding round scoring for 2026 Botball Fall Tournament`
   - **Access Code**: Choose a code (e.g., `BOTBALL2026`)
   - **Schema**: Copy the entire contents from `botball-seeding-template.json`
4. Click **"Save Template"**

## Step 4: Test the Scoresheet

### Test Dynamic Dropdowns

1. Open a new incognito/private browser window
2. Go to `http://localhost:5173`
3. Click **"Enter as Judge"**
4. Select the Botball template
5. Enter access code: `BOTBALL2026`
6. **Team Number dropdown should show**: 101, 102, 103, etc. (from your Teams sheet!)
7. Select a team number
8. **Team Name should auto-fill** with the corresponding name

### Test Score Submission

1. Fill out some scoring fields
2. Click **"Submit Score"**
3. Score is saved as **pending**

### Test Score Review

1. As admin, go to **Admin → Score History** tab
2. Select your **Seeding** sheet from the dropdown
3. You should see the pending score
4. Click **"Accept"**
5. Score is written to your **Seeding** sheet in the spreadsheet!

## How It Works

### Team Dropdown Configuration

From `botball-seeding-template.json`:

```json
{
  "id": "team_number",
  "type": "dropdown",
  "dataSource": {
    "sheetName": "Teams",           // Pulls from Teams sheet
    "range": "A1:B",                // Columns A and B
    "labelField": "Team Number",    // Shows this column
    "valueField": "Team Number"     // Saves this column value
  },
  "cascades": {
    "targetField": "team_name",     // Auto-fills this field
    "sourceField": "Team Name"      // With this column's value
  }
}
```

### Score Submission Flow

1. **Judge selects Team 101** and **Round 1**
2. **Judge fills scoresheet** → Total Score calculates automatically (e.g., 250)
3. **Judge submits** → Saved to database as `pending`
4. **Admin reviews** in History tab (filtered by Seeding sheet)
5. **Admin accepts** → Score **updates** Team 101's row, **Seed 1 column** with 250
6. **Data in spreadsheet** → Seed 1 column for Team 101 now shows 250

If the same team scores in Round 2:
- Their Seed 2 column gets updated
- Seed 1 column remains unchanged
- Each round has its own column

## Troubleshooting

**Team dropdown is empty:**
- Verify you linked the Teams sheet with purpose "Data Source"
- Check that Teams sheet has "Team Number" and "Team Name" column headers
- Make sure you're logged in as admin with valid token

**Accepted scores don't appear in spreadsheet:**
- Verify you linked the Seeding sheet with purpose "Score Submissions"
- Check that both Teams and Seeding sheets are marked "Active"
- Try logging out and back in to refresh your access token

**"No active spreadsheet configuration found" error:**
- You need at least one sheet with purpose "Score Submissions" linked
- Go to Admin → Spreadsheets and verify one is active

## Multiple Events

You can run multiple events simultaneously:

1. Link **"2026 Fall Scoring Template" → Teams** (Data Source)
2. Link **"2026 Fall Scoring Template" → Seeding** (Score Submissions)
3. Link **"2026 Spring Tournament" → Teams** (Data Source)
4. Link **"2026 Spring Tournament" → Finals** (Score Submissions)

All four can be active at once! Each template will use its owner's configurations.

