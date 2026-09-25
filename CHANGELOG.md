# Changelog

## 0.2.1 - 2026-09-25

### Fixed

- **Memory table column overlap.** The Size column's fixed-width input plus
  its size-hint text could force that column wider than its fair share
  under the default (auto) table layout, squeezing/overlapping the End
  column next to it. `.memory-table` now uses `table-layout: fixed` with
  explicit per-column widths, so no column can ever bleed into its
  neighbor; the size hint truncates with an ellipsis (full text on hover
  via `title`) instead of forcing overflow.
- **PolarFire SoC stack/heap detection was silently broken for the real
  multi-hart case.** Two bugs, found by finally running detection against
  `examples/mpfs-ddr-loaded-by-boot-loader.ld` instead of only the
  single-hart fixture:
  - `detectStackHeap` only ever looked at the *first* `. += ` statement in
    a `.stack`/`.heap` section body. PolarFire SoC's real multi-hart
    scripts define a separate stack per hart (E51 monitor core + up to
    four U54 application cores) as five separate `. += STACK_SIZE_xxx;`
    statements in one shared `.stack` section -- only the first
    (`STACK_SIZE_E51_APPLICATION`) was ever detected or editable. Now
    walks every increment in the section and returns one field per hart
    (`stack`/`heap` are arrays now, not single objects -- see
    `StackHeapField[]`). This turned out to affect Xilinx too: its AArch64
    template reserves one stack per ARM exception level (EL3/EL2/EL1/EL0),
    four increments in one section, same bug.
  - The local `parseNumeric` helper only understood bare hex/decimal, not
    the `0k`/`8k`/`1M` size-suffix literals PolarFire SoC's real script
    actually uses (`HEAP_SIZE = 8k;`) -- so even the one field that *was*
    detected had `currentValueNumeric: undefined`, which is why no visual
    bar rendered at all for that file. Replaced with the same
    `evalSimpleArithmetic` the core MEMORY parser already uses for
    ORIGIN/LENGTH, instead of a second, less capable implementation.
  - Added a test against the real unmodified example file asserting all
    five hart stacks are detected and independently editable.
  - The Stack & Heap bar now cycles through the same color palette as the
    memory-region bar instead of two hardcoded colors, so it scales to
    however many fields a script actually has.

## 0.2.0 - 2026-09-25

### Added

- **Stack & Heap section** (`src/core/stackHeap.ts`) in the Studio view,
  between Available Memory Regions and Output Sections. Detects and edits
  the stack/heap size however the script actually expresses it, uniformly:
  - Xilinx Vitis/SDK: a top-level symbol with a `DEFINED()` override
    (`_STACK_SIZE = DEFINED(_STACK_SIZE) ? _STACK_SIZE : 0x2000;`) --
    editing writes only the default (the right side of `:`), preserving
    the override wrapper.
  - Microchip SoftConsole/PolarFire SoC: no named symbol, just a literal
    directly in the `.stack`/`.heap` section body (`. += 0x2000;`) --
    editing rewrites that one body statement via a new
    `updateSectionBodyStatementValue`, without reprinting the rest of the
    section.
  - Verified against both real files in `examples/`, not just the fixtures.
  - A small proportional bar visualizes stack size vs. heap size relative
    to each other (not address-accurate placement, which isn't reliably
    inferable from the script alone).
- Explicit **Save** (button + Ctrl+S) with a dirty indicator, and
  **Undo/Redo** (buttons + Ctrl+Z/Ctrl+Shift+Z) for Studio edits.

### Changed

- **Reworked the whole editing architecture to a local draft buffer.**
  Studio edits used to apply straight to the real `vscode.TextDocument` on
  every keystroke; now `src/core` (zero vscode/Node imports) is bundled
  into the webview itself, which parses/edits/undoes entirely against its
  own local `draftText`. The host becomes a thin sync layer -- it only
  hears about the draft on an explicit Save, and only tells the webview
  about the document on genuine external changes. The message protocol
  (`shared/messages.ts`) shrank from ~10 message types to 2 (`update`,
  `save`) as a direct result.
