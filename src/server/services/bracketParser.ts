import { google } from 'googleapis';

const sheets = google.sheets('v4');

export interface BracketGame {
  gameNumber: number;
  team1: {
    teamNumber: string;
    displayName: string;
    fullName?: string;
  } | null;
  team2: {
    teamNumber: string;
    displayName: string;
    fullName?: string;
  } | null;
  winner?: string; // The winner's display name if already decided
  hasWinner: boolean; // True if this game already has a winner
  cellReference: string; // Where to write the winner
  column: number;
  row: number;
  isChampionshipGame?: boolean; // True if teams are shifted (final games)
}

/**
 * Parse a team string like "859 ACES Te" into team number and display name
 */
function parseTeamString(teamStr: string): { teamNumber: string; displayName: string } | null {
  if (!teamStr || teamStr === 'Bye' || teamStr.trim() === '') {
    return null;
  }
  
  const trimmed = teamStr.trim();
  const spaceIndex = trimmed.indexOf(' ');
  
  if (spaceIndex === -1) {
    // Just a number
    return { teamNumber: trimmed, displayName: trimmed };
  }
  
  const teamNumber = trimmed.substring(0, spaceIndex);
  const displayName = trimmed;
  
  return { teamNumber, displayName };
}

/**
 * Convert column index to letter (0 = A, 1 = B, etc.)
 */
