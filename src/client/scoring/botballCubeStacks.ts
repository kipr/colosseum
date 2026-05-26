export type BotballCubeStackSortedColor = 'red' | 'green' | 'yellow' | null;

export interface BotballCubeStackRow {
  has_pallet?: boolean | string | number | null;
  small_red?: number | string | null;
  small_green?: number | string | null;
  small_yellow?: number | string | null;
  large_red?: number | string | null;
  large_green?: number | string | null;
  large_brown?: number | string | null;
}

export interface BotballCubeStackResult {
  sortedEquivalent: number;
  unsortedEquivalent: number;
  subtotal: number;
  rows: Array<{
    sorted: boolean;
    sortedColor: BotballCubeStackSortedColor;
    equivalent: number;
    subtotal: number;
  }>;
}

function coerceCount(value: unknown): number {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  return Math.floor(numericValue);
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }

  return Boolean(value);
}

export function scoreBotballCubeStacks(
  rows: BotballCubeStackRow[],
  values: { sortedValue: number; unsortedValue: number },
): BotballCubeStackResult {
  const sortedValue = coerceCount(values.sortedValue);
  const unsortedValue = coerceCount(values.unsortedValue);
  const result: BotballCubeStackResult = {
    sortedEquivalent: 0,
    unsortedEquivalent: 0,
    subtotal: 0,
    rows: [],
  };

  rows.forEach((row) => {
    const redEquivalent =
      coerceCount(row.small_red) + coerceCount(row.large_red) * 4;
    const greenEquivalent =
      coerceCount(row.small_green) + coerceCount(row.large_green) * 4;
    const yellowEquivalent = coerceCount(row.small_yellow);
    const brownEquivalent = coerceCount(row.large_brown) * 8;
    const physicalObjectCount =
      coerceCount(row.small_red) +
      coerceCount(row.small_green) +
      coerceCount(row.small_yellow) +
      coerceCount(row.large_red) +
      coerceCount(row.large_green) +
      coerceCount(row.large_brown);
    const equivalent =
      redEquivalent + greenEquivalent + yellowEquivalent + brownEquivalent;

    if (equivalent === 0) {
      return;
    }

    const sortableColors: Array<Exclude<BotballCubeStackSortedColor, null>> =
      [];
    if (redEquivalent > 0) sortableColors.push('red');
    if (greenEquivalent > 0) sortableColors.push('green');
    if (yellowEquivalent > 0) sortableColors.push('yellow');

    const sorted =
      coerceBoolean(row.has_pallet) &&
      physicalObjectCount >= 2 &&
      sortableColors.length === 1;
    const sortedColor = sorted ? sortableColors[0] : null;
    const subtotal = equivalent * (sorted ? sortedValue : unsortedValue);

    if (sorted) {
      result.sortedEquivalent += equivalent;
    } else {
      result.unsortedEquivalent += equivalent;
    }

    result.subtotal += subtotal;
    result.rows.push({
      sorted,
      sortedColor,
      equivalent,
      subtotal,
    });
  });

  return result;
}