- **Text view is a toggle again, not a new tab.** The previous release
  changed "Open as Text" to reopen the document with VS Code's own default
  text editor, on the theory that a real native editor beats a custom
  textarea -- but in practice that opened a second tab for the same file,
  which read as "opens a new file" rather than switching views. Reverted
  to an in-panel Studio/Text toggle, backed by the same local draft buffer
  as Studio (so switching never loses an edit either way); the native
  editor swap survives as an explicit command-palette escape hatch
  (`linkerScriptStudio.openAsText`/`openAsStudio`) for anyone who
  specifically wants a separate tab.
- Delete confirmations (a referenced memory region, an output section) now
  use the webview's own `confirm()` instead of a native VS Code modal --
  the host is no longer in the loop for individual edits, so it can't show
  one; this is the one UX regression from the architecture change.

### Fixed

- The "+ Add section" button had no top margin (bare button with no
  wrapper, unlike every other add-button which sits in a spaced
  `.action-row`). Wrapped it the same way.
- Size/address value fields (Base Address, Size in the memory table, Stack
  Size, Heap Size) rendered at inconsistent widths -- the Size column's
  input was narrower than Base Address's because it shared a flex row with
  the size hint text, and the new Stack/Heap Size inputs didn't match
  either. New shared `.hex-input` class (fixed 140px) applied to all of
  them so they line up regardless of which container they're in. Left the
  add-region-form's Origin/Length fields alone -- they need room for their
  descriptive placeholders, a different UI pattern from a field showing an
  existing value.

## 0.1.2 - 2026-09-25

### Added

- `docs/images/studio-view.png` in the README, showing the Studio view's
  intended layout (memory regions with the proportional address bar, the
  section-to-region mapping table, and the collapsible section detail
  tree). Rendered from the actual `media/main.css` design via a standalone
  HTML page and a local headless browser (not a live capture of the
  extension running in VS Code -- labeled as a design mockup in the README
  pending an actual F5 smoke test), using real fixture data
  (`polarfire-e51.ld`).
- `docs/**` excluded from the packaged `.vsix` (`.vscodeignore`) -- `vsce`
  rewrites the README's relative image path to the GitHub repo's raw URL
  at package time (confirmed by inspecting the packaged `readme.md`), so
  the image doesn't need to ship in the extension package itself.

## 0.1.1 - 2026-09-25

### Changed (design inspired by the sibling binary-structure-inspector extension)

Pulled concrete patterns from that extension's actual real-world VS Code UI
(fetched its Marketplace listing and downloaded its own screenshots for
reference) rather than guessing further:

- Table headers are normal case, not uppercase/letter-spaced, matching its
  Sections view exactly.
- Memory region Size column shows a human-readable hint next to the raw
  editable value -- "0x00200000" + "2,097,152 (2.0 MB)" -- the same pattern
  as its Length column.
- Section Detail is now a real collapsible tree-table (chevron per section,
  grid-aligned Name/Placement columns, "Expand all"/"Collapse all"), instead
  of always-expanded free-standing cards -- directly modeled on its
  Structure view, and a real improvement given `examples/xilinx.ld` alone
  has 37 sections that were previously all force-expanded at once.
- Added a persistent status bar (region count / section count / error or
  warning count) styled with VS Code's own `--vscode-statusBar-*` tokens,
  mirroring its bottom status bar.

### Fixed (webview never actually loaded its stylesheet)

- `resolveCustomTextEditor`'s `webview.options.localResourceRoots` only
  listed `dist/`, but `media/main.css` is served from `media/`. VS Code
  doesn't error on a resource outside `localResourceRoots`, it just
  silently refuses to serve it -- so the Studio view had likely never
  rendered with any of its CSS at all, in any of the visual passes so far,
  regardless of what the CSS said. Fixed by widening the root to the whole
  extension directory. This is almost certainly the real explanation for
  "the design isn't appealing": there may not have been a design rendering
  in the first place.

