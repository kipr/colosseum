import type { Database } from '../database/connection';

/**
 * Double-elimination bracket template definition.
 * This defines the structure of games for a bracket of a given size.
 */
export interface BracketTemplate {
  bracket_size: number;
  game_number: number;
  play_order: number;
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

type BracketTemplateDefinition = Omit<BracketTemplate, 'play_order'>;

type Slot = BracketTemplate['winner_slot'];

/**
 * [game_number, team1_source, team2_source,
 *  winner_advances_to, winner_slot, loser_advances_to, loser_slot]
 */
type GameRow = readonly [
  number,
  string,
  string,
  number | null,
  Slot,
  number | null,
  Slot,
];

interface RoundRows {
  name: string;
  number: number;
  side: BracketTemplate['bracket_side'];
  games: readonly GameRow[];
}

interface CachedPlayOrder {
  order: readonly number[];
  ranks: ReadonlyMap<number, number>;
}

const playOrderCache = new Map<number, CachedPlayOrder>();

/**
 * Generate double-elimination bracket templates for a given bracket size.
 * Supports sizes: 4, 8, 16, 32, 64
 */
export function generateDEBracketTemplates(
  bracketSize: number,
): BracketTemplate[] {
  const definitions = generateDEBracketTemplateDefinitions(bracketSize);
  const { ranks } = getCachedPlayOrder(bracketSize, definitions);

  return definitions.map((definition) => {
    const playOrder = ranks.get(definition.game_number);
    if (playOrder === undefined) {
      throw new Error(
        `Missing play order for game ${definition.game_number} in ${bracketSize}-team bracket`,
      );
    }

    return { ...definition, play_order: playOrder };
  });
}

/** Game numbers in canonical play order for a bracket size. */
export function generatePlayOrder(bracketSize: number): number[] {
  return [...getCachedPlayOrder(bracketSize).order];
}

/** game_number -> 1-based play order rank. */
export function getPlayOrderMap(bracketSize: number): Map<number, number> {
  return new Map(getCachedPlayOrder(bracketSize).ranks);
}

function generateDEBracketTemplateDefinitions(
  bracketSize: number,
): BracketTemplateDefinition[] {
  const layout = DE_BRACKET_LAYOUTS.get(bracketSize);
  if (!layout) {
    throw new Error(`Unsupported bracket size: ${bracketSize}`);
  }

  return layout.flatMap((roundRows) =>
    roundRows.games.map(
      ([
        gameNumber,
        team1Source,
        team2Source,
        winnerAdvancesTo,
        winnerSlot,
        loserAdvancesTo,
        loserSlot,
      ]) => ({
        bracket_size: bracketSize,
        game_number: gameNumber,
        round_name: roundRows.name,
        round_number: roundRows.number,
        bracket_side: roundRows.side,
        team1_source: team1Source,
        team2_source: team2Source,
        winner_advances_to: winnerAdvancesTo,
        loser_advances_to: loserAdvancesTo,
        winner_slot: winnerSlot,
        loser_slot: loserSlot,
        is_championship: roundRows.name === 'Championship Reset',
        is_grand_final: roundRows.name === 'Grand Final',
        is_reset_game: roundRows.name === 'Championship Reset',
      }),
    ),
  );
}

function getCachedPlayOrder(
  bracketSize: number,
  definitions?: BracketTemplateDefinition[],
): CachedPlayOrder {
  const cached = playOrderCache.get(bracketSize);
  if (cached) return cached;

  const order = derivePlayOrder(
    definitions ?? generateDEBracketTemplateDefinitions(bracketSize),
  );
  const ranks = new Map(
    order.map((gameNumber, index) => [gameNumber, index + 1]),
  );
  const result = { order, ranks };
  playOrderCache.set(bracketSize, result);
  return result;
}

function derivePlayOrder(definitions: BracketTemplateDefinition[]): number[] {
  const gameNumbers = new Set<number>();
  const dependencies = new Map<number, number[]>();
  const dependents = new Map<number, number[]>();

  for (const definition of definitions) {
    if (gameNumbers.has(definition.game_number)) {
      throw new Error(
        `Duplicate bracket game number: ${definition.game_number}`,
      );
    }
    gameNumbers.add(definition.game_number);
    dependents.set(definition.game_number, []);
  }

  for (const definition of definitions) {
    const feeders = Array.from(
      new Set(
        [definition.team1_source, definition.team2_source]
          .map((source) => /^(?:winner|loser):(\d+)$/.exec(source))
          .filter((match): match is RegExpExecArray => match !== null)
          .map((match) => Number.parseInt(match[1], 10)),
      ),
    );

    for (const feeder of feeders) {
      if (!gameNumbers.has(feeder)) {
        throw new Error(
          `Game ${definition.game_number} references missing feeder game ${feeder}`,
        );
      }
      dependents.get(feeder)?.push(definition.game_number);
    }
    dependencies.set(definition.game_number, feeders);
  }

  const distanceToSink = new Map<number, number>();
  const visiting = new Set<number>();
  const getDistanceToSink = (gameNumber: number): number => {
    const knownDistance = distanceToSink.get(gameNumber);
    if (knownDistance !== undefined) return knownDistance;
    if (visiting.has(gameNumber)) {
      throw new Error(`Cycle detected at bracket game ${gameNumber}`);
    }

    visiting.add(gameNumber);
    const nextGames = dependents.get(gameNumber) ?? [];
    const distance =
      nextGames.length === 0
        ? 0
        : 1 + Math.max(...nextGames.map(getDistanceToSink));
    visiting.delete(gameNumber);
    distanceToSink.set(gameNumber, distance);
    return distance;
  };

  const criticalLineCount =
    1 +
    Math.max(
      ...definitions.map((definition) =>
        getDistanceToSink(definition.game_number),
      ),
    );
  const gamesByLine = new Map<number, number[]>();

  for (const definition of definitions) {
    const line = criticalLineCount - getDistanceToSink(definition.game_number);
    const games = gamesByLine.get(line) ?? [];
    games.push(definition.game_number);
    gamesByLine.set(line, games);
  }

  const order: number[] = [];
  const queuePosition = new Map<number, number>();

  for (let line = 1; line <= criticalLineCount; line++) {
    const games = gamesByLine.get(line) ?? [];
    games.sort((left, right) => {
      const feederPositions = (gameNumber: number): number[] =>
        (dependencies.get(gameNumber) ?? []).map((feeder) => {
          const position = queuePosition.get(feeder);
          if (position === undefined) {
            throw new Error(
              `Feeder game ${feeder} is not ordered before game ${gameNumber}`,
            );
          }
          return position;
        });
      const leftPositions = feederPositions(left);
      const rightPositions = feederPositions(right);
      const leftLast =
        leftPositions.length === 0 ? 0 : Math.max(...leftPositions);
      const rightLast =
        rightPositions.length === 0 ? 0 : Math.max(...rightPositions);
      const leftFirst =
        leftPositions.length === 0 ? 0 : Math.min(...leftPositions);
      const rightFirst =
        rightPositions.length === 0 ? 0 : Math.min(...rightPositions);

      return leftLast - rightLast || leftFirst - rightFirst || left - right;
    });

    for (const gameNumber of games) {
      order.push(gameNumber);
      queuePosition.set(gameNumber, order.length);
    }
  }

  return order;
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
        bracket_size, game_number, play_order, round_name, round_number, bracket_side,
        team1_source, team2_source, winner_advances_to, loser_advances_to,
        winner_slot, loser_slot, is_championship, is_grand_final, is_reset_game
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (bracket_size, game_number) DO UPDATE
      SET play_order = EXCLUDED.play_order
      RETURNING id`,
      [
        t.bracket_size,
        t.game_number,
        t.play_order,
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

/** Fill canonical ranks on bracket games created before play_order existed. */
export async function backfillBracketGamePlayOrders(
  db: Database,
): Promise<void> {
  const games = await db.all<{
    id: number;
    bracket_size: number;
    game_number: number;
  }>(
    `SELECT bg.id, b.bracket_size, bg.game_number
     FROM bracket_games bg
     JOIN brackets b ON b.id = bg.bracket_id
     WHERE bg.play_order IS NULL`,
  );

  const rankMaps = new Map<number, Map<number, number>>();
  const updates: Array<{ id: number; playOrder: number }> = [];
  let skippedCount = 0;

  for (const game of games) {
    if (!DE_BRACKET_LAYOUTS.has(game.bracket_size)) {
      skippedCount++;
      continue;
    }

    let ranks = rankMaps.get(game.bracket_size);
    if (!ranks) {
      ranks = getPlayOrderMap(game.bracket_size);
      rankMaps.set(game.bracket_size, ranks);
    }
    const playOrder = ranks.get(game.game_number);
    if (playOrder === undefined) {
      skippedCount++;
      continue;
    }
    updates.push({ id: game.id, playOrder });
  }

  if (updates.length > 0) {
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx.run(
          `UPDATE bracket_games
           SET play_order = ?
           WHERE id = ? AND play_order IS NULL`,
          [update.playOrder, update.id],
        );
      }
    });
  }

  if (skippedCount > 0) {
    console.warn(
      `Skipped play-order backfill for ${skippedCount} unsupported or custom bracket game(s)`,
    );
  }
}

// =============================================================================
// DOUBLE-ELIMINATION LAYOUTS
// =============================================================================
// One row per game, grouped by round in emission order. Every layout follows
// the same shape, shown here for 4 teams:
//
//   Winners R1: G1, G2
//   Winners Final (G3): winner of G1 vs winner of G2
//   Redemption R1 (G4): loser of G1 vs loser of G2
//   Redemption Final (G5): loser of G3 vs winner of G4
//   Grand Final (G6): winner of G3 vs winner of G5
//   Championship Reset (G7): if loser of G6 came from winners bracket
//
// Winners R1 uses standard seeding (1 vs N, N/2 vs N/2+1, ...). From Winners
// R2 on, a winners round's losers drop into the opposite half of the
// redemption round they join, so a team does not meet an opponent it may have
// just beaten until the redemption bracket has narrowed further.
//
// These rows were frozen from the original generators and are checked against
// tests/server/services/__fixtures__/bracketTemplates.golden.json. Seeded
// template rows are upserted on play_order only, so a structural edit here
// would not reach existing databases.

function round(
  name: string,
  number: number,
  side: RoundRows['side'],
  games: readonly GameRow[],
): RoundRows {
  return { name, number, side, games };
}

const DE_BRACKET_LAYOUTS = new Map<number, readonly RoundRows[]>([
  [
    4,
    [
      round('Winners R1', 1, 'winners', [
        [1, 'seed:1', 'seed:4', 3, 'team1', 4, 'team1'],
        [2, 'seed:2', 'seed:3', 3, 'team2', 4, 'team2'],
      ]),
      round('Winners Final', 2, 'winners', [
        [3, 'winner:1', 'winner:2', 6, 'team1', 5, 'team2'],
      ]),
      round('Redemption R1', 1, 'losers', [
        [4, 'loser:1', 'loser:2', 5, 'team1', null, null],
      ]),
      round('Redemption Final', 2, 'losers', [
        [5, 'winner:4', 'loser:3', 6, 'team2', null, null],
      ]),
      round('Grand Final', 3, 'finals', [
        [6, 'winner:3', 'winner:5', 7, 'team1', 7, 'team2'],
      ]),
      round('Championship Reset', 4, 'finals', [
        [7, 'winner:6', 'loser:6', null, null, null, null],
      ]),
    ],
  ],
  [
    8,
    [
      round('Winners R1', 1, 'winners', [
        [1, 'seed:1', 'seed:8', 5, 'team1', 7, 'team1'],
        [2, 'seed:4', 'seed:5', 5, 'team2', 7, 'team2'],
        [3, 'seed:2', 'seed:7', 6, 'team1', 8, 'team1'],
        [4, 'seed:3', 'seed:6', 6, 'team2', 8, 'team2'],
      ]),
      round('Winners Semi', 2, 'winners', [
        [5, 'winner:1', 'winner:2', 13, 'team1', 10, 'team2'],
        [6, 'winner:3', 'winner:4', 13, 'team2', 9, 'team2'],
      ]),
      round('Redemption R1', 1, 'losers', [
        [7, 'loser:1', 'loser:2', 9, 'team1', null, null],
        [8, 'loser:3', 'loser:4', 10, 'team1', null, null],
      ]),
      round('Redemption R2', 2, 'losers', [
        [9, 'winner:7', 'loser:6', 11, 'team1', null, null],
        [10, 'winner:8', 'loser:5', 11, 'team2', null, null],
      ]),
      round('Redemption Semi', 3, 'losers', [
        [11, 'winner:9', 'winner:10', 12, 'team1', null, null],
      ]),
      round('Redemption Final', 4, 'losers', [
        [12, 'winner:11', 'loser:13', 14, 'team2', null, null],
      ]),
      round('Winners Final', 3, 'winners', [
        [13, 'winner:5', 'winner:6', 14, 'team1', 12, 'team2'],
      ]),
      round('Grand Final', 5, 'finals', [
        [14, 'winner:13', 'winner:12', 15, 'team1', 15, 'team2'],
      ]),
      round('Championship Reset', 6, 'finals', [
        [15, 'winner:14', 'loser:14', null, null, null, null],
      ]),
    ],
  ],
  [
    16,
    [
      round('Winners R1', 1, 'winners', [
        [1, 'seed:1', 'seed:16', 9, 'team1', 13, 'team1'],
        [2, 'seed:8', 'seed:9', 9, 'team2', 13, 'team2'],
        [3, 'seed:4', 'seed:13', 10, 'team1', 14, 'team1'],
        [4, 'seed:5', 'seed:12', 10, 'team2', 14, 'team2'],
        [5, 'seed:2', 'seed:15', 11, 'team1', 15, 'team1'],
        [6, 'seed:7', 'seed:10', 11, 'team2', 15, 'team2'],
        [7, 'seed:3', 'seed:14', 12, 'team1', 16, 'team1'],
        [8, 'seed:6', 'seed:11', 12, 'team2', 16, 'team2'],
      ]),
      round('Winners R2', 2, 'winners', [
        [9, 'winner:1', 'winner:2', 25, 'team1', 19, 'team2'],
        [10, 'winner:3', 'winner:4', 25, 'team2', 20, 'team2'],
        [11, 'winner:5', 'winner:6', 26, 'team1', 17, 'team2'],
        [12, 'winner:7', 'winner:8', 26, 'team2', 18, 'team2'],
      ]),
      round('Redemption R1', 1, 'losers', [
        [13, 'loser:1', 'loser:2', 17, 'team1', null, null],
        [14, 'loser:3', 'loser:4', 18, 'team1', null, null],
        [15, 'loser:5', 'loser:6', 19, 'team1', null, null],
        [16, 'loser:7', 'loser:8', 20, 'team1', null, null],
      ]),
      round('Redemption R2', 2, 'losers', [
        [17, 'winner:13', 'loser:11', 21, 'team1', null, null],
        [18, 'winner:14', 'loser:12', 21, 'team2', null, null],
        [19, 'winner:15', 'loser:9', 22, 'team1', null, null],
        [20, 'winner:16', 'loser:10', 22, 'team2', null, null],
      ]),
      round('Redemption R3', 3, 'losers', [
        [21, 'winner:17', 'winner:18', 23, 'team1', null, null],
        [22, 'winner:19', 'winner:20', 24, 'team1', null, null],
      ]),
      round('Redemption R4', 4, 'losers', [
        [23, 'winner:21', 'loser:25', 27, 'team1', null, null],
        [24, 'winner:22', 'loser:26', 27, 'team2', null, null],
      ]),
      round('Winners Semi', 3, 'winners', [
        [25, 'winner:9', 'winner:10', 28, 'team1', 23, 'team2'],
        [26, 'winner:11', 'winner:12', 28, 'team2', 24, 'team2'],
      ]),
      round('Redemption Semi', 5, 'losers', [
        [27, 'winner:23', 'winner:24', 29, 'team1', null, null],
      ]),
      round('Winners Final', 4, 'winners', [
        [28, 'winner:25', 'winner:26', 30, 'team1', 29, 'team2'],
      ]),
      round('Redemption Final', 6, 'losers', [
        [29, 'winner:27', 'loser:28', 30, 'team2', null, null],
      ]),
      round('Grand Final', 7, 'finals', [
        [30, 'winner:28', 'winner:29', 31, 'team1', 31, 'team2'],
      ]),
      round('Championship Reset', 8, 'finals', [
        [31, 'winner:30', 'loser:30', null, null, null, null],
      ]),
    ],
  ],
  [
    32,
    [
      round('Winners R1', 1, 'winners', [
        [1, 'seed:1', 'seed:32', 17, 'team1', 25, 'team1'],
        [2, 'seed:16', 'seed:17', 17, 'team2', 25, 'team2'],
        [3, 'seed:8', 'seed:25', 18, 'team1', 26, 'team1'],
        [4, 'seed:9', 'seed:24', 18, 'team2', 26, 'team2'],
        [5, 'seed:4', 'seed:29', 19, 'team1', 27, 'team1'],
        [6, 'seed:13', 'seed:20', 19, 'team2', 27, 'team2'],
        [7, 'seed:5', 'seed:28', 20, 'team1', 28, 'team1'],
        [8, 'seed:12', 'seed:21', 20, 'team2', 28, 'team2'],
        [9, 'seed:2', 'seed:31', 21, 'team1', 29, 'team1'],
        [10, 'seed:15', 'seed:18', 21, 'team2', 29, 'team2'],
        [11, 'seed:7', 'seed:26', 22, 'team1', 30, 'team1'],
        [12, 'seed:10', 'seed:23', 22, 'team2', 30, 'team2'],
        [13, 'seed:3', 'seed:30', 23, 'team1', 31, 'team1'],
        [14, 'seed:14', 'seed:19', 23, 'team2', 31, 'team2'],
        [15, 'seed:6', 'seed:27', 24, 'team1', 32, 'team1'],
        [16, 'seed:11', 'seed:22', 24, 'team2', 32, 'team2'],
      ]),
      round('Winners R2', 2, 'winners', [
        [17, 'winner:1', 'winner:2', 49, 'team1', 37, 'team2'],
        [18, 'winner:3', 'winner:4', 49, 'team2', 38, 'team2'],
        [19, 'winner:5', 'winner:6', 50, 'team1', 39, 'team2'],
        [20, 'winner:7', 'winner:8', 50, 'team2', 40, 'team2'],
        [21, 'winner:9', 'winner:10', 51, 'team1', 33, 'team2'],
        [22, 'winner:11', 'winner:12', 51, 'team2', 34, 'team2'],
        [23, 'winner:13', 'winner:14', 52, 'team1', 35, 'team2'],
        [24, 'winner:15', 'winner:16', 52, 'team2', 36, 'team2'],
      ]),
      round('Redemption R1', 1, 'losers', [
        [25, 'loser:1', 'loser:2', 33, 'team1', null, null],
        [26, 'loser:3', 'loser:4', 34, 'team1', null, null],
        [27, 'loser:5', 'loser:6', 35, 'team1', null, null],
        [28, 'loser:7', 'loser:8', 36, 'team1', null, null],
        [29, 'loser:9', 'loser:10', 37, 'team1', null, null],
        [30, 'loser:11', 'loser:12', 38, 'team1', null, null],
        [31, 'loser:13', 'loser:14', 39, 'team1', null, null],
        [32, 'loser:15', 'loser:16', 40, 'team1', null, null],
      ]),
      round('Redemption R2', 2, 'losers', [
        [33, 'winner:25', 'loser:21', 41, 'team1', null, null],
        [34, 'winner:26', 'loser:22', 41, 'team2', null, null],
        [35, 'winner:27', 'loser:23', 42, 'team1', null, null],
        [36, 'winner:28', 'loser:24', 42, 'team2', null, null],
        [37, 'winner:29', 'loser:17', 43, 'team1', null, null],
        [38, 'winner:30', 'loser:18', 43, 'team2', null, null],
        [39, 'winner:31', 'loser:19', 44, 'team1', null, null],
        [40, 'winner:32', 'loser:20', 44, 'team2', null, null],
      ]),
      round('Redemption R3', 3, 'losers', [
        [41, 'winner:33', 'winner:34', 45, 'team1', null, null],
        [42, 'winner:35', 'winner:36', 46, 'team1', null, null],
        [43, 'winner:37', 'winner:38', 47, 'team1', null, null],
        [44, 'winner:39', 'winner:40', 48, 'team1', null, null],
      ]),
      round('Redemption R4', 4, 'losers', [
        [45, 'winner:41', 'loser:49', 53, 'team1', null, null],
        [46, 'winner:42', 'loser:50', 53, 'team2', null, null],
        [47, 'winner:43', 'loser:51', 54, 'team1', null, null],
        [48, 'winner:44', 'loser:52', 54, 'team2', null, null],
      ]),
      round('Winners R3', 3, 'winners', [
        [49, 'winner:17', 'winner:18', 57, 'team1', 45, 'team2'],
        [50, 'winner:19', 'winner:20', 57, 'team2', 46, 'team2'],
        [51, 'winner:21', 'winner:22', 58, 'team1', 47, 'team2'],
        [52, 'winner:23', 'winner:24', 58, 'team2', 48, 'team2'],
      ]),
      round('Redemption R5', 5, 'losers', [
        [53, 'winner:45', 'winner:46', 55, 'team1', null, null],
        [54, 'winner:47', 'winner:48', 56, 'team1', null, null],
      ]),
      round('Redemption R6', 6, 'losers', [
        [55, 'winner:53', 'loser:58', 59, 'team1', null, null],
        [56, 'winner:54', 'loser:57', 59, 'team2', null, null],
      ]),
      round('Winners Semi', 4, 'winners', [
        [57, 'winner:49', 'winner:50', 60, 'team1', 56, 'team2'],
        [58, 'winner:51', 'winner:52', 60, 'team2', 55, 'team2'],
      ]),
      round('Redemption Semi', 7, 'losers', [
        [59, 'winner:55', 'winner:56', 61, 'team1', null, null],
      ]),
      round('Winners Final', 5, 'winners', [
        [60, 'winner:57', 'winner:58', 62, 'team1', 61, 'team2'],
      ]),
      round('Redemption Final', 8, 'losers', [
        [61, 'winner:59', 'loser:60', 62, 'team2', null, null],
      ]),
      round('Grand Final', 9, 'finals', [
        [62, 'winner:60', 'winner:61', 63, 'team1', 63, 'team2'],
      ]),
      round('Championship Reset', 10, 'finals', [
        [63, 'winner:62', 'loser:62', null, null, null, null],
      ]),
    ],
  ],
  [
    64,
    [
      round('Winners R1', 1, 'winners', [
        [1, 'seed:1', 'seed:64', 33, 'team1', 49, 'team1'],
        [2, 'seed:32', 'seed:33', 33, 'team2', 49, 'team2'],
        [3, 'seed:16', 'seed:49', 34, 'team1', 50, 'team1'],
        [4, 'seed:17', 'seed:48', 34, 'team2', 50, 'team2'],
        [5, 'seed:8', 'seed:57', 35, 'team1', 51, 'team1'],
        [6, 'seed:25', 'seed:40', 35, 'team2', 51, 'team2'],
        [7, 'seed:9', 'seed:56', 36, 'team1', 52, 'team1'],
        [8, 'seed:24', 'seed:41', 36, 'team2', 52, 'team2'],
        [9, 'seed:4', 'seed:61', 37, 'team1', 53, 'team1'],
        [10, 'seed:29', 'seed:36', 37, 'team2', 53, 'team2'],
        [11, 'seed:13', 'seed:52', 38, 'team1', 54, 'team1'],
        [12, 'seed:20', 'seed:45', 38, 'team2', 54, 'team2'],
        [13, 'seed:5', 'seed:60', 39, 'team1', 55, 'team1'],
        [14, 'seed:28', 'seed:37', 39, 'team2', 55, 'team2'],
        [15, 'seed:12', 'seed:53', 40, 'team1', 56, 'team1'],
        [16, 'seed:21', 'seed:44', 40, 'team2', 56, 'team2'],
        [17, 'seed:2', 'seed:63', 41, 'team1', 57, 'team1'],
        [18, 'seed:31', 'seed:34', 41, 'team2', 57, 'team2'],
        [19, 'seed:15', 'seed:50', 42, 'team1', 58, 'team1'],
        [20, 'seed:18', 'seed:47', 42, 'team2', 58, 'team2'],
        [21, 'seed:7', 'seed:58', 43, 'team1', 59, 'team1'],
        [22, 'seed:26', 'seed:39', 43, 'team2', 59, 'team2'],
        [23, 'seed:10', 'seed:55', 44, 'team1', 60, 'team1'],
        [24, 'seed:23', 'seed:42', 44, 'team2', 60, 'team2'],
        [25, 'seed:3', 'seed:62', 45, 'team1', 61, 'team1'],
        [26, 'seed:30', 'seed:35', 45, 'team2', 61, 'team2'],
        [27, 'seed:14', 'seed:51', 46, 'team1', 62, 'team1'],
        [28, 'seed:19', 'seed:46', 46, 'team2', 62, 'team2'],
        [29, 'seed:6', 'seed:59', 47, 'team1', 63, 'team1'],
        [30, 'seed:27', 'seed:38', 47, 'team2', 63, 'team2'],
        [31, 'seed:11', 'seed:54', 48, 'team1', 64, 'team1'],
        [32, 'seed:22', 'seed:43', 48, 'team2', 64, 'team2'],
      ]),
      round('Winners R2', 2, 'winners', [
        [33, 'winner:1', 'winner:2', 97, 'team1', 73, 'team2'],
        [34, 'winner:3', 'winner:4', 97, 'team2', 74, 'team2'],
        [35, 'winner:5', 'winner:6', 98, 'team1', 75, 'team2'],
        [36, 'winner:7', 'winner:8', 98, 'team2', 76, 'team2'],
        [37, 'winner:9', 'winner:10', 99, 'team1', 77, 'team2'],
        [38, 'winner:11', 'winner:12', 99, 'team2', 78, 'team2'],
        [39, 'winner:13', 'winner:14', 100, 'team1', 79, 'team2'],
        [40, 'winner:15', 'winner:16', 100, 'team2', 80, 'team2'],
        [41, 'winner:17', 'winner:18', 101, 'team1', 65, 'team2'],
        [42, 'winner:19', 'winner:20', 101, 'team2', 66, 'team2'],
        [43, 'winner:21', 'winner:22', 102, 'team1', 67, 'team2'],
        [44, 'winner:23', 'winner:24', 102, 'team2', 68, 'team2'],
        [45, 'winner:25', 'winner:26', 103, 'team1', 69, 'team2'],
        [46, 'winner:27', 'winner:28', 103, 'team2', 70, 'team2'],
        [47, 'winner:29', 'winner:30', 104, 'team1', 71, 'team2'],
        [48, 'winner:31', 'winner:32', 104, 'team2', 72, 'team2'],
      ]),
      round('Redemption R1', 1, 'losers', [
        [49, 'loser:1', 'loser:2', 65, 'team1', null, null],
        [50, 'loser:3', 'loser:4', 66, 'team1', null, null],
        [51, 'loser:5', 'loser:6', 67, 'team1', null, null],
        [52, 'loser:7', 'loser:8', 68, 'team1', null, null],
        [53, 'loser:9', 'loser:10', 69, 'team1', null, null],
        [54, 'loser:11', 'loser:12', 70, 'team1', null, null],
        [55, 'loser:13', 'loser:14', 71, 'team1', null, null],
        [56, 'loser:15', 'loser:16', 72, 'team1', null, null],
        [57, 'loser:17', 'loser:18', 73, 'team1', null, null],
        [58, 'loser:19', 'loser:20', 74, 'team1', null, null],
        [59, 'loser:21', 'loser:22', 75, 'team1', null, null],
        [60, 'loser:23', 'loser:24', 76, 'team1', null, null],
        [61, 'loser:25', 'loser:26', 77, 'team1', null, null],
        [62, 'loser:27', 'loser:28', 78, 'team1', null, null],
        [63, 'loser:29', 'loser:30', 79, 'team1', null, null],
        [64, 'loser:31', 'loser:32', 80, 'team1', null, null],
      ]),
      round('Redemption R2', 2, 'losers', [
        [65, 'winner:49', 'loser:41', 81, 'team1', null, null],
        [66, 'winner:50', 'loser:42', 81, 'team2', null, null],
        [67, 'winner:51', 'loser:43', 82, 'team1', null, null],
        [68, 'winner:52', 'loser:44', 82, 'team2', null, null],
        [69, 'winner:53', 'loser:45', 83, 'team1', null, null],
        [70, 'winner:54', 'loser:46', 83, 'team2', null, null],
        [71, 'winner:55', 'loser:47', 84, 'team1', null, null],
        [72, 'winner:56', 'loser:48', 84, 'team2', null, null],
        [73, 'winner:57', 'loser:33', 85, 'team1', null, null],
        [74, 'winner:58', 'loser:34', 85, 'team2', null, null],
        [75, 'winner:59', 'loser:35', 86, 'team1', null, null],
        [76, 'winner:60', 'loser:36', 86, 'team2', null, null],
        [77, 'winner:61', 'loser:37', 87, 'team1', null, null],
        [78, 'winner:62', 'loser:38', 87, 'team2', null, null],
        [79, 'winner:63', 'loser:39', 88, 'team1', null, null],
        [80, 'winner:64', 'loser:40', 88, 'team2', null, null],
      ]),
      round('Redemption R3', 3, 'losers', [
        [81, 'winner:65', 'winner:66', 89, 'team1', null, null],
        [82, 'winner:67', 'winner:68', 90, 'team1', null, null],
        [83, 'winner:69', 'winner:70', 91, 'team1', null, null],
        [84, 'winner:71', 'winner:72', 92, 'team1', null, null],
        [85, 'winner:73', 'winner:74', 93, 'team1', null, null],
        [86, 'winner:75', 'winner:76', 94, 'team1', null, null],
        [87, 'winner:77', 'winner:78', 95, 'team1', null, null],
        [88, 'winner:79', 'winner:80', 96, 'team1', null, null],
      ]),
      round('Redemption R4', 4, 'losers', [
        [89, 'winner:81', 'loser:97', 105, 'team1', null, null],
        [90, 'winner:82', 'loser:98', 105, 'team2', null, null],
        [91, 'winner:83', 'loser:99', 106, 'team1', null, null],
        [92, 'winner:84', 'loser:100', 106, 'team2', null, null],
        [93, 'winner:85', 'loser:101', 107, 'team1', null, null],
        [94, 'winner:86', 'loser:102', 107, 'team2', null, null],
        [95, 'winner:87', 'loser:103', 108, 'team1', null, null],
        [96, 'winner:88', 'loser:104', 108, 'team2', null, null],
      ]),
      round('Winners R3', 3, 'winners', [
        [97, 'winner:33', 'winner:34', 113, 'team1', 89, 'team2'],
        [98, 'winner:35', 'winner:36', 113, 'team2', 90, 'team2'],
        [99, 'winner:37', 'winner:38', 114, 'team1', 91, 'team2'],
        [100, 'winner:39', 'winner:40', 114, 'team2', 92, 'team2'],
        [101, 'winner:41', 'winner:42', 115, 'team1', 93, 'team2'],
        [102, 'winner:43', 'winner:44', 115, 'team2', 94, 'team2'],
        [103, 'winner:45', 'winner:46', 116, 'team1', 95, 'team2'],
        [104, 'winner:47', 'winner:48', 116, 'team2', 96, 'team2'],
      ]),
      round('Redemption R5', 5, 'losers', [
        [105, 'winner:89', 'winner:90', 109, 'team1', null, null],
        [106, 'winner:91', 'winner:92', 110, 'team1', null, null],
        [107, 'winner:93', 'winner:94', 111, 'team1', null, null],
        [108, 'winner:95', 'winner:96', 112, 'team1', null, null],
      ]),
      round('Redemption R6', 6, 'losers', [
        [109, 'winner:105', 'loser:115', 117, 'team1', null, null],
        [110, 'winner:106', 'loser:116', 117, 'team2', null, null],
        [111, 'winner:107', 'loser:113', 118, 'team1', null, null],
        [112, 'winner:108', 'loser:114', 118, 'team2', null, null],
      ]),
      round('Winners R4', 4, 'winners', [
        [113, 'winner:97', 'winner:98', 121, 'team1', 111, 'team2'],
        [114, 'winner:99', 'winner:100', 121, 'team2', 112, 'team2'],
        [115, 'winner:101', 'winner:102', 122, 'team1', 109, 'team2'],
        [116, 'winner:103', 'winner:104', 122, 'team2', 110, 'team2'],
      ]),
      round('Redemption R7', 7, 'losers', [
        [117, 'winner:109', 'winner:110', 119, 'team1', null, null],
        [118, 'winner:111', 'winner:112', 120, 'team1', null, null],
      ]),
      round('Redemption R8', 8, 'losers', [
        [119, 'winner:117', 'loser:121', 123, 'team1', null, null],
        [120, 'winner:118', 'loser:122', 123, 'team2', null, null],
      ]),
      round('Winners Semi', 5, 'winners', [
        [121, 'winner:113', 'winner:114', 124, 'team1', 119, 'team2'],
        [122, 'winner:115', 'winner:116', 124, 'team2', 120, 'team2'],
      ]),
      round('Redemption Semi', 9, 'losers', [
        [123, 'winner:119', 'winner:120', 125, 'team1', null, null],
      ]),
      round('Winners Final', 6, 'winners', [
        [124, 'winner:121', 'winner:122', 126, 'team1', 125, 'team2'],
      ]),
      round('Redemption Final', 10, 'losers', [
        [125, 'winner:123', 'loser:124', 126, 'team2', null, null],
      ]),
      round('Grand Final', 11, 'finals', [
        [126, 'winner:124', 'winner:125', 127, 'team1', 127, 'team2'],
      ]),
      round('Championship Reset', 12, 'finals', [
        [127, 'winner:126', 'loser:126', null, null, null, null],
      ]),
    ],
  ],
]);
