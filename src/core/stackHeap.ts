/**
 * Detects the stack/heap size convention a linker script actually uses, so
 * the Studio view can offer editable fields regardless of which real-world
 * toolchain wrote the file, and regardless of whether there's one stack or
 * several. Two conventions cover the fixtures/examples this extension has
 * actually been tested against:
 *
 * - Xilinx Vitis/SDK: a top-level symbol (`_STACK_SIZE = DEFINED(_STACK_SIZE)
 *   ? _STACK_SIZE : 0x2000;`), referenced from inside a `.stack`/`.heap`
 *   section as `. += _STACK_SIZE;`. The symbol is the editable source of
 *   truth; editing the in-section reference would just break the
 *   indirection.
 * - Microchip SoftConsole/PolarFire SoC: no named symbol at all, just a
 *   literal directly in the section body (`. += 0x2000;`) for a single-core
 *   part -- but PolarFire SoC is multi-hart (E51 + up to four U54s), and its
 *   real-world scripts (see examples/mpfs-ddr-loaded-by-boot-loader.ld)
 *   define a SEPARATE top-level symbol per hart (`STACK_SIZE_E51_APPLICATION`,
 *   `STACK_SIZE_U54_1_APPLICATION`, ...), each referenced by its own
 *   `. += STACK_SIZE_xxx;` inside ONE shared `.stack` section. This module
 *   walks every `. += ` statement in the section, not just the first, so
 *   every hart's stack shows up as its own editable field.
 *
 * A file that uses neither convention (or names its sections something
 * other than .stack/.heap) reports an empty array -- the Studio view shows
 * that plainly rather than guessing.
 */
import { LinkerScript, OutputSection, TextEdit } from "./model";
import { evalSimpleArithmetic } from "./expr";
import { EditError, updateSectionBodyStatementValue, updateTopLevelAssignment } from "./edits";

export type StackHeapKind = "symbol" | "inline";

export interface StackHeapField {
  kind: StackHeapKind;
  /** The symbol name (kind "symbol") or a positional label like "Stack #2" (kind "inline" with more than one field) -- always safe to display as-is. */
  label: string;
  /** The editable portion of the value (the right side of a DEFINED(...) ? ... : DEFAULT ternary, or the whole expression if there's no such wrapper). */
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

/** Reuses the same restricted, non-executing arithmetic evaluator as MEMORY ORIGIN/LENGTH -- handles hex, decimal, and the "0k"/"8k"/"1M" size-suffix literals real scripts (e.g. PolarFire SoC's HEAP_SIZE = 8k;) actually use, which a bare hex/decimal regex would miss. */
function parseNumeric(raw: string): number | undefined {
  return evalSimpleArithmetic(raw);
}

function findAllLocationCounterIncrements(section: OutputSection): { index: number; raw: string }[] {
  const out: { index: number; raw: string }[] = [];
  for (let i = 0; i < section.body.length; i++) {
    const stmt = section.body[i];
    if (stmt.kind === "symbol-assignment" && stmt.name === "." && stmt.operator === "+=") {
      out.push({ index: i, raw: stmt.value.raw });
    }
  }
  return out;
}

function detectAll(script: LinkerScript, sectionNamePattern: RegExp, symbolNamePattern: RegExp, fallbackLabel: string): StackHeapField[] {
  const section = script.sections?.sections.find((s) => sectionNamePattern.test(s.name));
  const regionName = section?.placement.vmaRegion;
  const increments = section ? findAllLocationCounterIncrements(section) : [];

  if (increments.length > 0) {
    return increments.map((inc, i): StackHeapField => {
      const referencedName = inc.raw.trim();
      const symbolAssignment = script.topLevelAssignments.find((a) => a.name === referencedName);
      if (symbolAssignment) {
        // Xilinx/PolarFire-multi-hart-style: this increment references a top-level symbol by name.
        const { prefix, editableValue } = splitTernaryDefault(symbolAssignment.value.raw);
        return {
          kind: "symbol",
          label: symbolAssignment.name,
          currentValueRaw: editableValue,
          currentValueNumeric: parseNumeric(editableValue),
          prefix,
          regionName,
          symbolName: symbolAssignment.name,
        };
      }
      // SoftConsole-style: a literal (or any expression) directly in the section body.
      const { prefix, editableValue } = splitTernaryDefault(inc.raw);
      return {
        kind: "inline",
        label: increments.length > 1 ? `${fallbackLabel} #${i + 1}` : fallbackLabel,
        currentValueRaw: editableValue,
        currentValueNumeric: parseNumeric(editableValue),
        prefix,
        regionName,
        sectionName: section!.name,
        statementIndex: inc.index,
      };
    });
  }

  // No section (or a section with no ". += " statements) -- fall back to any
  // top-level symbol that looks like a size, still useful to expose even
  // without knowing where (or whether) a section consumes it.
  const symbolAssignment = script.topLevelAssignments.find((a) => symbolNamePattern.test(a.name));
  if (symbolAssignment) {
    const { prefix, editableValue } = splitTernaryDefault(symbolAssignment.value.raw);
    return [
      {
        kind: "symbol",
        label: symbolAssignment.name,
        currentValueRaw: editableValue,
        currentValueNumeric: parseNumeric(editableValue),
        prefix,
        regionName: undefined,
        symbolName: symbolAssignment.name,
      },
    ];
  }

  return [];
}

export interface StackHeapDetection {
  stack: StackHeapField[];
  heap: StackHeapField[];
}

export function detectStackHeap(script: LinkerScript): StackHeapDetection {
  return {
    stack: detectAll(script, /^\.?stack$/i, /stack.*size|size.*stack/i, "Stack"),
    heap: detectAll(script, /^\.?heap$/i, /heap.*size|size.*heap/i, "Heap"),
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
