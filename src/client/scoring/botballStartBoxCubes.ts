export type BotballStartBoxCubeType =
  | 'small'
  | 'large_red_green'
  | 'large_brown';

export interface BotballStartBoxCubeRow {
  cube_type?: BotballStartBoxCubeType | string | null;
  quantity?: number | string | null;
  on_pallet?: boolean | string | number | null;
}

export interface BotballStartBoxCubeResult {
  subtotal: number;
  rows: Array<{
    subtotal: number;
  }>;
}

const CUBE_VALUES: Record<BotballStartBoxCubeType, number> = {
  small: 5,
  large_red_green: 20,
  large_brown: 40,
};

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

function getCubeValue(cubeType: unknown): number {
  if (typeof cubeType !== 'string') {
    return 0;
  }

  return CUBE_VALUES[cubeType as BotballStartBoxCubeType] ?? 0;
}

export function scoreBotballStartBoxCubes(
  rows: BotballStartBoxCubeRow[],
): BotballStartBoxCubeResult {
  const result: BotballStartBoxCubeResult = {
    subtotal: 0,
    rows: [],
  };

  rows.forEach((row) => {
    const quantity = coerceCount(row.quantity);
    const cubeValue = getCubeValue(row.cube_type);

    if (quantity === 0 || cubeValue === 0) {
      return;
    }

    const multiplier = coerceBoolean(row.on_pallet) ? 2 : 1;
    const subtotal = quantity * cubeValue * multiplier;

    result.subtotal += subtotal;
    result.rows.push({
      subtotal,
    });
  });

  return result;
}
