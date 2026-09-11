export type Op = '+' | '*' | '<' | '>' | '===' | '||';
export type Single =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'variable'; name: string };
export type Compound =
  | { type: 'binary'; op: Op; left: Expr; right: Expr }
  | { type: 'conditional'; condition: Expr; then: Expr; otherwise: Expr };
export type Expr = Single | Compound;
export type FormulaValue = number | string | boolean;
export interface FormulaDiagnostic {
  code: string;
  field?: string;
  message: string;
  offset?: number;
  path?: string[];
}
export type FormulaParseResult =
  | { ok: true; expr: Expr }
  | { ok: false; error: string; code: string; offset: number };
export const DEPTH_EXCEEDED = 'Recursive depth exceeded';
export const LEN_EXCEEDED = 'Length exceeded';
export const INVALID_OP = 'Invalid operation in formula';
export const MISMATCHED_PAREN = 'Mismatched parenthesis';

const positions = new WeakMap<Expr, number>();
class FormulaError extends Error {
  constructor(public diagnostic: FormulaDiagnostic) {
    super(diagnostic.message);
  }
}
function fail(code: string, message: string, offset?: number): never {
  throw new FormulaError({ code, message, offset });
}
interface Token {
  kind: 'number' | 'string' | 'identifier' | 'symbol' | 'end';
  text: string;
  offset: number;
}
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    const offset = i;
    if (source[i] === "'") {
      let text = '';
      i++;
      while (i < source.length && source[i] !== "'") {
        if (source[i] === '\\') {
          i++;
          if (source[i] !== "'" && source[i] !== '\\')
            fail(
              'INVALID_ESCAPE',
              'Only escaped quotes and backslashes are supported.',
              i - 1,
            );
        }
        text += source[i++];
      }
      if (source[i] !== "'")
        fail('UNTERMINATED_STRING', 'Close the single-quoted text.', offset);
      i++;
      tokens.push({ kind: 'string', text, offset });
    } else if (/[0-9]/.test(source[i])) {
      const text = source.slice(i).match(/^[0-9]+(?:\.[0-9]+)?/)![0];
      i += text.length;
      if (i < source.length && /[.A-Za-z_0-9]/.test(source[i]))
        fail('INVALID_NUMBER', 'Use an integer or decimal such as 12.5.', i);
      if (!Number.isFinite(Number(text)))
        fail('NONFINITE_NUMBER', 'Numeric literal must be finite.', offset);
      tokens.push({ kind: 'number', text, offset });
    } else if (/[A-Za-z]/.test(source[i])) {
      const text = source.slice(i).match(/^[A-Za-z][A-Za-z0-9_]*/)![0];
      i += text.length;
      tokens.push({ kind: 'identifier', text, offset });
    } else {
      const text = source.slice(i).match(/^(===|\|\||[+*<>?:()])/)?.[0];
      if (!text)
        fail(
          'INVALID_TOKEN',
          `Unsupported character ${JSON.stringify(source[i])}.`,
          i,
        );
      i += text.length;
      tokens.push({ kind: 'symbol', text, offset });
    }
  }
  tokens.push({ kind: 'end', text: '', offset: source.length });
  return tokens;
}

