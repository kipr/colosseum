/**
 * Lexer, parser, and type checker for the permitted scoring-formula language.
 *
 * @remarks A formula is a closed expression over field identifiers that must
 * yield a number. This module rejects every token outside the alphabet and
 * every expression that does not type-check. It does not evaluate formulas
 * and does not run JavaScript.
 *
 * Unknown identifiers and forward references are template-save rules and are
 * not checked here. Evaluation belongs in a later shared evaluator.
 */

export const FORMULA_MAX_LENGTH = 1024;
export const FORMULA_MAX_DEPTH = 32;

export type FormulaBinaryOp = '+' | '*' | '||' | '>' | '===';

/**
 * Parsed formula tree. `index` is the source offset of the node (operator
 * for binaries and ternaries, token start for leaves).
 */
export type FormulaExpr =
  | { type: 'number'; value: number; index: number }
  | { type: 'identifier'; name: string; index: number }
  | { type: 'string'; value: string; index: number }
  | {
      type: 'binary';
      op: FormulaBinaryOp;
      left: FormulaExpr;
      right: FormulaExpr;
      index: number;
    }
  | {
      type: 'ternary';
      condition: FormulaExpr;
      consequent: FormulaExpr;
      alternate: FormulaExpr;
      index: number;
    };

export type FormulaErrorKind = 'lex' | 'parse' | 'type' | 'limit';

export type FormulaError = {
  kind: FormulaErrorKind;
  message: string;
  index: number;
};

export type FormulaParseResult =
  | { ok: true; ast: FormulaExpr }
  | { ok: false; error: FormulaError };

const RESERVED_IDENTIFIERS = new Set(['true', 'false', 'null']);

type FormulaValueType = 'number' | 'boolean' | 'string';

type Token =
  | { kind: 'number'; value: number; index: number }
  | { kind: 'identifier'; value: string; index: number }
  | { kind: 'string'; value: string; index: number }
  | {
      kind: '+' | '*' | '||' | '>' | '===' | '?' | ':' | '(' | ')' | 'eof';
      index: number;
    };

class FormulaFailure extends Error {
  readonly kind: FormulaErrorKind;
  readonly index: number;

  constructor(kind: FormulaErrorKind, message: string, index: number) {
    super(message);
    this.name = 'FormulaFailure';
    this.kind = kind;
    this.index = index;
  }

  toError(): FormulaError {
    return {
      kind: this.kind,
      message: this.message,
      index: this.index,
    };
  }
}

/**
 * Parse `source` into a type-checked formula AST.
 *
 * Length and depth limits are enforced before type checking. The first
 * failure is returned; this is not a multi-error collector.
 */
export function parseFormula(source: string): FormulaParseResult {
  try {
    if (source.length > FORMULA_MAX_LENGTH) {
      throw new FormulaFailure(
        'limit',
        `Formula exceeds ${FORMULA_MAX_LENGTH} characters`,
        0,
      );
    }

    const tokens = tokenize(source);
    const ast = new Parser(tokens).parse();
    const depth = astDepth(ast);
    if (depth > FORMULA_MAX_DEPTH) {
      throw new FormulaFailure(
        'limit',
        `Formula exceeds AST depth ${FORMULA_MAX_DEPTH}`,
        ast.index,
      );
    }

    typeCheckFormula(ast);
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof FormulaFailure) {
      return { ok: false, error: error.toError() };
    }
    throw error;
  }
}

/** Identifiers in the AST, in visit order, including repeats. */
export function collectIdentifiers(ast: FormulaExpr): string[] {
  const names: string[] = [];
  walkIdentifiers(ast, names);
  return names;
}

