import { google } from 'googleapis';

const sheets = google.sheets('v4');
const drive = google.drive('v3');

export async function listDrives(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    const locations = [];

    // Add "My Drive" location
    locations.push({
      id: 'my-drive',
      name: '📁 My Drive',
      type: 'myDrive'
    });

    // Add "Shared with Me" location
    locations.push({
      id: 'shared-with-me',
      name: '👥 Shared with Me',
      type: 'sharedWithMe'
    });

    // List Shared Drives
    const sharedDrivesResponse = await drive.drives.list({
      auth,
      pageSize: 50,
      fields: 'drives(id, name)'
    });

    if (sharedDrivesResponse.data.drives) {
      sharedDrivesResponse.data.drives.forEach(sharedDrive => {
        locations.push({
          id: sharedDrive.id,
          name: `🏢 ${sharedDrive.name}`,
          type: 'sharedDrive'
        });
      });
    }

    return locations;
  } catch (error) {
    console.error('Error listing drives:', error);
    throw new Error('Failed to list drives from Google Drive');
  }
}

export async function listSpreadsheets(accessToken: string, driveId?: string, driveType?: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    let query = "mimeType='application/vnd.google-apps.spreadsheet'";
    const options: any = {
      auth,
      q: query,
      fields: 'files(id, name, createdTime, modifiedTime, owners, shared)',
      orderBy: 'modifiedTime desc',
      pageSize: 100
    };

    // Handle different drive types
    if (driveType === 'sharedWithMe') {
      options.q = query + " and sharedWithMe=true";
      options.corpora = 'user';
    } else if (driveType === 'sharedDrive' && driveId) {
      options.corpora = 'drive';
      options.driveId = driveId;
      options.includeItemsFromAllDrives = true;
      options.supportsAllDrives = true;
    } else {
      // My Drive
      options.q = query + " and 'me' in owners";
      options.corpora = 'user';
    }

    const response = await drive.files.list(options);

    return response.data.files || [];
  } catch (error) {
    console.error('Error listing spreadsheets:', error);
    throw new Error('Failed to list spreadsheets from Google Drive');
  }
}

export async function getSpreadsheetInfo(accessToken: string, spreadsheetId: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId,
      fields: 'properties,sheets.properties'
    });

    return {
      title: response.data.properties?.title || 'Untitled',
      sheets: response.data.sheets?.map(sheet => ({
        title: sheet.properties?.title,
        sheetId: sheet.properties?.sheetId
      })) || []
    };
  } catch (error) {
    console.error('Error getting spreadsheet info:', error);
    throw new Error('Failed to get spreadsheet information');
  }
}

export async function getSpreadsheetSheets(accessToken: string, spreadsheetId: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId,
      fields: 'sheets.properties(title,sheetId,index)'
    });

    return response.data.sheets?.map(sheet => ({
      title: sheet.properties?.title || 'Untitled',
      sheetId: sheet.properties?.sheetId,
      index: sheet.properties?.index
    })) || [];
  } catch (error) {
    console.error('Error getting spreadsheet sheets:', error);
    throw new Error('Failed to get sheets from spreadsheet');
  }
}

export async function getParticipants(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    // Assuming participants are in column A
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: `${sheetName}!A2:A`, // Skip header row
    });

    const values = response.data.values || [];
    return values.map(row => row[0]).filter(Boolean);
  } catch (error) {
    console.error('Error getting participants:', error);
    throw new Error('Failed to get participants from spreadsheet');
  }
}

export async function getMatches(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<any[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    // Assuming matches are in columns with headers
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: `${sheetName}!A1:Z`,
    });

    const values = response.data.values || [];
    if (values.length === 0) return [];

    const headers = values[0];
    const matches = values.slice(1).map((row, index) => {
      const match: any = { id: index + 1 };
      headers.forEach((header, i) => {
        match[header] = row[i] || '';
      });
      return match;
    });

    return matches;
  } catch (error) {
    console.error('Error getting matches:', error);
    throw new Error('Failed to get matches from spreadsheet');
  }
}

export async function submitScoreToSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  scoreValues: any[]
): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    // scoreValues should already be a flat array
    const values = [scoreValues];

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values
      }
    });
  } catch (error) {
    console.error('Error submitting score to sheet:', error);
    throw new Error('Failed to submit score to spreadsheet');
  }
}

export async function updateTeamScore(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  teamNumber: string,
  round: number,
  totalScore: number | string  // Allow string for clearing cells
): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    // First, get all data from the sheet to find the team row
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const values = response.data.values || [];
    if (values.length === 0) {
      throw new Error('Sheet is empty');
    }

    // Find the header row and team row
    const headers = values[0];
    
    // More flexible search for team number column
    const teamNumberColIndex = headers.findIndex((h: string) => {
      const normalized = String(h || '').toLowerCase().trim();
      return normalized.includes('team') && normalized.includes('number') ||
             normalized === 'team #' ||
             normalized === 'team number' ||
             normalized === 'teamnumber';
    });
    
    if (teamNumberColIndex === -1) {
      console.error('Available headers:', headers);
      throw new Error(`Could not find Team Number column. Available columns: ${headers.join(', ')}`);
    }

    // Find the team's row
    const teamRowIndex = values.findIndex((row, idx) => 
      idx > 0 && String(row[teamNumberColIndex]) === String(teamNumber)
    );

    if (teamRowIndex === -1) {
      throw new Error(`Team ${teamNumber} not found in sheet`);
    }

    // Find the correct round column (Seed 1, Seed 2, Seed 3)
    const roundColumnName = `Seed ${round}`;
    const roundColIndex = headers.findIndex((h: string) => h === roundColumnName);

    if (roundColIndex === -1) {
      throw new Error(`Column "${roundColumnName}" not found in sheet`);
    }

    // Convert column index to letter (A, B, C, etc.)
    const columnLetter = String.fromCharCode(65 + roundColIndex);
    const rowNumber = teamRowIndex + 1; // +1 because sheets are 1-indexed

    // Update the specific cell
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId,
      range: `${sheetName}!${columnLetter}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[totalScore]]
      }
    });
  } catch (error: any) {
    console.error('Error updating team score:', error);
    throw new Error(`Failed to update team score: ${error.message}`);
  }
}

export async function getSheetData(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  range?: string
): Promise<any[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    const fullRange = range ? `${sheetName}!${range}` : `${sheetName}!A:Z`;
    
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: fullRange,
    });

    const values = response.data.values || [];
    if (values.length === 0) return [];

    // First row is headers
    const headers = values[0];
    const rows = values.slice(1);

    // Convert to array of objects
    return rows.map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });
  } catch (error: any) {
    console.error('Error getting sheet data:', error);
    console.error('Sheet name:', sheetName, 'Range:', range);
    if (error.response) {
      console.error('API Error:', error.response.status, error.response.data);
    }
    throw new Error(`Failed to get data from spreadsheet: ${error.message}`);
  }
}

