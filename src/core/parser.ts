/**
 * Recursive-descent parser for GNU ld linker scripts.
 *
 * Scope (documented, not accidental): this implements the common,
 * real-world subset of the ld script grammar -- MEMORY blocks, SECTIONS
 * with input-section patterns/KEEP/ALIGN/symbol assignments/placement
 * clauses, and the usual top-level directives (ENTRY, OUTPUT_FORMAT,
 * OUTPUT_ARCH, INCLUDE, PROVIDE[_HIDDEN], bare assignments). Constructs it
 * doesn't recognize are skipped with a parse-error diagnostic rather than
 * crashing, and files that need the C preprocessor are detected up front
 * (see needsPreprocessor) and should be routed to the Text view instead of
 * parsed at all -- the parser will produce a best-effort, likely-wrong
 * model for them.
 */
import { evalSimpleArithmetic } from "./expr";
import {
  AlignDirective,
  Diagnostic,
  EntryDirective,
  Expr,
  IncludeDirective,
  InputSectionPattern,
  LinkerScript,
  MemoryBlock,
  MemoryRegion,
  OutputArchDirective,
  OutputFormatDirective,
  OutputSection,
  PlacementClause,
  SectionBodyStatement,
  SectionsBlock,
  SymbolAssignment,
  TopLevelAssignment,
} from "./model";
import { Token, tokenize } from "./tokenizer";

export interface ParseResult {
  script: LinkerScript;
  diagnostics: Diagnostic[];
}

const PREPROCESSOR_LINE = /^[ \t]*#[ \t]*(include|define|if|ifdef|ifndef|elif|else|endif|pragma|undef)\b/;

export function detectNeedsPreprocessor(source: string): boolean {
  const lines = source.split(/\r\n|\n/);
  let inBlockComment = false;
  for (const line of lines) {
    let text = line;
    if (inBlockComment) {
      const end = text.indexOf("*/");
      if (end === -1) continue;
      text = text.slice(end + 2);
      inBlockComment = false;
    }
    // Strip any block comments that start and end on this line, repeatedly.
    for (;;) {
      const start = text.indexOf("/*");
      if (start === -1) break;
      const end = text.indexOf("*/", start + 2);
      if (end === -1) {
        text = text.slice(0, start);
        inBlockComment = true;
        break;
      }
      text = text.slice(0, start) + text.slice(end + 2);
    }
    if (PREPROCESSOR_LINE.test(text)) return true;
  }
  return false;
}

const ORIGIN_KEYS = new Set(["ORIGIN", "ORG", "O"]);
const LENGTH_KEYS = new Set(["LENGTH", "LEN", "L"]);

function extractLeadingComments(trivia: string): string[] {
  const comments: string[] = [];
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trivia))) {
    comments.push(m[0].trim());
  }
  return comments;
}

class Cursor {
  constructor(
    public readonly tokens: Token[],
    public readonly source: string,
    public i: number = 0,
  ) {}

  peek(offset = 0): Token {
    const idx = this.i + offset;
    return this.tokens[Math.min(idx, this.tokens.length - 1)];
  }

  at(kind: Token["kind"], text?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (text !== undefined && t.text !== text) return false;
    return true;
  }

  atIdent(...names: string[]): boolean {
    const t = this.peek();
    return t.kind === "ident" && names.includes(t.text.toUpperCase());
  }

  advance(): Token {
    const t = this.tokens[this.i];
    if (this.i < this.tokens.length - 1) this.i++;
    return t;
  }

  /** Finds the index of the token that matches the '(' or '{' at `openIdx`. Returns -1 if unmatched. */
  findMatching(openIdx: number): number {
    const open = this.tokens[openIdx].text;
    const close = open === "(" ? ")" : open === "{" ? "}" : undefined;
    if (!close) return -1;
    let depth = 0;
    for (let j = openIdx; j < this.tokens.length; j++) {
      const t = this.tokens[j];
      if (t.kind === "eof") return -1;
      if (t.text === open) depth++;
      else if (t.text === close) {
        depth--;
        if (depth === 0) return j;
      }
    }
    return -1;
  }
}

