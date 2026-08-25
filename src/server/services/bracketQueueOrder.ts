/** Fields that determine a bracket game's event-wide queue order. */
export interface BracketQueueOrder {
  bracket_id: number;
  bracket_size: number;
  game_number: number;
  play_order: number | null;
}

export interface BracketQueueSequenceItem {
  bracketOrder: BracketQueueOrder | null;
}

/**
 * SQL ordering used when selecting bracket games for the queue.
 *
 * The aliases intentionally match the bracket_games/brackets aliases used by
 * both queue population and repair sync queries.
 */
export const BRACKET_INTERLEAVE_ORDER_SQL = `
  (COALESCE(bg.play_order, bg.game_number) - 1.0) /
    (2 * b.bracket_size - 2) ASC,
  b.id ASC,
  bg.game_number ASC
`;

/** Compare two games by normalized progress through their brackets. */
export function compareBracketQueueOrder(
  left: BracketQueueOrder,
  right: BracketQueueOrder,
): number {
  const leftOrder = left.play_order ?? left.game_number;
  const rightOrder = right.play_order ?? right.game_number;
  const leftDenominator = 2 * left.bracket_size - 2;
  const rightDenominator = 2 * right.bracket_size - 2;

  // Cross multiplication avoids floating-point differences between the
  // JavaScript merger and the SQLite/PostgreSQL ORDER BY expression.
  const progressComparison =
    (leftOrder - 1) * rightDenominator - (rightOrder - 1) * leftDenominator;

  return (
    progressComparison ||
    left.bracket_id - right.bracket_id ||
    left.game_number - right.game_number
  );
}

/**
 * Insert new bracket items into a mixed queue without re-sorting existing
 * rows. Non-bracket rows retain their relative order. When no later canonical
 * bracket row exists, the item is appended to the event queue.
 */
export function mergeBracketQueueItems<T extends BracketQueueSequenceItem>(
  current: readonly T[],
  additions: readonly T[],
): T[] {
  const merged = [...current];
  const orderedAdditions = [...additions].sort((left, right) =>
    compareBracketQueueOrder(left.bracketOrder!, right.bracketOrder!),
  );

  for (const addition of orderedAdditions) {
    const insertionIndex = merged.findIndex(
      (row) =>
        row.bracketOrder !== null &&
        compareBracketQueueOrder(addition.bracketOrder!, row.bracketOrder) < 0,
    );

    if (insertionIndex === -1) {
      merged.push(addition);
    } else {
      merged.splice(insertionIndex, 0, addition);
    }
  }

  return merged;
}
