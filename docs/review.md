# Architecture and webview review — 0.2.4

The core remains independent of Node, VS Code, and DOM APIs. Host and browser bundles use the same parser and span-edit functions. Editing untouched constructs preserves their text; editing a region or section canonicalizes that construct and can remove its internal comments. Unsupported expressions remain raw text.

## Changes and regression coverage

- Clean external updates now compare against the old baseline before replacing it. Focused Text views receive the new text without replacing the textarea.
- Save waits for a host acknowledgement after both the WorkspaceEdit and disk save succeed. A rejected edit or failed disk save keeps the local draft unsaved. Repeated Save while pending is blocked. Typing during a pending save remains dirty after acknowledgement.
- Each save carries its document baseline. The host rejects stale requests, preventing changes that arrive between the webview update and Save from being silently overwritten. An explicit confirmation permits replacing a known external change; Discard draft loads the latest document without closing the editor.
- Empty MEMORY and SECTIONS blocks accept insertions before their closing token, including when comments contain braces.
- Arithmetic implements addition before shifts, unsigned high positive addresses without JavaScript 32-bit coercion, unary plus, and remainder. Unsafe integer intermediates, division by zero, and unsupported shift counts remain opaque.

## Security review

The webview CSP denies resources by default and permits scripts only with a cryptographically generated nonce. Styles and fonts are limited to VS Code's resource origin. Resource roots cover only dist and media. Linker content is rendered using textContent and input values rather than HTML interpolation. No linker expressions execute JavaScript or invoke tools.

The host treats incoming messages as unknown data and validates the message type and string fields before accessing or writing them. It writes only the document attached to that panel; messages cannot select arbitrary paths. Listener disposal follows panel disposal. Host regression tests check malformed input, stale writes, edit rejection, disk-save failure/retry, resource roots, and CSP.

This is a source review and regression pass, not a complete security audit. Extremely large or deeply nested scripts can still consume UI-thread resources. Draft changes are local to the webview; closing the editor can lose an unsaved draft and does not reliably trigger VS Code's native dirty-document warning. INCLUDE files are not resolved, symbol expressions are not evaluated, and region renaming does not rewrite all symbol/region references automatically. Text view and diagnostics remain necessary for these cases.

## Validation boundaries

The Node suite covers core behavior with the existing reconstructed fixtures and unmodified Xilinx and PolarFire SoC examples, plus host protocol tests using a mocked VS Code API. The browser suite executes the real bundled webview in Chromium with a simulated message bridge. It checks memory edits, undo/redo, view switching, external changes, conflict discard, keyboard save, disk-save failures, and edits during saves.

A real VS Code Extension Development Host smoke test remains separate. Chromium tests do not establish that VS Code loads resources correctly or that its document and modal-dialog behavior matches the test bridge. Use the checklist in README before publishing to the Marketplace.
