import * as assert from "assert";
import { parseLinkerScript } from "../../src/core/parser";

describe("MEMORY block parsing", () => {
  it("parses a simple two-region block", () => {
    const src = `MEMORY
{
  rom (rx)  : ORIGIN = 0x00000000, LENGTH = 0x00040000
  ram (rwx) : ORIGIN = 0x20000000, LENGTH = 0x00008000
}
`;
    const { script, diagnostics } = parseLinkerScript(src);
    assert.deepStrictEqual(diagnostics, []);
    assert.ok(script.memory);
    assert.strictEqual(script.memory!.regions.length, 2);
    const [rom, ram] = script.memory!.regions;
    assert.strictEqual(rom.name, "rom");
    assert.strictEqual(rom.attributes, "rx");
    assert.strictEqual(rom.origin.value, 0);
    assert.strictEqual(rom.length.value, 0x40000);
    assert.strictEqual(ram.name, "ram");
    assert.strictEqual(ram.origin.value, 0x20000000);
    assert.strictEqual(ram.length.value, 0x8000);
  });

  it("handles ORIGIN/LENGTH abbreviations and reversed order", () => {
    const src = `MEMORY {
  flash (rx) : o = 0x0, l = 0x1000
  sram (!rx) : LENGTH = 0x2000, ORIGIN = 0x20000000
}`;
    const { script, diagnostics } = parseLinkerScript(src);
    assert.deepStrictEqual(diagnostics, []);
    const [flash, sram] = script.memory!.regions;
    assert.strictEqual(flash.origin.value, 0);
    assert.strictEqual(flash.length.value, 0x1000);
    assert.strictEqual(sram.origin.value, 0x20000000);
    assert.strictEqual(sram.length.value, 0x2000);
    assert.strictEqual(sram.attributes, "!rx");
  });

  it("evaluates simple arithmetic in origin/length", () => {
    const src = `MEMORY {
  ram (rwx) : ORIGIN = 0x1000 + 0x2000, LENGTH = 4 * 1024
}`;
    const { script } = parseLinkerScript(src);
    const [ram] = script.memory!.regions;
    assert.strictEqual(ram.origin.value, 0x3000);
    assert.strictEqual(ram.length.value, 4096);
  });

  it("keeps ORIGIN(region)-style references as opaque but still parses the next region", () => {
    const src = `MEMORY {
  a (rwx) : ORIGIN = 0x0, LENGTH = 0x1000
  b (rwx) : ORIGIN = ORIGIN(a) + LENGTH(a), LENGTH = 0x1000
}`;
    const { script, diagnostics } = parseLinkerScript(src);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(script.memory!.regions.length, 2);
    const [a, b] = script.memory!.regions;
    assert.strictEqual(a.length.value, 0x1000);
    assert.strictEqual(b.origin.value, undefined);
    assert.strictEqual(b.origin.raw, "ORIGIN(a) + LENGTH(a)");
    assert.strictEqual(b.length.value, 0x1000);
  });

  it("reports a diagnostic for a region missing LENGTH", () => {
    const src = `MEMORY {
  broken (rw) : ORIGIN = 0x1000
}`;
    const { diagnostics } = parseLinkerScript(src);
    assert.ok(diagnostics.some((d) => d.code === "missing-origin-or-length"));
  });

  it("captures leading comments on a region", () => {
    const src = `MEMORY {
  /* DDR memory for PS */
  psu_ddr_0_MEM0 (rwx) : ORIGIN = 0x00100000, LENGTH = 0x3FF00000
}`;
    const { script } = parseLinkerScript(src);
    const [region] = script.memory!.regions;
    assert.strictEqual(region.name, "psu_ddr_0_MEM0");
    assert.deepStrictEqual(region.leadingComments, ["/* DDR memory for PS */"]);
  });
});
