/**
 * Produces TextEdit[] splices for Studio-view mutations (add/update/delete a
 * MEMORY region or an output SECTION). Callers apply the result with
 * applyTextEdits() and re-parse to refresh the model -- these functions
 * never mutate the LinkerScript object in place.
 */
import { LinkerScript, MemoryRegion, OutputSection, SectionBodyStatement, Span, TextEdit } from "./model";
import { MemoryRegionInput, OutputSectionInput, printMemoryRegion, printOutputSection } from "./serializer";

export class EditError extends Error {}

function findMemoryRegion(script: LinkerScript, name: string): MemoryRegion {
  const region = script.memory?.regions.find((r) => r.name === name);
  if (!region) throw new EditError(`No memory region named "${name}".`);
  return region;
}

function findSection(script: LinkerScript, name: string): OutputSection {
  const section = script.sections?.sections.find((s) => s.name === name);
  if (!section) throw new EditError(`No output section named "${name}".`);
  return section;
}

/** Replaces one top-level assignment's value (e.g. "_STACK_SIZE = ...;"), keeping its name/operator/PROVIDE wrapper. */
export function updateTopLevelAssignment(script: LinkerScript, name: string, newValueRaw: string): TextEdit[] {
  const assignment = script.topLevelAssignments.find((a) => a.name === name);
  if (!assignment) throw new EditError(`No top-level assignment named "${name}".`);
  const lhs =
    assignment.provide === "provide"
      ? `PROVIDE(${name} = ${newValueRaw})`
      : assignment.provide === "provide-hidden"
        ? `PROVIDE_HIDDEN(${name} = ${newValueRaw})`
        : `${name} ${assignment.operator} ${newValueRaw}`;
  return [{ span: assignment.span, newText: `${lhs};` }];
}

/** Replaces one section body statement's value in place (e.g. the ". += 0x2000;" line inside a .stack section), without reprinting the rest of the section. Only symbol-assignment statements are supported since that's the only kind with an editable value. */
export function updateSectionBodyStatementValue(script: LinkerScript, sectionName: string, statementIndex: number, newValueRaw: string): TextEdit[] {
  const section = findSection(script, sectionName);
  const stmt = section.body[statementIndex];
  if (!stmt) throw new EditError(`Section "${sectionName}" has no body statement at index ${statementIndex}.`);
  if (stmt.kind !== "symbol-assignment") throw new EditError(`Body statement ${statementIndex} in "${sectionName}" is not an assignment.`);
  const lhs =
    stmt.provide === "provide"
      ? `PROVIDE(${stmt.name} = ${newValueRaw})`
      : stmt.provide === "provide-hidden"
        ? `PROVIDE_HIDDEN(${stmt.name} = ${newValueRaw})`
        : `${stmt.name} ${stmt.operator} ${newValueRaw}`;
  return [{ span: stmt.span, newText: `${lhs};` }];
}

export function addMemoryRegion(script: LinkerScript, region: MemoryRegionInput): TextEdit[] {
  if (!script.memory) throw new EditError("This script has no MEMORY block to add a region to.");
  if (script.memory.regions.some((r) => r.name === region.name)) {
    throw new EditError(`A memory region named "${region.name}" already exists.`);
  }
  const insertAt = script.memory.regions.length > 0 ? script.memory.regions[script.memory.regions.length - 1].span.end : script.memory.span.start;
  const text = script.memory.regions.length > 0 ? `\n${printMemoryRegion(region)}` : `\n${printMemoryRegion(region)}\n`;
  return [{ span: { start: insertAt, end: insertAt }, newText: text }];
}

export function updateMemoryRegion(script: LinkerScript, name: string, patch: Partial<MemoryRegionInput>): TextEdit[] {
  const region = findMemoryRegion(script, name);
  const next: MemoryRegionInput = {
    name: patch.name ?? region.name,
    attributes: patch.attributes ?? region.attributes,
    origin: patch.origin ?? region.origin.raw,
    length: patch.length ?? region.length.raw,
  };
  if (next.name !== region.name && script.memory!.regions.some((r) => r.name === next.name)) {
    throw new EditError(`A memory region named "${next.name}" already exists.`);
  }
  const leadingWs = /^\s*/.exec(script.sourceText.slice(0, region.span.start).split("\n").pop() ?? "")?.[0] ?? "  ";
  return [{ span: region.span, newText: printMemoryRegion(next, leadingWs).trimStart() }];
}

/** Returns the names of sections that reference `regionName` as their VMA or LMA region. */
export function findRegionReferences(script: LinkerScript, regionName: string): string[] {
  const refs: string[] = [];
  for (const s of script.sections?.sections ?? []) {
    if (s.placement.vmaRegion === regionName || s.placement.lmaRegion === regionName) refs.push(s.name);
  }
  return refs;
}