### Changed (Text view is now VS Code's real text editor, not a textarea)

- "Text" is no longer a second render mode inside the Studio webview.
  Clicking "Open as Text" now reopens the same document with VS Code's own
  default text editor (`vscode.openWith` ... `"default"`) -- real syntax
  highlighting, line numbers, find/replace, undo/redo, instead of a plain
  `<textarea>` trying to imitate one. `linkerScriptStudio.openAsStudio` goes
  back the other way. Both editor types share the same `vscode.TextDocument`,
  so edits made in either flow into the other via the existing
  `onDidChangeTextDocument` listener -- no new sync mechanism needed.
- Removed the now-meaningless `linkerScript.defaultView` setting and the
  `linkerScriptStudio.toggleView` command (replaced by the explicit
  `openAsText`/`openAsStudio` pair, since there's no longer an in-webview
  state to toggle).
- Studio view restyled again, this time flatter and more VS Code-native:
  rectangular buttons using `--vscode-button-secondaryBackground` for
  secondary actions (matching the built-in Settings UI) instead of pill
  shapes, `@vscode/codicons` icon buttons (trash/add/go-to-file) instead of
  text-only buttons, list-style section rows instead of card backgrounds/
  shadows, and memory-bar segment colors pulled from
  `--vscode-charts-*` theme tokens so the bar stays legible across themes
  instead of fixed hexes picked against one theme.

### Fixed (data-corruption bug)

- **`src/core/parser.ts`: every top-level construct's span end was computed
  as the START of the NEXT token instead of the end of its own last token**,
  so it silently absorbed the blank-line whitespace separating it from its
  neighbor. Editing that construct (e.g. reassigning a section's region via
  the mapping-table dropdown) replaced that absorbed whitespace along with
  it, deleting the blank line and merging the edited construct's closing
  line into the next, *untouched* construct's opening line. Caught via
  `examples/xilinx.ld`, which had actually been corrupted this way by using
  0.1.0 against a real file (`.text`'s `} > psu_ddr_1_memory_1;.note.gnu.build-id : {`
  on one line). Fixed with a new `Cursor.lastEnd()` used everywhere a
  construct's span end is computed (MEMORY regions, output sections, all
  top-level directives).
- Hyphenated section/region names (`.note.gnu.build-id`, `.note-ABI-tag` --
  both real names from `examples/xilinx.ld`) were mis-tokenized as an
  identifier minus a name/number, truncating the parsed name at the hyphen.
  Fixed with adjacency-based name coalescing (`readHyphenatedName`); found
  while writing a regression test for the bug above, against the real file.
- Added regression tests for both, including running the exact edit that
  corrupted `examples/xilinx.ld` against that real file and asserting the
  blank line and section boundary survive.

### Changed (Studio view visual redesign)

The layout worked but looked flat and utilitarian; this pass adds real
visual hierarchy without changing what any control does.

- Page header ("Linker Script" title + one-line description of what the view
  controls) and a description paragraph under each section/subsection
  heading, matching the reference layout style.
- Memory region table is now always-editable inline (bordered input boxes
  per cell, matching Base Address/Size naming), instead of a separate
  Edit/Save/Cancel step -- one less click, and matches how the reference
  layout behaves. Edits commit on blur/change; the row's original name is
  captured at render time so a mid-edit rename doesn't break the lookup for
  a `Delete` on the same row.
- Memory-map bar: taller, rounded, inset shadow for depth, and each region
  gets a distinct color from a 6-color palette (cycled by index) instead of
  one flat blue for every segment, so adjacent regions are visually
  distinguishable at a glance.
- Section cards, the mapping table, and all "+ Add ..." actions restyled
  (pill-shaped primary/secondary/ghost buttons, consistent card backgrounds,
  hover states, tighter/more consistent spacing) to read as one coherent
  design rather than a stack of default HTML form controls.
- No message-protocol or core-API changes beyond the memory-table
  interaction model above.

## 0.1.0 - 2026-09-24

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
