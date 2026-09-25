/** Tokenizer for GNU ld linker script syntax. Pure, no vscode/Node imports. */

export type TokenKind =
  | "ident"
  | "number"
  | "string"
  | "punct"
  | "op"
  | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
  /** Comments and blank-line trivia appearing before this token, verbatim source slices. */
  leadingTrivia: string;
}

const PUNCT_CHARS = new Set(["{", "}", "(", ")", ",", ";", ":"]);
// Longest-match-first operator set. GNU ld expressions support a fairly rich
// set of C-like operators; we tokenize them but the expression evaluator
// only handles simple arithmetic (see expr.ts).
const OPERATORS = [
  "<<=", ">>=",
  "==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "+=", "-=", "*=", "/=",
  "=", "+", "-", "*", "/", "%", "&", "|", "^", "~", "!", "<", ">", ".",
];

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_.$\\]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_.$\\]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * Scans from `pos` (assumed to be the start of possible trivia) and returns
 * the index just past all whitespace and comments (/* * / , // , # line
 * comments), so the caller can slice out leadingTrivia and resume tokenizing.
 */
function skipTrivia(src: string, pos: number): number {
  let i = pos;
  for (;;) {
    const ch = src[i];
    if (ch === undefined) return i;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i + 2);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (ch === "#") {
      const end = src.indexOf("\n", i + 1);
      i = end === -1 ? src.length : end;
      continue;
    }
    break;
  }
  return i;
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  for (;;) {
    const triviaStart = i;
    i = skipTrivia(src, i);
    const leadingTrivia = src.slice(triviaStart, i);
    if (i >= src.length) {
      tokens.push({ kind: "eof", text: "", start: i, end: i, leadingTrivia });
      break;
    }
    const start = i;
    const ch = src[i];

    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      const text = src.slice(start, Math.min(j + 1, src.length));
      i = j + 1;
      tokens.push({ kind: "string", text, start, end: i, leadingTrivia });
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i;
      if (src[j] === "0" && (src[j + 1] === "x" || src[j + 1] === "X")) {
        j += 2;
        while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++;
      } else {
        while (j < src.length && isDigit(src[j])) j++;
        if (src[j] === ".") {
          j++;
          while (j < src.length && isDigit(src[j])) j++;
        }
      }
      // ld size suffixes: K/M (kilo/mega), and object-file style suffixes are rare; support K/M.
      if (j < src.length && /[KkMm]/.test(src[j])) j++;
      const text = src.slice(start, j);
      i = j;
      tokens.push({ kind: "number", text, start, end: i, leadingTrivia });
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i;
      while (j < src.length && isIdentPart(src[j])) j++;
      const text = src.slice(start, j);
      i = j;
      tokens.push({ kind: "ident", text, start, end: i, leadingTrivia });
      continue;
    }

    if (PUNCT_CHARS.has(ch)) {
      i++;
      tokens.push({ kind: "punct", text: ch, start, end: i, leadingTrivia });
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      tokens.push({ kind: "op", text: op, start, end: i, leadingTrivia });
      continue;
    }

    // Unknown character: emit as a single-char punct token so the parser can
    // report a clear error instead of the tokenizer silently dropping it.
    i++;
    tokens.push({ kind: "punct", text: ch, start, end: i, leadingTrivia });
  }
  return tokens;
}
