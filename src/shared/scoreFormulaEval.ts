const OPS = new Set(['+', '*', '<', '>', '===', '||'] as const);
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

export function evaluate(strExp: string): Expr {
  split(strExp);
  return { type: 'string', value: strExp };
}

const GENERAL_CHARS = /[\w\s+*:?<>=]/;
const OP = /([+*<>?:]|===|\|\|)/;
const NOT_OP = /[^+*:?<>=\s]/;

function split (strExp: string): string | Expr {
  // Look for matching closer, then find op
  let left = '';
  let op = '';
  let right = '';
  if (strExp[0] === '(') {
    let depth = 1;
    let i = 1;
    while (depth !== 0) {
      if (strExp[i] === '(') {
        depth += 1;
      } else if (strExp[i] === ')') {
        depth -= 1;
      } else if (!GENERAL_CHARS.test(strExp[i])) {
        return '';
      }
      i += 1;
    }
    left = strExp.slice(1, i-1).trim();

    right = strExp.slice(i).trim();
    i = 0;
    // Is the next non-whitespace *not* an operator?
    const next_op_idx = right.search(OP);
    const next_not_op_idx = right.search(NOT_OP);
    if (next_not_op_idx < next_op_idx) {
      return '';
    }
    op = right[next_op_idx];
    right = right.slice(next_not_op_idx);
    console.log(left);    
    console.log(op);    
    console.log(right);    
  }

  return {
    type: 'binary',
    left: {
      type: 'string',
      value: left,
    },
    op: op,
    right: {
      type: 'string',
      value: right
    }
  } as Expr;
}

export function splitRec (strExp: string): Expr {
  //console.log(strExp);
  // Base case: strExp is a single
  if (/^'\w*'$/.test(strExp)) {
    return {type: "string", value: strExp};
  } else if (/^[a-z]\w*$/.test(strExp)) {
    return {type: "variable", name: strExp};
  } else if (/^[0-9.]*$/.test(strExp)) {
    return {type: "number", value: parseInt(strExp, 10)}
  }

  // If starting with a parenthesis, get sub-expressions
  let left: Expr;
  let op: Op;
  let right: Expr;
  if (strExp[0] === '(') {
    left = splitRec(strExp.slice(1));
    // Need to parse right somehow
  } else {
    const closeParenIdx = strExp.search(/\)/);
    if (closeParenIdx !== -1) {
      left = splitRec(strExp.slice(0, closeParenIdx).trim());
      const remain = strExp.slice(closeParenIdx + 1).trim();
      // TODO Handle incorrect stuff
      switch (remain[0]) {
        case '+':
        case '*':
        case '<':
        case '>':
          op = remain[0];
          break;
        case '=':
          op = '===';
          break;
        default:
          op = '||';
      }
      const rightIdx = remain.search(NOT_OP);
      right = splitRec(remain.slice(rightIdx).trim());
      return {
        type: "binary",
        op: op,
        left: left,
        right: right
      };
    } else {
      const op_idx = strExp.search(OP);
      left = splitRec(strExp.slice(0, op_idx).trim());
      const remain = strExp.slice(op_idx).trim();
      // TODO Handle incorrect stuff
      switch (remain[0]) {
        case '+':
        case '*':
        case '<':
        case '>':
          op = remain[0];
          break;
        case '=':
          op = '===';
          break;
        default:
          op = '||';
      }
      const rightIdx = remain.search(NOT_OP);
      right = splitRec(remain.slice(rightIdx).trim());
      return {
        type: "binary",
        op: op,
        left: left,
        right: right
      };
    }
  }
  return left;
}

//console.dir(splitRec('(((side_a_starting_cubes * 2) + 1) + (side_a_starting_baskets * 15)) * (side_a_starting_botguy === \'1\' ? 2 : 1)'), { depth: null });
//console.dir(splitRec('1 * 2 * 3 * 4'), { depth: null });
