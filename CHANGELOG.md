# Changelog

## 0.1.0 - Unreleased

Initial scaffold.

- Pure `src/core` parser/serializer/validator for GNU ld linker scripts
  (`.ld`/`.lds`): `MEMORY` blocks, `SECTIONS` (input-section patterns,
  `KEEP`, `ALIGN`, symbol/`PROVIDE` assignments, `>`/`AT>`/`AT()` placement),
  and top-level directives (`ENTRY`, `OUTPUT_FORMAT`, `OUTPUT_ARCH`,
  `INCLUDE`, bare assignments). Enforced dependency-free via
  `tsconfig.core.json` (no `node`/`vscode` type libs).
- Detects files that need C-preprocessor expansion (`#include`/`#define`/
  `#if`) and routes them to a "needs preprocessor" diagnostic instead of a
  broken parse.
- Span-splice edit model (`src/core/edits.ts`): add/update/delete a MEMORY
  region or output SECTION as a small set of text splices against the
  original source, so untouched comments/formatting survive byte-for-byte.
- `linkerScriptStudio.editor` custom text editor (writable, backed by
  `vscode.TextDocument` so save/undo/dirty state work natively) with a
  Studio (structured) view and a Text (raw) view, toggled per file.
- Studio view: memory-region table with a proportional address-space bar,
  inline add/edit/delete; output-section tree with delete-with-confirmation
  when a memory region is still referenced.
- `linkerScript.additionalExtensions` and `linkerScript.defaultView` settings.
- Mocha unit tests for the core parser/serializer/edits, including
  representative Xilinx Vitis/SDK and Microchip SoftConsole (PolarFire SoC)
  fixture round-trips (`fixtures/`).
- "+ Add shared memory" preset (`addSharedMemoryRegion` in
  `src/core/edits.ts`): one action adds a MEMORY region plus a paired
  `(NOLOAD)` output section reserving it, with `__<name>_start`/`_end`
  symbols spanning the region via `LENGTH(region)` -- the common pattern for
  a cross-core shared buffer on an AMP part (Zynq APU/RPU, PolarFire SoC
  harts), without committing to any IPC framework (OpenAMP/RPMsg is a
  separate, heavier convention this intentionally doesn't model).
- "Section to Memory Region Mapping" table in the Studio view: every output
  section next to a dropdown of available memory regions, reassignable in
  one click (wired through the new `updateOutputSection` message to the
  existing `core/edits.ts` function). Mirrors the layout of Xilinx Vitis's
  own linker-script editor.
- `npm run package` now actually works: added the missing
  `scripts/clean-vsix.js`, a generated `media/icon.png`
  (`scripts/generate-icon.js`, a small dependency-free PNG encoder) and a
  `LICENSE` file (both required by `vsce`), fixed `.vscodeignore` to
  actually exclude sourcemaps/`.claude/`/`scripts/`/`examples/`
  (bare `*.map` wasn't matching nested paths; needed `**/*.map`), and fixed
  a real bug where `vsce`'s automatic `vscode:prepublish` hook was silently
  re-running the *non*-production build (with sourcemaps, unminified) after
  the `package` script's own `--production` build, clobbering it --
  `vscode:prepublish` now runs `build:prod` directly.
