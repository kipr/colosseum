const OPS = new Set(['+', '*', '<', '>', '===', '||'] as const);
const OPS_SINGLE = '*+<>=|?:';
type Op = typeof OPS extends Set<infer T> ? T : never;
function isOp(value: string): value is Op {
  return OPS.has(value as Op);
}
export type Single =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'variable'; name: string };
export type Compound =
  | {
      type: 'binary';
      op: Op;
      left: Expr;
      right: Expr;
    }
  | {
      type: 'conditional';
      condition: Expr;
      then: Expr;
      otherwise: Expr;
    };

export type Expr = Single | Compound;
export type FormulaParseResult =
  | {
      ok: true;
      expr: Expr;
    }
  | {
      ok: false;
      error: string;
    };
export const DEPTH_EXCEEDED = 'Recursive depth exceeded';
export const LEN_EXCEEDED = 'Length exceeded';
export const INVALID_OP = 'Invalid operation in formula';
export const MISMATCHED_PAREN = 'Mismatched parenthesis';

export function parseFormula(formula: string): FormulaParseResult {
  if (formula.length > 1024) {
    return {
      ok: false,
      error: LEN_EXCEEDED,
    };
  }
  return splitRec(formula, 0);
}

function ok(expr: Expr): FormulaParseResult {
  return {
    ok: true,
    expr: expr,
  };
}
function err(error: string): FormulaParseResult {
  return {
    ok: false,
    error: error,
  };
}

function splitRec(strExp: string, recDepth: number): FormulaParseResult {
  // Base case: strExp is a single
  if (/^'\w*'$/.test(strExp)) {
    return ok({ type: 'string', value: strExp.slice(1, -1) });
  } else if (/^[a-z]\w*$/.test(strExp)) {
    return ok({ type: 'variable', name: strExp });
  } else if (/^[0-9.]*$/.test(strExp)) {
    return ok({ type: 'number', value: parseInt(strExp, 10) });
  }

  if (recDepth > 64) {
    return err(DEPTH_EXCEEDED);
  }
  // Find the position of the next operator
  let depth = 0;
  let minDepth = Number.MAX_SAFE_INTEGER;
  let split = 0;
  let prec = 0;
  let tern_start = -1;
  for (const [i, c] of Array.from(strExp).entries()) {
    const curPrec = OPS_SINGLE.indexOf(c);
    if (depth <= minDepth && curPrec >= prec) {
      if (c === '?') {
        tern_start = i;
      }
      prec = curPrec;
      split = i;
      minDepth = depth;
    }
    if (c === '(') {
      depth += 1;
      prec = 0;
    } else if (c === ')') {
      depth -= 1;
      prec = 0;
    }
  }
  if (depth !== 0) {
    return err(MISMATCHED_PAREN);
  }
  // Clean up extraneous parenthesis
  strExp = strExp.slice(minDepth, strExp.length - minDepth);
  split = split - minDepth;

  // Handle unique operators
  let opLen = 1;
  let isTern = false;
  switch (strExp[split]) {
    case '=':
      opLen = 3;
      break;
    case '|':
      opLen = 2;
      break;
    case ':':
      isTern = true;
  }
  if (isTern) {
    const con = strExp.slice(0, tern_start - 1).trim();
    const the = strExp.slice(tern_start + opLen, split).trim();
    const oth = strExp.slice(split + opLen).trim();
    const cons = splitRec(con, recDepth + 1);
    if (!cons.ok) return cons;
    const thes = splitRec(the, recDepth + 1);
    if (!thes.ok) return thes;
    const oths = splitRec(oth, recDepth + 1);
    if (!oths.ok) return oths;

    return ok({
      type: 'conditional',
      condition: cons.expr,
      then: thes.expr,
      otherwise: oths.expr,
    });
  }
  const left = strExp.slice(0, split - opLen).trim();
  const right = strExp.slice(split + 1).trim();
  const op = strExp.slice(split - opLen, split + 1).trim();
  if (!isOp(op)) {
    return err(INVALID_OP);
  }
  const leftSplit = splitRec(left, recDepth + 1);
  if (!leftSplit.ok) return leftSplit;
  const rightSplit = splitRec(right, recDepth + 1);
  if (!rightSplit.ok) return rightSplit;

  return ok({
    type: 'binary',
    op: op as Op,
    left: leftSplit.expr,
    right: rightSplit.expr,
  });
}
