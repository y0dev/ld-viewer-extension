import * as assert from "assert";
import { parseLinkerScript } from "../../src/core/parser";
import { applyTextEdits } from "../../src/core/serializer";
import {
  addMemoryRegion,
  updateMemoryRegion,
  deleteMemoryRegion,
  findRegionReferences,
  addOutputSection,
  updateOutputSection,
  deleteOutputSection,
  addSharedMemoryRegion,
  EditError,
} from "../../src/core/edits";

const SRC = `MEMORY
{
  rom (rx)  : ORIGIN = 0x00000000, LENGTH = 0x00040000
  ram (rwx) : ORIGIN = 0x20000000, LENGTH = 0x00008000
}

SECTIONS
{
  .text : { *(.text) } > rom
  .data : { *(.data) } > ram AT> rom
}
`;

function reparse(src: string) {
  return parseLinkerScript(src);
}

describe("edits: MEMORY regions", () => {
  it("adds a new region and the result re-parses cleanly", () => {
    const { script } = reparse(SRC);
    const edits = addMemoryRegion(script, { name: "ocm", attributes: "rwx", origin: "0x00100000", length: "0x8000" });
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(reparsed.memory!.regions.length, 3);
    assert.strictEqual(reparsed.memory!.regions[2].name, "ocm");
    // Untouched regions are byte-for-byte preserved.
    assert.ok(next.includes("rom (rx)  : ORIGIN = 0x00000000, LENGTH = 0x00040000"));
  });

  it("rejects adding a region with a duplicate name", () => {
    const { script } = reparse(SRC);
    assert.throws(() => addMemoryRegion(script, { name: "rom", attributes: "rx", origin: "0x0", length: "0x1" }), EditError);
  });

  it("updates a region's fields in place, preserving the rest of the file", () => {
    const { script } = reparse(SRC);
    const edits = updateMemoryRegion(script, "ram", { length: "0x00010000" });
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);
    const ram = reparsed.memory!.regions.find((r) => r.name === "ram")!;
    assert.strictEqual(ram.length.value, 0x10000);
    assert.ok(next.includes(".text : { *(.text) } > rom"));
  });

  it("deletes a region and leaves the other one untouched", () => {
    const { script } = reparse(SRC);
    const edits = deleteMemoryRegion(script, "rom");
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed } = reparse(next);
    assert.strictEqual(reparsed.memory!.regions.length, 1);
    assert.strictEqual(reparsed.memory!.regions[0].name, "ram");
  });

  it("findRegionReferences reports which sections reference a region before deletion", () => {
    const { script } = reparse(SRC);
    assert.deepStrictEqual(findRegionReferences(script, "rom"), [".text", ".data"]);
    assert.deepStrictEqual(findRegionReferences(script, "ram"), [".data"]);
  });
});

describe("edits: SECTIONS", () => {
  it("adds a new output section", () => {
    const { script } = reparse(SRC);
    const edits = addOutputSection(script, { name: ".bss", body: [], vmaRegion: "ram" });
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(reparsed.sections!.sections.length, 3);
    assert.strictEqual(reparsed.sections!.sections[2].name, ".bss");
  });

  it("deletes a section", () => {
    const { script } = reparse(SRC);
    const edits = deleteOutputSection(script, ".data");
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed } = reparse(next);
    assert.strictEqual(reparsed.sections!.sections.length, 1);
    assert.strictEqual(reparsed.sections!.sections[0].name, ".text");
  });

  it("reassigns a section's memory region (the mapping-table dropdown's edit), preserving its body and LMA", () => {
    const { script } = reparse(SRC);
    const dataSection = script.sections!.sections.find((s) => s.name === ".data")!;
    const edits = updateOutputSection(script, ".data", {
      name: dataSection.name,
      body: dataSection.body,
      vmaRegion: "rom",
      lmaRegion: dataSection.placement.lmaRegion,
    });
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);
    const updated = reparsed.sections!.sections.find((s) => s.name === ".data")!;
    assert.strictEqual(updated.placement.vmaRegion, "rom");
    assert.strictEqual(updated.placement.lmaRegion, "rom");
    assert.strictEqual(updated.body.length, dataSection.body.length);
    // .text is untouched.
    assert.ok(next.includes(".text : { *(.text) } > rom"));
  });

  it("unassigns a section's region by passing vmaRegion: undefined", () => {
    const { script } = reparse(SRC);
    const textSection = script.sections!.sections.find((s) => s.name === ".text")!;
    const edits = updateOutputSection(script, ".text", { name: textSection.name, body: textSection.body, vmaRegion: undefined });
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed } = reparse(next);
    const updated = reparsed.sections!.sections.find((s) => s.name === ".text")!;
    assert.strictEqual(updated.placement.vmaRegion, undefined);
  });
});

