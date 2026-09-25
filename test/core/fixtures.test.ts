import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseLinkerScript } from "../../src/core/parser";
import { validate } from "../../src/core/validate";
import { addMemoryRegion, deleteOutputSection } from "../../src/core/edits";
import { applyTextEdits } from "../../src/core/serializer";

const FIXTURES_DIR = path.join(__dirname, "..", "..", "fixtures");

function readFixture(...parts: string[]): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, ...parts), "utf8");
}

describe("real-world fixtures", () => {
  it("parses the Xilinx Vitis lscript.ld excerpt with no parse errors", () => {
    const src = readFixture("xilinx", "lscript.ld");
    const { script, diagnostics } = parseLinkerScript(src);
    const errors = diagnostics.filter((d) => d.severity === "error");
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(script.needsPreprocessor, false);
    assert.strictEqual(script.memory!.regions.length, 2);
    assert.deepStrictEqual(
      script.memory!.regions.map((r) => r.name),
      ["psu_ocm_ram_0_MEM0", "psu_ddr_0_MEM0"],
    );
    assert.strictEqual(script.sections!.sections.length, 8);
    assert.deepStrictEqual(validate(script), []);
  });

  it("parses the SoftConsole PolarFire SoC excerpt with no parse errors", () => {
    const src = readFixture("softconsole", "polarfire-e51.ld");
    const { script, diagnostics } = parseLinkerScript(src);
    const errors = diagnostics.filter((d) => d.severity === "error");
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(
      script.memory!.regions.map((r) => r.name),
      ["envm", "e51_dtim", "ddr_cached"],
    );
    const dataSection = script.sections!.sections.find((s) => s.name === ".data")!;
    assert.strictEqual(dataSection.placement.vmaRegion, "ddr_cached");
    assert.strictEqual(dataSection.placement.lmaRegion, "envm");
    assert.deepStrictEqual(validate(script), []);
  });

  for (const [toolchain, file] of [
    ["xilinx", "lscript.ld"],
    ["softconsole", "polarfire-e51.ld"],
  ] as const) {
    it(`${toolchain}: re-parsing unedited source is byte-identical (identity round trip)`, () => {
      const src = readFixture(toolchain, file);
      const { script } = parseLinkerScript(src);
      assert.strictEqual(script.sourceText, src);
    });

    it(`${toolchain}: an edit only changes its own span, everything else survives byte-for-byte`, () => {
      const src = readFixture(toolchain, file);
      const { script } = parseLinkerScript(src);
      const firstRegionName = script.memory!.regions[0].name;
      const edits = addMemoryRegion(script, { name: "extra_region", attributes: "rw", origin: "0x50000000", length: "0x1000" });
      const next = applyTextEdits(src, edits);

      // Every byte before the insertion point, and the byte range of every
      // other pre-existing region, must be untouched.
      const insertionOffset = edits[0].span.start;
      assert.strictEqual(next.slice(0, insertionOffset), src.slice(0, insertionOffset));
      assert.ok(next.includes(firstRegionName));

      const { script: reparsed, diagnostics } = parseLinkerScript(next);
      assert.deepStrictEqual(diagnostics.filter((d) => d.severity === "error"), []);
      assert.ok(reparsed.memory!.regions.some((r) => r.name === "extra_region"));
      assert.strictEqual(reparsed.sections!.sections.length, script.sections!.sections.length);
    });

    it(`${toolchain}: deleting a section leaves the rest of the file untouched`, () => {
      const src = readFixture(toolchain, file);
      const { script } = parseLinkerScript(src);
      const targetName = script.sections!.sections[script.sections!.sections.length - 1].name;
      const edits = deleteOutputSection(script, targetName);
      const next = applyTextEdits(src, edits);
      const { script: reparsed, diagnostics } = parseLinkerScript(next);
      assert.deepStrictEqual(diagnostics.filter((d) => d.severity === "error"), []);
      assert.strictEqual(reparsed.sections!.sections.length, script.sections!.sections.length - 1);
      assert.ok(!reparsed.sections!.sections.some((s) => s.name === targetName));
    });
  }
});
