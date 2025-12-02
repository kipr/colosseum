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
  scoreData: any
): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  try {
    // Convert score data to array format
    const values = [Object.values(scoreData)];

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
  } catch (error) {
    console.error('Error getting sheet data:', error);
    throw new Error('Failed to get data from spreadsheet');
  }
}

