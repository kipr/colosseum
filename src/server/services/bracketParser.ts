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
 * Preserves the original string (including trailing spaces) as displayName
 */
function parseTeamString(teamStr: string): { teamNumber: string; displayName: string } | null {
  if (!teamStr || teamStr === 'Bye' || teamStr.trim() === '') {
    return null;
  }
  
  // Use trimmed version for parsing the team number
  const trimmed = teamStr.trim();
  const spaceIndex = trimmed.indexOf(' ');
  
  if (spaceIndex === -1) {
    // Just a number - preserve original
    return { teamNumber: trimmed, displayName: teamStr };
  }
  
  const teamNumber = trimmed.substring(0, spaceIndex);
  // Preserve original string (including any trailing spaces) as displayName
  // This is important for bracket validation that expects exact format
  const displayName = teamStr;
  
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

  // Use wider range for 64-team brackets which use columns beyond Z (up to AK)
  const response = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: `${sheetName}!A:AK`,
  });

  const values = response.data.values || [];
  if (values.length === 0) {
    throw new Error('Bracket sheet is empty');
  }

  const games: BracketGame[] = [];
  // Match "Game X" at the start, allowing optional trailing text like "Game 15 - Finals"
  const gamePattern = /^Game\s+(\d+)(?:\s|$)/i;

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
        // In 64-team brackets, later rounds can have teams 60+ rows apart
        const maxSearchRows = 65; // Search up to 65 rows down for 64-team brackets
        let team1Row = -1;
        let team2Row = -1;
        let teamColumn = colIdx; // Track which column the teams are in
        
        for (let searchOffset = 1; searchOffset <= maxSearchRows && rowIdx + searchOffset < values.length; searchOffset++) {
          const searchRow = values[rowIdx + searchOffset];
          if (!searchRow) continue;
          
          const cellValueRaw = String(searchRow[colIdx] || '');
          const cellValue = cellValueRaw.trim();
          
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
          
          // Try to parse as a team - pass raw value to preserve trailing spaces
          const potentialTeam = parseTeamString(cellValueRaw);
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
        
        // If no teams found directly below, OR only one team found, check shifted column
        if (!team1 || !team2) {
          // For championship/final games, teams may be in the next column
          const shiftedCol = colIdx + 1;
          
          if (!team1) {
            isChampionshipGame = true;
            teamColumn = shiftedCol; // Teams are in shifted column
            
            // Team 1 is in the same row or row below, shifted column
            if (row[shiftedCol]) {
              team1 = parseTeamString(String(row[shiftedCol]));
              if (team1) team1Row = rowIdx;
            }
            if (!team1 && rowIdx + 1 < values.length) {
              const nextRow = values[rowIdx + 1];
              if (nextRow && nextRow[shiftedCol]) {
                team1 = parseTeamString(String(nextRow[shiftedCol]));
                if (team1) team1Row = rowIdx + 1;
              }
            }
          }
          
          // Search for teams in the shifted column (broader search for finals)
          if (!team2) {
            teamColumn = shiftedCol; // Update team column
            for (let searchRow = rowIdx; searchRow < Math.min(rowIdx + maxSearchRows, values.length); searchRow++) {
              const searchRowData = values[searchRow];
              if (!searchRowData || !searchRowData[shiftedCol]) continue;
              
              const cellValueRaw = String(searchRowData[shiftedCol]);
              const cellValue = cellValueRaw.trim();
              // Skip if it's another game label
              if (gamePattern.test(cellValue)) break;
              
              // Pass raw value to preserve trailing spaces
              const potentialTeam = parseTeamString(cellValueRaw);
              if (potentialTeam) {
                if (!team1) {
                  team1 = potentialTeam;
                  team1Row = searchRow;
                } else if (potentialTeam.teamNumber !== team1.teamNumber) {
                  team2 = potentialTeam;
                  team2Row = searchRow;
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
        
        // Check columns for the advancement cell
        // Search the range around team rows including midRow
        const searchRows = [actualTeam1Row, actualTeam2Row, midRow, midRow - 1, midRow + 1];
        
        // Determine search direction based on bracket size and game number
        const bracketSize = detectBracketSize(sheetName);
        
        // Special handling for 64-team bracket finals games
        const finalsWinnerCell = bracketSize === 64 ? get64TeamFinalsWinnerCell(gameNumber) : null;
        
        if (finalsWinnerCell) {
          // For finals games, check the specific winner cell directly
          const colLetter = finalsWinnerCell.replace(/[0-9]/g, '');
          const rowNum = parseInt(finalsWinnerCell.replace(/[A-Z]/gi, ''), 10);
          
          // Convert column letter to index (A=0, B=1, ... Z=25, AA=26, etc.)
          let colIdx = 0;
          for (let i = 0; i < colLetter.length; i++) {
            colIdx = colIdx * 26 + (colLetter.charCodeAt(i) - 64);
          }
          colIdx--; // Convert to 0-based
          
          const checkRow = rowNum - 1; // Convert to 0-based
          
          if (checkRow >= 0 && checkRow < values.length && 
              values[checkRow] && values[checkRow][colIdx]) {
            const cellVal = String(values[checkRow][colIdx]).trim();
            // For finals games, accept any non-empty value that looks like a team
            // (starts with digits, or matches either team)
            if (cellVal && (matchesTeam(cellVal) || /^\d/.test(cellVal))) {
              winner = cellVal;
              hasWinner = true;
            }
          }
        } else {
          // Standard search for non-finals games
          const searchDirection = getWinnerSearchDirection(bracketSize, gameNumber);
          
          // Start winner search based on direction
          const winnerSearchStartCol = teamColumn + 1;
          
          outerLoop:
          if (searchDirection === 'right') {
            // Search RIGHT (standard direction for most brackets)
            for (let checkCol = winnerSearchStartCol; checkCol < Math.min(winnerSearchStartCol + 10, 37); checkCol++) {
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
          } else {
            // Search LEFT (for 64-team bracket right side)
            for (let checkCol = teamColumn - 1; checkCol >= Math.max(teamColumn - 10, 0); checkCol--) {
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
 * Detect bracket size from sheet name
 * Sheet names should start with "DE 4", "DE 8", "DE 16", "DE 32", or "DE 64"
 */
function detectBracketSize(sheetName: string): number {
  const normalized = sheetName.toLowerCase();
  if (normalized.startsWith('de 64') || normalized.startsWith('de64')) return 64;
  if (normalized.startsWith('de 32') || normalized.startsWith('de32')) return 32;
  if (normalized.startsWith('de 16') || normalized.startsWith('de16')) return 16;
  if (normalized.startsWith('de 8') || normalized.startsWith('de8')) return 8;
  if (normalized.startsWith('de 4') || normalized.startsWith('de4')) return 4;
  // Default to 16 if not specified
  return 16;
}

/**
 * Determine winner search direction for a game
 * For 64-team brackets, the right side advances LEFT (mirrored structure)
 * All other brackets advance RIGHT
 */
function getWinnerSearchDirection(bracketSize: number, gameNumber: number): 'left' | 'right' {
  // Only 64-team brackets have mirrored structure
  if (bracketSize !== 64) {
    return 'right';
  }
  
  // 64-team bracket: RIGHT side games advance LEFT
  // These are the game numbers that are on the RIGHT side of the bracket
  const rightSideGames = new Set([
    // Winners R1 RIGHT (17-32)
    17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    // Losers R1 RIGHT (41-48)
    41, 42, 43, 44, 45, 46, 47, 48,
    // Winners R2 RIGHT (57-64)
    57, 58, 59, 60, 61, 62, 63, 64,
    // Losers R2 RIGHT (73-80)
    73, 74, 75, 76, 77, 78, 79, 80,
    // Winners R3 RIGHT (85-88)
    85, 86, 87, 88,
    // Losers R3 RIGHT (93-96)
    93, 94, 95, 96,
    // Losers R4 RIGHT (101-104)
    101, 102, 103, 104,
    // Winners R4 RIGHT (107-108)
    107, 108,
    // Losers R5 RIGHT (111-112)
    111, 112,
    // Losers R6 RIGHT (115-116)
    115, 116,
    // Losers R7 RIGHT (118)
    118,
    // Winners Semi RIGHT (120)
    120,
    // Losers Semi RIGHT (122)
    122,
  ]);
  
  return rightSideGames.has(gameNumber) ? 'left' : 'right';
}

/**
 * For 64-team bracket finals games, define exact winner cell locations
 * These games are special because they're in the center where both sides converge
 * Returns the cell reference where the winner of THIS GAME is written
 */
function get64TeamFinalsWinnerCell(gameNumber: number): string | null {
  // These match the BRACKET_TARGET_CELLS_64_TEAM entries
  const finalsWinnerCells: Record<number, string> = {
    // Winners Final - winner is written to G51
    123: 'G51',
    // Losers Final - winner is written to X27
    124: 'X27',
    // Grand Final - winner is written to G52
    125: 'G52',
    // Championship - winner is written to G56
    126: 'G56',
    // Championship Reset - winner is written to G61
    127: 'G61',
  };
  
  return finalsWinnerCells[gameNumber] || null;
}

/**
 * Lookup table for 4-team double elimination bracket
 */
const BRACKET_TARGET_CELLS_4_TEAM: Record<number, string> = {
  // Main Bracket (Games 1-2) → Semi-finals
  1: 'D5',
  2: 'D8',
  
  // Consolation (Game 3) → From loser of game 1
  3: 'D14',
  
  // Main Final (Game 4)
  4: 'F7',
  
  // Consolation Final (Game 5)
  5: 'F13',
  
  // True Final (Game 6)
  6: 'H11',
  
  // Grand Final if needed (Game 7)
  7: 'J13',
};

/**
 * Lookup table for 8-team double elimination bracket
 */
const BRACKET_TARGET_CELLS_8_TEAM: Record<number, string> = {
  // Main Bracket Round 1 (Games 1-4) → Quarter-finals
  1: 'E5', 2: 'E8',
  3: 'E13', 4: 'E16',
  
  // Consolation Round 1 (Games 5-6)
  5: 'D24', 6: 'D28',
  
  // Main Bracket Round 2 (Games 7-8) → Semi-finals
  7: 'H7', 8: 'H14',
  
  // Consolation Round 2 (Games 9-10)
  9: 'F24', 10: 'F27',
  
  // Main Final (Game 11)
  11: 'K11',

  // Consolation Round 3 (Game 12)
  12: 'H25',
  
  // Consolation Final (Game 13)
  13: 'K23',
  
  // True Final (Game 14)
  14: 'O16',
  
  // Grand Final if needed (Game 15)
  15: 'Q18',
};

/**
 * Lookup table for 16-team double elimination bracket
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
 * Lookup table for 32-team double elimination bracket
 * Based on the clearDE32 function pattern
 */
const BRACKET_TARGET_CELLS_32_TEAM: Record<number, string> = {
  // Winners Bracket Round 1 (Games 1-16)
  1: 'E5', 2: 'E8', 3: 'E13', 4: 'E16',
  5: 'E21', 6: 'E24', 7: 'E29', 8: 'E32',
  9: 'E37', 10: 'E40', 11: 'E45', 12: 'E48',
  13: 'E53', 14: 'E56', 15: 'E61', 16: 'E64',
  
  // Consolation Bracket Round 1 (Games 17-24)
  17: 'D71', 18: 'D75', 19: 'D79', 20: 'D83',
  21: 'D87', 22: 'D91', 23: 'D95', 24: 'D99',
  
  // Winners Bracket Round 2 (Games 25-32)
  25: 'H7', 26: 'H14', 27: 'H23', 28: 'H30',
  29: 'H39', 30: 'H46', 31: 'H55', 32: 'H62',
  
  // Consolation Bracket Round 2 (Games 33-40)
  33: 'F71', 34: 'F74', 35: 'F79', 36: 'F82',
  37: 'F87', 38: 'F90', 39: 'F95', 40: 'F98',
  
  // Winners Bracket Round 3 (Games 41-44)
  41: 'K11', 42: 'K26', 43: 'K43', 44: 'K58',
  
  // Consolation Bracket Round 3 (Games 45-48)
  45: 'H72', 46: 'H80', 47: 'H88', 48: 'H96',
  
  // Consolation Bracket Round 4 (Games 49-52)
  49: 'J71', 50: 'J78', 51: 'J87', 52: 'J94',
  
  // Winners Bracket Round 4 (Games 53-54)
  53: 'N19', 54: 'N50',
  
  // Consolation Bracket Round 5 (Games 55-56)
  55: 'L74', 56: 'L90',
  
  // Consolation Bracket Round 6 (Games 57-58)
  57: 'N71', 58: 'N86',
  
  // Consolation Bracket Round 7 (Game 59)
  59: 'R35',
  
  // Winners Bracket Final (Game 60)
  60: 'P78',
  
  // Consolation Bracket Final (Game 61)
  61: 'R70',
  
  // Grand Final (Game 62) - if winner comes from consolation
  62: 'V53',
  
  // Grand Final Reset (Game 63) - if needed
  63: 'X55',
};

/**
 * Lookup table for 64-team double elimination bracket
 * Based on the DE 64 Team.csv template
 * 
 * IMPORTANT: This bracket has a MIRRORED structure:
 * - LEFT side (Games 1-16): Teams in column B, winners advance RIGHT to C, D, E, F, G
 * - RIGHT side (Games 17-32): Teams in column M, winners advance LEFT to L, K, J, I, H
 * - Both sides CONVERGE in the middle around column G/H
 * 
 * Consolation bracket (columns P onwards) also has mirrored structure
 */
const BRACKET_TARGET_CELLS_64_TEAM: Record<number, string> = {
  // ========== MAIN BRACKET (Winners Side) ==========
  
  // --- LEFT SIDE: Winners advance RIGHT (B → C → D → E → F → G) ---
  
  // Winners Round 1 LEFT (Games 1-16) - Teams in B, winners go to C
  // Each game takes 3 rows: team1, game label, team2 - so spacing is 3
  1: 'C3',    // Seeds 1 vs 64
  2: 'C6',    // Seeds 32 vs 33
  3: 'C11',    // Seeds 17 vs 48
  4: 'C14',   // Seeds 16 vs 49
  5: 'C19',   // Seeds 9 vs 56
  6: 'C22',   // Seeds 24 vs 41
  7: 'C27',   // Seeds 25 vs 40
  8: 'C30',   // Seeds 8 vs 57
  9: 'C35',   // Seeds 4 vs 61
  10: 'C38',  // Seeds 29 vs 36
  11: 'C43',  // Seeds 20 vs 45
  12: 'C46',  // Seeds 13 vs 52
  13: 'C51',  // Seeds 12 vs 53
  14: 'C54',  // Seeds 21 vs 44
  15: 'C59',  // Seeds 28 vs 37
  16: 'C62',  // Seeds 5 vs 60
  
  // --- RIGHT SIDE: Winners advance LEFT (M → L → K → J → I → H) ---
  
  // Winners Round 1 RIGHT (Games 17-32) - Teams in M, winners go BACK to L
  // Same alternating 3,5 pattern as left side: pairs at (3,6), (11,14), (19,22), etc.
  17: 'L3',   // Seeds 2 vs 63
  18: 'L6',   // Seeds 31 vs 34
  19: 'L11',  // Seeds 18 vs 47
  20: 'L14',  // Seeds 15 vs 50
  21: 'L19',  // Seeds 10 vs 55
  22: 'L22',  // Seeds 23 vs 42
  23: 'L27',  // Seeds 26 vs 39
  24: 'L30',  // Seeds 7 vs 58
  25: 'L35',  // Seeds 3 vs 62
  26: 'L38',  // Seeds 30 vs 35
  27: 'L43',  // Seeds 19 vs 46
  28: 'L46',  // Seeds 14 vs 51
  29: 'L51',  // Seeds 11 vs 54
  30: 'L54',  // Seeds 22 vs 43
  31: 'L59',  // Seeds 27 vs 38
  32: 'L62',  // Seeds 6 vs 59
  
  // Winners Round 2 LEFT (Games 49-56) - Winners of 1-16, advance to D
  // Midpoint of each R1 pair (spacing of 8): rows 5, 13, 21, 29, 37, 45, 53, 61
  49: 'D5',   // Winners of G1(C3) & G2(C6) → midpoint 5
  50: 'D12',  // Winners of G3(C11) & G4(C14) → midpoint 13
  51: 'D21',  // Winners of G5(C19) & G6(C22) → midpoint 21
  52: 'D28',  // Winners of G7(C27) & G8(C30) → midpoint 29
  53: 'D37',  // Winners of G9(C35) & G10(C38) → midpoint 37
  54: 'D44',  // Winners of G11(C43) & G12(C46) → midpoint 45
  55: 'D53',  // Winners of G13(C51) & G14(C54) → midpoint 53
  56: 'D60',  // Winners of G15(C59) & G16(C62) → midpoint 61
  
  // Winners Round 2 RIGHT (Games 57-64) - Winners of 17-32, advance LEFT to K
  // Same pattern as left side: rows 5, 12, 21, 28, 37, 44, 53, 60
  57: 'K5',   // Winners of G17(L3) & G18(L6)
  58: 'K12',  // Winners of G19(L11) & G20(L14)
  59: 'K21',  // Winners of G21(L19) & G22(L22)
  60: 'K28',  // Winners of G23(L27) & G24(L30)
  61: 'K37',  // Winners of G25(L35) & G26(L38)
  62: 'K44',  // Winners of G27(L43) & G28(L46)
  63: 'K53',  // Winners of G29(L51) & G30(L54)
  64: 'K60',  // Winners of G31(L59) & G32(L62)
  
  // Winners Round 3 LEFT (Games 81-84) - advance to E
  // Midpoint of R2 pairs (spacing of 16): rows 9, 25, 41, 57
  81: 'E9',   // Winners of G49(D5) & G50(D13) → midpoint 9
  82: 'E24',  // Winners of G51(D21) & G52(D29) → midpoint 25
  83: 'E41',  // Winners of G53(D37) & G54(D45) → midpoint 41
  84: 'E56',  // Winners of G55(D53) & G56(D61) → midpoint 57
  
  // Winners Round 3 RIGHT (Games 85-88) - advance LEFT to J
  // Same pattern as left side: rows 9, 24, 41, 56
  85: 'J9',   // Winners of G57(K5) & G58(K12)
  86: 'J24',  // Winners of G59(K21) & G60(K28)
  87: 'J41',  // Winners of G61(K37) & G62(K44)
  88: 'J56',  // Winners of G63(K53) & G64(K60)
  
  // Winners Round 4 LEFT (Games 105-106) - advance to F
  // Midpoint of R3 pairs (spacing of 32): rows 17, 49
  105: 'F17',  // Winners of G81(E9) & G82(E25) → midpoint 17
  106: 'F48',  // Winners of G83(E41) & G84(E57) → midpoint 49
  
  // Winners Round 4 RIGHT (Games 107-108) - advance LEFT to I
  // Same pattern as left side: rows 17, 48
  107: 'I17',  // Winners of G85(J9) & G86(J24)
  108: 'I48',  // Winners of G87(J41) & G88(J56)
  
  // Winners Semi-Finals (Games 119-120) - converge toward center
  // Midpoint of R4 games: row 33
  119: 'G32',  // Winner of G105(F17) vs G106(F49) → midpoint 33
  120: 'H32',  // Winner of G107(I17) vs G108(I49) → midpoint 33
  
  // Winners Final (Game 123) - at center where semi-finals converge
  123: 'G51',  // TODO: verify actual position - may need adjustment
  
  // ========== CONSOLATION BRACKET (Losers Side) ==========
  // Consolation also has mirrored structure (LEFT advances right, RIGHT advances left)
  
  // --- Consolation LEFT SIDE ---
  
  // Losers Round 1 LEFT (Games 33-40) - Column P area
  33: 'Q3',   34: 'Q7',   35: 'Q11',  36: 'Q15',
  37: 'Q24',  38: 'Q28',  39: 'Q32',  40: 'Q36',
  
  // --- Consolation RIGHT SIDE ---
  
  // Losers Round 1 RIGHT (Games 41-48) - Right side of consolation
  // Same pattern as left side: rows 3, 7, 11, 15, 24, 28, 32, 36
  41: 'AF3',  42: 'AF7',  43: 'AF11', 44: 'AF15',
  45: 'AF24', 46: 'AF28', 47: 'AF32', 48: 'AF36',
  
  // Losers Round 2 LEFT (Games 65-72)
  65: 'R4',   66: 'R7',  67: 'R12',  68: 'R15',
  69: 'R24',  70: 'R27',  71: 'R32',  72: 'R35',
  
  // Losers Round 2 RIGHT (Games 73-80)
  // Same pattern as left side: rows 4, 7, 12, 15, 24, 27, 32, 35
  73: 'AE4',  74: 'AE7',  75: 'AE12', 76: 'AE15',
  77: 'AE24', 78: 'AE27', 79: 'AE32', 80: 'AE35',
  
  // Losers Round 3 (Games 89-96)
  // LEFT: rows 6, 14, 25, 33 | RIGHT: same pattern
  89: 'S6',   90: 'S14',  91: 'S25',  92: 'S33',
  93: 'AD6',  94: 'AD14', 95: 'AD25', 96: 'AD33',
  
  // Losers Round 4 (Games 97-104)
  // LEFT: rows 8, 15, 24, 31 | RIGHT: same pattern
  97: 'T8',   98: 'T15',  99: 'T24',  100: 'T31',
  101: 'AC8', 102: 'AC15', 103: 'AC24', 104: 'AC31',
  
  // Losers Round 5 (Games 109-112)
  // LEFT: rows 12, 28 | RIGHT: same pattern
  109: 'U12',  110: 'U28',  111: 'AB12', 112: 'AB28',
  
  // Losers Round 6 (Games 113-116)
  // LEFT: rows 16, 31 | RIGHT: same pattern
  113: 'V16',  114: 'V31',  115: 'AA16', 116: 'AA31',
  
  // Losers Round 7 (Games 117-118)
  // LEFT: row 23 | RIGHT: same pattern
  117: 'W23',  118: 'Z23',
  
  // Losers Semi-Final (Games 121-122)
  121: 'X16',  122: 'Y16',
  
  // Losers Final (Game 124)
  124: 'X27',
  
  // Grand Final (Game 125) - Loser of Winners Final vs Winner of Losers
  125: 'G52',
  
  // Championship (Game 126) - Column G area
  126: 'G56',
  
  // Championship Reset if needed (Game 127)
  127: 'G61',
};

/**
 * Get the appropriate lookup table based on bracket size
 */
function getBracketLookupTable(size: number): Record<number, string> {
  switch (size) {
    case 4: return BRACKET_TARGET_CELLS_4_TEAM;
    case 8: return BRACKET_TARGET_CELLS_8_TEAM;
    case 16: return BRACKET_TARGET_CELLS_16_TEAM;
    case 32: return BRACKET_TARGET_CELLS_32_TEAM;
    case 64: return BRACKET_TARGET_CELLS_64_TEAM;
    default: return BRACKET_TARGET_CELLS_16_TEAM;
  }
}

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

  // Detect bracket size from sheet name
  const bracketSize = detectBracketSize(sheetName);
  const lookupTable = getBracketLookupTable(bracketSize);

  // Check if we have a known target cell for this game
  const knownTargetCell = lookupTable[gameNumber];
  
  if (knownTargetCell) {
    // Use the lookup table - most reliable method
    const fullCellRef = `${sheetName}!${knownTargetCell}`;
    
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
    
    const cellValueRaw = String(searchRow[gameCol] || '');
    const cellValue = cellValueRaw.trim();
    
    // Stop if we hit another "Game X" pattern
    if (gamePatternAny.test(cellValue)) break;
    
    // Try to parse as a team - pass raw value to preserve trailing spaces
    const potentialTeam = parseTeamString(cellValueRaw);
    if (potentialTeam) {
      if (!team1Info) {
        team1Info = potentialTeam;
        team1Row = gameRow + searchOffset;
      } else if (!team2Info && potentialTeam.teamNumber !== team1Info.teamNumber) {
        team2Info = potentialTeam;
        team2Row = gameRow + searchOffset;
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
  } else if (team2Info && team2Info.teamNumber === winnerTeamNumber) {
    winnerRow = team2Row;
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

  // Detect bracket size from sheet name
  const bracketSize = detectBracketSize(sheetName);
  const lookupTable = getBracketLookupTable(bracketSize);

  // Check if we have a known target cell for this game
  const knownTargetCell = lookupTable[gameNumber];
  
  if (knownTargetCell) {
    const fullCellRef = `${sheetName}!${knownTargetCell}`;
    
    
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
  
  console.warn(`clearWinnerFromBracket: Game ${gameNumber} not in ${bracketSize}-team lookup table, cannot clear`);
}