describe("edits: span-end must not absorb trailing whitespace (regression)", () => {
  // Reproduces a real corruption found in examples/xilinx.ld: reassigning
  // .text's region merged its closing line into the next, UNEDITED
  // section's opening line, deleting the blank line between them, because
  // parseOutputSection computed its span's end as the START of the next
  // token (swallowing the blank-line trivia before it) instead of the end
  // of its own last token. Mirrors that file's exact shape: no semicolon
  // after the placement clause, a blank line before the next section.
  const XILINX_SHAPED = `SECTIONS
{
.text : {
   KEEP (*(.vectors))
   *(.text)
} > psu_ddr_0_memory_0

.note.gnu.build-id : {
   KEEP (*(.note.gnu.build-id))
} > psu_ddr_0_memory_0
}
`;

  it("updating a section's region leaves the blank line before the next section intact", () => {
    const { script } = reparse(XILINX_SHAPED);
    const textSection = script.sections!.sections.find((s) => s.name === ".text")!;
    const edits = updateOutputSection(script, ".text", {
      name: textSection.name,
      body: textSection.body,
      vmaRegion: "psu_ddr_1_memory_1",
    });
    const next = applyTextEdits(XILINX_SHAPED, edits);

    assert.ok(!next.includes("memory_1;.note"), `sections must not merge onto one line:\n${next}`);
    assert.ok(next.includes("\n\n.note.gnu.build-id"), `blank line before the untouched section must survive:\n${next}`);

    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(reparsed.sections!.sections.length, 2);
    assert.strictEqual(reparsed.sections!.sections[1].name, ".note.gnu.build-id");
    assert.strictEqual(reparsed.sections!.sections[1].placement.vmaRegion, "psu_ddr_0_memory_0");
  });

  it("updating a memory region leaves the blank line before the next region intact", () => {
    const src = `MEMORY
{
rom : ORIGIN = 0x0, LENGTH = 0x1000

ram : ORIGIN = 0x2000, LENGTH = 0x1000
}
`;
    const { script } = reparse(src);
    const edits = updateMemoryRegion(script, "rom", { length: "0x2000" });
    const next = applyTextEdits(src, edits);

    assert.ok(!next.includes("0x2000}ram") && !next.includes("0x2000ram"), `regions must not merge onto one line:\n${next}`);
    assert.ok(next.includes("\n\nram"), `blank line before the untouched region must survive:\n${next}`);

    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(reparsed.memory!.regions.length, 2);
    assert.strictEqual(reparsed.memory!.regions[1].name, "ram");
    assert.strictEqual(reparsed.memory!.regions[1].origin.value, 0x2000);
  });
});

describe("edits: shared memory preset", () => {
  it("adds a region plus a paired NOLOAD reserved section", () => {
    const { script } = reparse(SRC);
    const edits = addSharedMemoryRegion(script, { regionName: "shared_memory", attributes: "rw", origin: "0x30000000", length: "0x10000" });
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);

    const region = reparsed.memory!.regions.find((r) => r.name === "shared_memory");
    assert.ok(region);
    assert.strictEqual(region!.attributes, "rw");
    assert.strictEqual(region!.origin.value, 0x30000000);
    assert.strictEqual(region!.length.value, 0x10000);

    const section = reparsed.sections!.sections.find((s) => s.name === ".shared_memory");
    assert.ok(section);
    assert.strictEqual(section!.placement.vmaRegion, "shared_memory");
    assert.strictEqual(section!.address?.raw, "(NOLOAD)");
    const names = section!.body.map((b) => (b.kind === "symbol-assignment" ? b.name : b.kind));
    assert.deepStrictEqual(names, ["align", "__shared_memory_start", ".", "__shared_memory_end"]);

    // Pre-existing regions/sections are untouched.
    assert.ok(next.includes("rom (rx)  : ORIGIN = 0x00000000, LENGTH = 0x00040000"));
    assert.ok(next.includes(".text : { *(.text) } > rom"));
  });

  it("derives the section name from the region name and uses . / LENGTH(region) to reserve the whole span", () => {
    const { script } = reparse(SRC);
    const edits = addSharedMemoryRegion(script, { regionName: "shm", attributes: "rw", origin: "0x0", length: "0x1000" });
    const next = applyTextEdits(SRC, edits);
    const { script: reparsed } = reparse(next);
    const section = reparsed.sections!.sections.find((s) => s.name === ".shm")!;
    const lengthRef = section.body.find((b) => b.kind === "symbol-assignment" && b.name === ".");
    assert.ok(lengthRef && lengthRef.kind === "symbol-assignment");
    if (lengthRef && lengthRef.kind === "symbol-assignment") {
      assert.strictEqual(lengthRef.operator, "+=");
      assert.strictEqual(lengthRef.value.raw, "LENGTH(shm)");
    }
  });

  it("only adds the region when the script has no SECTIONS block", () => {
    const memOnly = `MEMORY { ram (rwx) : ORIGIN = 0x0, LENGTH = 0x1000 }`;
    const { script } = reparse(memOnly);
    const edits = addSharedMemoryRegion(script, { regionName: "shared_memory", attributes: "rw", origin: "0x2000", length: "0x1000" });
    const next = applyTextEdits(memOnly, edits);
    const { script: reparsed, diagnostics } = reparse(next);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(reparsed.memory!.regions.length, 2);
    assert.strictEqual(reparsed.sections, undefined);
  });

  it("rejects a shared-memory section name that already exists", () => {
    const { script } = reparse(SRC);
    assert.throws(
      () => addSharedMemoryRegion(script, { regionName: "x", attributes: "rw", origin: "0x0", length: "0x1000", sectionName: ".text" }),
      EditError,
    );
  });
});