export function deleteMemoryRegion(script: LinkerScript, name: string): TextEdit[] {
  const region = findMemoryRegion(script, name);
  let end = region.span.end;
  if (script.sourceText[end] === "\n") end += 1;
  else if (script.sourceText[end] === "\r" && script.sourceText[end + 1] === "\n") end += 2;
  return [{ span: { start: region.span.start, end }, newText: "" }];
}

export function addOutputSection(script: LinkerScript, section: OutputSectionInput): TextEdit[] {
  if (!script.sections) throw new EditError("This script has no SECTIONS block to add a section to.");
  if (script.sections.sections.some((s) => s.name === section.name)) {
    throw new EditError(`An output section named "${section.name}" already exists.`);
  }
  const insertAt = script.sections.sections.length > 0 ? script.sections.sections[script.sections.sections.length - 1].span.end : script.sections.span.start;
  const text = script.sections.sections.length > 0 ? `\n${printOutputSection(section)}` : `\n${printOutputSection(section)}\n`;
  return [{ span: { start: insertAt, end: insertAt }, newText: text }];
}

export function updateOutputSection(script: LinkerScript, name: string, next: OutputSectionInput): TextEdit[] {
  const section = findSection(script, name);
  const leadingWs = /^\s*/.exec(script.sourceText.slice(0, section.span.start).split("\n").pop() ?? "")?.[0] ?? "  ";
  return [{ span: section.span, newText: printOutputSection(next, leadingWs).trimStart() }];
}

export function deleteOutputSection(script: LinkerScript, name: string): TextEdit[] {
  const section = findSection(script, name);
  let end = section.span.end;
  if (script.sourceText[end] === "\n") end += 1;
  else if (script.sourceText[end] === "\r" && script.sourceText[end + 1] === "\n") end += 2;
  return [{ span: { start: section.span.start, end }, newText: "" }];
}

// Fresh, never-parsed body statements only need to carry the fields the
// printer reads (name/operator/value/raw) -- span is meaningless until the
// text they produce is itself parsed, so every one below uses this placeholder.
const UNPARSED_SPAN: Span = { start: 0, end: 0 };

function sanitizeSymbolFragment(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

export function defaultSharedMemorySectionName(regionName: string): string {
  return regionName.startsWith(".") ? regionName : `.${regionName}`;
}

export interface SharedMemoryRegionPreset {
  regionName: string;
  attributes: string;
  origin: string;
  length: string;
  /** Defaults to defaultSharedMemorySectionName(regionName). */
  sectionName?: string;
}

/**
 * Adds a MEMORY region plus a paired (NOLOAD) output section that reserves
 * the whole region and exposes it to C code via __<region>_start/_end
 * symbols -- the common pattern for a shared-memory buffer between cores on
 * an AMP part (e.g. Zynq APU/RPU, PolarFire SoC harts), without committing
 * to any particular IPC framework (OpenAMP/RPMsg is a separate, heavier
 * convention -- this just reserves the space). If the script has no
 * SECTIONS block, only the region is added.
 */
export function addSharedMemoryRegion(script: LinkerScript, preset: SharedMemoryRegionPreset): TextEdit[] {
  const regionEdits = addMemoryRegion(script, {
    name: preset.regionName,
    attributes: preset.attributes,
    origin: preset.origin,
    length: preset.length,
  });

  if (!script.sections) return regionEdits;

  const sectionName = preset.sectionName ?? defaultSharedMemorySectionName(preset.regionName);
  if (script.sections.sections.some((s) => s.name === sectionName)) {
    throw new EditError(`An output section named "${sectionName}" already exists.`);
  }

  const sym = sanitizeSymbolFragment(preset.regionName);
  const body: SectionBodyStatement[] = [
    { kind: "align", raw: ". = ALIGN(4);", span: UNPARSED_SPAN },
    { kind: "symbol-assignment", name: `__${sym}_start`, operator: "=", value: { raw: ".", value: undefined }, provide: "none", span: UNPARSED_SPAN },
    { kind: "symbol-assignment", name: ".", operator: "+=", value: { raw: `LENGTH(${preset.regionName})`, value: undefined }, provide: "none", span: UNPARSED_SPAN },
    { kind: "symbol-assignment", name: `__${sym}_end`, operator: "=", value: { raw: ".", value: undefined }, provide: "none", span: UNPARSED_SPAN },
  ];

  const sectionEdits = addOutputSection(script, {
    name: sectionName,
    address: "(NOLOAD)",
    body,
    vmaRegion: preset.regionName,
  });

  return [...regionEdits, ...sectionEdits];
}
