import * as assert from "assert";
import { parseLinkerScript, detectNeedsPreprocessor } from "../../src/core/parser";

describe("top-level directives", () => {
  it("parses ENTRY, OUTPUT_FORMAT, OUTPUT_ARCH, INCLUDE, and bare assignments", () => {
    const src = `
OUTPUT_FORMAT("elf32-littlearm", "elf32-bigarm", "elf32-littlearm")
OUTPUT_ARCH(arm)
ENTRY(_start)
INCLUDE "memory_map.ld"
_stack_size = 0x2000;
PROVIDE(_heap_size = 0x1000);
`;
    const { script, diagnostics } = parseLinkerScript(src);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(script.entry?.symbol, "_start");
    assert.deepStrictEqual(script.outputFormat?.args, ["elf32-littlearm", "elf32-bigarm", "elf32-littlearm"]);
    assert.strictEqual(script.outputArch?.arch, "arm");
    assert.strictEqual(script.includes.length, 1);
    assert.strictEqual(script.includes[0].path, "memory_map.ld");
    assert.strictEqual(script.topLevelAssignments.length, 2);
    assert.strictEqual(script.topLevelAssignments[0].name, "_stack_size");
    assert.strictEqual(script.topLevelAssignments[1].provide, "provide");
  });

  it("detects preprocessor-only files and skips parsing them", () => {
    const src = `#include "config.h"\nMEMORY { ram (rwx) : ORIGIN = 0x0, LENGTH = 0x1000 }\n`;
    assert.strictEqual(detectNeedsPreprocessor(src), true);
    const { script, diagnostics } = parseLinkerScript(src);
    assert.strictEqual(script.needsPreprocessor, true);
    assert.strictEqual(script.memory, undefined);
    assert.ok(diagnostics.some((d) => d.code === "needs-preprocessor"));
  });

  it("does not false-positive on a line comment starting with #", () => {
    const src = `# this is just a comment, not preprocessor\nMEMORY { ram (rwx) : ORIGIN = 0x0, LENGTH = 0x1000 }\n`;
    assert.strictEqual(detectNeedsPreprocessor(src), false);
  });
});
