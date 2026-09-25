/**
 * Pure data model for a GNU ld linker script. No vscode/Node imports allowed
 * in this folder (enforced by tsconfig.core.json, which excludes their type
 * libs) so the parser/serializer stay usable from plain Node tests and any
 * future webview context.
 */

/** Byte offset range in the original source text, end-exclusive. */
export interface Span {
  start: number;
  end: number;
}

/**
 * A numeric-ish expression (ORIGIN/LENGTH values, ALIGN() args, address
 * expressions, etc). We evaluate simple arithmetic over literals so the
 * Studio view can render addresses/sizes numerically, but anything that
 * isn't a closed-form literal expression (symbol references, LENGTH(X),
 * calls we don't model) is kept as an opaque `raw` string with `value`
 * left undefined. We never execute code to get here -- just arithmetic
 * over numeric literals.
 */
export interface Expr {
  raw: string;
  value: number | undefined;
}

export type MemoryAttrFlag = "r" | "w" | "x" | "a" | "l" | "!";

export interface MemoryRegion {
  name: string;
  /** Raw attribute string as written, e.g. "rwx" or "rx!w". */
  attributes: string;
  origin: Expr;
  length: Expr;
  span: Span;
  /** Comment lines immediately preceding this region, verbatim (with markers). */
  leadingComments: string[];
}

export interface InputSectionPattern {
  kind: "input-section";
  /** File glob, e.g. "*" or "*crt0.o". Empty string means unspecified. */
  fileGlob: string;
  /** Section name patterns inside the parens, e.g. [".text", ".text.*"]. */
  sectionGlobs: string[];
  keep: boolean;
  span: Span;
}

export interface AlignDirective {
  kind: "align";
  /** The full ". = ALIGN(expr);" style statement, kept verbatim for edit-free round trip. */
  raw: string;
  span: Span;
}

export interface SymbolAssignment {
  kind: "symbol-assignment";
  name: string;
  operator: "=" | "+=" | "-=";
  value: Expr;
  provide: "none" | "provide" | "provide-hidden";
  span: Span;
}

export type SectionBodyStatement = InputSectionPattern | AlignDirective | SymbolAssignment;

export interface PlacementClause {
  /** ">REGION" (VMA). */
  vmaRegion: string | undefined;
  /** "AT>REGION" (LMA via region) or "AT(addr)" (explicit LMA). Mutually exclusive in practice. */
  lmaRegion: string | undefined;
  lmaAddress: Expr | undefined;
}

export interface OutputSection {
  name: string;
  /** Optional explicit load/VMA address expression before the colon. */
  address: Expr | undefined;
  body: SectionBodyStatement[];
  placement: PlacementClause;
  span: Span;
  leadingComments: string[];
}

export interface EntryDirective {
  kind: "entry";
  symbol: string;
  span: Span;
}

export interface OutputFormatDirective {
  kind: "output-format";
  /** Raw comma-separated argument list, e.g. ["elf32-littlearm"] or default/big/little variants. */
  args: string[];
  span: Span;
}

export interface OutputArchDirective {
  kind: "output-arch";
  arch: string;
  span: Span;
}

export interface IncludeDirective {
  kind: "include";
  path: string;
  span: Span;
  /** Populated by the host after resolving relative to the containing file. */
  resolvedPath?: string;
}

export interface TopLevelAssignment {
  kind: "assignment";
  name: string;
  operator: "=" | "+=" | "-=";
  value: Expr;
  provide: "none" | "provide" | "provide-hidden";
  span: Span;
  leadingComments: string[];
}

export type TopLevelDirective =
  | EntryDirective
  | OutputFormatDirective
  | OutputArchDirective
  | IncludeDirective;

export interface MemoryBlock {
  regions: MemoryRegion[];
  span: Span;
}

export interface SectionsBlock {
  sections: OutputSection[];
  span: Span;
}

export interface LinkerScript {
  /** Full original source text, used for span-splice serialization. */
  sourceText: string;
  entry: EntryDirective | undefined;
  outputFormat: OutputFormatDirective | undefined;
  outputArch: OutputArchDirective | undefined;
  includes: IncludeDirective[];
  memory: MemoryBlock | undefined;
  sections: SectionsBlock | undefined;
  topLevelAssignments: TopLevelAssignment[];
  /** True if the file appears to require C-preprocessor expansion before it is valid ld syntax. */
  needsPreprocessor: boolean;
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  span: Span | undefined;
  code:
    | "undefined-region"
    | "duplicate-region"
    | "missing-origin-or-length"
    | "include-not-found"
    | "parse-error"
    | "needs-preprocessor";
}

/** A single text splice, used to apply edits while preserving unrelated source verbatim. */
export interface TextEdit {
  span: Span;
  newText: string;
}
