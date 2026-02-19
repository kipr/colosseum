import { Database } from '../database/connection';

/**
 * Double-elimination bracket template definition.
 * This defines the structure of games for a bracket of a given size.
 */
export interface BracketTemplate {
  bracket_size: number;
  game_number: number;
  round_name: string;
  round_number: number;
  bracket_side: 'winners' | 'losers' | 'finals';
  team1_source: string; // e.g., 'seed:1', 'winner:5', 'loser:3'
  team2_source: string;
  winner_advances_to: number | null;
  loser_advances_to: number | null;
  winner_slot: 'team1' | 'team2' | null;
  loser_slot: 'team1' | 'team2' | null;
  is_championship: boolean;
  is_grand_final: boolean;
  is_reset_game: boolean;
}

/**
 * Generate double-elimination bracket templates for a given bracket size.
 * Supports sizes: 4, 8, 16, 32, 64
 */
export function generateDEBracketTemplates(
  bracketSize: number,
): BracketTemplate[] {
  switch (bracketSize) {
    case 4:
      return generate4TeamDE();
    case 8:
      return generate8TeamDE();
    case 16:
      return generate16TeamDE();
    case 32:
      return generate32TeamDE();
    case 64:
      return generate64TeamDE();
    default:
      throw new Error(`Unsupported bracket size: ${bracketSize}`);
  }
}

/**
 * Ensure bracket templates are seeded for a given bracket size.
 * This is idempotent - it will not insert duplicates.
 */
export async function ensureBracketTemplatesSeeded(
  db: Database,
  bracketSize: number,
): Promise<void> {
  const templates = generateDEBracketTemplates(bracketSize);

  for (const t of templates) {
    await db.run(
      `INSERT INTO bracket_templates (
        bracket_size, game_number, round_name, round_number, bracket_side,
        team1_source, team2_source, winner_advances_to, loser_advances_to,
        winner_slot, loser_slot, is_championship, is_grand_final, is_reset_game
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (bracket_size, game_number) DO NOTHING`,
      [
        t.bracket_size,
        t.game_number,
        t.round_name,
        t.round_number,
        t.bracket_side,
        t.team1_source,
        t.team2_source,
        t.winner_advances_to,
        t.loser_advances_to,
        t.winner_slot,
        t.loser_slot,
        t.is_championship,
        t.is_grand_final,
        t.is_reset_game,
      ],
    );
  }
}

// =============================================================================
// 4-TEAM DOUBLE ELIMINATION
// =============================================================================
// Structure:
// Winners R1: G1, G2
// Winners Final (G3): winner of G1 vs winner of G2
// Losers R1 (G4): loser of G1 vs loser of G2
// Losers Final (G5): loser of G3 vs winner of G4
// Grand Final (G6): winner of G3 vs winner of G5
// Reset (G7): if loser of G6 came from winners bracket

