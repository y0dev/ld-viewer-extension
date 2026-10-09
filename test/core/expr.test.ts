import * as assert from "assert";
import { evalSimpleArithmetic } from "../../src/core/expr";
import { parseLinkerScript } from "../../src/core/parser";
import { addSharedMemoryRegion } from "../../src/core/edits";
import { applyTextEdits } from "../../src/core/serializer";

describe("linker arithmetic", () => {
  for (const [raw, expected] of [
    ["1 + 2 << 3", 24], ["1 << 2 + 3", 32], ["(1 << 2) + 3", 7],
    ["1 << 32", 4294967296], ["0x80000000 >> 1", 1073741824],
    ["+4K % 3000", 1096], ["8M / 2", 4194304],
  ] as const) {
    it(`evaluates ${raw}`, () => assert.strictEqual(evalSimpleArithmetic(raw), expected));
  }
  for (const raw of ["1 / 0", "1 % 0", "1 << -1", "1 << 64", "1 << 53", "9007199254740993", "9007199254740993 - 9007199254740992", "(1 << 52) * 4 / 4", "ORIGIN(ram)"]) {
    it(`keeps ${raw} opaque`, () => assert.strictEqual(evalSimpleArithmetic(raw), undefined));
  }
  it("parses high-address memory with linker shift precedence", () => {
    const { script, diagnostics } = parseLinkerScript("MEMORY { ram : ORIGIN = 1 << 32, LENGTH = 1 << 10 + 2 }");
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(script.memory!.regions[0].origin.value, 4294967296);
    assert.strictEqual(script.memory!.regions[0].length.value, 4096);
  });
});

describe("editing empty blocks", () => {
  for (const source of ["MEMORY {}\nSECTIONS {}", "MEMORY { /* preserve } comment */ }\nSECTIONS { /* keep */ }"]) {
    it(`adds a shared region inside both blocks: ${source}`, () => {
      const { script } = parseLinkerScript(source);
      const next = applyTextEdits(source, addSharedMemoryRegion(script, {
        regionName: "shared", attributes: "rw", origin: "0x80000000", length: "4K",
      }));
      const { script: parsed, diagnostics } = parseLinkerScript(next);
      assert.deepStrictEqual(diagnostics, []);
      assert.strictEqual(parsed.memory!.regions[0].name, "shared");
      assert.strictEqual(parsed.sections!.sections[0].placement.vmaRegion, "shared");
      if (source.includes("/*")) assert.ok(next.includes("/* preserve } comment */"));
    });
  }
});
