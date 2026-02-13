/**
 * Unit tests for bracket connector edge derivation and SVG path generation.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWinnerEdges,
  computeConnectorPaths,
  buildGameAnchorPoints,
  type Edge,
  type GameAnchorPoints,
} from '../../src/client/components/bracket/bracketConnectors';
import type { BracketGame } from '../../src/client/types/brackets';

function makeGame(
  overrides: Partial<BracketGame> & { id: number },
): BracketGame {
  return {
    id: 0,
    bracket_id: 1,
    game_number: 0,
    round_name: null,
    round_number: null,
    bracket_side: 'winners',
    team1_id: null,
    team2_id: null,
    team1_source: null,
    team2_source: null,
    status: 'pending',
    winner_id: null,
    loser_id: null,
    winner_advances_to_id: null,
    loser_advances_to_id: null,
    winner_slot: null,
    loser_slot: null,
    team1_score: null,
    team2_score: null,
    scheduled_time: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

describe('buildWinnerEdges', () => {
  it('returns fromAnchor=team1 when winner_id equals team1_id', () => {
    const games: BracketGame[] = [
      makeGame({
        id: 1,
        team1_id: 10,
        team2_id: 20,
        winner_id: 10,
        winner_advances_to_id: 2,
      }),
      makeGame({ id: 2 }),
    ];
    const edges = buildWinnerEdges(games);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({
      fromGameId: 1,
      fromAnchor: 'team1',
      toGameId: 2,
      toAnchor: 'gameMid',
    });
  });

  it('returns fromAnchor=team2 when winner_id equals team2_id', () => {
    const games: BracketGame[] = [
      makeGame({
        id: 1,
        team1_id: 10,
        team2_id: 20,
        winner_id: 20,
        winner_advances_to_id: 2,
      }),
      makeGame({ id: 2 }),
    ];
    const edges = buildWinnerEdges(games);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.fromAnchor).toBe('team2');
  });

  it('returns fromAnchor=gameMid when no winner set', () => {
    const games: BracketGame[] = [
      makeGame({
        id: 1,
        team1_id: 10,
        team2_id: 20,
        winner_id: null,
        winner_advances_to_id: 2,
      }),
      makeGame({ id: 2 }),
    ];
    const edges = buildWinnerEdges(games);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.fromAnchor).toBe('gameMid');
  });

  it('omits edge when target game not in visible games', () => {
    const games: BracketGame[] = [
      makeGame({
        id: 1,
        winner_id: 10,
        winner_advances_to_id: 999,
      }),
    ];
    const edges = buildWinnerEdges(games);
    expect(edges).toHaveLength(0);
  });

  it('omits edge when winner_advances_to_id is null', () => {
    const games: BracketGame[] = [
      makeGame({ id: 1, winner_id: 10, winner_advances_to_id: null }),
      makeGame({ id: 2 }),
    ];
    const edges = buildWinnerEdges(games);
    expect(edges).toHaveLength(0);
  });
});

describe('computeConnectorPaths', () => {
  function anchors(
    gameId: number,
    team1?: { xLeft: number; xRight: number; y: number },
    team2?: { xLeft: number; xRight: number; y: number },
  ): [number, GameAnchorPoints] {
    const gameMid =
      team1 && team2
        ? {
            xLeft: team1.xLeft,
            xRight: team1.xRight,
            y: (team1.y + team2.y) / 2,
          }
        : (team1 ?? team2 ?? { xLeft: 0, xRight: 0, y: 0 });
    return [
      gameId,
      {
        team1,
        team2,
        gameMid,
      },
    ];
  }

  it('produces single-feeder elbow path', () => {
    const edges: Edge[] = [
      {
        fromGameId: 1,
        fromAnchor: 'team1',
        toGameId: 2,
        toAnchor: 'gameMid',
      },
    ];
    const anchorMap = new Map<number, GameAnchorPoints>([
      anchors(1, { xLeft: 10, xRight: 210, y: 50 }),
      anchors(2, { xLeft: 260, xRight: 460, y: 80 }),
    ]);

    const paths = computeConnectorPaths(edges, anchorMap);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^M 210 50 L \d+ 50 L \d+ 80 L 260 80$/);
  });

  it('produces two-feeder merge with vertical segment', () => {
    const edges: Edge[] = [
      { fromGameId: 1, fromAnchor: 'team1', toGameId: 3, toAnchor: 'gameMid' },
      { fromGameId: 2, fromAnchor: 'team2', toGameId: 3, toAnchor: 'gameMid' },
    ];
    const anchorMap = new Map<number, GameAnchorPoints>([
      anchors(1, { xLeft: 10, xRight: 210, y: 30 }),
      anchors(2, { xLeft: 10, xRight: 210, y: 90 }),
      anchors(3, { xLeft: 260, xRight: 460, y: 60 }),
    ]);

    const paths = computeConnectorPaths(edges, anchorMap);
    expect(paths.length).toBe(4);
    expect(paths.some((p) => p.startsWith('M 210 30'))).toBe(true);
    expect(paths.some((p) => p.startsWith('M 210 90'))).toBe(true);
    expect(
      paths.some(
        (p) => /M \d+ 30 L \d+ 90/.test(p) || /M \d+ 90 L \d+ 30/.test(p),
      ),
    ).toBe(true);
    expect(paths.some((p) => p.includes('L 260 60'))).toBe(true);
  });
});

describe('buildGameAnchorPoints', () => {
  it('computes gameMid from team1 and team2 rects', () => {
    const team1 = { left: 10, right: 210, top: 20, height: 28 };
    const team2 = { left: 10, right: 210, top: 48, height: 28 };
    const pts = buildGameAnchorPoints(team1, team2, 0, 0);
    expect(pts).not.toBeNull();
    expect(pts?.team1?.y).toBe(34);
    expect(pts?.team2?.y).toBe(62);
    expect(pts?.gameMid?.y).toBe(48);
    expect(pts?.gameMid?.xLeft).toBe(10);
    expect(pts?.gameMid?.xRight).toBe(210);
  });

  it('returns null when both rects are null', () => {
    const pts = buildGameAnchorPoints(null, null, 0, 0);
    expect(pts).toBeNull();
  });

  it('uses single rect for gameMid when only one team present', () => {
    const team1 = { left: 10, right: 210, top: 20, height: 28 };
    const pts = buildGameAnchorPoints(team1, null, 0, 0);
    expect(pts?.gameMid?.y).toBe(34);
  });
});
