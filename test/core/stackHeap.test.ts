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

    // Xilinx's AArch64 BSP template reserves one stack per ARM exception
    // level (EL3/main + EL2 + EL1 + EL0), not just one -- all four must be
    // their own editable field, the same real-world shape as PolarFire's
    // per-hart stacks below.
    assert.strictEqual(stack.length, 4);
    assert.deepStrictEqual(
      stack.map((f) => f.symbolName),
      ["_STACK_SIZE", "_EL2_STACK_SIZE", "_EL1_STACK_SIZE", "_EL0_STACK_SIZE"],
    );
    assert.strictEqual(stack[0].kind, "symbol");
    assert.strictEqual(stack[0].symbolName, "_STACK_SIZE");
    assert.strictEqual(stack[0].label, "_STACK_SIZE");
    assert.strictEqual(stack[0].currentValueRaw, "0x2000");
    assert.strictEqual(stack[0].currentValueNumeric, 0x2000);
    assert.strictEqual(stack[0].prefix, "DEFINED(_STACK_SIZE) ? _STACK_SIZE : ");
    assert.strictEqual(stack[0].regionName, "psu_ddr_0_memory_0");

    assert.strictEqual(heap.length, 1);
    assert.strictEqual(heap[0].kind, "symbol");
    assert.strictEqual(heap[0].symbolName, "_HEAP_SIZE");
    assert.strictEqual(heap[0].currentValueNumeric, 0x2000);

    const edits = updateStackHeapSize(script, stack[0], "0x8000");
    const next = applyTextEdits(src, edits);
    assert.ok(next.includes("_STACK_SIZE = DEFINED(_STACK_SIZE) ? _STACK_SIZE : 0x8000;"));

    const { script: reparsed, diagnostics } = parseLinkerScript(next);
    assert.deepStrictEqual(diagnostics, []);
    const redetected = detectStackHeap(reparsed);
    assert.strictEqual(redetected.stack[0].currentValueNumeric, 0x8000);
    // Heap and everything else untouched.
    assert.ok(next.includes("_HEAP_SIZE = DEFINED(_HEAP_SIZE) ? _HEAP_SIZE : 0x2000;"));
  });

  it("PolarFire SoC (softconsole fixture): no symbol -- detects the inline literal in .stack's body", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "fixtures", "softconsole", "polarfire-e51.ld"), "utf8");
    const { script } = parseLinkerScript(src);
    const { stack } = detectStackHeap(script);

    assert.strictEqual(stack.length, 1);
    assert.strictEqual(stack[0].kind, "inline");
    assert.strictEqual(stack[0].label, "Stack");
    assert.strictEqual(stack[0].sectionName, ".stack");
    assert.strictEqual(stack[0].currentValueRaw, "0x2000");
    assert.strictEqual(stack[0].prefix, "");
    assert.strictEqual(stack[0].regionName, "e51_dtim");

    const edits = updateStackHeapSize(script, stack[0], "0x4000");
    const next = applyTextEdits(src, edits);
    assert.ok(next.includes(". += 0x4000;"));

    const { script: reparsed, diagnostics } = parseLinkerScript(next);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(detectStackHeap(reparsed).stack[0].currentValueNumeric, 0x4000);
  });

  it("PolarFire SoC multi-hart (real mpfs-ddr-loaded-by-boot-loader.ld): every hart's stack is its own editable field", () => {
    const src = readExample("mpfs-ddr-loaded-by-boot-loader.ld");
    const { script, diagnostics } = parseLinkerScript(src);
    assert.deepStrictEqual(diagnostics, []);

    const { stack, heap } = detectStackHeap(script);

    // "k" suffix literals (HEAP_SIZE = 8k;) must parse -- this is exactly
    // the real-world case a bare hex/decimal regex misses.
    assert.strictEqual(heap.length, 1);
    assert.strictEqual(heap[0].symbolName, "HEAP_SIZE");
    assert.strictEqual(heap[0].currentValueNumeric, 8 * 1024);

    assert.strictEqual(stack.length, 5);
    assert.deepStrictEqual(
      stack.map((f) => f.symbolName),
      ["STACK_SIZE_E51_APPLICATION", "STACK_SIZE_U54_1_APPLICATION", "STACK_SIZE_U54_2_APPLICATION", "STACK_SIZE_U54_3_APPLICATION", "STACK_SIZE_U54_4_APPLICATION"],
    );
    assert.deepStrictEqual(
      stack.map((f) => f.currentValueNumeric),
      [0, 8 * 1024, 8 * 1024, 8 * 1024, 8 * 1024],
    );
    // All five live in the same shared .stack section.
    for (const f of stack) assert.strictEqual(f.kind, "symbol");

    // Editing one hart's stack only touches that hart's symbol.
    const edits = updateStackHeapSize(script, stack[1], "16k");
    const next = applyTextEdits(src, edits);
    assert.ok(next.includes("STACK_SIZE_U54_1_APPLICATION = 16k;"));
    assert.ok(next.includes("STACK_SIZE_U54_2_APPLICATION = 8k;")); // untouched

    const { script: reparsed, diagnostics: d2 } = parseLinkerScript(next);
    assert.deepStrictEqual(d2, []);
    const redetected = detectStackHeap(reparsed);
    assert.strictEqual(redetected.stack[1].currentValueNumeric, 16 * 1024);
    assert.strictEqual(redetected.stack[2].currentValueNumeric, 8 * 1024);
  });

  it("reports empty arrays when neither convention is present", () => {
    const src = `MEMORY { ram (rwx) : ORIGIN = 0x0, LENGTH = 0x1000 }\nSECTIONS { .text : { *(.text) } > ram }`;
    const { script } = parseLinkerScript(src);
    const { stack, heap } = detectStackHeap(script);
    assert.deepStrictEqual(stack, []);
    assert.deepStrictEqual(heap, []);
  });
});