export function parseLinkerScript(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const needsPreprocessor = detectNeedsPreprocessor(source);

  const script: LinkerScript = {
    sourceText: source,
    entry: undefined,
    outputFormat: undefined,
    outputArch: undefined,
    includes: [],
    memory: undefined,
    sections: undefined,
    topLevelAssignments: [],
    needsPreprocessor,
  };

  if (needsPreprocessor) {
    diagnostics.push({
      severity: "warning",
      message:
        "This file appears to use C-preprocessor directives (#include/#define/#if) and is not valid ld syntax until preprocessed. Showing Text view only.",
      span: undefined,
      code: "needs-preprocessor",
    });
    return { script, diagnostics };
  }

  const tokens = tokenize(source);
  const cur = new Cursor(tokens, source);

  while (!cur.at("eof")) {
    const t = cur.peek();
    try {
      if (cur.atIdent("MEMORY")) {
        script.memory = parseMemoryBlock(cur, diagnostics);
      } else if (cur.atIdent("SECTIONS")) {
        script.sections = parseSectionsBlock(cur, diagnostics, script.topLevelAssignments);
      } else if (cur.atIdent("ENTRY")) {
        script.entry = parseEntry(cur);
      } else if (cur.atIdent("OUTPUT_FORMAT")) {
        script.outputFormat = parseOutputFormat(cur);
      } else if (cur.atIdent("OUTPUT_ARCH")) {
        script.outputArch = parseOutputArch(cur);
      } else if (cur.atIdent("INCLUDE")) {
        script.includes.push(parseInclude(cur));
      } else if (cur.atIdent("PROVIDE", "PROVIDE_HIDDEN")) {
        script.topLevelAssignments.push(parseProvide(cur));
      } else if (t.kind === "ident" && (cur.peek(1).text === "=" || cur.peek(1).text === "+=" || cur.peek(1).text === "-=")) {
        script.topLevelAssignments.push(parseAssignment(cur));
      } else if (t.kind === "eof") {
        break;
      } else {
        diagnostics.push({
          severity: "error",
          message: `Unexpected token "${t.text}" at top level.`,
          span: { start: t.start, end: t.end },
          code: "parse-error",
        });
        cur.advance();
      }
    } catch (e) {
      diagnostics.push({
        severity: "error",
        message: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
        span: { start: t.start, end: t.end },
        code: "parse-error",
      });
      cur.advance();
    }
  }

  return { script, diagnostics };
}

function expectPunct(cur: Cursor, text: string, diagnostics: Diagnostic[]): void {
  if (!cur.at("punct", text) && !cur.at("op", text)) {
    const t = cur.peek();
    diagnostics.push({
      severity: "error",
      message: `Expected "${text}" but found "${t.text || "<eof>"}".`,
      span: { start: t.start, end: t.end },
      code: "parse-error",
    });
    return;
  }
  cur.advance();
}

function makeExprFromRaw(raw: string): Expr {
  return { raw: raw.trim(), value: evalSimpleArithmetic(raw) };
}

