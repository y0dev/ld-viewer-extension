/**
 * A tiny, side-effect-free arithmetic evaluator over numeric literals.
 * This is NOT a general expression evaluator and never executes arbitrary
 * code: it only folds `+ - * / % << >> ( )` over number literals (decimal,
 * hex "0x..", and K/M suffixes). Anything else (symbol references,
 * LENGTH(REGION), ORIGIN(REGION), function calls) makes the expression
 * "opaque": we keep the raw source text and leave `value` undefined, per
 * the domain-model contract in model.ts.
 */
import { Expr } from "./model";

export function parseNumberLiteral(text: string): number | undefined {
  let t = text.trim();
  let mult = 1;
  if (/[Kk]$/.test(t)) {
    mult = 1024;
    t = t.slice(0, -1);
  } else if (/[Mm]$/.test(t)) {
    mult = 1024 * 1024;
    t = t.slice(0, -1);
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) {
    return parseInt(t, 16) * mult;
  }
  if (/^[0-9]+(\.[0-9]+)?$/.test(t)) {
    return parseFloat(t) * mult;
  }
  return undefined;
}

/** Recursive-descent evaluator over a restricted token stream slice, used only for MEMORY origin/length and simple address expressions. */
export function evalSimpleArithmetic(raw: string): number | undefined {
  const src = raw.trim();
  let pos = 0;

  function skipWs() {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  function parsePrimary(): number | undefined {
    skipWs();
    if (src[pos] === "(") {
      pos++;
      const v = parseShift();
      skipWs();
      if (src[pos] !== ")") return undefined;
      pos++;
      return v;
    }
    const start = pos;
    if (src[pos] === "-" || src[pos] === "+") {
      const negative = src[pos] === "-";
      pos++;
      const v = parsePrimary();
      return v === undefined ? undefined : negative ? -v : v;
    }
    while (pos < src.length && /[0-9a-fA-FxXKkMm.]/.test(src[pos])) pos++;
    if (pos === start) return undefined;
    const value = parseNumberLiteral(src.slice(start, pos));
    return value !== undefined && Number.isSafeInteger(value) ? value : undefined;
  }

  function parseMul(): number | undefined {
    let left = parsePrimary();
    if (left === undefined) return undefined;
    for (;;) {
      skipWs();
      const op = src[pos];
      if (op === "*" || op === "/" || op === "%") {
        pos++;
        const right = parsePrimary();
        if (right === undefined) return undefined;
        if (right === 0 && op !== "*") return undefined;
        left = op === "*" ? left * right : op === "%" ? left % right : Math.trunc(left / right);
        if (!Number.isSafeInteger(left)) return undefined;
      } else {
        break;
      }
    }
    return left;
  }

  function parseAdd(): number | undefined {
    let left = parseMul();
    if (left === undefined) return undefined;
    for (;;) {
      skipWs();
      const op = src[pos];
      if (op === "+" || op === "-") {
        pos++;
        const right = parseMul();
        if (right === undefined) return undefined;
        left = op === "+" ? left + right : left - right;
        if (!Number.isSafeInteger(left)) return undefined;
      } else {
        break;
      }
    }
    return left;
  }

  // Shifts bind less tightly than addition; avoid JavaScript's signed
  // 32-bit coercion, which corrupts addresses above 0x7fffffff.
  function parseShift(): number | undefined {
    let left = parseAdd();
    if (left === undefined) return undefined;
    for (;;) {
      skipWs();
      if (!src.startsWith("<<", pos) && !src.startsWith(">>", pos)) break;
      const op = src.slice(pos, pos + 2);
      pos += 2;
      const right = parseAdd();
      if (right === undefined || !Number.isInteger(right) || right < 0 || right > 63) return undefined;
      left = op === "<<" ? left * 2 ** right : Math.floor(left / 2 ** right);
      if (!Number.isSafeInteger(left)) return undefined;
    }
    return left;
  }

  const result = parseShift();
  skipWs();
  if (pos !== src.length) return undefined;
  return result !== undefined && Number.isSafeInteger(result) ? result : undefined;
}

export function makeExpr(raw: string): Expr {
  return { raw: raw.trim(), value: evalSimpleArithmetic(raw) };
}