export function parseFormula(formula: string): FormulaParseResult {
  try {
    if (formula.length > 1024) fail('LENGTH_EXCEEDED', LEN_EXCEEDED, 1024);
    const tokens = tokenize(formula);
    let index = 0;
    const depths = new WeakMap<Expr, number>();
    const peek = () => tokens[index];
    const is = (text: string) =>
      peek().kind === 'symbol' && peek().text === text;
    const take = (text: string) => {
      if (!is(text)) return false;
      index++;
      return true;
    };
    const node = (expr: Expr, offset: number, children: Expr[] = []): Expr => {
      const depth =
        1 + Math.max(0, ...children.map((child) => depths.get(child)!));
      if (depth > 64) fail('DEPTH_EXCEEDED', DEPTH_EXCEEDED, offset);
      depths.set(expr, depth);
      positions.set(expr, offset);
      return expr;
    };
    const binary = (op: Op, left: Expr, right: Expr, offset: number) =>
      node({ type: 'binary', op, left, right }, offset, [left, right]);
    function primary(nesting: number): Expr {
      if (nesting > 64) fail('DEPTH_EXCEEDED', DEPTH_EXCEEDED, peek().offset);
      const token = peek();
      if (take('(')) {
        const expr = conditional(nesting + 1);
        if (!take(')'))
          fail(
            'EXPECTED_PAREN',
            MISMATCHED_PAREN + ': expected ")".',
            peek().offset,
          );
        return expr;
      }
      index++;
      switch (token.kind) {
        case 'number':
          return node(
            { type: 'number', value: Number(token.text) },
            token.offset,
          );
        case 'string':
          return node({ type: 'string', value: token.text }, token.offset);
        case 'identifier':
          return node({ type: 'variable', name: token.text }, token.offset);
        default:
          return fail(
            'EXPECTED_EXPRESSION',
            'Expected a number, field ID, quoted text, or parenthesized expression.',
            token.offset,
          );
      }
    }
    function multiply(nesting: number): Expr {
      let left = primary(nesting);
      while (is('*')) {
        const offset = tokens[index++].offset;
        left = binary('*', left, primary(nesting), offset);
      }
      return left;
    }
    function add(nesting: number): Expr {
      let left = multiply(nesting);
      while (is('+')) {
        const offset = tokens[index++].offset;
        left = binary('+', left, multiply(nesting), offset);
      }
      return left;
    }
    function compare(nesting: number): Expr {
      let left = add(nesting);
      const comparison = () => is('<') || is('>') || is('===');
      if (comparison()) {
        const token = tokens[index++];
        left = binary(token.text as Op, left, add(nesting), token.offset);
        if (comparison())
          fail(
            'COMPARISON_CHAIN',
            'Parenthesize comparisons instead of chaining them.',
            peek().offset,
          );
      }
      return left;
    }
    function or(nesting: number): Expr {
      let left = compare(nesting);
      while (is('||')) {
        const offset = tokens[index++].offset;
        left = binary('||', left, compare(nesting), offset);
      }
      return left;
    }
    function conditional(nesting: number): Expr {
      if (nesting > 64) fail('DEPTH_EXCEEDED', DEPTH_EXCEEDED, peek().offset);
      const condition = or(nesting);
      if (!is('?')) return condition;
      const offset = tokens[index++].offset;
      const then = conditional(nesting + 1);
      if (!take(':'))
        fail(
          'EXPECTED_COLON',
          'Expected ":" and the alternate branch.',
          peek().offset,
        );
      const otherwise = conditional(nesting + 1);
      return node({ type: 'conditional', condition, then, otherwise }, offset, [
        condition,
        then,
        otherwise,
      ]);
    }
    const expr = conditional(1);
    if (peek().kind !== 'end')
      fail(
        'TRAILING_TOKEN',
        'Unexpected token after the expression.',
        peek().offset,
      );
    return { ok: true, expr };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return {
      ok: false,
      error: error.message,
      code: error.diagnostic.code,
      offset: error.diagnostic.offset ?? 0,
    };
  }
}

export function isFormulaValue(value: unknown): value is FormulaValue {
  return (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  );
}
function numeric(value: FormulaValue, offset?: number): number {
  const result = Number(value);
  if (!Number.isFinite(result))
    fail(
      'INVALID_NUMBER',
      `Expected a finite number; received ${typeof value === 'number' ? String(value) : JSON.stringify(value)}.`,
      offset,
    );
  return result;
}
function truthy(value: FormulaValue): boolean {
  if (typeof value === 'number') return numeric(value) !== 0;
  if (typeof value === 'string' && !Number.isNaN(Number(value)))
    return numeric(value) !== 0;
  return Boolean(value);
}
export type FormulaEvaluationResult =
  | { ok: true; value: FormulaValue }
  | { ok: false; error: FormulaDiagnostic };
