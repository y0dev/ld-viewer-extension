/**
 * Detects the stack/heap size convention a linker script actually uses, so
 * the Studio view can offer one "Stack Size" / "Heap Size" field regardless
 * of which real-world toolchain wrote the file. Two conventions cover the
 * fixtures/examples this extension has actually been tested against:
 *
 * - Xilinx Vitis/SDK: a top-level symbol (`_STACK_SIZE = DEFINED(_STACK_SIZE)
 *   ? _STACK_SIZE : 0x2000;`), referenced from inside a `.stack`/`.heap`
 *   section as `. += _STACK_SIZE;`. The symbol is the editable source of
 *   truth; editing the in-section reference would just break the
 *   indirection.
 * - Microchip SoftConsole/PolarFire SoC: no named symbol at all, just a
 *   literal directly in the section body (`. += 0x2000;`). The section
 *   statement itself is the editable source of truth.
 *
 * A file that uses neither convention (or names its sections something
 * other than .stack/.heap) reports `kind: "not-found"` -- the Studio view
 * shows that plainly rather than guessing.
 */
import { LinkerScript, OutputSection, TextEdit } from "./model";
import { EditError, updateSectionBodyStatementValue, updateTopLevelAssignment } from "./edits";

export type StackHeapKind = "symbol" | "inline" | "not-found";

export interface StackHeapField {
  kind: StackHeapKind;
  /** The editable portion of the value (the ")" side of a DEFINED(...) ? ... : DEFAULT ternary, or the whole expression if there's no such wrapper). */
  currentValueRaw: string;
  currentValueNumeric: number | undefined;
  /** Text to keep before currentValueRaw when writing back (e.g. "DEFINED(_STACK_SIZE) ? _STACK_SIZE : "). Empty if there's no such wrapper. */
  prefix: string;
  /** Which MEMORY region hosts the .stack/.heap section, if one was found. */
  regionName: string | undefined;
  /** Set when kind === "symbol": the top-level assignment name to edit. */
  symbolName?: string;
  /** Set when kind === "inline": which section + body-statement index to edit. */
  sectionName?: string;
  statementIndex?: number;
}

const DEFINED_TERNARY = /^(DEFINED\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*\?\s*\2\s*:\s*)([\s\S]+)$/i;

function splitTernaryDefault(raw: string): { prefix: string; editableValue: string } {
  const m = DEFINED_TERNARY.exec(raw.trim());
  if (m) return { prefix: m[1], editableValue: m[3].trim() };
  return { prefix: "", editableValue: raw.trim() };
}

function parseNumeric(raw: string): number | undefined {
  const t = raw.trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return undefined;
}

function findLocationCounterIncrement(section: OutputSection): { index: number; raw: string } | undefined {
  for (let i = 0; i < section.body.length; i++) {
    const stmt = section.body[i];
    if (stmt.kind === "symbol-assignment" && stmt.name === "." && stmt.operator === "+=") {
      return { index: i, raw: stmt.value.raw };
    }
  }
  return undefined;
}

function detectOne(script: LinkerScript, sectionNamePattern: RegExp, symbolNamePattern: RegExp): StackHeapField {
  const section = script.sections?.sections.find((s) => sectionNamePattern.test(s.name));
  const symbolAssignment = script.topLevelAssignments.find((a) => symbolNamePattern.test(a.name));
  const regionName = section?.placement.vmaRegion;

  const increment = section ? findLocationCounterIncrement(section) : undefined;

  if (increment && symbolAssignment && increment.raw.trim() === symbolAssignment.name) {
    // Xilinx-style: the section references a top-level symbol by name.
    const { prefix, editableValue } = splitTernaryDefault(symbolAssignment.value.raw);
    return {
      kind: "symbol",
      currentValueRaw: editableValue,
      currentValueNumeric: parseNumeric(editableValue),
      prefix,
      regionName,
      symbolName: symbolAssignment.name,
    };
  }

  if (increment) {
    // SoftConsole-style: a literal (or any expression) directly in the section body.
    const { prefix, editableValue } = splitTernaryDefault(increment.raw);
    return {
      kind: "inline",
      currentValueRaw: editableValue,
      currentValueNumeric: parseNumeric(editableValue),
      prefix,
      regionName,
      sectionName: section!.name,
      statementIndex: increment.index,
    };
  }

  if (symbolAssignment) {
    // A sized symbol exists even though we couldn't find where (or whether) a
    // section consumes it -- still useful to expose for editing.
    const { prefix, editableValue } = splitTernaryDefault(symbolAssignment.value.raw);
    return {
      kind: "symbol",
      currentValueRaw: editableValue,
      currentValueNumeric: parseNumeric(editableValue),
      prefix,
      regionName,
      symbolName: symbolAssignment.name,
    };
  }

  return { kind: "not-found", currentValueRaw: "", currentValueNumeric: undefined, prefix: "", regionName: undefined };
}

export interface StackHeapDetection {
  stack: StackHeapField;
  heap: StackHeapField;
}

export function detectStackHeap(script: LinkerScript): StackHeapDetection {
  return {
    stack: detectOne(script, /^\.?stack$/i, /stack.*size|size.*stack/i),
    heap: detectOne(script, /^\.?heap$/i, /heap.*size|size.*heap/i),
  };
}

/** Writes a new value for a field detected by detectStackHeap(), preserving its DEFINED()-ternary wrapper (if any) and whether it lives in a top-level symbol or directly in a section body. */
export function updateStackHeapSize(script: LinkerScript, field: StackHeapField, newValueRaw: string): TextEdit[] {
  const fullValue = `${field.prefix}${newValueRaw.trim()}`;
  if (field.kind === "symbol" && field.symbolName) {
    return updateTopLevelAssignment(script, field.symbolName, fullValue);
  }
  if (field.kind === "inline" && field.sectionName && field.statementIndex !== undefined) {
    return updateSectionBodyStatementValue(script, field.sectionName, field.statementIndex, fullValue);
  }
  throw new EditError("No editable stack/heap size was detected in this script.");
}
