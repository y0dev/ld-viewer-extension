/**
 * Text serialization for the linker-script model.
 *
 * Round-trip strategy (span-splice, not full regeneration): the parser
 * records the exact source span of every top-level construct. Editing a
 * document never re-prints the whole file from the model -- it computes a
 * small set of TextEdit splices (see edits.ts) against the ORIGINAL source
 * text and applies them with `applyTextEdits`. Anything outside an edited
 * node's span -- comments, blank-line grouping, unrelated sections/regions,
 * indentation style elsewhere in the file -- survives byte-for-byte.
 *
 * The explicit tradeoff: a node that IS edited has its own span fully
 * replaced by canonical pretty-printed text, so that node's internal
 * comments/formatting are not preserved (its structured fields are re-
 * printed from scratch). A newly added region/section is appended using the
 * same canonical formatting with no comment. The Text view is the escape
 * hatch either way -- nothing is only editable through this lossy path.
 */
import { Expr, MemoryRegion, OutputSection, SectionBodyStatement, TextEdit } from "./model";

export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.span.start - b.span.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].span.start < sorted[i - 1].span.end) {
      throw new Error("Overlapping text edits.");
    }
  }
  let out = "";
  let cursor = 0;
  for (const edit of sorted) {
    out += source.slice(cursor, edit.span.start);
    out += edit.newText;
    cursor = edit.span.end;
  }
  out += source.slice(cursor);
  return out;
}

function printExpr(e: Expr): string {
  return e.raw;
}

export interface MemoryRegionInput {
  name: string;
  attributes: string;
  origin: string;
  length: string;
}

/** Prints a single MEMORY region declaration line, indented for insertion inside a MEMORY { } block. */
export function printMemoryRegion(r: MemoryRegionInput, indent = "  "): string {
  return `${indent}${r.name} (${r.attributes}) : ORIGIN = ${r.origin}, LENGTH = ${r.length}`;
}

export function printMemoryRegionFromModel(r: MemoryRegion, indent = "  "): string {
  return printMemoryRegion({ name: r.name, attributes: r.attributes, origin: printExpr(r.origin), length: printExpr(r.length) }, indent);
}

function printSectionBodyStatement(s: SectionBodyStatement, indent: string): string {
  if (s.kind === "input-section") {
    const pat = `${s.fileGlob}(${s.sectionGlobs.join(" ")})`;
    return `${indent}${s.keep ? `KEEP(${pat})` : pat}`;
  }
  if (s.kind === "align") {
    return `${indent}${s.raw}`;
  }
  // symbol-assignment
  const lhs = s.provide === "provide" ? `PROVIDE(${s.name} = ${printExpr(s.value)})` : s.provide === "provide-hidden" ? `PROVIDE_HIDDEN(${s.name} = ${printExpr(s.value)})` : `${s.name} ${s.operator} ${printExpr(s.value)}`;
  return `${indent}${lhs};`;
}

export interface OutputSectionInput {
  name: string;
  address?: string;
  body: SectionBodyStatement[];
  vmaRegion?: string;
  lmaRegion?: string;
  lmaAddress?: string;
}

export function printOutputSection(s: OutputSectionInput, indent = "  ", bodyIndent = "    "): string {
  const lines: string[] = [];
  const addr = s.address ? `${s.address} ` : "";
  const at = s.lmaAddress ? ` AT(${s.lmaAddress})` : "";
  lines.push(`${indent}${s.name} ${addr}:${at}`);
  lines.push(`${indent}{`);
  for (const stmt of s.body) {
    lines.push(printSectionBodyStatement(stmt, bodyIndent));
  }
  let closing = `${indent}}`;
  if (s.vmaRegion) closing += ` > ${s.vmaRegion}`;
  if (s.lmaRegion) closing += ` AT> ${s.lmaRegion}`;
  lines.push(closing + ";");
  return lines.join("\n");
}

export function printOutputSectionFromModel(s: OutputSection, indent = "  ", bodyIndent = "    "): string {
  return printOutputSection(
    {
      name: s.name,
      address: s.address ? printExpr(s.address) : undefined,
      body: s.body,
      vmaRegion: s.placement.vmaRegion,
      lmaRegion: s.placement.lmaRegion,
      lmaAddress: s.placement.lmaAddress ? printExpr(s.placement.lmaAddress) : undefined,
    },
    indent,
    bodyIndent,
  );
}
