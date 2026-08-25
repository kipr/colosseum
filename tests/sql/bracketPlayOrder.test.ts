import { describe, expect, it } from 'vitest';
import {
  generateDEBracketTemplates,
  generatePlayOrder,
  getPlayOrderMap,
  type BracketTemplate,
} from '../../src/server/services/bracketTemplates';

const expectedLines = new Map<number, number[][]>([
  [4, [[1, 2], [3, 4], [5], [6], [7]]],
  [8, [[1, 2, 3, 4], [5, 7, 6, 8], [9, 10], [13, 11], [12], [14], [15]]],
  [
    16,
    [
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 13, 10, 14, 11, 15, 12, 16],
      [17, 19, 18, 20],
      [25, 26, 21, 22],
      [23, 24],
      [28, 27],
      [29],
      [30],
      [31],
    ],
  ],
  [
    32,
    [
      Array.from({ length: 16 }, (_, index) => index + 1),
      [17, 25, 18, 26, 19, 27, 20, 28, 21, 29, 22, 30, 23, 31, 24, 32],
      [33, 37, 34, 38, 35, 39, 36, 40],
      [49, 50, 51, 52, 41, 43, 42, 44],
      [45, 47, 46, 48],
      [57, 58, 53, 54],
      [55, 56],
      [60, 59],
      [61],
      [62],
      [63],
    ],
  ],
  [
    64,
    [
      Array.from({ length: 32 }, (_, index) => index + 1),
      [
        33, 49, 34, 50, 35, 51, 36, 52, 37, 53, 38, 54, 39, 55, 40, 56, 41, 57,
        42, 58, 43, 59, 44, 60, 45, 61, 46, 62, 47, 63, 48, 64,
      ],
      [65, 73, 66, 74, 67, 75, 68, 76, 69, 77, 70, 78, 71, 79, 72, 80],
      [97, 98, 99, 100, 101, 102, 103, 104, 81, 85, 82, 86, 83, 87, 84, 88],
      [89, 93, 90, 94, 91, 95, 92, 96],
      [113, 114, 115, 116, 105, 107, 106, 108],
      [109, 111, 110, 112],
      [121, 122, 117, 118],
      [119, 120],
      [124, 123],
      [125],
      [126],
      [127],
    ],
  ],
]);

function feederNumbers(template: BracketTemplate): number[] {
  return Array.from(
    new Set(
      [template.team1_source, template.team2_source]
        .map((source) => /^(?:winner|loser):(\d+)$/.exec(source))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number.parseInt(match[1], 10)),
    ),
  );
}

function alapLineWidths(templates: BracketTemplate[]): number[] {
  const dependents = new Map(
    templates.map((template) => [template.game_number, [] as number[]]),
  );
  for (const template of templates) {
    for (const feeder of feederNumbers(template)) {
      dependents.get(feeder)?.push(template.game_number);
    }
  }

  const distances = new Map<number, number>();
  const distance = (gameNumber: number): number => {
    const cached = distances.get(gameNumber);
    if (cached !== undefined) return cached;
    const next = dependents.get(gameNumber) ?? [];
    const result = next.length === 0 ? 0 : 1 + Math.max(...next.map(distance));
    distances.set(gameNumber, result);
    return result;
  };
  const lineCount =
    1 +
    Math.max(...templates.map((template) => distance(template.game_number)));
  const widths = Array.from({ length: lineCount }, () => 0);
  for (const template of templates) {
    widths[lineCount - distance(template.game_number) - 1]++;
  }
  return widths;
}

