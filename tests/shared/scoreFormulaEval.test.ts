import { describe, it, expect } from 'vitest';
import {
  parseFormula,
  evaluateFormula,
  compileFormulaProgram,
  evaluateFormulaProgram,
  type FormulaValue,
} from '../../src/shared/scoreFormulaEval';

function evaluate(source: string, bindings: Record<string, FormulaValue> = {}) {
  const parsed = parseFormula(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  return evaluateFormula(parsed.expr, bindings);
}

describe('formula parser', () => {
  it('preserves the discriminated AST and gives multiplication higher precedence', () => {
    expect(parseFormula('a+2*3')).toEqual({
      ok: true,
      expr: {
        type: 'binary',
        op: '+',
        left: { type: 'variable', name: 'a' },
        right: {
          type: 'binary',
          op: '*',
          left: { type: 'number', value: 2 },
          right: { type: 'number', value: 3 },
        },
      },
    });
    expect(
      evaluate(
        '((side_a_starting_cubes * 2) + 1) + (side_a_starting_baskets * 15) * (side_a_starting_botguy * 2 + 1)',
        {
          side_a_starting_cubes: 2,
          side_a_starting_baskets: 3,
          side_a_starting_botguy: 1,
        },
      ),
    ).toEqual({ ok: true, value: 140 });
  });
  it.each(['a+2*3', ' a + 2 * 3 ', '\na\t+2 *\n3'])(
    'allows optional whitespace: %s',
    (source) => {
      expect(evaluate(source, { a: 1 })).toEqual({ ok: true, value: 7 });
    },
  );
  it('handles decimals, text containing operators, and escapes', () => {
    expect(evaluate("'a+*?:()===||'==='a+*?:()===||'?1.25:0")).toEqual({
      ok: true,
      value: 1.25,
    });
    expect(evaluate("'it\\'s \\\\ fine'")).toEqual({
      ok: true,
      value: "it's \\ fine",
    });
    expect(evaluate("'?'==='?'?2:3")).toEqual({ ok: true, value: 2 });
    expect(evaluate('Upper_1+1', { Upper_1: 2 })).toEqual({
      ok: true,
      value: 3,
    });
  });
  it('associates arithmetic left and conditionals right', () => {
    const parsed = parseFormula('1+2+3');
    expect(parsed).toMatchObject({
      ok: true,
      expr: { type: 'binary', left: { type: 'binary', op: '+' } },
    });
    expect(evaluate('0?1:0?2:3')).toEqual({ ok: true, value: 3 });
    expect(evaluate('1?0?2:3:4')).toEqual({ ok: true, value: 3 });
    expect(evaluate('1+2*3>6||0?8:9')).toEqual({ ok: true, value: 8 });
    expect(evaluate('(1<2)===1')).toEqual({ ok: true, value: false });
  });
  it.each([
    '',
    ' ',
    '1+',
    '+1',
    '-1',
    '.5',
    '1.',
    '1.2.3',
    '1e3',
    '1a',
    'a==1',
    'a>=1',
    'a&&b',
    'a|b',
    'a**2',
    '(1',
    '1)',
    "'unclosed",
    "'bad\\n'",
    'a?1',
    'a?:2',
    'a?1:',
    '1 2',
    'a.b',
    'a[0]',
    'Math.random()',
    '()=>1',
    '`x`',
    '"x"',
    '1;2',
    '1<2<3',
    '1===2>3',
  ])('rejects malformed or unsupported syntax: %s', (source) => {
    expect(parseFormula(source)).toMatchObject({
      ok: false,
      code: expect.any(String),
      error: expect.any(String),
      offset: expect.any(Number),
    });
  });
  it('enforces exact length, nesting, AST depth, and finite literal bounds', () => {
    expect(parseFormula('1' + ' '.repeat(1023)).ok).toBe(true);
    expect(parseFormula('1' + ' '.repeat(1024))).toMatchObject({
      code: 'LENGTH_EXCEEDED',
      offset: 1024,
    });
    expect(parseFormula('('.repeat(63) + '1' + ')'.repeat(63)).ok).toBe(true);
    expect(parseFormula('('.repeat(64) + '1' + ')'.repeat(64))).toMatchObject({
      code: 'DEPTH_EXCEEDED',
    });
    expect(parseFormula(Array(64).fill('1').join('+')).ok).toBe(true);
    expect(parseFormula(Array(65).fill('1').join('+'))).toMatchObject({
      code: 'DEPTH_EXCEEDED',
    });
    expect(parseFormula('9'.repeat(309))).toMatchObject({
      code: 'NONFINITE_NUMBER',
    });
  });
  it('reports useful offsets', () => {
    expect(parseFormula('a + @')).toMatchObject({
      ok: false,
      offset: 4,
      code: 'INVALID_TOKEN',
    });
    expect(parseFormula('a +')).toMatchObject({
      ok: false,
      offset: 3,
      code: 'EXPECTED_EXPRESSION',
    });
  });
  it('handles deterministic malformed-input fuzz without hanging or throwing', () => {
    let seed = 42;
    const alphabet = "ab019+*<>=|?:()'\\. @";
    for (let i = 0; i < 500; i++) {
      let source = '';
      for (let j = 0; j < i % 91; j++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        source += alphabet[seed % alphabet.length];
      }
      const result = parseFormula(source + '@');
      expect(result.ok).toBe(false);
    }
  });
});

describe('formula values', () => {
  it.each([
    ["'2'+3", 5],
    ["'  '+2", 2],
    ["'0'?1:2", 2],
    ["''?1:2", 2],
    ["'text'?1:2", 1],
    ["'1'===1", false],
    ["'1'==='1'", true],
    ["'3'>2", true],
    ['flag+1', 2],
    ['1||missing', 1],
    ['0?missing:4', 4],
    ["'0'||'selected'", 'selected'],
    ['1?5:missing', 5],
  ])('evaluates %s', (source, value) =>
    expect(evaluate(String(source), { flag: true })).toEqual({
      ok: true,
      value,
    }),
  );
  it('does not substitute identifiers within string literals', () => {
    expect(
      evaluate("color==='red'?10:0", { color: 'red', red: 'blue' }),
    ).toEqual({ ok: true, value: 10 });
    expect(evaluate("text==='x\\'y'?1:0", { text: "x'y" })).toEqual({
      ok: true,
      value: 1,
    });
  });
  it.each(["'bad'+1", "'bad'*2", "'bad'<2", 'huge*huge', 'nan+1', 'missing'])(
    'returns errors instead of zero: %s',
    (source) => {
      expect(evaluate(source, { huge: 1e308, nan: NaN }).ok).toBe(false);
    },
  );
});

describe('compiled dependencies', () => {
  it('orders shuffled diamonds and ignores stale calculated bindings', () => {
    const compiled = compileFormulaProgram(
      [
        { id: 'total', formula: 'left+right' },
        { id: 'right', formula: 'base*3' },
        { id: 'left', formula: 'base+2' },
        { id: 'base', formula: 'input*2' },
      ],
      ['input'],
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(
      evaluateFormulaProgram(compiled.program, {
        input: 4,
        base: 999,
        total: 999,
      }),
    ).toEqual({
      ok: true,
      values: { base: 8, left: 10, right: 24, total: 34 },
      errors: [],
    });
    expect(evaluateFormulaProgram(compiled.program, {}).values.total).toBe(2);
  });
  it.each([
    [[{ id: 'a', formula: 'a+1' }], 'DEPENDENCY_CYCLE'],
    [
      [
        { id: 'a', formula: '1?2:b' },
        { id: 'b', formula: 'a' },
      ],
      'DEPENDENCY_CYCLE',
    ],
    [
      [
        { id: 'a', formula: '1||b' },
        { id: 'b', formula: 'a' },
      ],
      'DEPENDENCY_CYCLE',
    ],
    [[{ id: 'a', formula: 'unknown' }], 'UNKNOWN_REFERENCE'],
    [
      [
        { id: 'a', formula: '1' },
        { id: 'a', formula: '2' },
      ],
      'DUPLICATE_ID',
    ],
    [[{ id: 'a' }], 'MISSING_FORMULA'],
  ] as const)('rejects invalid graphs (%s)', (definitions, code) => {
    expect(compileFormulaProgram(definitions, [])).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });
  it('reports an actionable cycle path', () => {
    expect(
      compileFormulaProgram(
        [
          { id: 'a', formula: 'b' },
          { id: 'b', formula: 'c' },
          { id: 'c', formula: 'a' },
        ],
        [],
      ),
    ).toMatchObject({ errors: [{ path: ['a', 'b', 'c', 'a'] }] });
  });
  it('invalidates dependents even when a branch would skip them, preserving unrelated totals', () => {
    const compiled = compileFormulaProgram(
      [
        { id: 'bad', formula: 'text+1' },
        { id: 'dependent', formula: '1?2:bad' },
        { id: 'valid', formula: '2*3' },
      ],
      ['text'],
    );
    if (!compiled.ok) throw new Error('compile');
    const result = evaluateFormulaProgram(compiled.program, { text: 'oops' });
    expect(result.values).toEqual({ valid: 6 });
    expect(result.errors.map((error) => error.code)).toEqual([
      'INVALID_NUMBER',
      'FAILED_DEPENDENCY',
    ]);
    expect(
      evaluateFormulaProgram(compiled.program, { text: '4' }).values,
    ).toEqual({ bad: 5, dependent: 2, valid: 6 });
  });
  it('requires finite numeric calculated outputs', () => {
    const compiled = compileFormulaProgram(
      [{ id: 'total', formula: "'text'" }],
      [],
    );
    if (!compiled.ok) throw new Error('compile');
    expect(evaluateFormulaProgram(compiled.program, {})).toMatchObject({
      ok: false,
      values: {},
      errors: [{ field: 'total', code: 'INVALID_NUMBER' }],
    });
  });
  it('requires derived values, supports display-only outputs and formula precedence', () => {
    const compiled = compileFormulaProgram(
      [
        { id: 'derived' },
        { id: 'override', formula: '2' },
        { id: 'total', formula: 'derived+override' },
      ],
      [
        { id: 'derived', kind: 'derived' },
        { id: 'override', kind: 'derived' },
      ],
    );
    if (!compiled.ok) throw new Error('compile');
    expect(
      evaluateFormulaProgram(compiled.program, { derived: 4, override: 999 })
        .values,
    ).toEqual({ derived: 4, override: 2, total: 6 });
    expect(evaluateFormulaProgram(compiled.program, {}).ok).toBe(false);
    expect(compileFormulaProgram([{ id: 'a', formula: '1' }], ['a']).ok).toBe(
      false,
    );
    expect(
      compileFormulaProgram(
        [],
        [
          { id: 'a', kind: 'derived' },
          { id: 'a', kind: 'derived' },
        ],
      ).ok,
    ).toBe(false);
    expect(
      compileFormulaProgram([], ['a', { id: 'a', kind: 'derived' }]).ok,
    ).toBe(false);
  });
});
