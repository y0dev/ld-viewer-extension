import * as assert from "assert";
import { parseLinkerScript } from "../../src/core/parser";
import { validate } from "../../src/core/validate";

describe("SECTIONS block parsing", () => {
  it("parses a typical .text section with KEEP, ALIGN, symbols, and placement", () => {
    const src = `SECTIONS
{
  .text : {
    KEEP(*(.vectors))
    *(.text)
    *(.text.*)
    . = ALIGN(4);
    _etext = .;
  } > rom AT> rom
}`;
    const { script, diagnostics } = parseLinkerScript(src);
    assert.deepStrictEqual(diagnostics, []);
    assert.strictEqual(script.sections!.sections.length, 1);
    const sec = script.sections!.sections[0];
    assert.strictEqual(sec.name, ".text");
    assert.strictEqual(sec.placement.vmaRegion, "rom");
    assert.strictEqual(sec.placement.lmaRegion, "rom");
    assert.strictEqual(sec.body.length, 5);

    const [keep, text, textStar, align, sym] = sec.body;
    assert.strictEqual(keep.kind, "input-section");
    if (keep.kind === "input-section") {
      assert.strictEqual(keep.keep, true);
      assert.strictEqual(keep.fileGlob, "*");
      assert.deepStrictEqual(keep.sectionGlobs, [".vectors"]);
    }
    assert.strictEqual(text.kind, "input-section");
    if (text.kind === "input-section") assert.deepStrictEqual(text.sectionGlobs, [".text"]);
    assert.strictEqual(textStar.kind, "input-section");
    if (textStar.kind === "input-section") assert.deepStrictEqual(textStar.sectionGlobs, [".text.*"]);
    assert.strictEqual(align.kind, "align");
    assert.strictEqual(sym.kind, "symbol-assignment");
    if (sym.kind === "symbol-assignment") {
      assert.strictEqual(sym.name, "_etext");
      assert.strictEqual(sym.value.raw, ".");
    }
  });

  it("parses multiple input-section globs in one pattern", () => {
    const src = `SECTIONS {
  .data : {
    *(.data .data.*)
  } > ram AT> rom
}`;
    const { script } = parseLinkerScript(src);
    const body = script.sections!.sections[0].body;
    assert.strictEqual(body.length, 1);
    const stmt = body[0];
    assert.strictEqual(stmt.kind, "input-section");
    if (stmt.kind === "input-section") assert.deepStrictEqual(stmt.sectionGlobs, [".data", ".data.*"]);
  });

  it("parses PROVIDE and PROVIDE_HIDDEN inside a section body", () => {
    const src = `SECTIONS {
  .bss : {
    __bss_start = .;
    *(.bss)
    PROVIDE(end = .);
    PROVIDE_HIDDEN(_end = .);
  } > ram
}`;
    const { script, diagnostics } = parseLinkerScript(src);
    assert.deepStrictEqual(diagnostics, []);
    const body = script.sections!.sections[0].body;
    const provide = body.find((s) => s.kind === "symbol-assignment" && s.name === "end");
    const provideHidden = body.find((s) => s.kind === "symbol-assignment" && s.name === "_end");
    assert.ok(provide && provide.kind === "symbol-assignment" && provide.provide === "provide");
    assert.ok(provideHidden && provideHidden.kind === "symbol-assignment" && provideHidden.provide === "provide-hidden");
  });

  it("parses an explicit AT(addr) load address before the body", () => {
    const src = `SECTIONS {
  .data 0x20000000 : AT(0x00010000) {
    *(.data)
  } > ram
}`;
    const { script } = parseLinkerScript(src);
    const sec = script.sections!.sections[0];
    assert.strictEqual(sec.address?.raw, "0x20000000");
    assert.strictEqual(sec.placement.lmaAddress?.raw, "0x00010000");
  });

  it("flags a section that places into an undefined region via validate()", () => {
    const src = `MEMORY { ram (rwx) : ORIGIN = 0x0, LENGTH = 0x1000 }
SECTIONS {
  .text : { *(.text) } > flash
}`;
    const { script } = parseLinkerScript(src);
    const diags = validate(script);
    assert.ok(diags.some((d) => d.code === "undefined-region"));
  });
});
