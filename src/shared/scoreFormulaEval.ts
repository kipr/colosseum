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


export function splitRec (strExp: string): Expr {
  // Base case: strExp is a single
  if (/^'\w*'$/.test(strExp)) {
    return {type: "string", value: strExp};
  } else if (/^[a-z]\w*$/.test(strExp)) {
    return {type: "variable", name: strExp};
  } else if (/^[0-9.]*$/.test(strExp)) {
    return {type: "number", value: parseInt(strExp, 10)}
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
  // Clean up extraneous parenthesis
  strExp = strExp.slice(minDepth, strExp.length - minDepth);
  split = split - minDepth;
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
    const cond = strExp.slice(0, tern_start).trim();
    const pri = strExp.slice(tern_start + opLen, split).trim();
    const aux = strExp.slice(split + opLen).trim();
    return {
      type: 'conditional',
      condition: splitRec(cond),
      then: splitRec(pri),
      otherwise: splitRec(aux)
    }
  }
  const left = strExp.slice(0, split - opLen).trim();
  const right = strExp.slice(split+1).trim();
  const op = strExp.slice(split - opLen, split+1).trim();

  return {
    type: 'binary',
    op: op as Op,
    left: splitRec(left),
    right: splitRec(right)
  }
}



//console.dir(splitRec('(((side_a_starting_cubes * 2) + 1) + (side_a_starting_baskets * 15)) * ((side_a_starting_botguy === \'1\' ? 2 : 1) + 1)'), { depth: null });
//console.dir(splitRec('((side_a_starting_cubes * 2) + 1) + (side_a_starting_baskets * 15) * (side_a_starting_botguy * 2 + 1)'), { depth: null });
//console.dir(splitRec('1 * 2 * 3 + 4'), { depth: null });
//console.dir(splitRec('((1 * 2 * (3 + 4)))'), { depth: null });
//console.dir(splitRec('(3 + 4) * 1 * 2'), { depth: null });
//console.dir(splitRec('1 === 1 ? 1 : 2'), { depth: null });
//console.dir(splitRec('(1 === 1 ? 1 : 2) * 2'), { depth: null });
