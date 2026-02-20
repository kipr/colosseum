/**
 * Additional bracket connector tests targeting uncovered sort branches.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWinnerEdges,
  computeConnectorPaths,
  buildGameAnchorPoints,
  type Edge,
  type GameAnchorPoints,
} from '../../src/client/components/bracket/bracketConnectors';

describe('bracketConnectors - additional coverage', () => {
  describe('buildWinnerEdges - sort with same toGameId', () => {
    it('sorts by fromGameId when toGameId is equal', () => {
      const games = [
        {
          id: 3,
          winner_advances_to_id: 5,
          winner_id: null,
          team1_id: 10,
          team2_id: 20,
        },
        {
          id: 1,
          winner_advances_to_id: 5,
          winner_id: null,
          team1_id: 30,
          team2_id: 40,
        },
        { id: 5, winner_advances_to_id: null, winner_id: null, team1_id: null, team2_id: null },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = buildWinnerEdges(games as any);
      expect(edges.length).toBe(2);
      expect(edges[0].fromGameId).toBe(1);
      expect(edges[1].fromGameId).toBe(3);
    });

    it('uses team1 anchor when winner matches team1', () => {
      const games = [
        {
          id: 1,
          winner_advances_to_id: 2,
          winner_id: 10,
          team1_id: 10,
          team2_id: 20,
        },
        { id: 2, winner_advances_to_id: null, winner_id: null, team1_id: null, team2_id: null },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = buildWinnerEdges(games as any);
      expect(edges[0].fromAnchor).toBe('team1');
    });

    it('uses team2 anchor when winner matches team2', () => {
      const games = [
        {
          id: 1,
          winner_advances_to_id: 2,
          winner_id: 20,
          team1_id: 10,
          team2_id: 20,
        },
        { id: 2, winner_advances_to_id: null, winner_id: null, team1_id: null, team2_id: null },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = buildWinnerEdges(games as any);
      expect(edges[0].fromAnchor).toBe('team2');
    });
  });

  describe('computeConnectorPaths - edge cases', () => {
    it('skips edges where source anchor points are missing', () => {
      const edges: Edge[] = [
        { fromGameId: 1, fromAnchor: 'gameMid', toGameId: 2, toAnchor: 'gameMid' },
      ];

      const anchors = new Map<number, GameAnchorPoints>();
      anchors.set(2, {
        gameMid: { xLeft: 100, xRight: 200, y: 50 },
      });
      // Missing anchor for game 1

      const paths = computeConnectorPaths(edges, anchors);
      expect(paths).toHaveLength(0);
    });

    it('skips edges where target anchor points are missing', () => {
      const edges: Edge[] = [
        { fromGameId: 1, fromAnchor: 'gameMid', toGameId: 2, toAnchor: 'gameMid' },
      ];

      const anchors = new Map<number, GameAnchorPoints>();
      anchors.set(1, {
        gameMid: { xLeft: 0, xRight: 50, y: 50 },
      });
      // Missing anchor for game 2

      const paths = computeConnectorPaths(edges, anchors);
      expect(paths).toHaveLength(0);
    });
  });

  describe('buildGameAnchorPoints - only one team rect', () => {
    it('uses team1 as gameMid when team2 is null', () => {
      const result = buildGameAnchorPoints(
        { left: 0, right: 100, top: 10, height: 30 },
        null,
        0,
        0,
      );
      expect(result).not.toBeNull();
      expect(result!.gameMid).toBeDefined();
      expect(result!.team2).toBeUndefined();
      expect(result!.gameMid!.y).toBe(result!.team1!.y);
    });

    it('uses team2 as gameMid when team1 is null', () => {
      const result = buildGameAnchorPoints(
        null,
        { left: 0, right: 100, top: 50, height: 30 },
        0,
        0,
      );
      expect(result).not.toBeNull();
      expect(result!.gameMid).toBeDefined();
      expect(result!.team1).toBeUndefined();
    });

    it('returns null when both rects are null', () => {
      const result = buildGameAnchorPoints(null, null, 0, 0);
      expect(result).toBeNull();
    });
  });
});
