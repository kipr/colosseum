import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORMULA_MAX_DEPTH,
  FORMULA_MAX_LENGTH,
  collectIdentifiers,
  parseFormula,
  type FormulaErrorKind,
  type FormulaExpr,
} from '../../src/shared/scoreFormula';

function stripIndex(expr: FormulaExpr): unknown {
  switch (expr.type) {
    case 'number':
      return { type: 'number', value: expr.value };
    case 'identifier':
      return { type: 'identifier', name: expr.name };
    case 'string':
      return { type: 'string', value: expr.value };
    case 'binary':
      return {
        type: 'binary',
        op: expr.op,
        left: stripIndex(expr.left),
        right: stripIndex(expr.right),
      };
    case 'ternary':
      return {
        type: 'ternary',
        condition: stripIndex(expr.condition),
        consequent: stripIndex(expr.consequent),
        alternate: stripIndex(expr.alternate),
      };
  }
}

function expectOk(source: string): FormulaExpr {
  const result = parseFormula(source);
  expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.ast;
}

function expectFail(
  source: string,
  kind: FormulaErrorKind,
  message?: string | RegExp,
): void {
  const result = parseFormula(source);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected ${kind} failure`);
  }
  expect(result.error.kind).toBe(kind);
  if (typeof message === 'string') {
    expect(result.error.message).toBe(message);
  } else if (message) {
    expect(result.error.message).toMatch(message);
  }
}

function collectFormulas(value: unknown, formulas: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectFormulas(item, formulas));
    return;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.formula === 'string') {
      formulas.push(record.formula);
    }
    Object.values(record).forEach((child) => collectFormulas(child, formulas));
  }
}

describe('parseFormula accepted examples', () => {
  it('parses a sum of identifiers', () => {
    const ast = expectOk('side_a_score + side_b_score');
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '+',
      left: { type: 'identifier', name: 'side_a_score' },
      right: { type: 'identifier', name: 'side_b_score' },
    });
    expect(collectIdentifiers(ast)).toEqual(['side_a_score', 'side_b_score']);
  });

  it('parses a weighted sum', () => {
    const ast = expectOk('(poms * 2) + (cubes * 5)');
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '+',
      left: {
        type: 'binary',
        op: '*',
        left: { type: 'identifier', name: 'poms' },
        right: { type: 'number', value: 2 },
      },
      right: {
        type: 'binary',
        op: '*',
        left: { type: 'identifier', name: 'cubes' },
        right: { type: 'number', value: 5 },
      },
    });
    expect(collectIdentifiers(ast)).toEqual(['poms', 'cubes'])
  });

  it('parses a 2x on-off multiplier', () => {
    const ast = expectOk("subtotal * (botguy === '1' ? 2 : 1)");
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '*',
      left: { type: 'identifier', name: 'subtotal' },
      right: {
        type: 'ternary',
        condition: {
          type: 'binary',
          op: '===',
          left: { type: 'identifier', name: 'botguy' },
          right: { type: 'string', value: '1' },
        },
        consequent: { type: 'number', value: 2 },
        alternate: { type: 'number', value: 1 },
      },
    });
    expect(collectIdentifiers(ast)).toEqual(['subtotal', 'botguy']);
  });

  it('parses an identity-if-zero multiplier', () => {
    const ast = expectOk('subtotal * (count > 0 ? count : 1)');
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '*',
      left: { type: 'identifier', name: 'subtotal' },
      right: {
        type: 'ternary',
        condition: {
          type: 'binary',
          op: '>',
          left: { type: 'identifier', name: 'count' },
          right: { type: 'number', value: 0 },
        },
        consequent: { type: 'identifier', name: 'count' },
        alternate: { type: 'number', value: 1 },
      },
    });
    expect(collectIdentifiers(ast)).toEqual(['subtotal', 'count', 'count']);
  });

  it('parses a default-to-1 combined multiplier', () => {
    const ast = expectOk(
      "((drum === '1' ? 2 : 0) + (botguy === '1' ? 2 : 0)) || 1",
    );
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '||',
      left: {
        type: 'binary',
        op: '+',
        left: {
          type: 'ternary',
          condition: {
            type: 'binary',
            op: '===',
            left: { type: 'identifier', name: 'drum' },
            right: { type: 'string', value: '1' },
          },
          consequent: { type: 'number', value: 2 },
          alternate: { type: 'number', value: 0 },
        },
        right: {
          type: 'ternary',
          condition: {
            type: 'binary',
            op: '===',
            left: { type: 'identifier', name: 'botguy' },
            right: { type: 'string', value: '1' },
          },
          consequent: { type: 'number', value: 2 },
          alternate: { type: 'number', value: 0 },
        },
      },
      right: { type: 'number', value: 1 },
    });
    expect(collectIdentifiers(ast)).toEqual(['drum', 'botguy']);
  });

  it('accepts a comparison grouped as a numeric coalesce operand', () => {
    expectOk('(a > 0 ? 1 : 0) || 1');
  });

  it('treats whitespace as insignificant', () => {
    const ast = expectOk('a\n+\tb');
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '+',
      left: { type: 'identifier', name: 'a' },
      right: { type: 'identifier', name: 'b' },
    });
    expect(collectIdentifiers(ast)).toEqual(['a', 'b']);
  });

  it('accepts decimal numbers without a sign or exponent', () => {
    const ast = expectOk('items * 1.5');
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '*',
      left: { type: 'identifier', name: 'items' },
      right: { type: 'number', value: 1.5 },
    });
  });

  it('accepts identifier === number as number === number', () => {
    expectOk('flag === 1 ? 2 : 1');
  });

  it('accepts an empty string as the === right-hand side', () => {
    expectOk("choice === '' ? 0 : 1");
  });
});

describe('parseFormula precedence', () => {
  it('groups a || b ? c : d as (a || b) ? c : d, which is a type error', () => {
    expectFail('a || b ? c : d', 'type', 'Ternary condition must be boolean');
  });

  it('binds * tighter than +', () => {
    const ast = expectOk('a + b * c');
    expect(stripIndex(ast)).toEqual({
      type: 'binary',
      op: '+',
      left: { type: 'identifier', name: 'a' },
      right: {
        type: 'binary',
        op: '*',
        left: { type: 'identifier', name: 'b' },
        right: { type: 'identifier', name: 'c' },
      },
    });
  });

  it('binds comparison tighter than ||', () => {
    expectFail(
      'a > 0 || b > 0',
      'type',
      "Operator '||' requires number operands (numeric zero-coalesce, not boolean OR)",
    );
  });
});

describe('parseFormula rejected lexemes', () => {
  it.each([
    '.',
    '"1"',
    'base - penalty',
    'sum / 2',
    'n % 2',
    'a & b',
    'a | b',
    'a = b',
    'a == b',
    '// comment',
    'true',
    'false',
    'null',
    'constructor.constructor("alert(1)")()',
    '`1`',
    'Foo',
    '_hidden',
    'choice === "1"',
    "choice === 'x y'",
    '1.',
    'max(a, 1)',
  ])('rejects %s', (source) => {
    expectFail(source, 'lex');
  });

  it('rejects reserved keywords with a keyword message', () => {
    expectFail('true', 'lex', "Reserved keyword 'true' is not allowed");
  });

  it('rejects lone = and == as incomplete ===', () => {
    expectFail('a = 1', 'lex', "'=' is only allowed as part of '==='");
    expectFail('a == 1', 'lex', "'=' is only allowed as part of '==='");
  });

  it('rejects a lone |', () => {
    expectFail('a | 1', 'lex', "'|' is only allowed as part of '||'");
  });
});

describe('parseFormula rejected structure', () => {
  it('rejects an empty formula', () => {
    expectFail('', 'parse');
    expectFail('   ', 'parse');
    expectFail('\t\n', 'parse');
  });

  it('rejects a missing ternary colon', () => {
    expectFail('a > 0 ? 1', 'parse', 'Expected ":" in ternary expression');
  });

  it('rejects unmatched parentheses', () => {
    expectFail('(a + b', 'parse', 'Expected ")" to close grouped expression');
    expectFail('a + b)', 'parse', "Unexpected token ')' after formula");
  });

  it('rejects two primaries in a row, including 1e3', () => {
    expectFail('1e3', 'parse', "Unexpected token 'identifier' after formula");
    expectFail('a b', 'parse', "Unexpected token 'identifier' after formula");
  });

  it('rejects unary +', () => {
    expectFail('+1', 'parse', "Unary '+' is not allowed");
    expectFail('1 + + 2', 'parse', "Unary '+' is not allowed");
  });

  it('rejects function calls', () => {
    expectFail('ident(', 'parse', 'Function calls are not allowed');
    expectFail('ident(a)', 'parse', 'Function calls are not allowed');
  });
});

describe('parseFormula rejected types', () => {
  it('rejects a number used as a ternary condition', () => {
    expectFail(
      'field ? field : 0',
      'type',
      'Ternary condition must be boolean',
    );
  });

  it('rejects boolean ||', () => {
    expectFail(
      'a > 0 || b > 0',
      'type',
      "Operator '||' requires number operands (numeric zero-coalesce, not boolean OR)",
    );
  });

  it('rejects a top-level string', () => {
    expectFail(
      "'1'",
      'type',
      "String literals are only legal as the right-hand side of '==='",
    );
    expectFail(
      "''",
      'type',
      "String literals are only legal as the right-hand side of '==='",
    );
  });

  it('rejects === between a number and a string', () => {
    expectFail(
      "1 === '1'",
      'type',
      "String literals are only legal as the right-hand side of '==='",
    );
  });

  it('rejects a string on the left of ===', () => {
    expectFail(
      "'1' === ident",
      'type',
      "String literals are only legal as the right-hand side of '==='",
    );
  });

  it('rejects === between a computed number and a string', () => {
    expectFail(
      "(a + b) === '1'",
      'type',
      "String literals are only legal as the right-hand side of '==='",
    );
  });

  it('rejects a comparison as the top-level result', () => {
    expectFail('a > 0', 'type', 'Formula must yield a number');
  });
});

describe('parseFormula limits', () => {
  it('rejects formulas longer than 1024 characters before lexing', () => {
    const source = 'a'.repeat(FORMULA_MAX_LENGTH + 1);
    expectFail(
      source,
      'limit',
      `Formula exceeds ${FORMULA_MAX_LENGTH} characters`,
    );
  });

  it('accepts a formula of exactly 1024 characters', () => {
    expectOk('a'.repeat(FORMULA_MAX_LENGTH));
  });

  it('rejects an AST deeper than 32', () => {
    const source = `${'a+'.repeat(FORMULA_MAX_DEPTH)}a`;
    expectFail(
      source,
      'limit',
      `Formula exceeds AST depth ${FORMULA_MAX_DEPTH}`,
    );
  });

  it('accepts an AST of depth 32', () => {
    const source = `${'a+'.repeat(FORMULA_MAX_DEPTH - 1)}a`;
    expectOk(source);
  });
});

describe('checked-in template formulas', () => {
  const templatesDir = path.resolve(__dirname, '../../templates');
  const files = fs
    .readdirSync(templatesDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  it.each(files)('parses every formula in %s', (fileName) => {
    const json = JSON.parse(
      fs.readFileSync(path.join(templatesDir, fileName), 'utf8'),
    ) as unknown;
    const formulas: string[] = [];
    collectFormulas(json, formulas);
    expect(formulas.length).toBeGreaterThan(0);
    for (const formula of formulas) {
      const result = parseFormula(formula);
      expect(
        result.ok,
        `${fileName}: ${formula} -> ${result.ok ? '' : result.error.message}`,
      ).toBe(true);
    }
  });
});
