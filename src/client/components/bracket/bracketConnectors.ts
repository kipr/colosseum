import type { BracketGame } from '../../types/brackets';

export type AnchorKind = 'team1' | 'team2' | 'gameMid';

export interface Edge {
  fromGameId: number;
  fromAnchor: AnchorKind;
  toGameId: number;
  toAnchor: AnchorKind;
}

export interface AnchorPoint {
  xLeft: number;
  xRight: number;
  y: number;
}

export interface GameAnchorPoints {
  team1?: AnchorPoint;
  team2?: AnchorPoint;
  gameMid?: AnchorPoint;
}

/**
 * Build winner-advancement edges from visible games.
 * Only includes edges where both source and target are in visibleGames.
 */
export function buildWinnerEdges(visibleGames: BracketGame[]): Edge[] {
  const visibleIds = new Set(visibleGames.map((g) => g.id));
  const edges: Edge[] = [];

  for (const game of visibleGames) {
    const targetId = game.winner_advances_to_id;
    if (!targetId || !visibleIds.has(targetId)) continue;

    let fromAnchor: AnchorKind = 'gameMid';
    if (game.winner_id === game.team1_id) {
      fromAnchor = 'team1';
    } else if (game.winner_id === game.team2_id) {
      fromAnchor = 'team2';
    }

    edges.push({
      fromGameId: game.id,
      fromAnchor,
      toGameId: targetId,
      toAnchor: 'gameMid',
    });
  }

  return edges.sort((a, b) => {
    if (a.toGameId !== b.toGameId) return a.toGameId - b.toGameId;
    return a.fromGameId - b.fromGameId;
  });
}

/**
 * Compute orthogonal SVG path d strings for edges.
 * Groups by toGameId; for two feeders draws merge geometry, for one draws elbow.
 */
export function computeConnectorPaths(
  edges: Edge[],
  anchorPointsByGameId: Map<number, GameAnchorPoints>,
): string[] {
  const paths: string[] = [];
  const groups = groupEdgesByTarget(edges);

  for (const [toGameId, groupEdges] of groups) {
    const targetAnchors = anchorPointsByGameId.get(toGameId);
    if (!targetAnchors?.gameMid) continue;

    const target = targetAnchors.gameMid;

    if (groupEdges.length === 1) {
      const e = groupEdges[0]!;
      const src = getSourcePoint(e, anchorPointsByGameId);
      if (!src) continue;
      const mergeX = (src.xRight + target.xLeft) / 2;
      const d = `M ${src.xRight} ${src.y} L ${mergeX} ${src.y} L ${mergeX} ${target.y} L ${target.xLeft} ${target.y}`;
      paths.push(d);
    } else if (groupEdges.length >= 2) {
      const [e1, e2] = groupEdges;
      const s1 = e1 ? getSourcePoint(e1, anchorPointsByGameId) : null;
      const s2 = e2 ? getSourcePoint(e2, anchorPointsByGameId) : null;
      if (!s1 || !s2) continue;

      const maxSourceX = Math.max(s1.xRight, s2.xRight);
      const mergeX = (maxSourceX + target.xLeft) / 2;
      const y1 = s1.y;
      const y2 = s2.y;

      paths.push(
        `M ${s1.xRight} ${y1} L ${mergeX} ${y1}`,
        `M ${s2.xRight} ${y2} L ${mergeX} ${y2}`,
        `M ${mergeX} ${Math.min(y1, y2)} L ${mergeX} ${Math.max(y1, y2)}`,
        `M ${mergeX} ${target.y} L ${target.xLeft} ${target.y}`,
      );
    }
  }

  return paths;
}

function groupEdgesByTarget(edges: Edge[]): Map<number, Edge[]> {
  const map = new Map<number, Edge[]>();
  for (const e of edges) {
    const list = map.get(e.toGameId) ?? [];
    list.push(e);
    map.set(e.toGameId, list);
  }
  return map;
}

function getSourcePoint(
  edge: Edge,
  anchorPointsByGameId: Map<number, GameAnchorPoints>,
): AnchorPoint | null {
  const anchors = anchorPointsByGameId.get(edge.fromGameId);
  if (!anchors) return null;

  if (edge.fromAnchor === 'team1' && anchors.team1) return anchors.team1;
  if (edge.fromAnchor === 'team2' && anchors.team2) return anchors.team2;
  if (edge.fromAnchor === 'gameMid' && anchors.gameMid) return anchors.gameMid;
  return anchors.gameMid ?? anchors.team1 ?? anchors.team2 ?? null;
}

/** Rect-like shape for measurement (avoids DOM types in pure module). */
export interface RectLike {
  left: number;
  right: number;
  top: number;
  height: number;
}

/** Convert a measured rect to an anchor point (row midline) relative to content. */
export function rectToAnchorPoint(
  rect: RectLike,
  contentLeft: number,
  contentTop: number,
): AnchorPoint {
  return {
    xLeft: rect.left - contentLeft,
    xRight: rect.right - contentLeft,
    y: rect.top - contentTop + rect.height / 2,
  };
}

/** Build GameAnchorPoints from measured team row rects. */
export function buildGameAnchorPoints(
  team1Rect: RectLike | null,
  team2Rect: RectLike | null,
  contentLeft: number,
  contentTop: number,
): GameAnchorPoints | null {
  const team1 = team1Rect
    ? rectToAnchorPoint(team1Rect, contentLeft, contentTop)
    : undefined;
  const team2 = team2Rect
    ? rectToAnchorPoint(team2Rect, contentLeft, contentTop)
    : undefined;

  let gameMid: AnchorPoint | undefined;
  if (team1 && team2) {
    gameMid = {
      xLeft: team1.xLeft,
      xRight: team1.xRight,
      y: (team1.y + team2.y) / 2,
    };
  } else {
    gameMid = team1 ?? team2;
  }

  if (!gameMid) return null;
  return { team1, team2, gameMid };
}