// Restricted expression grammar for MEMORY origin/length values: literals,
// arithmetic/shift operators, parens, and ORIGIN(name)/LENGTH(name)
// references. Stops as soon as the grammar no longer matches, so a
// following region declaration is never swallowed.
function parseMemoryExpr(cur: Cursor, diagnostics: Diagnostic[]): Expr {
  const startTok = cur.peek();
  let lastConsumedEnd = startTok.start;
  let consumedAny = false;

  function primary(): boolean {
    const t = cur.peek();
    if (t.kind === "op" && t.text === "-") {
      cur.advance();
      return primary();
    }
    if (t.kind === "punct" && t.text === "(") {
      const openIdx = cur.i;
      const closeIdx = cur.findMatching(openIdx);
      if (closeIdx === -1) return false;
      cur.i = openIdx;
      cur.advance();
      if (!additive()) return false;
      if (!cur.at("punct", ")")) return false;
      lastConsumedEnd = cur.peek().end;
      cur.advance();
      return true;
    }
    if (t.kind === "number") {
      lastConsumedEnd = t.end;
      cur.advance();
      return true;
    }
    if (t.kind === "ident" && (ORIGIN_KEYS.has(t.text.toUpperCase()) || LENGTH_KEYS.has(t.text.toUpperCase())) && cur.peek(1).text === "(") {
      cur.advance();
      const openIdx = cur.i;
      const closeIdx = cur.findMatching(openIdx);
      if (closeIdx === -1) return false;
      lastConsumedEnd = cur.tokens[closeIdx].end;
      cur.i = closeIdx + 1;
      return true;
    }
    return false;
  }

  function term(): boolean {
    if (!primary()) return false;
    for (;;) {
      const t = cur.peek();
      if (t.kind === "op" && (t.text === "*" || t.text === "/" || t.text === "<<" || t.text === ">>")) {
        cur.advance();
        if (!primary()) return false;
      } else {
        break;
      }
    }
    return true;
  }

  function additive(): boolean {
    if (!term()) return false;
    for (;;) {
      const t = cur.peek();
      if (t.kind === "op" && (t.text === "+" || t.text === "-")) {
        cur.advance();
        if (!term()) return false;
      } else {
        break;
      }
    }
    return true;
  }

  consumedAny = additive();
  if (!consumedAny) {
    const t = cur.peek();
    diagnostics.push({
      severity: "error",
      message: `Expected a numeric expression but found "${t.text || "<eof>"}".`,
      span: { start: t.start, end: t.end },
      code: "parse-error",
    });
    return { raw: "", value: undefined };
  }
  const raw = cur.source.slice(startTok.start, lastConsumedEnd);
  return makeExprFromRaw(raw);
}

function parseMemoryBlock(cur: Cursor, diagnostics: Diagnostic[]): MemoryBlock {
  const blockStart = cur.peek().start;
  cur.advance(); // MEMORY
  expectPunct(cur, "{", diagnostics);
  const regions: MemoryRegion[] = [];

  while (!cur.at("punct", "}") && !cur.at("eof")) {
    const nameTok = cur.peek();
    const leadingComments = extractLeadingComments(nameTok.leadingTrivia);
    if (nameTok.kind !== "ident") {
      diagnostics.push({
        severity: "error",
        message: `Expected a memory region name but found "${nameTok.text || "<eof>"}".`,
        span: { start: nameTok.start, end: nameTok.end },
        code: "parse-error",
      });
      cur.advance();
      continue;
    }
    const regionStart = nameTok.start;
    cur.advance();

    let attributes = "";
    if (cur.at("punct", "(")) {
      const openIdx = cur.i;
      const closeIdx = cur.findMatching(openIdx);
      if (closeIdx === -1) {
        diagnostics.push({ severity: "error", message: "Unterminated memory region attribute list.", span: { start: nameTok.start, end: nameTok.end }, code: "parse-error" });
        break;
      }
      attributes = cur.source.slice(cur.tokens[openIdx].end, cur.tokens[closeIdx].start).trim();
      cur.i = closeIdx + 1;
    }

    expectPunct(cur, ":", diagnostics);

    let origin: Expr = { raw: "", value: undefined };
    let length: Expr = { raw: "", value: undefined };
    let sawOrigin = false;
    let sawLength = false;

    for (let attrCount = 0; attrCount < 2; attrCount++) {
      const keyTok = cur.peek();
      if (keyTok.kind !== "ident") break;
      const key = keyTok.text.toUpperCase();
      if (ORIGIN_KEYS.has(key)) {
        cur.advance();
        expectPunct(cur, "=", diagnostics);
        origin = parseMemoryExpr(cur, diagnostics);
        sawOrigin = true;
      } else if (LENGTH_KEYS.has(key)) {
        cur.advance();
        expectPunct(cur, "=", diagnostics);
        length = parseMemoryExpr(cur, diagnostics);
        sawLength = true;
      } else {
        break;
      }
      if (cur.at("punct", ",")) {
        cur.advance();
      } else {
        break;
      }
    }

    if (!sawOrigin || !sawLength) {
      diagnostics.push({
        severity: "error",
        message: `Memory region "${nameTok.text}" is missing ${!sawOrigin ? "ORIGIN" : "LENGTH"}.`,
        span: { start: regionStart, end: cur.peek().start },
        code: "missing-origin-or-length",
      });
    }

    const regionEnd = cur.peek().start; // start of next token (next region name or '}')
    regions.push({
      name: nameTok.text,
      attributes,
      origin,
      length,
      span: { start: regionStart, end: regionEnd },
      leadingComments,
    });
  }

  const blockEndTok = cur.peek();
  expectPunct(cur, "}", diagnostics);
  return { regions, span: { start: blockStart, end: blockEndTok.end } };
}

