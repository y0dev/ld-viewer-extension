/**
 * Semantic validation over an already-parsed LinkerScript. Kept separate
 * from the parser so syntax errors (parse-error diagnostics) and semantic
 * issues (undefined region references, duplicate names) are both plain
 * Diagnostic[] but come from independently testable passes.
 *
 * INCLUDE resolution/existence is NOT checked here -- that requires a
 * filesystem, which this module deliberately has no access to. The host
 * resolves IncludeDirective.path itself and can append its own
 * "include-not-found" diagnostics to this pass's output.
 */
import { Diagnostic, LinkerScript } from "./model";
import { summarizeRegionStackHeap } from "./stackHeap";

export function validate(script: LinkerScript): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const regionNames = new Set<string>();
  for (const region of script.memory?.regions ?? []) {
    if (regionNames.has(region.name)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate memory region name "${region.name}".`,
        span: region.span,
        code: "duplicate-region",
      });
    }
    regionNames.add(region.name);
  }

  for (const section of script.sections?.sections ?? []) {
    if (section.placement.vmaRegion && !regionNames.has(section.placement.vmaRegion)) {
      diagnostics.push({
        severity: "error",
        message: `Section "${section.name}" places output in undefined memory region "${section.placement.vmaRegion}".`,
        span: section.span,
        code: "undefined-region",
      });
    }
    if (section.placement.lmaRegion && !regionNames.has(section.placement.lmaRegion)) {
      diagnostics.push({
        severity: "error",
        message: `Section "${section.name}" loads to undefined memory region "${section.placement.lmaRegion}".`,
        span: section.span,
        code: "undefined-region",
      });
    }
  }

  // Stack/heap reservations alone can already exceed a region, before any
  // code or data is placed in it.
  for (const region of script.memory?.regions ?? []) {
    const usage = summarizeRegionStackHeap(script, region.name);
    const used = usage.stackBytes + usage.heapBytes;
    if (usage.regionSize !== undefined && used > usage.regionSize) {
      diagnostics.push({
        severity: "error",
        message: `Stack and heap reserve ${used.toLocaleString("en-US")} bytes in memory region "${region.name}", which is only ${usage.regionSize.toLocaleString("en-US")} bytes (over by ${(used - usage.regionSize).toLocaleString("en-US")}).`,
        span: region.span,
        code: "region-overflow",
      });
    }
  }

  return diagnostics;
}