function columnToLetter(col: number): string {
  let letter = '';
  col++;
  while (col > 0) {
    const remainder = (col - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

/**
 * Parse a bracket spreadsheet and extract all games with their team matchups
 */
export async function parseBracket(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<BracketGame[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const response = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const values = response.data.values || [];
  if (values.length === 0) {
    throw new Error('Bracket sheet is empty');
  }

  const games: BracketGame[] = [];
  const gamePattern = /^Game\s+(\d+)$/i;

  // Scan through all cells to find "Game X" patterns
  for (let rowIdx = 0; rowIdx < values.length; rowIdx++) {
    const row = values[rowIdx];
    if (!row) continue;
    
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cellValue = String(row[colIdx] || '').trim();
      const match = cellValue.match(gamePattern);
      
      if (match) {
        const gameNumber = parseInt(match[1], 10);
        
        // Look for the two teams below this cell
        let team1: { teamNumber: string; displayName: string } | null = null;
        let team2: { teamNumber: string; displayName: string } | null = null;
        
        // Check if this is a championship/final game (teams shifted one column to the right)
        // Finals typically have teams in the column AFTER the "Game X" label
        // We detect this by checking if the cells below are empty but the cells to the right have teams
        
        let isChampionshipGame = false;
        
        // Search for teams below the "Game X" cell in the same column
        // In later rounds (like Game 27), teams can be 15+ rows apart, so search far
        const maxSearchRows = 25; // Search up to 25 rows down for later-round games
        let team1Row = -1;
        let team2Row = -1;
        
        for (let searchOffset = 1; searchOffset <= maxSearchRows && rowIdx + searchOffset < values.length; searchOffset++) {
          const searchRow = values[rowIdx + searchOffset];
          if (!searchRow) continue;
          
          const cellValue = String(searchRow[colIdx] || '').trim();
          
          // Stop if we hit another "Game X" pattern
          if (gamePattern.test(cellValue)) break;
          
          // Check for "Bye" explicitly
          if (cellValue === 'Bye') {
            if (!team1) {
              team1 = { teamNumber: 'Bye', displayName: 'Bye' };
              team1Row = rowIdx + searchOffset;
            } else if (!team2) {
              team2 = { teamNumber: 'Bye', displayName: 'Bye' };
              team2Row = rowIdx + searchOffset;
              break;
            }
            continue;
          }
          
          // Try to parse as a team
          const potentialTeam = parseTeamString(cellValue);
          if (potentialTeam) {
            if (!team1) {
              team1 = potentialTeam;
              team1Row = rowIdx + searchOffset;
            } else if (!team2 && potentialTeam.teamNumber !== team1.teamNumber) {
              team2 = potentialTeam;
              team2Row = rowIdx + searchOffset;
              break; // Found both teams
            }
          }
        }
        
        // If no teams found directly below, check shifted column (championship game pattern - Game 31)
        if (!team1 && !team2) {
          isChampionshipGame = true;
          
          // For championship games, teams are in the next column
          const shiftedCol = colIdx + 1;
          
          // Team 1 is in the same row or row below, shifted column
          if (row[shiftedCol]) {
            team1 = parseTeamString(String(row[shiftedCol]));
          }
          if (!team1 && rowIdx + 1 < values.length) {
            const nextRow = values[rowIdx + 1];
            if (nextRow && nextRow[shiftedCol]) {
              team1 = parseTeamString(String(nextRow[shiftedCol]));
            }
          }
          
          // Team 2 is below team 1 in the shifted column, or further down
          for (let searchRow = rowIdx + 1; searchRow < Math.min(rowIdx + 5, values.length); searchRow++) {
            const searchRowData = values[searchRow];
            if (searchRowData && searchRowData[shiftedCol]) {
              const potentialTeam = parseTeamString(String(searchRowData[shiftedCol]));
              if (potentialTeam && (!team1 || potentialTeam.teamNumber !== team1.teamNumber)) {
                if (!team1) {
                  team1 = potentialTeam;
                } else {
                  team2 = potentialTeam;
                  break;
                }
              }
            }
          }
        }
        
        // The winner will be written to the cell that's adjacent to where Game X appears
        const cellReference = `${sheetName}!${columnToLetter(colIdx)}${rowIdx + 1}`;
        
        // Check if this game already has a winner
        // Winners appear in cells to the right of the game's team rows (in bracket columns)
        let winner: string | undefined;
        let hasWinner = false;
        
        // Use the actual team rows we found, not assumed positions
        const actualTeam1Row = team1Row >= 0 ? team1Row : rowIdx + 1;
        const actualTeam2Row = team2Row >= 0 ? team2Row : rowIdx + 2;
        const midRow = Math.floor((actualTeam1Row + actualTeam2Row) / 2);
        
        // Helper to check if a cell value matches either team
        const matchesTeam = (cellVal: string): boolean => {
          if (!cellVal || cellVal === 'Bye') return false;
          
          // Exact match
          if (team1 && cellVal === team1.displayName) return true;
          if (team2 && cellVal === team2.displayName) return true;
          
          // Partial match (team number is at the start)
          if (team1 && cellVal.startsWith(team1.teamNumber + ' ')) return true;
          if (team2 && cellVal.startsWith(team2.teamNumber + ' ')) return true;
          
          return false;
        };
        
        // Check several columns to the right for the advancement cell
        // Search the range around team rows including midRow
        const searchRows = [actualTeam1Row, actualTeam2Row, midRow, midRow - 1, midRow + 1];
        
        outerLoop:
        for (let checkCol = colIdx + 1; checkCol < Math.min(colIdx + 8, 26); checkCol++) {
          for (const checkRow of searchRows) {
            if (checkRow < 0 || checkRow >= values.length) continue;
            if (!values[checkRow] || !values[checkRow][checkCol]) continue;
            
            const cellVal = String(values[checkRow][checkCol]).trim();
            if (matchesTeam(cellVal)) {
              winner = cellVal;
              hasWinner = true;
              break outerLoop;
            }
          }
        }
        
        games.push({
          gameNumber,
          team1,
          team2,
          winner,
          hasWinner,
          cellReference,
          column: colIdx,
          row: rowIdx,
          isChampionshipGame,
        });
      }
    }
  }

  // Sort by game number
  games.sort((a, b) => a.gameNumber - b.gameNumber);

  return games;
}

/**
 * Get available games (games with teams that haven't been decided yet)
 */
export async function getAvailableGames(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  includeDecided: boolean = false
): Promise<BracketGame[]> {
  const allGames = await parseBracket(accessToken, spreadsheetId, sheetName);
  
  // Filter to only games with at least one real team (not all byes)
  // Also filter out games that already have a winner (unless includeDecided is true)
  return allGames.filter(game => {
    // Must have at least one team
    if (game.team1 === null && game.team2 === null) return false;
    
    // Filter out games where both teams are "Bye"
    const team1IsBye = game.team1?.displayName === 'Bye';
    const team2IsBye = game.team2?.displayName === 'Bye';
    if (team1IsBye && team2IsBye) return false;
    
    // Filter out games where one team is a Bye (automatic advancement, no scoring needed)
    if (team1IsBye || team2IsBye) return false;
    
    // If we want to exclude decided games
    if (!includeDecided && game.hasWinner) return false;
    
    return true;
  });
}

/**
 * Get a specific game by number
 */
export async function getGame(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  gameNumber: number
): Promise<BracketGame | null> {
  const games = await parseBracket(accessToken, spreadsheetId, sheetName);
  return games.find(g => g.gameNumber === gameNumber) || null;
}

/**
 * Lookup table for 16-team double elimination bracket
 * Maps game number to target cell (where winner advances to)
 * Format: { gameNumber: "COLUMN_ROW" } using 1-indexed rows
 */
const BRACKET_TARGET_CELLS_16_TEAM: Record<number, string> = {
  // Main Bracket Round 1 (Games 1-8) → Column E
  1: 'E5', 2: 'E8', 3: 'E13', 4: 'E16',
  5: 'E21', 6: 'E24', 7: 'E29', 8: 'E32',
  
  // Consolation Bracket Round 1 (Games 9-12) → Column D
  9: 'D40', 10: 'D44', 11: 'D48', 12: 'D52',
  
  // Main Bracket Round 2 (Games 13-16) → Column H
  13: 'H7', 14: 'H14', 15: 'H23', 16: 'H30',
  
  // Consolation Bracket Round 2 (Games 17-20) → Column F
  17: 'F40', 18: 'F43', 19: 'F48', 20: 'F51',
  
  // Main Bracket Round 3 (Games 21-22) → Column K
  21: 'K11', 22: 'K26',
  
  // Consolation Bracket Round 3 (Games 23-24) → Column H
  23: 'H41', 24: 'H49',
  
  // Consolation Bracket Round 4 (Games 25-26) → Column J
  25: 'J40', 26: 'J47',
  
  // Main Bracket Round 4 (Game 27) → Column N
  27: 'N19',
  
  // Consolation Bracket Round 5 (Game 28) → Column L
  28: 'L43',
  
  // Consolation Bracket Round 6 (Game 29) → Column N
  29: 'N39',
  
  // Finals
  30: 'Q29',  // Main bracket final
  31: 'S31',  // Grand final
};

/**
 * Write the winner to the bracket
 * This finds where the winner should advance to and writes their name there
 */
export async function writeWinnerToBracket(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  gameNumber: number,
  winnerTeamNumber: string,
  winnerDisplayName: string
): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  // Check if we have a known target cell for this game
  const knownTargetCell = BRACKET_TARGET_CELLS_16_TEAM[gameNumber];
  
  if (knownTargetCell) {
    // Use the lookup table - most reliable method
    const fullCellRef = `${sheetName}!${knownTargetCell}`;
    
    console.log(`Writing winner "${winnerDisplayName}" to ${fullCellRef} (from lookup table)`);
    
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId,
      range: fullCellRef,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[winnerDisplayName]]
      }
    });
    
    return;
  }

  // Fallback: calculate position for games not in lookup table
  console.log(`Game ${gameNumber} not in lookup table, calculating position...`);

  // First, get the bracket to find the game
  const response = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const values = response.data.values || [];
  const gamePatternExact = new RegExp(`^Game\\s+${gameNumber}$`, 'i');
  const gamePatternAny = /^Game\s+(\d+)$/i;

  // Find the game cell
  let gameRow = -1;
  let gameCol = -1;
  
  for (let rowIdx = 0; rowIdx < values.length; rowIdx++) {
    const row = values[rowIdx];
    if (!row) continue;
    
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cellValue = String(row[colIdx] || '').trim();
      if (gamePatternExact.test(cellValue)) {
        gameRow = rowIdx;
        gameCol = colIdx;
        break;
      }
    }
    if (gameRow !== -1) break;
  }

  if (gameRow === -1) {
    throw new Error(`Game ${gameNumber} not found in bracket`);
  }

  console.log(`Found Game ${gameNumber} at row ${gameRow}, col ${gameCol}`);

  // Find the actual team rows using the same logic as parseBracket
  // Search down from the game cell to find both teams
  const maxSearchRows = 15;
  let team1Row = -1;
  let team2Row = -1;
  let team1Info: { teamNumber: string; displayName: string } | null = null;
  let team2Info: { teamNumber: string; displayName: string } | null = null;
  
  for (let searchOffset = 1; searchOffset <= maxSearchRows && gameRow + searchOffset < values.length; searchOffset++) {
    const searchRow = values[gameRow + searchOffset];
    if (!searchRow) continue;
    
    const cellValue = String(searchRow[gameCol] || '').trim();
    
    // Stop if we hit another "Game X" pattern
    if (gamePatternAny.test(cellValue)) break;
    
    // Try to parse as a team
    const potentialTeam = parseTeamString(cellValue);
    if (potentialTeam) {
      if (!team1Info) {
        team1Info = potentialTeam;
        team1Row = gameRow + searchOffset;
        console.log(`Found team1 "${potentialTeam.displayName}" at row ${team1Row}`);
      } else if (!team2Info && potentialTeam.teamNumber !== team1Info.teamNumber) {
        team2Info = potentialTeam;
        team2Row = gameRow + searchOffset;
        console.log(`Found team2 "${potentialTeam.displayName}" at row ${team2Row}`);
        break;
      }
    }
  }

  if (team1Row === -1) {
    throw new Error(`Could not find teams for Game ${gameNumber}`);
  }

  // Determine which team won based on the team number
  let winnerRow = -1;
  if (team1Info && team1Info.teamNumber === winnerTeamNumber) {
    winnerRow = team1Row;
    console.log(`Winner is team1, row ${winnerRow}`);
  } else if (team2Info && team2Info.teamNumber === winnerTeamNumber) {
    winnerRow = team2Row;
    console.log(`Winner is team2, row ${winnerRow}`);
  } else {
    // Try matching by display name
    if (team1Info && winnerDisplayName.includes(team1Info.teamNumber)) {
      winnerRow = team1Row;
    } else if (team2Info && winnerDisplayName.includes(team2Info.teamNumber)) {
      winnerRow = team2Row;
    } else {
      // Default to team1's row
      winnerRow = team1Row;
      console.warn(`Could not match winner to a team, using team1's row`);
    }
  }

  // Find the advancement cell - look to the right of the game for the next game's team slot
  // Calculate the expected advancement row (midpoint between the two teams)
  // In bracket structure: odd games use ceil (upper slot), even games use floor (lower slot)
  const rawMid = team2Row > 0 ? (team1Row + team2Row) / 2 : team1Row;
  const midRow = gameNumber % 2 === 1 ? Math.ceil(rawMid) : Math.floor(rawMid);
  
  console.log(`Looking for advancement cell. team1Row=${team1Row}, team2Row=${team2Row}, midRow=${midRow}`);
  
  // First, find columns that contain game headers (these are bracket columns)
  // Skip columns that are just empty padding
  const bracketColumns: number[] = [];
  for (let col = gameCol + 1; col < Math.min(gameCol + 15, 26); col++) {
    let hasGameHeader = false;
    for (let row = 0; row < values.length; row++) {
      if (values[row] && values[row][col]) {
        const cellVal = String(values[row][col]).trim();
        if (gamePatternAny.test(cellVal)) {
          hasGameHeader = true;
          break;
        }
      }
    }
    if (hasGameHeader) {
      bracketColumns.push(col);
    }
  }
  
  console.log(`Bracket columns to the right: ${bracketColumns.map(c => columnToLetter(c)).join(', ')}`);
  
  let targetCol = -1;
  let targetRow = -1;
  
  // For each bracket column, find the cell that best matches the expected position
  for (const col of bracketColumns) {
    // Search rows in the range between our teams (with some margin)
    const searchStart = Math.max(0, team1Row - 2);
    const searchEnd = Math.min(values.length - 1, (team2Row > 0 ? team2Row : team1Row) + 2);
    
    // First, check if midRow itself is empty or has the winner
    if (midRow >= searchStart && midRow <= searchEnd) {
      const cellVal = values[midRow] ? String(values[midRow][col] || '').trim() : '';
      if (cellVal === '' || cellVal === winnerDisplayName || 
          (team1Info && cellVal.startsWith(team1Info.teamNumber)) ||
          (team2Info && cellVal.startsWith(team2Info.teamNumber))) {
        targetCol = col;
        targetRow = midRow;
        console.log(`Found exact midRow match at col ${col} (${columnToLetter(col)}), row ${midRow}`);
        break;
      }
    }
    
    // If midRow didn't work, search nearby rows
    for (let offset = 1; offset <= 3; offset++) {
      // Check midRow + offset
      const rowUp = midRow - offset;
      const rowDown = midRow + offset;
      
      for (const checkRow of [rowDown, rowUp]) {
        if (checkRow < searchStart || checkRow > searchEnd) continue;
        if (!values[checkRow]) continue;
        
        const cellVal = String(values[checkRow][col] || '').trim();
        
        // Skip game headers
        if (gamePatternAny.test(cellVal)) continue;
        
        // Accept empty cells or cells that already have a matching team
        if (cellVal === '' || cellVal === winnerDisplayName ||
            (team1Info && cellVal.startsWith(team1Info.teamNumber)) ||
            (team2Info && cellVal.startsWith(team2Info.teamNumber))) {
          targetCol = col;
          targetRow = checkRow;
          console.log(`Found nearby match at col ${col} (${columnToLetter(col)}), row ${checkRow} (offset ${offset} from midRow=${midRow})`);
          break;
        }
      }
      
      if (targetCol !== -1) break;
    }
    
    // Use the first bracket column where we found a match
    if (targetCol !== -1) break;
  }
  
  if (targetCol === -1) {
    // Fallback: use the first bracket column at the midRow position
    targetCol = bracketColumns.length > 0 ? bracketColumns[0] : gameCol + 3;
    targetRow = midRow;
    console.warn(`Could not find exact advancement cell for Game ${gameNumber}, using fallback: col ${targetCol} (${columnToLetter(targetCol)}), row ${targetRow}`);
  }

  // Write the winner
  const targetCell = `${sheetName}!${columnToLetter(targetCol)}${targetRow + 1}`;
  
  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId,
    range: targetCell,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[winnerDisplayName]]
    }
  });
  
  console.log(`Wrote winner "${winnerDisplayName}" to ${targetCell}`);
}

/**
 * Clear a winner from the bracket (for revert functionality)
 */
export async function clearWinnerFromBracket(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  gameNumber: number
): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  // Check if we have a known target cell for this game
  const knownTargetCell = BRACKET_TARGET_CELLS_16_TEAM[gameNumber];
  
  if (knownTargetCell) {
    const fullCellRef = `${sheetName}!${knownTargetCell}`;
    
    console.log(`Clearing winner from ${fullCellRef} (from lookup table)`);
    
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId,
      range: fullCellRef,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['']]  // Clear the cell
      }
    });
    
    return;
  }
  
  console.warn(`clearWinnerFromBracket: Game ${gameNumber} not in lookup table, cannot clear`);
}