function captureExprUntil(cur: Cursor, stopPuncts: string[]): Expr {
  const startTok = cur.peek();
  let depth = 0;
  let lastEnd = startTok.start;
  while (!cur.at("eof")) {
    const t = cur.peek();
    if (depth === 0 && t.kind === "punct" && stopPuncts.includes(t.text)) break;
    if (t.kind === "punct" && (t.text === "(" || t.text === "{")) depth++;
    if (t.kind === "punct" && (t.text === ")" || t.text === "}")) {
      if (depth === 0) break;
      depth--;
    }
    lastEnd = t.end;
    cur.advance();
  }
  return makeExprFromRaw(cur.source.slice(startTok.start, lastEnd));
}

function parseSectionsBlock(cur: Cursor, diagnostics: Diagnostic[], topLevelAssignments: TopLevelAssignment[]): SectionsBlock {
  const blockStart = cur.peek().start;
  cur.advance(); // SECTIONS
  expectPunct(cur, "{", diagnostics);
  const sections: OutputSection[] = [];

  while (!cur.at("punct", "}") && !cur.at("eof")) {
    const t = cur.peek();
    const opAhead = cur.peek(1).text;
    if (t.kind === "ident" && (t.text === "PROVIDE" || t.text === "PROVIDE_HIDDEN")) {
      topLevelAssignments.push(parseProvide(cur));
      continue;
    }
    // A bare/location-counter assignment directly inside SECTIONS (e.g.
    // "_stack_size = 0x2000;" or ". = 0x1000;"), as opposed to an output
    // section declaration (which is followed by an optional address, then
    // ':'). Disambiguated by lookahead: assignments are followed by an
    // assignment operator, section declarations are not.
    if ((t.kind === "ident" || (t.kind === "op" && t.text === ".")) && (opAhead === "=" || opAhead === "+=" || opAhead === "-=")) {
      topLevelAssignments.push(parseAssignment(cur));
      continue;
    }
    if (t.kind === "ident" || t.kind === "string") {
      sections.push(parseOutputSection(cur, diagnostics));
      continue;
    }
    if (t.kind === "eof") break;
    diagnostics.push({
      severity: "error",
      message: `Unexpected token "${t.text}" inside SECTIONS.`,
      span: { start: t.start, end: t.end },
      code: "parse-error",
    });
    cur.advance();
  }

  const endTok = cur.peek();
  expectPunct(cur, "}", diagnostics);
  return { sections, span: { start: blockStart, end: endTok.end } };
}