function walkIdentifiers(expr: FormulaExpr, names: string[]): void {
  switch (expr.type) {
    case 'identifier':
      names.push(expr.name);
      return;
    case 'number':
    case 'string':
      return;
    case 'binary':
      walkIdentifiers(expr.left, names);
      walkIdentifiers(expr.right, names);
      return;
    case 'ternary':
      walkIdentifiers(expr.condition, names);
      walkIdentifiers(expr.consequent, names);
      walkIdentifiers(expr.alternate, names);
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i += 1;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const start = i;
      i += 1;
      while (i < source.length && source[i] >= '0' && source[i] <= '9') {
        i += 1;
      }
      if (i < source.length && source[i] === '.') {
        if (
          i + 1 < source.length &&
          source[i + 1] >= '0' &&
          source[i + 1] <= '9'
        ) {
          i += 1;
          while (i < source.length && source[i] >= '0' && source[i] <= '9') {
            i += 1;
          }
        }
      }
      tokens.push({
        kind: 'number',
        value: Number(source.slice(start, i)),
        index: start,
      });
      continue;
    }

    if (ch >= 'a' && ch <= 'z') {
      const start = i;
      i += 1;
      while (i < source.length && isIdentPart(source[i])) {
        i += 1;
      }
      const name = source.slice(start, i);
      if (RESERVED_IDENTIFIERS.has(name)) {
        throw new FormulaFailure(
          'lex',
          `Reserved keyword '${name}' is not allowed`,
          start,
        );
      }
      tokens.push({ kind: 'identifier', value: name, index: start });
      continue;
    }

    if (ch === "'") {
      const start = i;
      i += 1;
      while (i < source.length && isStringChar(source[i])) {
        i += 1;
      }
      if (i >= source.length || source[i] !== "'") {
        const bad = i < source.length ? source[i] : '';
        if (bad !== '') {
          throw new FormulaFailure(
            'lex',
            `Invalid character ${formatChar(bad)} in string`,
            i,
          );
        }
        throw new FormulaFailure('lex', 'Unterminated string', start);
      }
      tokens.push({
        kind: 'string',
        value: source.slice(start + 1, i),
        index: start,
      });
      i += 1;
      continue;
    }

    if (ch === '=') {
      if (source.slice(i, i + 3) !== '===') {
        throw new FormulaFailure(
          'lex',
          "'=' is only allowed as part of '==='",
          i,
        );
      }
      tokens.push({ kind: '===', index: i });
      i += 3;
      continue;
    }

    if (ch === '|') {
      if (source[i + 1] !== '|') {
        throw new FormulaFailure(
          'lex',
          "'|' is only allowed as part of '||'",
          i,
        );
      }
      tokens.push({ kind: '||', index: i });
      i += 2;
      continue;
    }

    if (ch === '+') {
      tokens.push({ kind: '+', index: i });
      i += 1;
      continue;
    }
    if (ch === '*') {
      tokens.push({ kind: '*', index: i });
      i += 1;
      continue;
    }
    if (ch === '>') {
      tokens.push({ kind: '>', index: i });
      i += 1;
      continue;
    }
    if (ch === '?') {
      tokens.push({ kind: '?', index: i });
      i += 1;
      continue;
    }
    if (ch === ':') {
      tokens.push({ kind: ':', index: i });
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: '(', index: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: ')', index: i });
      i += 1;
      continue;
    }

    throw new FormulaFailure(
      'lex',
      `Unexpected character ${formatChar(ch)}`,
      i,
    );
  }

  tokens.push({ kind: 'eof', index: source.length });
  return tokens;
}

function isIdentPart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_';
}

function isStringChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '_'
  );
}

function formatChar(ch: string): string {
  if (ch === '\r') {
    return "'\\r'";
  }
  return `'${ch}'`;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaExpr {
    const expr = this.parseNumeric();
    const next = this.peek();
    if (next.kind !== 'eof') {
      throw new FormulaFailure(
        'parse',
        `Unexpected token '${next.kind}' after formula`,
        next.index,
      );
    }
    return expr;
  }

  /**
   * numeric = coalesce [ "?" numeric ":" numeric ]
   */
  private parseNumeric(): FormulaExpr {
    const condition = this.parseCoalesce();
    if (!this.match('?')) {
      return condition;
    }
    const question = this.previous();
    const consequent = this.parseNumeric();
    this.expect(':', 'Expected ":" in ternary expression');
    const alternate = this.parseNumeric();
    return {
      type: 'ternary',
      condition,
      consequent,
      alternate,
      index: question.index,
    };
  }

  /**
   * coalesce = comparison { "||" comparison }
   */
  private parseCoalesce(): FormulaExpr {
    let expr = this.parseComparison();
    while (this.match('||')) {
      const op = this.previous();
      const right = this.parseComparison();
      expr = {
        type: 'binary',
        op: '||',
        left: expr,
        right,
        index: op.index,
      };
    }
    return expr;
  }

  /**
   * comparison = additive { ("===" | ">") additive }
   */
  private parseComparison(): FormulaExpr {
    let expr = this.parseAdditive();
    while (this.check('===') || this.check('>')) {
      const op = this.advance();
      const right = this.parseAdditive();
      expr = {
        type: 'binary',
        op: op.kind === '===' ? '===' : '>',
        left: expr,
        right,
        index: op.index,
      };
    }
    return expr;
  }

  /**
   * additive = multiplicative { "+" multiplicative }
   */
  private parseAdditive(): FormulaExpr {
    let expr = this.parseMultiplicative();
    while (this.match('+')) {
      const op = this.previous();
      const right = this.parseMultiplicative();
      expr = {
        type: 'binary',
        op: '+',
        left: expr,
        right,
        index: op.index,
      };
    }
    return expr;
  }

  /**
   * multiplicative = primary { "*" primary }
   */
  private parseMultiplicative(): FormulaExpr {
    let expr = this.parsePrimary();
    this.rejectCall();
    while (this.match('*')) {
      const op = this.previous();
      const right = this.parsePrimary();
      this.rejectCall();
      expr = {
        type: 'binary',
        op: '*',
        left: expr,
        right,
        index: op.index,
      };
    }
    return expr;
  }

  /**
   * primary = NUMBER | IDENTIFIER | STRING | "(" numeric ")"
   */
  private parsePrimary(): FormulaExpr {
    const token = this.peek();
    if (token.kind === 'number') {
      this.advance();
      return { type: 'number', value: token.value, index: token.index };
    }
    if (token.kind === 'identifier') {
      this.advance();
      return { type: 'identifier', name: token.value, index: token.index };
    }
    if (token.kind === 'string') {
      this.advance();
      return { type: 'string', value: token.value, index: token.index };
    }
    if (this.match('(')) {
      const expr = this.parseNumeric();
      this.expect(')', 'Expected ")" to close grouped expression');
      return expr;
    }
    if (token.kind === '+' || token.kind === '*') {
      throw new FormulaFailure(
        'parse',
        `Unary '${token.kind}' is not allowed`,
        token.index,
      );
    }
    throw new FormulaFailure(
      'parse',
      'Expected a number, identifier, string, or "("',
      token.index,
    );
  }

  private rejectCall(): void {
    const next = this.peek();
    if (next.kind === '(') {
      throw new FormulaFailure(
        'parse',
        'Function calls are not allowed',
        next.index,
      );
    }
  }

  private check(kind: Token['kind']): boolean {
    return this.peek().kind === kind;
  }

  private match(kind: Token['kind']): boolean {
    if (!this.check(kind)) {
      return false;
    }
    this.advance();
    return true;
  }

  private expect(kind: Token['kind'], message: string): Token {
    if (this.check(kind)) {
      return this.advance();
    }
    const next = this.peek();
    throw new FormulaFailure('parse', message, next.index);
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }

  private previous(): Token {
    return this.tokens[this.pos - 1] ?? this.tokens[0];
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== 'eof') {
      this.pos += 1;
    }
    return token;
  }
}

