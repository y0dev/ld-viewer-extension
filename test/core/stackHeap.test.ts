import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseLinkerScript } from "../../src/core/parser";
import { applyTextEdits } from "../../src/core/serializer";
import { detectStackHeap, updateStackHeapSize } from "../../src/core/stackHeap";

const EXAMPLES_DIR = path.join(__dirname, "..", "..", "examples");

function readExample(name: string): string {
  return fs.readFileSync(path.join(EXAMPLES_DIR, name), "utf8");
}

describe("stack/heap detection and editing", () => {
  it("Xilinx: detects the DEFINED()-ternary symbol convention and edits only the default", () => {
    const src = readExample("xilinx.ld");
    const { script } = parseLinkerScript(src);
    const { stack, heap } = detectStackHeap(script);

    assert.strictEqual(stack.kind, "symbol");
    assert.strictEqual(stack.symbolName, "_STACK_SIZE");
    assert.strictEqual(stack.currentValueRaw, "0x2000");
    assert.strictEqual(stack.currentValueNumeric, 0x2000);
    assert.strictEqual(stack.prefix, "DEFINED(_STACK_SIZE) ? _STACK_SIZE : ");
    assert.strictEqual(stack.regionName, "psu_ddr_0_memory_0");

    assert.strictEqual(heap.kind, "symbol");
    assert.strictEqual(heap.symbolName, "_HEAP_SIZE");
    assert.strictEqual(heap.currentValueNumeric, 0x2000);

    const edits = updateStackHeapSize(script, stack, "0x8000");
    const next = applyTextEdits(src, edits);
    assert.ok(next.includes("_STACK_SIZE = DEFINED(_STACK_SIZE) ? _STACK_SIZE : 0x8000;"));

    const { script: reparsed, diagnostics } = parseLinkerScript(next);
    assert.deepStrictEqual(diagnostics, []);
    const redetected = detectStackHeap(reparsed);
    assert.strictEqual(redetected.stack.currentValueNumeric, 0x8000);
    // Heap and everything else untouched.
    assert.ok(next.includes("_HEAP_SIZE = DEFINED(_HEAP_SIZE) ? _HEAP_SIZE : 0x2000;"));
  });

  it("PolarFire SoC (softconsole fixture): no symbol -- detects the inline literal in .stack's body", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "fixtures", "softconsole", "polarfire-e51.ld"), "utf8");
    const { script } = parseLinkerScript(src);
    const { stack } = detectStackHeap(script);

    assert.strictEqual(stack.kind, "inline");
    assert.strictEqual(stack.sectionName, ".stack");
    assert.strictEqual(stack.currentValueRaw, "0x2000");
    assert.strictEqual(stack.prefix, "");
    assert.strictEqual(stack.regionName, "e51_dtim");

    const edits = updateStackHeapSize(script, stack, "0x4000");
    const next = applyTextEdits(src, edits);
    assert.ok(next.includes(". += 0x4000;"));

    const { script: reparsed, diagnostics } = parseLinkerScript(next);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(detectStackHeap(reparsed).stack.currentValueNumeric, 0x4000);
  });

  it("reports not-found when neither convention is present", () => {
    const src = `MEMORY { ram (rwx) : ORIGIN = 0x0, LENGTH = 0x1000 }\nSECTIONS { .text : { *(.text) } > ram }`;
    const { script } = parseLinkerScript(src);
    const { stack, heap } = detectStackHeap(script);
    assert.strictEqual(stack.kind, "not-found");
    assert.strictEqual(heap.kind, "not-found");
  });
});