function generate4TeamDE(): BracketTemplate[] {
  return [
    // Winners R1
    {
      bracket_size: 4,
      game_number: 1,
      round_name: 'Winners R1',
      round_number: 1,
      bracket_side: 'winners',
      team1_source: 'seed:1',
      team2_source: 'seed:4',
      winner_advances_to: 3,
      loser_advances_to: 4,
      winner_slot: 'team1',
      loser_slot: 'team1',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    },
    {
      bracket_size: 4,
      game_number: 2,
      round_name: 'Winners R1',
      round_number: 1,
      bracket_side: 'winners',
      team1_source: 'seed:2',
      team2_source: 'seed:3',
      winner_advances_to: 3,
      loser_advances_to: 4,
      winner_slot: 'team2',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    },
    // Winners Final
    {
      bracket_size: 4,
      game_number: 3,
      round_name: 'Winners Final',
      round_number: 2,
      bracket_side: 'winners',
      team1_source: 'winner:1',
      team2_source: 'winner:2',
      winner_advances_to: 6,
      loser_advances_to: 5,
      winner_slot: 'team1',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    },
    // Losers R1
    {
      bracket_size: 4,
      game_number: 4,
      round_name: 'Losers R1',
      round_number: 1,
      bracket_side: 'losers',
      team1_source: 'loser:1',
      team2_source: 'loser:2',
      winner_advances_to: 5,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    },
    // Losers Final
    {
      bracket_size: 4,
      game_number: 5,
      round_name: 'Losers Final',
      round_number: 2,
      bracket_side: 'losers',
      team1_source: 'winner:4',
      team2_source: 'loser:3',
      winner_advances_to: 6,
      loser_advances_to: null,
      winner_slot: 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    },
    // Grand Final
    {
      bracket_size: 4,
      game_number: 6,
      round_name: 'Grand Final',
      round_number: 3,
      bracket_side: 'finals',
      team1_source: 'winner:3',
      team2_source: 'winner:5',
      winner_advances_to: 7,
      loser_advances_to: 7,
      winner_slot: 'team2',
      loser_slot: 'team1',
      is_championship: false,
      is_grand_final: true,
      is_reset_game: false,
    },
    // Reset (if needed)
    {
      bracket_size: 4,
      game_number: 7,
      round_name: 'Championship Reset',
      round_number: 4,
      bracket_side: 'finals',
      team1_source: 'loser:6',
      team2_source: 'winner:6',
      winner_advances_to: null,
      loser_advances_to: null,
      winner_slot: null,
      loser_slot: null,
      is_championship: true,
      is_grand_final: false,
      is_reset_game: true,
    },
  ];
}

// =============================================================================
// 8-TEAM DOUBLE ELIMINATION
// =============================================================================