export function evaluateFormula(
  expr: Expr,
  variables: Readonly<Record<string, FormulaValue>>,
): FormulaEvaluationResult {
  function visit(expr: Expr): FormulaValue {
    const offset = positions.get(expr);
    switch (expr.type) {
      case 'number':
        return numeric(expr.value, offset);
      case 'string':
        return expr.value;
      case 'variable': {
        if (!Object.prototype.hasOwnProperty.call(variables, expr.name))
          fail('MISSING_VALUE', `Missing value for "${expr.name}".`, offset);
        const value = variables[expr.name];
        if (!isFormulaValue(value))
          fail(
            'INVALID_VALUE',
            `"${expr.name}" must be a number, text, or boolean.`,
            offset,
          );
        if (typeof value === 'number') numeric(value, offset);
        return value;
      }
      case 'conditional':
        return visit(
          truthy(visit(expr.condition)) ? expr.then : expr.otherwise,
        );
      case 'binary': {
        const left = visit(expr.left);
        if (expr.op === '||') return truthy(left) ? left : visit(expr.right);
        const right = visit(expr.right);
        switch (expr.op) {
          case '===':
            return left === right;
          case '<':
            return numeric(left, offset) < numeric(right, offset);
          case '>':
            return numeric(left, offset) > numeric(right, offset);
          case '+':
            return numeric(
              numeric(left, offset) + numeric(right, offset),
              offset,
            );
          case '*':
            return numeric(
              numeric(left, offset) * numeric(right, offset),
              offset,
            );
        }
      }
    }
  }
  try {
    return { ok: true, value: visit(expr) };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return { ok: false, error: error.diagnostic };
  }
}

export interface FormulaDefinition {
  id: string;
  formula?: string;
}
export interface FormulaInput {
  id: string;
  kind: 'input' | 'derived';
}
export interface FormulaProgram {
  inputs: FormulaInput[];
  order: string[];
  expressions: ReadonlyMap<string, Expr>;
  references: ReadonlyMap<string, string[]>;
}
export type FormulaCompilationResult =
  | { ok: true; program: FormulaProgram }
  | { ok: false; errors: FormulaDiagnostic[] };