function zeroRestHandoffs(
  templates: BracketTemplate[],
  priority: number[],
  tableCount: number,
): number {
  const templateByNumber = new Map(
    templates.map((template) => [template.game_number, template]),
  );
  const completedRound = new Map<number, number>();
  let round = 1;

  while (completedRound.size < templates.length) {
    const ready = priority.filter((gameNumber) => {
      if (completedRound.has(gameNumber)) return false;
      const template = templateByNumber.get(gameNumber);
      return (
        template !== undefined &&
        feederNumbers(template).every((feeder) => completedRound.has(feeder))
      );
    });
    if (ready.length === 0) throw new Error('Unable to schedule bracket DAG');

    for (const gameNumber of ready.slice(0, tableCount)) {
      completedRound.set(gameNumber, round);
    }
    round++;
  }

  let count = 0;
  for (const template of templates) {
    if (template.is_reset_game) continue;
    const gameRound = completedRound.get(template.game_number);
    for (const feeder of feederNumbers(template)) {
      if (gameRound === (completedRound.get(feeder) ?? 0) + 1) count++;
    }
  }
  return count;
}

describe('canonical bracket play order', () => {
  it.each([4, 8, 16, 32, 64])(
    'matches the documented %i-team order',
    (size) => {
      expect(generatePlayOrder(size)).toEqual(expectedLines.get(size)?.flat());
    },
  );

  it.each([4, 8, 16, 32, 64])(
    'is a complete topological order for %i teams',
    (size) => {
      const templates = generateDEBracketTemplates(size);
      const order = generatePlayOrder(size);
      const positions = new Map(
        order.map((gameNumber, index) => [gameNumber, index]),
      );

      expect(new Set(order).size).toBe(2 * size - 1);
      expect(order).toHaveLength(2 * size - 1);
      for (const template of templates) {
        for (const feeder of feederNumbers(template)) {
          expect(positions.get(feeder)).toBeLessThan(
            positions.get(template.game_number) as number,
          );
        }
      }
    },
  );

  it.each([4, 8, 16, 32, 64])(
    'uses minimum-length ALAP line widths for %i teams',
    (size) => {
      const widths = alapLineWidths(generateDEBracketTemplates(size));
      const expectedWidths: number[] = [];
      for (let width = size / 2; width >= 2; width /= 2) {
        expectedWidths.push(width, width);
      }
      expectedWidths.push(1, 1, 1);

      expect(widths).toEqual(expectedWidths);
      expect(widths).toHaveLength(2 * Math.log2(size) + 1);
    },
  );

  it.each([4, 8, 16, 32, 64])(
    'assigns ranks consistently for %i teams',
    (size) => {
      const order = generatePlayOrder(size);
      const ranks = getPlayOrderMap(size);
      const templates = generateDEBracketTemplates(size);

      expect(
        templates
          .slice()
          .sort((left, right) => left.play_order - right.play_order)
          .map((template) => template.game_number),
      ).toEqual(order);
      for (const [index, gameNumber] of order.entries()) {
        expect(ranks.get(gameNumber)).toBe(index + 1);
      }
    },
  );

  it.each([4, 8, 16, 32, 64])(
    'does not regress zero-rest handoffs for %i teams',
    (size) => {
      const templates = generateDEBracketTemplates(size);
      const canonical = generatePlayOrder(size);
      const gameNumberOrder = templates.map((template) => template.game_number);

      for (const tableCount of [2, 3, 4]) {
        expect(
          zeroRestHandoffs(templates, canonical, tableCount),
        ).toBeLessThanOrEqual(
          zeroRestHandoffs(templates, gameNumberOrder, tableCount),
        );
      }
    },
  );

  it('returns defensive copies of cached orders and maps', () => {
    const order = generatePlayOrder(8);
    const ranks = getPlayOrderMap(8);
    order[0] = 999;
    ranks.set(1, 999);

    expect(generatePlayOrder(8)[0]).toBe(1);
    expect(getPlayOrderMap(8).get(1)).toBe(1);
  });

  it.each([3, 10, 128])('rejects unsupported size %i', (size) => {
    expect(() => generatePlayOrder(size)).toThrow(/Unsupported bracket size/);
    expect(() => getPlayOrderMap(size)).toThrow(/Unsupported bracket size/);
    expect(() => generateDEBracketTemplates(size)).toThrow(
      /Unsupported bracket size/,
    );
  });
});