function generate8TeamDE(): BracketTemplate[] {
  const templates: BracketTemplate[] = [];

  // Winners R1 (Games 1-4)
  const winnersR1Seeds = [
    [1, 8],
    [4, 5],
    [2, 7],
    [3, 6],
  ];
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 8,
      game_number: i + 1,
      round_name: 'Winners R1',
      round_number: 1,
      bracket_side: 'winners',
      team1_source: `seed:${winnersR1Seeds[i][0]}`,
      team2_source: `seed:${winnersR1Seeds[i][1]}`,
      winner_advances_to: 5 + Math.floor(i / 2),
      loser_advances_to: 7 + Math.floor(i / 2),
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: i % 2 === 0 ? 'team1' : 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners Semi (Games 5-6)
  templates.push({
    bracket_size: 8,
    game_number: 5,
    round_name: 'Winners Semi',
    round_number: 2,
    bracket_side: 'winners',
    team1_source: 'winner:1',
    team2_source: 'winner:2',
    winner_advances_to: 13,
    loser_advances_to: 9,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });
  templates.push({
    bracket_size: 8,
    game_number: 6,
    round_name: 'Winners Semi',
    round_number: 2,
    bracket_side: 'winners',
    team1_source: 'winner:3',
    team2_source: 'winner:4',
    winner_advances_to: 13,
    loser_advances_to: 10,
    winner_slot: 'team2',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers R1 (Games 7-10): losers from winners R1
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 8,
      game_number: 7 + i,
      round_name: 'Losers R1',
      round_number: 1,
      bracket_side: 'losers',
      team1_source: `loser:${i + 1}`,
      team2_source: `loser:${4 - i}`, // Cross-matching for balance
      winner_advances_to: 11 + Math.floor(i / 2),
      loser_advances_to: null,
      winner_slot: i % 2 === 0 ? 'team1' : 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Actually, let's simplify and use a more standard 8-team structure
  // Losers R1: Games 7-8 (2 games from 4 losers)
  templates.length = 6; // Reset to just winners games

  // Losers R1 (Games 7-8)
  templates.push({
    bracket_size: 8,
    game_number: 7,
    round_name: 'Losers R1',
    round_number: 1,
    bracket_side: 'losers',
    team1_source: 'loser:1',
    team2_source: 'loser:2',
    winner_advances_to: 9,
    loser_advances_to: null,
    winner_slot: 'team1',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });
  templates.push({
    bracket_size: 8,
    game_number: 8,
    round_name: 'Losers R1',
    round_number: 1,
    bracket_side: 'losers',
    team1_source: 'loser:3',
    team2_source: 'loser:4',
    winner_advances_to: 10,
    loser_advances_to: null,
    winner_slot: 'team1',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers R2 (Games 9-10): losers from winners semi vs winners from losers R1
  templates.push({
    bracket_size: 8,
    game_number: 9,
    round_name: 'Losers R2',
    round_number: 2,
    bracket_side: 'losers',
    team1_source: 'winner:7',
    team2_source: 'loser:5',
    winner_advances_to: 11,
    loser_advances_to: null,
    winner_slot: 'team1',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });
  templates.push({
    bracket_size: 8,
    game_number: 10,
    round_name: 'Losers R2',
    round_number: 2,
    bracket_side: 'losers',
    team1_source: 'winner:8',
    team2_source: 'loser:6',
    winner_advances_to: 11,
    loser_advances_to: null,
    winner_slot: 'team2',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Semi (Game 11)
  templates.push({
    bracket_size: 8,
    game_number: 11,
    round_name: 'Losers Semi',
    round_number: 3,
    bracket_side: 'losers',
    team1_source: 'winner:9',
    team2_source: 'winner:10',
    winner_advances_to: 12,
    loser_advances_to: null,
    winner_slot: 'team1',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Final (Game 12): winner of losers semi vs loser of winners final
  templates.push({
    bracket_size: 8,
    game_number: 12,
    round_name: 'Losers Final',
    round_number: 4,
    bracket_side: 'losers',
    team1_source: 'winner:11',
    team2_source: 'loser:13',
    winner_advances_to: 14,
    loser_advances_to: null,
    winner_slot: 'team2',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Winners Final (Game 13)
  templates.push({
    bracket_size: 8,
    game_number: 13,
    round_name: 'Winners Final',
    round_number: 3,
    bracket_side: 'winners',
    team1_source: 'winner:5',
    team2_source: 'winner:6',
    winner_advances_to: 14,
    loser_advances_to: 12,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Grand Final (Game 14)
  templates.push({
    bracket_size: 8,
    game_number: 14,
    round_name: 'Grand Final',
    round_number: 5,
    bracket_side: 'finals',
    team1_source: 'winner:13',
    team2_source: 'winner:12',
    winner_advances_to: 15,
    loser_advances_to: 15,
    winner_slot: 'team2',
    loser_slot: 'team1',
    is_championship: false,
    is_grand_final: true,
    is_reset_game: false,
  });

  // Reset (Game 15)
  templates.push({
    bracket_size: 8,
    game_number: 15,
    round_name: 'Championship Reset',
    round_number: 6,
    bracket_side: 'finals',
    team1_source: 'loser:14',
    team2_source: 'winner:14',
    winner_advances_to: null,
    loser_advances_to: null,
    winner_slot: null,
    loser_slot: null,
    is_championship: true,
    is_grand_final: false,
    is_reset_game: true,
  });

  return templates;
}

// =============================================================================
// 16-TEAM DOUBLE ELIMINATION
// =============================================================================

function generate16TeamDE(): BracketTemplate[] {
  const templates: BracketTemplate[] = [];

  // Standard 16-team seeding order: 1v16, 8v9, 4v13, 5v12, 2v15, 7v10, 3v14, 6v11
  const seedPairs = [
    [1, 16],
    [8, 9],
    [4, 13],
    [5, 12],
    [2, 15],
    [7, 10],
    [3, 14],
    [6, 11],
  ];

  // Winners R1 (Games 1-8)
  for (let i = 0; i < 8; i++) {
    templates.push({
      bracket_size: 16,
      game_number: i + 1,
      round_name: 'Winners R1',
      round_number: 1,
      bracket_side: 'winners',
      team1_source: `seed:${seedPairs[i][0]}`,
      team2_source: `seed:${seedPairs[i][1]}`,
      winner_advances_to: 9 + Math.floor(i / 2),
      loser_advances_to: 13 + Math.floor(i / 2),
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: i % 2 === 0 ? 'team1' : 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners R2 (Games 9-12)
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 16,
      game_number: 9 + i,
      round_name: 'Winners R2',
      round_number: 2,
      bracket_side: 'winners',
      team1_source: `winner:${i * 2 + 1}`,
      team2_source: `winner:${i * 2 + 2}`,
      winner_advances_to: 25 + Math.floor(i / 2),
      loser_advances_to: 17 + i,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R1 (Games 13-16): 4 games from 8 losers
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 16,
      game_number: 13 + i,
      round_name: 'Losers R1',
      round_number: 1,
      bracket_side: 'losers',
      team1_source: `loser:${i * 2 + 1}`,
      team2_source: `loser:${i * 2 + 2}`,
      winner_advances_to: 17 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R2 (Games 17-20): winners from L1 vs losers from W R2
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 16,
      game_number: 17 + i,
      round_name: 'Losers R2',
      round_number: 2,
      bracket_side: 'losers',
      team1_source: `winner:${13 + i}`,
      team2_source: `loser:${9 + i}`,
      winner_advances_to: 21 + Math.floor(i / 2),
      loser_advances_to: null,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R3 (Games 21-22)
  for (let i = 0; i < 2; i++) {
    templates.push({
      bracket_size: 16,
      game_number: 21 + i,
      round_name: 'Losers R3',
      round_number: 3,
      bracket_side: 'losers',
      team1_source: `winner:${17 + i * 2}`,
      team2_source: `winner:${18 + i * 2}`,
      winner_advances_to: 23 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R4 (Games 23-24): vs losers from Winners Semi
  for (let i = 0; i < 2; i++) {
    templates.push({
      bracket_size: 16,
      game_number: 23 + i,
      round_name: 'Losers R4',
      round_number: 4,
      bracket_side: 'losers',
      team1_source: `winner:${21 + i}`,
      team2_source: `loser:${25 + i}`,
      winner_advances_to: 27,
      loser_advances_to: null,
      winner_slot: i === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners Semi (Games 25-26)
  templates.push({
    bracket_size: 16,
    game_number: 25,
    round_name: 'Winners Semi',
    round_number: 3,
    bracket_side: 'winners',
    team1_source: 'winner:9',
    team2_source: 'winner:10',
    winner_advances_to: 28,
    loser_advances_to: 23,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });
  templates.push({
    bracket_size: 16,
    game_number: 26,
    round_name: 'Winners Semi',
    round_number: 3,
    bracket_side: 'winners',
    team1_source: 'winner:11',
    team2_source: 'winner:12',
    winner_advances_to: 28,
    loser_advances_to: 24,
    winner_slot: 'team2',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Semi (Game 27)
  templates.push({
    bracket_size: 16,
    game_number: 27,
    round_name: 'Losers Semi',
    round_number: 5,
    bracket_side: 'losers',
    team1_source: 'winner:23',
    team2_source: 'winner:24',
    winner_advances_to: 29,
    loser_advances_to: null,
    winner_slot: 'team1',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Winners Final (Game 28)
  templates.push({
    bracket_size: 16,
    game_number: 28,
    round_name: 'Winners Final',
    round_number: 4,
    bracket_side: 'winners',
    team1_source: 'winner:25',
    team2_source: 'winner:26',
    winner_advances_to: 30,
    loser_advances_to: 29,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Final (Game 29)
  templates.push({
    bracket_size: 16,
    game_number: 29,
    round_name: 'Losers Final',
    round_number: 6,
    bracket_side: 'losers',
    team1_source: 'winner:27',
    team2_source: 'loser:28',
    winner_advances_to: 30,
    loser_advances_to: null,
    winner_slot: 'team2',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Grand Final (Game 30)
  templates.push({
    bracket_size: 16,
    game_number: 30,
    round_name: 'Grand Final',
    round_number: 7,
    bracket_side: 'finals',
    team1_source: 'winner:28',
    team2_source: 'winner:29',
    winner_advances_to: 31,
    loser_advances_to: 31,
    winner_slot: 'team2',
    loser_slot: 'team1',
    is_championship: false,
    is_grand_final: true,
    is_reset_game: false,
  });

  // Reset (Game 31)
  templates.push({
    bracket_size: 16,
    game_number: 31,
    round_name: 'Championship Reset',
    round_number: 8,
    bracket_side: 'finals',
    team1_source: 'loser:30',
    team2_source: 'winner:30',
    winner_advances_to: null,
    loser_advances_to: null,
    winner_slot: null,
    loser_slot: null,
    is_championship: true,
    is_grand_final: false,
    is_reset_game: true,
  });

  return templates;
}

// =============================================================================
// 32-TEAM DOUBLE ELIMINATION
// =============================================================================

function generate32TeamDE(): BracketTemplate[] {
  const templates: BracketTemplate[] = [];

  // 32-team seeding (standard format)
  const seedPairs = [
    [1, 32],
    [16, 17],
    [8, 25],
    [9, 24],
    [4, 29],
    [13, 20],
    [5, 28],
    [12, 21],
    [2, 31],
    [15, 18],
    [7, 26],
    [10, 23],
    [3, 30],
    [14, 19],
    [6, 27],
    [11, 22],
  ];

  // Winners R1 (Games 1-16)
  for (let i = 0; i < 16; i++) {
    templates.push({
      bracket_size: 32,
      game_number: i + 1,
      round_name: 'Winners R1',
      round_number: 1,
      bracket_side: 'winners',
      team1_source: `seed:${seedPairs[i][0]}`,
      team2_source: `seed:${seedPairs[i][1]}`,
      winner_advances_to: 17 + Math.floor(i / 2),
      loser_advances_to: 25 + Math.floor(i / 2),
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: i % 2 === 0 ? 'team1' : 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners R2 (Games 17-24)
  for (let i = 0; i < 8; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 17 + i,
      round_name: 'Winners R2',
      round_number: 2,
      bracket_side: 'winners',
      team1_source: `winner:${i * 2 + 1}`,
      team2_source: `winner:${i * 2 + 2}`,
      winner_advances_to: 49 + Math.floor(i / 2),
      loser_advances_to: 33 + i,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R1 (Games 25-32): 8 games from 16 losers
  for (let i = 0; i < 8; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 25 + i,
      round_name: 'Losers R1',
      round_number: 1,
      bracket_side: 'losers',
      team1_source: `loser:${i * 2 + 1}`,
      team2_source: `loser:${i * 2 + 2}`,
      winner_advances_to: 33 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R2 (Games 33-40)
  for (let i = 0; i < 8; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 33 + i,
      round_name: 'Losers R2',
      round_number: 2,
      bracket_side: 'losers',
      team1_source: `winner:${25 + i}`,
      team2_source: `loser:${17 + i}`,
      winner_advances_to: 41 + Math.floor(i / 2),
      loser_advances_to: null,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R3 (Games 41-44)
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 41 + i,
      round_name: 'Losers R3',
      round_number: 3,
      bracket_side: 'losers',
      team1_source: `winner:${33 + i * 2}`,
      team2_source: `winner:${34 + i * 2}`,
      winner_advances_to: 45 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R4 (Games 45-48): vs losers from Winners R3
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 45 + i,
      round_name: 'Losers R4',
      round_number: 4,
      bracket_side: 'losers',
      team1_source: `winner:${41 + i}`,
      team2_source: `loser:${49 + i}`,
      winner_advances_to: 53 + Math.floor(i / 2),
      loser_advances_to: null,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners R3 (Games 49-52)
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 49 + i,
      round_name: 'Winners R3',
      round_number: 3,
      bracket_side: 'winners',
      team1_source: `winner:${17 + i * 2}`,
      team2_source: `winner:${18 + i * 2}`,
      winner_advances_to: 57 + Math.floor(i / 2),
      loser_advances_to: 45 + i,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R5 (Games 53-54)
  for (let i = 0; i < 2; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 53 + i,
      round_name: 'Losers R5',
      round_number: 5,
      bracket_side: 'losers',
      team1_source: `winner:${45 + i * 2}`,
      team2_source: `winner:${46 + i * 2}`,
      winner_advances_to: 55 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R6 (Games 55-56): vs losers from Winners Semi
  for (let i = 0; i < 2; i++) {
    templates.push({
      bracket_size: 32,
      game_number: 55 + i,
      round_name: 'Losers R6',
      round_number: 6,
      bracket_side: 'losers',
      team1_source: `winner:${53 + i}`,
      team2_source: `loser:${57 + i}`,
      winner_advances_to: 59,
      loser_advances_to: null,
      winner_slot: i === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners Semi (Games 57-58)
  templates.push({
    bracket_size: 32,
    game_number: 57,
    round_name: 'Winners Semi',
    round_number: 4,
    bracket_side: 'winners',
    team1_source: 'winner:49',
    team2_source: 'winner:50',
    winner_advances_to: 60,
    loser_advances_to: 55,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });
  templates.push({
    bracket_size: 32,
    game_number: 58,
    round_name: 'Winners Semi',
    round_number: 4,
    bracket_side: 'winners',
    team1_source: 'winner:51',
    team2_source: 'winner:52',
    winner_advances_to: 60,
    loser_advances_to: 56,
    winner_slot: 'team2',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Semi (Game 59)
  templates.push({
    bracket_size: 32,
    game_number: 59,
    round_name: 'Losers Semi',
    round_number: 7,
    bracket_side: 'losers',
    team1_source: 'winner:55',
    team2_source: 'winner:56',
    winner_advances_to: 61,
    loser_advances_to: null,
    winner_slot: 'team1',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Winners Final (Game 60)
  templates.push({
    bracket_size: 32,
    game_number: 60,
    round_name: 'Winners Final',
    round_number: 5,
    bracket_side: 'winners',
    team1_source: 'winner:57',
    team2_source: 'winner:58',
    winner_advances_to: 62,
    loser_advances_to: 61,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Final (Game 61)
  templates.push({
    bracket_size: 32,
    game_number: 61,
    round_name: 'Losers Final',
    round_number: 8,
    bracket_side: 'losers',
    team1_source: 'winner:59',
    team2_source: 'loser:60',
    winner_advances_to: 62,
    loser_advances_to: null,
    winner_slot: 'team2',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Grand Final (Game 62)
  templates.push({
    bracket_size: 32,
    game_number: 62,
    round_name: 'Grand Final',
    round_number: 9,
    bracket_side: 'finals',
    team1_source: 'winner:60',
    team2_source: 'winner:61',
    winner_advances_to: 63,
    loser_advances_to: 63,
    winner_slot: 'team2',
    loser_slot: 'team1',
    is_championship: false,
    is_grand_final: true,
    is_reset_game: false,
  });

  // Reset (Game 63)
  templates.push({
    bracket_size: 32,
    game_number: 63,
    round_name: 'Championship Reset',
    round_number: 10,
    bracket_side: 'finals',
    team1_source: 'loser:62',
    team2_source: 'winner:62',
    winner_advances_to: null,
    loser_advances_to: null,
    winner_slot: null,
    loser_slot: null,
    is_championship: true,
    is_grand_final: false,
    is_reset_game: true,
  });

  return templates;
}

// =============================================================================
// 64-TEAM DOUBLE ELIMINATION
// =============================================================================

function generate64TeamDE(): BracketTemplate[] {
  const templates: BracketTemplate[] = [];

  // 64-team seeding (standard format) - all 64 seeds
  const seedPairs: [number, number][] = [];
  // Generate standard bracket seeding order
  for (let i = 0; i < 32; i++) {
    // Standard seeding algorithm: high vs low in each region
    const seed1 = getStandardSeed(i, 32);
    const seed2 = 65 - seed1;
    seedPairs.push([seed1, seed2]);
  }

  // Winners R1 (Games 1-32)
  for (let i = 0; i < 32; i++) {
    templates.push({
      bracket_size: 64,
      game_number: i + 1,
      round_name: 'Winners R1',
      round_number: 1,
      bracket_side: 'winners',
      team1_source: `seed:${seedPairs[i][0]}`,
      team2_source: `seed:${seedPairs[i][1]}`,
      winner_advances_to: 33 + Math.floor(i / 2),
      loser_advances_to: 49 + Math.floor(i / 2),
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: i % 2 === 0 ? 'team1' : 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners R2 (Games 33-48)
  for (let i = 0; i < 16; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 33 + i,
      round_name: 'Winners R2',
      round_number: 2,
      bracket_side: 'winners',
      team1_source: `winner:${i * 2 + 1}`,
      team2_source: `winner:${i * 2 + 2}`,
      winner_advances_to: 97 + Math.floor(i / 2),
      loser_advances_to: 65 + i,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R1 (Games 49-64): 16 games from 32 losers
  for (let i = 0; i < 16; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 49 + i,
      round_name: 'Losers R1',
      round_number: 1,
      bracket_side: 'losers',
      team1_source: `loser:${i * 2 + 1}`,
      team2_source: `loser:${i * 2 + 2}`,
      winner_advances_to: 65 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R2 (Games 65-80)
  for (let i = 0; i < 16; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 65 + i,
      round_name: 'Losers R2',
      round_number: 2,
      bracket_side: 'losers',
      team1_source: `winner:${49 + i}`,
      team2_source: `loser:${33 + i}`,
      winner_advances_to: 81 + Math.floor(i / 2),
      loser_advances_to: null,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R3 (Games 81-88)
  for (let i = 0; i < 8; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 81 + i,
      round_name: 'Losers R3',
      round_number: 3,
      bracket_side: 'losers',
      team1_source: `winner:${65 + i * 2}`,
      team2_source: `winner:${66 + i * 2}`,
      winner_advances_to: 89 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R4 (Games 89-96): vs losers from Winners R3
  for (let i = 0; i < 8; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 89 + i,
      round_name: 'Losers R4',
      round_number: 4,
      bracket_side: 'losers',
      team1_source: `winner:${81 + i}`,
      team2_source: `loser:${97 + i}`,
      winner_advances_to: 105 + Math.floor(i / 2),
      loser_advances_to: null,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners R3 (Games 97-104)
  for (let i = 0; i < 8; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 97 + i,
      round_name: 'Winners R3',
      round_number: 3,
      bracket_side: 'winners',
      team1_source: `winner:${33 + i * 2}`,
      team2_source: `winner:${34 + i * 2}`,
      winner_advances_to: 113 + Math.floor(i / 2),
      loser_advances_to: 89 + i,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R5 (Games 105-108)
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 105 + i,
      round_name: 'Losers R5',
      round_number: 5,
      bracket_side: 'losers',
      team1_source: `winner:${89 + i * 2}`,
      team2_source: `winner:${90 + i * 2}`,
      winner_advances_to: 109 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R6 (Games 109-112): vs losers from Winners R4
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 109 + i,
      round_name: 'Losers R6',
      round_number: 6,
      bracket_side: 'losers',
      team1_source: `winner:${105 + i}`,
      team2_source: `loser:${113 + i}`,
      winner_advances_to: 117 + Math.floor(i / 2),
      loser_advances_to: null,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners R4 (Games 113-116)
  for (let i = 0; i < 4; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 113 + i,
      round_name: 'Winners R4',
      round_number: 4,
      bracket_side: 'winners',
      team1_source: `winner:${97 + i * 2}`,
      team2_source: `winner:${98 + i * 2}`,
      winner_advances_to: 121 + Math.floor(i / 2),
      loser_advances_to: 109 + i,
      winner_slot: i % 2 === 0 ? 'team1' : 'team2',
      loser_slot: 'team2',
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R7 (Games 117-118)
  for (let i = 0; i < 2; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 117 + i,
      round_name: 'Losers R7',
      round_number: 7,
      bracket_side: 'losers',
      team1_source: `winner:${109 + i * 2}`,
      team2_source: `winner:${110 + i * 2}`,
      winner_advances_to: 119 + i,
      loser_advances_to: null,
      winner_slot: 'team1',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Losers R8 (Games 119-120): vs losers from Winners Semi
  for (let i = 0; i < 2; i++) {
    templates.push({
      bracket_size: 64,
      game_number: 119 + i,
      round_name: 'Losers R8',
      round_number: 8,
      bracket_side: 'losers',
      team1_source: `winner:${117 + i}`,
      team2_source: `loser:${121 + i}`,
      winner_advances_to: 123,
      loser_advances_to: null,
      winner_slot: i === 0 ? 'team1' : 'team2',
      loser_slot: null,
      is_championship: false,
      is_grand_final: false,
      is_reset_game: false,
    });
  }

  // Winners Semi (Games 121-122)
  templates.push({
    bracket_size: 64,
    game_number: 121,
    round_name: 'Winners Semi',
    round_number: 5,
    bracket_side: 'winners',
    team1_source: 'winner:113',
    team2_source: 'winner:114',
    winner_advances_to: 124,
    loser_advances_to: 119,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });
  templates.push({
    bracket_size: 64,
    game_number: 122,
    round_name: 'Winners Semi',
    round_number: 5,
    bracket_side: 'winners',
    team1_source: 'winner:115',
    team2_source: 'winner:116',
    winner_advances_to: 124,
    loser_advances_to: 120,
    winner_slot: 'team2',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Semi (Game 123)
  templates.push({
    bracket_size: 64,
    game_number: 123,
    round_name: 'Losers Semi',
    round_number: 9,
    bracket_side: 'losers',
    team1_source: 'winner:119',
    team2_source: 'winner:120',
    winner_advances_to: 125,
    loser_advances_to: null,
    winner_slot: 'team1',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Winners Final (Game 124)
  templates.push({
    bracket_size: 64,
    game_number: 124,
    round_name: 'Winners Final',
    round_number: 6,
    bracket_side: 'winners',
    team1_source: 'winner:121',
    team2_source: 'winner:122',
    winner_advances_to: 126,
    loser_advances_to: 125,
    winner_slot: 'team1',
    loser_slot: 'team2',
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Losers Final (Game 125)
  templates.push({
    bracket_size: 64,
    game_number: 125,
    round_name: 'Losers Final',
    round_number: 10,
    bracket_side: 'losers',
    team1_source: 'winner:123',
    team2_source: 'loser:124',
    winner_advances_to: 126,
    loser_advances_to: null,
    winner_slot: 'team2',
    loser_slot: null,
    is_championship: false,
    is_grand_final: false,
    is_reset_game: false,
  });

  // Grand Final (Game 126)
  templates.push({
    bracket_size: 64,
    game_number: 126,
    round_name: 'Grand Final',
    round_number: 11,
    bracket_side: 'finals',
    team1_source: 'winner:124',
    team2_source: 'winner:125',
    winner_advances_to: 127,
    loser_advances_to: 127,
    winner_slot: 'team2',
    loser_slot: 'team1',
    is_championship: false,
    is_grand_final: true,
    is_reset_game: false,
  });

  // Reset (Game 127)
  templates.push({
    bracket_size: 64,
    game_number: 127,
    round_name: 'Championship Reset',
    round_number: 12,
    bracket_side: 'finals',
    team1_source: 'loser:126',
    team2_source: 'winner:126',
    winner_advances_to: null,
    loser_advances_to: null,
    winner_slot: null,
    loser_slot: null,
    is_championship: true,
    is_grand_final: false,
    is_reset_game: true,
  });

  return templates;
}

/**
 * Helper to generate standard bracket seeding order.
 * For a given position (0-based) in a bracket of n games, returns the seed number.
 */
function getStandardSeed(position: number, totalGames: number): number {
  // Standard bracket seeding ensures #1 vs #64, #32 vs #33, etc.
  // This follows the pattern: 1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20, 5, 28, 12, 21...
  const seeds = generateSeedOrder(totalGames * 2);
  return seeds[position * 2] || position + 1;
}

/**
 * Generate the standard seeding order for a bracket of given size.
 * Returns an array where index i contains the seed number for position i.
 */
function generateSeedOrder(bracketSize: number): number[] {
  if (bracketSize === 2) {
    return [1, 2];
  }

  const halfSize = bracketSize / 2;
  const prevOrder = generateSeedOrder(halfSize);
  const result: number[] = [];

  for (const seed of prevOrder) {
    result.push(seed);
    result.push(bracketSize + 1 - seed);
  }

  return result;
}