function references(expr: Expr): Array<{ id: string; offset?: number }> {
  switch (expr.type) {
    case 'variable':
      return [{ id: expr.name, offset: positions.get(expr) }];
    case 'binary':
      return [...references(expr.left), ...references(expr.right)];
    case 'conditional':
      return [
        ...references(expr.condition),
        ...references(expr.then),
        ...references(expr.otherwise),
      ];
    default:
      return [];
  }
}
export function compileFormulaProgram(
  definitions: readonly FormulaDefinition[],
  inputIds: readonly (string | FormulaInput)[],
): FormulaCompilationResult {
  const errors: FormulaDiagnostic[] = [];
  const inputs = inputIds.map((input) =>
    typeof input === 'string' ? { id: input, kind: 'input' as const } : input,
  );
  const declared = new Map<string, FormulaInput>();
  const defs = new Map<string, FormulaDefinition>();
  const expressions = new Map<string, Expr>();
  const refs = new Map<string, string[]>();
  const report = (code: string, field: string, message: string) =>
    errors.push({ code, field, message });
  for (const input of inputs) {
    if (declared.has(input.id))
      report(
        'DUPLICATE_ID',
        input.id,
        `Duplicate input or derived-output producer "${input.id}".`,
      );
    declared.set(input.id, input);
  }
  for (const definition of definitions) {
    if (
      defs.has(definition.id) ||
      declared.get(definition.id)?.kind === 'input'
    )
      report(
        'DUPLICATE_ID',
        definition.id,
        `Calculated field "${definition.id}" collides with another field.`,
      );
    defs.set(definition.id, definition);
  }
  for (const { id, formula } of definitions) {
    if (formula === undefined) {
      if (declared.get(id)?.kind !== 'derived')
        report(
          'MISSING_FORMULA',
          id,
          'Supply a formula or declare a derived output for this calculated field.',
        );
      refs.set(id, []);
      continue;
    }
    const parsed = parseFormula(formula);
    if (!parsed.ok) {
      errors.push({
        code: parsed.code,
        field: id,
        message: parsed.error,
        offset: parsed.offset,
      });
      continue;
    }
    expressions.set(id, parsed.expr);
    const used = references(parsed.expr);
    refs.set(id, [...new Set(used.map((ref) => ref.id))]);
    for (const ref of used) {
      if (!defs.has(ref.id) && !declared.has(ref.id))
        errors.push({
          code: 'UNKNOWN_REFERENCE',
          field: id,
          message: `Unknown field "${ref.id}". Declare it as an input, derived output, or calculated field.`,
          offset: ref.offset,
        });
    }
  }
  // Iterative DFS avoids a JS stack limit for large schemas. Traversal follows
  // declaration and expression order, so diagnostics and evaluation are stable.
  const order: string[] = [];
  const state = new Map<string, 'active' | 'done'>();
  for (const id of defs.keys()) {
    if (state.has(id)) continue;
    const stack = [{ id, next: 0 }];
    state.set(id, 'active');
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const deps = refs.get(frame.id) ?? [];
      if (frame.next === deps.length) {
        order.push(frame.id);
        state.set(frame.id, 'done');
        stack.pop();
        continue;
      }
      const dep = deps[frame.next++];
      if (!defs.has(dep)) continue;
      if (state.get(dep) === 'active') {
        const path = [
          ...stack
            .slice(stack.findIndex((item) => item.id === dep))
            .map((item) => item.id),
          dep,
        ];
        errors.push({
          code: 'DEPENDENCY_CYCLE',
          field: frame.id,
          message: `Circular dependency: ${path.join(' → ')}.`,
          path,
        });
      } else if (!state.has(dep)) {
        state.set(dep, 'active');
        stack.push({ id: dep, next: 0 });
      }
    }
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, program: { inputs, order, expressions, references: refs } };
}
export interface FormulaProgramResult {
  ok: boolean;
  values: Record<string, number>;
  errors: FormulaDiagnostic[];
}
export function evaluateFormulaProgram(
  program: FormulaProgram,
  variables: Readonly<Record<string, FormulaValue>>,
): FormulaProgramResult {
  const bindings: Record<string, FormulaValue> = Object.create(null);
  const values: Record<string, number> = Object.create(null);
  const errors: FormulaDiagnostic[] = [];
  const calculatedIds = new Set(program.order);
  for (const input of program.inputs) {
    if (program.expressions.has(input.id)) continue;
    if (Object.prototype.hasOwnProperty.call(variables, input.id))
      bindings[input.id] = variables[input.id];
    else if (input.kind === 'input') bindings[input.id] = 0;
  }
  const missingDerived = new Set(
    program.inputs
      .filter(
        (input) =>
          input.kind === 'derived' &&
          !program.expressions.has(input.id) &&
          !Object.prototype.hasOwnProperty.call(bindings, input.id),
      )
      .map((input) => input.id),
  );
  for (const id of missingDerived) {
    if (!calculatedIds.has(id))
      errors.push({
        code: 'MISSING_DERIVED_OUTPUT',
        field: id,
        message: `Required derived output "${id}" is missing.`,
      });
  }
  for (const id of program.order) {
    const missing = [id, ...(program.references.get(id) ?? [])].find((dep) =>
      missingDerived.has(dep),
    );
    if (missing) {
      errors.push({
        code: 'MISSING_DERIVED_OUTPUT',
        field: id,
        message: `Required derived output "${missing}" is missing.`,
        path: [id, missing],
      });
      continue;
    }
    const failed = (program.references.get(id) ?? []).find(
      (dep) =>
        calculatedIds.has(dep) &&
        !Object.prototype.hasOwnProperty.call(values, dep),
    );
    if (failed) {
      errors.push({
        code: 'FAILED_DEPENDENCY',
        field: id,
        message: `Cannot calculate until "${failed}" is corrected.`,
        path: [id, failed],
      });
      continue;
    }
    const expr = program.expressions.get(id);
    const result = evaluateFormula(
      expr ?? { type: 'variable', name: id },
      bindings,
    );
    if (!result.ok) {
      errors.push({ ...result.error, field: id });
      continue;
    }
    try {
      const value = numeric(result.value, expr && positions.get(expr));
      values[id] = value;
      bindings[id] = value;
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      errors.push({ ...error.diagnostic, field: id });
    }
  }
  return { ok: errors.length === 0, values, errors };
}