function parseOutputSection(cur: Cursor, diagnostics: Diagnostic[]): OutputSection {
  const nameTok = cur.peek();
  const leadingComments = extractLeadingComments(nameTok.leadingTrivia);
  const sectionStart = nameTok.start;
  cur.advance();

  let address: Expr | undefined;
  if (!cur.at("punct", ":")) {
    address = captureExprUntil(cur, [":"]);
  }
  expectPunct(cur, ":", diagnostics);

  let lmaAddress: Expr | undefined;
  // Optional AT(lma) / ALIGN(...) / SUBALIGN(...) clauses before the body brace.
  while (cur.at("ident") && cur.peek(1).text === "(" && !cur.at("punct", "{")) {
    const kw = cur.peek().text.toUpperCase();
    const openIdx = cur.i + 1;
    const closeIdx = cur.findMatching(openIdx);
    if (closeIdx === -1) break;
    if (kw === "AT") {
      const inner = cur.source.slice(cur.tokens[openIdx].end, cur.tokens[closeIdx].start);
      lmaAddress = makeExprFromRaw(inner);
    }
    cur.i = closeIdx + 1;
  }

  expectPunct(cur, "{", diagnostics);
  const body: SectionBodyStatement[] = [];
  while (!cur.at("punct", "}") && !cur.at("eof")) {
    body.push(parseSectionBodyStatement(cur, diagnostics));
  }
  expectPunct(cur, "}", diagnostics);

  const placement = parsePlacementClause(cur, lmaAddress);

  if (cur.at("punct", ";")) cur.advance();

  const sectionEnd = cur.peek().start;
  return {
    name: nameTok.text,
    address,
    body,
    placement,
    span: { start: sectionStart, end: sectionEnd },
    leadingComments,
  };
}

function parsePlacementClause(cur: Cursor, lmaAddress: Expr | undefined): PlacementClause {
  let vmaRegion: string | undefined;
  let lmaRegion: string | undefined;

  for (;;) {
    if (cur.at("op", ">")) {
      cur.advance();
      if (cur.at("ident")) {
        vmaRegion = cur.peek().text;
        cur.advance();
      }
      continue;
    }
    if (cur.at("ident", "AT") && cur.peek(1).text === ">") {
      cur.advance(); // AT
      cur.advance(); // >
      if (cur.at("ident")) {
        lmaRegion = cur.peek().text;
        cur.advance();
      }
      continue;
    }
    if (cur.at("punct", ":") && cur.peek(1).kind === "ident") {
      // PHDR assignment, e.g. ":text". We don't model program headers; skip.
      cur.advance();
      cur.advance();
      continue;
    }
    if (cur.at("op", "=")) {
      // Fill expression, e.g. "= 0xff". Skip up to the next placement token or ';'.
      cur.advance();
      while (!cur.at("eof") && !cur.at("punct", ";") && !cur.at("op", ">") && !(cur.at("ident", "AT") && cur.peek(1).text === ">")) {
        cur.advance();
      }
      continue;
    }
    break;
  }

  return { vmaRegion, lmaRegion, lmaAddress };
}

