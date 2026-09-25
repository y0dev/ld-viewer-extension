# Linker Script Studio

A VS Code extension that opens GNU `ld` linker scripts (`.ld`, `.lds`) as a
custom editor with two views, toggled like a tab bar:

- **Studio** (default): memory regions as a table with a proportional
  address-space bar, a "Section to Memory Region Mapping" table (each output
  section next to a dropdown of available regions, reassignable in one
  click), and an output-section tree with the full detail (input-section
  patterns, placement, symbols). Entry point, `OUTPUT_FORMAT`/`OUTPUT_ARCH`,
  and `INCLUDE`d files are summarized at the top. Add/edit/delete memory
  regions and output sections here, including a "+ Add shared memory" preset
  that adds a region plus a paired `(NOLOAD)` reserved section for a
  cross-core shared buffer.
- **Text**: the raw file content, always available, for anything the Studio
  view can't yet represent.

Both views are backed by the same `vscode.TextDocument`, so save/undo/dirty
state work exactly like a normal text editor.

## Architecture

- `src/core/` -- pure parser/serializer/validator, **zero `vscode`/Node
  imports** (enforced at build time: `tsconfig.core.json` excludes the
  `node`/`vscode` type libs, so an accidental import fails `tsc`, not just
  code review). Usable from plain Node (that's what the Mocha tests run
  against) and reusable from the webview if ever needed.
  - `tokenizer.ts` / `parser.ts` -- GNU ld script grammar → `LinkerScript` model.
  - `serializer.ts` / `edits.ts` -- model mutations → text splices (see
    **Round-trip strategy** below).
  - `validate.ts` -- semantic checks (duplicate/undefined region references).
  - `expr.ts` -- a restricted, non-executing arithmetic evaluator for
    `ORIGIN`/`LENGTH` values. It folds literals and `+ - * / << >>`; anything
    else (symbol references, `LENGTH(REGION)`) is kept as an opaque `raw`
    string. **No code from a linker script is ever executed.**
- `src/extension.ts`, `src/linkerScriptEditorProvider.ts` -- the extension
  host (`vscode` imports allowed). Registers the `linkerScriptStudio.editor`
  custom text editor and applies Studio-view edits via
  `vscode.workspace.applyEdit`.
- `src/webview/` -- the Studio view's UI (vanilla DOM, no framework),
  talking to the host only through the typed `postMessage` protocol in
  `src/shared/messages.ts`.
- Two esbuild bundles: `dist/extension.js` (`platform: node`) and
  `dist/webview/main.js` (`platform: browser`), matching build targets to
  what's actually available in each context.

## Round-trip strategy (read before editing the parser)

Editing in the Studio view does **not** regenerate the whole file from the
model. The parser records the exact source byte-span of every top-level
construct (each `MEMORY` region, each output `SECTION`, each top-level
directive). An edit computes a small set of `TextEdit` splices against the
**original source text** and applies only those -- everything outside an
edited node's span (comments, blank-line grouping, unrelated
regions/sections, indentation elsewhere in the file) survives byte-for-byte.

The explicit tradeoff: a node that **is** edited has its entire span
replaced by canonical pretty-printed text, so that node's own internal
comments/formatting are not preserved, and a newly added region/section is
appended with no comment. The Text view is the escape hatch either way --
nothing is only editable through the lossy path.

## Scope

Implements the common real-world subset of the ld script grammar:
`MEMORY`, `SECTIONS` (input-section patterns, `KEEP`, `ALIGN`, symbol/
`PROVIDE` assignments, `>`/`AT>`/`AT()` placement), and the usual top-level
directives. Unrecognized constructs produce a parse-error diagnostic rather
than crashing or silently corrupting the file.

**Explicitly out of scope (first pass):** scripts that require the C
preprocessor before they're valid ld syntax (`#include`/`#define`/`#if` at
BSP-generated files sometimes do this). These are detected up front
(`detectNeedsPreprocessor`) and routed to Text-view-only with a clear
notice, rather than producing a broken parse.

## Development

```
npm install
npm run check-types  # tsc --noEmit against all three tsconfigs (core/host/webview)
npm run lint
npm test             # Mocha, plain Node -- no extension host required
npm run build         # esbuild, both bundles (dev: sourcemaps, unminified)
npm run package       # produces linker-script-studio-<version>.vsix
```

`npm run package` cleans any stale `.vsix`, type-checks, then runs `vsce
package`, whose own `vscode:prepublish` hook runs the **production** build
(`build:prod`: minified, no sourcemaps) -- don't add a separate production
build step to the `package` script, `vsce` already triggers one, and running
both just means the second (non-production) build silently wins.

Press F5 in VS Code (with the `.vscode/launch.json` Extension Development
Host config) to try it against `fixtures/xilinx/lscript.ld` or
`fixtures/softconsole/polarfire-e51.ld`.

The fixtures under `fixtures/` are representative, hand-trimmed excerpts
reconstructed from well-known Xilinx Vitis/SDK and Microchip SoftConsole
conventions, not literal vendor files. `examples/` now holds real,
unmodified vendor linker scripts (a Xilinx one and a PolarFire SoC
DDR-loaded-by-bootloader one) -- worth promoting into `fixtures/` and
wiring into the fixture tests, since real files are what actually surfaces
grammar edge cases.
