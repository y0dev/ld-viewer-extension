import * as assert from "assert";
import { parseLinkerScript } from "../../src/core/parser";

const SAMPLE = `/* Sample linker script for round-trip testing */
OUTPUT_FORMAT("elf32-littlearm")
OUTPUT_ARCH(arm)
ENTRY(_start)

MEMORY
{
  /* on-chip ROM */
  rom (rx)  : ORIGIN = 0x00000000, LENGTH = 0x00040000
  ram (rwx) : ORIGIN = 0x20000000, LENGTH = 0x00008000
}

SECTIONS
{
  .text :
  {
    KEEP(*(.vectors))
    *(.text .text.*)
    . = ALIGN(4);
    _etext = .;
  } > rom

  .data : AT(0x00010000)
  {
    _data_start = .;
    *(.data .data.*)
  } > ram AT> rom

  _stack_size = 0x2000;
}
`;

describe("round trip", () => {
  it("re-parsing the untouched source text yields an identical model shape", () => {
    const first = parseLinkerScript(SAMPLE);
    const second = parseLinkerScript(SAMPLE);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(first.script)),
      JSON.parse(JSON.stringify(second.script)),
    );
    assert.deepStrictEqual(first.diagnostics, second.diagnostics);
  });

  it("produces no parse diagnostics for well-formed input", () => {
    const { diagnostics } = parseLinkerScript(SAMPLE);
    assert.deepStrictEqual(diagnostics, []);
  });

  it("an unedited document's sourceText is byte-for-byte the original (identity round trip)", () => {
    const { script } = parseLinkerScript(SAMPLE);
    assert.strictEqual(script.sourceText, SAMPLE);
  });
});