function parseSectionBodyStatement(cur: Cursor, diagnostics: Diagnostic[]): SectionBodyStatement {
  const t = cur.peek();
  const start = t.start;

  if (t.kind === "ident" && t.text === "KEEP" && cur.peek(1).text === "(") {
    cur.advance(); // KEEP
    const openIdx = cur.i;
    const closeIdx = cur.findMatching(openIdx);
    cur.advance(); // (
    const pattern = parseInputSectionPattern(cur, diagnostics, true);
    if (closeIdx !== -1) cur.i = closeIdx + 1;
    if (cur.at("punct", ";")) cur.advance();
    return { ...pattern, span: { start, end: cur.peek().start } };
  }

  if (t.kind === "ident" && (t.text === "PROVIDE" || t.text === "PROVIDE_HIDDEN")) {
    const provide = t.text === "PROVIDE" ? "provide" : "provide-hidden";
    cur.advance();
    const openIdx = cur.i;
    const closeIdx = cur.findMatching(openIdx);
    cur.advance(); // (
    const nameTok = cur.peek();
    cur.advance();
    expectPunct(cur, "=", diagnostics);
    const value = captureExprUntil(cur, [")"]);
    if (closeIdx !== -1) cur.i = closeIdx + 1;
    if (cur.at("punct", ";")) cur.advance();
    return {
      kind: "symbol-assignment",
      name: nameTok.text,
      operator: "=",
      value,
      provide,
      span: { start, end: cur.peek().start },
    } satisfies SymbolAssignment;
  }

  // Input-section pattern: some token sequence followed by '(' before any '=' or ';' at depth 0.
  if (looksLikeInputSectionPattern(cur)) {
    const pattern = parseInputSectionPattern(cur, diagnostics, false);
    if (cur.at("punct", ";")) cur.advance();
    return { ...pattern, span: { start, end: cur.peek().start } };
  }

  // Otherwise: location-counter or symbol assignment, e.g. ". = ALIGN(4);" or "_end = .;"
  if (t.kind === "ident" || (t.kind === "op" && t.text === ".")) {
    const nameTok = t;
    cur.advance();
    const opTok = cur.peek();
    let operator: "=" | "+=" | "-=" = "=";
    if (opTok.text === "=" || opTok.text === "+=" || opTok.text === "-=") {
      operator = opTok.text as "=" | "+=" | "-=";
      cur.advance();
    } else {
      diagnostics.push({
        severity: "error",
        message: `Expected "=" after "${nameTok.text}" but found "${opTok.text || "<eof>"}".`,
        span: { start: opTok.start, end: opTok.end },
        code: "parse-error",
      });
    }
    const value = captureExprUntil(cur, [";"]);
    if (cur.at("punct", ";")) cur.advance();
    const isAlign = nameTok.text === "." && operator === "=" && /^ALIGN\s*\(/i.test(value.raw);
    if (isAlign) {
      return {
        kind: "align",
        raw: `. = ${value.raw};`,
        span: { start, end: cur.peek().start },
      } satisfies AlignDirective;
    }
    return {
      kind: "symbol-assignment",
      name: nameTok.text,
      operator,
      value,
      provide: "none",
      span: { start, end: cur.peek().start },
    } satisfies SymbolAssignment;
  }

  diagnostics.push({
    severity: "error",
    message: `Unexpected token "${t.text}" inside output section body.`,
    span: { start: t.start, end: t.end },
    code: "parse-error",
  });
  cur.advance();
  return {
    kind: "align",
    raw: "",
    span: { start, end: cur.peek().start },
  };
}

function looksLikeInputSectionPattern(cur: Cursor): boolean {
  // Scan forward from the current position for a top-level '(' before hitting
  // '=', ';', or '}'. If found, and the tokens between here and there are all
  // "file-glob-shaped" (idents/wildcards/dots, no '='), treat it as an
  // input-section pattern rather than a symbol assignment.
  let j = cur.i;
  let depth = 0;
  for (; j < cur.tokens.length; j++) {
    const t = cur.tokens[j];
    if (t.kind === "eof") return false;
    if (depth === 0) {
      if (t.text === "(") return true;
      if (t.text === "=" || t.text === "+=" || t.text === "-=" || t.text === ";" || t.text === "}") return false;
    }
    if (t.text === "(") depth++;
    if (t.text === ")") depth = Math.max(0, depth - 1);
  }
  return false;
}

function parseInputSectionPattern(cur: Cursor, diagnostics: Diagnostic[], keep: boolean): InputSectionPattern {
  const start = cur.peek().start;
  const fileGlobStart = cur.i;
  while (!cur.at("eof") && !cur.at("punct", "(")) {
    cur.advance();
  }
  const fileGlob = cur.source.slice(cur.tokens[fileGlobStart].start, cur.peek().start).trim();

  let sectionGlobs: string[] = [];
  if (cur.at("punct", "(")) {
    const openIdx = cur.i;
    const closeIdx = cur.findMatching(openIdx);
    if (closeIdx === -1) {
      diagnostics.push({
        severity: "error",
        message: "Unterminated input-section pattern.",
        span: { start, end: cur.peek().end },
        code: "parse-error",
      });
    } else {
      const inner = cur.source.slice(cur.tokens[openIdx].end, cur.tokens[closeIdx].start).trim();
      sectionGlobs = inner.length ? inner.split(/\s+/) : [];
      cur.i = closeIdx + 1;
    }
  }

  return {
    kind: "input-section",
    fileGlob,
    sectionGlobs,
    keep,
    span: { start, end: cur.peek().start },
  };
}

function parseEntry(cur: Cursor): EntryDirective {
  const start = cur.peek().start;
  cur.advance(); // ENTRY
  let symbol = "";
  if (cur.at("punct", "(")) {
    cur.advance();
    if (cur.at("ident")) {
      symbol = cur.peek().text;
      cur.advance();
    }
    if (cur.at("punct", ")")) cur.advance();
  }
  if (cur.at("punct", ";")) cur.advance();
  return { kind: "entry", symbol, span: { start, end: cur.peek().start } };
}

function parseOutputFormat(cur: Cursor): OutputFormatDirective {
  const start = cur.peek().start;
  cur.advance(); // OUTPUT_FORMAT
  const args: string[] = [];
  if (cur.at("punct", "(")) {
    cur.advance();
    while (!cur.at("punct", ")") && !cur.at("eof")) {
      const t = cur.peek();
      if (t.kind === "string") args.push(t.text.slice(1, -1));
      else if (t.kind === "ident") args.push(t.text);
      cur.advance();
      if (cur.at("punct", ",")) cur.advance();
    }
    if (cur.at("punct", ")")) cur.advance();
  }
  if (cur.at("punct", ";")) cur.advance();
  return { kind: "output-format", args, span: { start, end: cur.peek().start } };
}

function parseOutputArch(cur: Cursor): OutputArchDirective {
  const start = cur.peek().start;
  cur.advance(); // OUTPUT_ARCH
  let arch = "";
  if (cur.at("punct", "(")) {
    cur.advance();
    if (cur.at("ident")) {
      arch = cur.peek().text;
      cur.advance();
    } else if (cur.at("string")) {
      arch = cur.peek().text.slice(1, -1);
      cur.advance();
    }
    if (cur.at("punct", ")")) cur.advance();
  }
  if (cur.at("punct", ";")) cur.advance();
  return { kind: "output-arch", arch, span: { start, end: cur.peek().start } };
}

function parseInclude(cur: Cursor): IncludeDirective {
  const start = cur.peek().start;
  cur.advance(); // INCLUDE
  let path = "";
  const t = cur.peek();
  if (t.kind === "string") {
    path = t.text.slice(1, -1);
    cur.advance();
  } else if (t.kind === "ident") {
    path = t.text;
    cur.advance();
  }
  if (cur.at("punct", ";")) cur.advance();
  return { kind: "include", path, span: { start, end: cur.peek().start } };
}

function parseProvide(cur: Cursor): TopLevelAssignment {
  const start = cur.peek().start;
  const leadingComments = extractLeadingComments(cur.peek().leadingTrivia);
  const provide = cur.peek().text === "PROVIDE" ? "provide" : "provide-hidden";
  cur.advance();
  let name = "";
  let value: Expr = { raw: "", value: undefined };
  if (cur.at("punct", "(")) {
    cur.advance();
    if (cur.at("ident")) {
      name = cur.peek().text;
      cur.advance();
    }
    if (cur.at("op", "=")) cur.advance();
    value = captureExprUntil(cur, [")"]);
    if (cur.at("punct", ")")) cur.advance();
  }
  if (cur.at("punct", ";")) cur.advance();
  return { kind: "assignment", name, operator: "=", value, provide, span: { start, end: cur.peek().start }, leadingComments };
}

function parseAssignment(cur: Cursor): TopLevelAssignment {
  const start = cur.peek().start;
  const leadingComments = extractLeadingComments(cur.peek().leadingTrivia);
  const nameTok = cur.peek();
  cur.advance();
  const opTok = cur.peek();
  const operator = (opTok.text === "+=" || opTok.text === "-=" ? opTok.text : "=") as "=" | "+=" | "-=";
  cur.advance();
  const value = captureExprUntil(cur, [";"]);
  if (cur.at("punct", ";")) cur.advance();
  return {
    kind: "assignment",
    name: nameTok.text,
    operator,
    value,
    provide: "none",
    span: { start, end: cur.peek().start },
    leadingComments,
  };
}