function astDepth(expr: FormulaExpr): number {
  switch (expr.type) {
    case 'number':
    case 'identifier':
    case 'string':
      return 1;
    case 'binary':
      return 1 + Math.max(astDepth(expr.left), astDepth(expr.right));
    case 'ternary':
      return (
        1 +
        Math.max(
          astDepth(expr.condition),
          astDepth(expr.consequent),
          astDepth(expr.alternate),
        )
      );
  }
}

function typeCheckFormula(expr: FormulaExpr): void {
  const resultType = inferType(expr);
  if (resultType === 'string') {
    throw stringLiteralError(expr.index);
  }
  if (resultType !== 'number') {
    throw new FormulaFailure('type', 'Formula must yield a number', expr.index);
  }
}

function inferType(expr: FormulaExpr): FormulaValueType {
  switch (expr.type) {
    case 'number':
    case 'identifier':
      return 'number';
    case 'string':
      return 'string';
    case 'binary':
      return inferBinary(expr);
    case 'ternary':
      return inferTernary(expr);
  }
}

function inferBinary(
  expr: Extract<FormulaExpr, { type: 'binary' }>,
): FormulaValueType {
  if (expr.op === '===') {
    if (expr.left.type === 'identifier' && expr.right.type === 'string') {
      return 'boolean';
    }
    const left = inferType(expr.left);
    const right = inferType(expr.right);
    if (left === 'number' && right === 'number') {
      return 'boolean';
    }
    if (left === 'string' || right === 'string') {
      throw stringLiteralError(
        expr.left.type === 'string' ? expr.left.index : expr.right.index,
      );
    }
    throw new FormulaFailure(
      'type',
      "'===' requires number === number or identifier === string",
      expr.index,
    );
  }

  const left = inferType(expr.left);
  const right = inferType(expr.right);

  if (expr.op === '>') {
    requireNumberOperand(left, expr.left, expr.op, expr.index);
    requireNumberOperand(right, expr.right, expr.op, expr.index);
    return 'boolean';
  }

  requireNumberOperand(left, expr.left, expr.op, expr.index);
  requireNumberOperand(right, expr.right, expr.op, expr.index);
  return 'number';
}

function inferTernary(
  expr: Extract<FormulaExpr, { type: 'ternary' }>,
): FormulaValueType {
  const condition = inferType(expr.condition);
  if (condition !== 'boolean') {
    throw new FormulaFailure(
      'type',
      'Ternary condition must be boolean',
      expr.index,
    );
  }
  const consequent = inferType(expr.consequent);
  const alternate = inferType(expr.alternate);
  if (consequent === 'string') {
    throw stringLiteralError(expr.consequent.index);
  }
  if (alternate === 'string') {
    throw stringLiteralError(expr.alternate.index);
  }
  if (consequent !== 'number' || alternate !== 'number') {
    throw new FormulaFailure(
      'type',
      'Ternary branches must be numbers',
      expr.index,
    );
  }
  return 'number';
}

function requireNumberOperand(
  valueType: FormulaValueType,
  operand: FormulaExpr,
  op: FormulaBinaryOp,
  opIndex: number,
): void {
  if (valueType === 'string') {
    throw stringLiteralError(operand.index);
  }
  if (valueType !== 'number') {
    const extra = op === '||' ? ' (numeric zero-coalesce, not boolean OR)' : '';
    throw new FormulaFailure(
      'type',
      `Operator '${op}' requires number operands${extra}`,
      opIndex,
    );
  }
}

function stringLiteralError(index: number): FormulaFailure {
  return new FormulaFailure(
    'type',
    "String literals are only legal as the right-hand side of '==='",
    index,
  );
}
