# 0013. Text editing via a DOM `contenteditable` overlay

Date: 2026-05-13

## Status

Accepted. Ships as part of v1.2 with the text tool feature.

## Context

The text tool needs to accept keyboard input — typing, multi-line editing, paste, IME composition, native browser-level Cmd/Ctrl+C/X/V/A/Z. The whiteboard's drawing surface is an HTML `<canvas>` element, which is **not focusable for keyboard input**. Canvas has no caret, no selection model, no input-method support, no built-in clipboard handling.

Two broad implementation strategies were considered:

1. **Roll a custom canvas-based text editor** — track caret position in JS, render the caret as a canvas overlay, implement selection ranges, hook keyboard events to a custom edit buffer, build clipboard / IME / RTL / spell-check shims as needed.
2. **Overlay a DOM `contenteditable` element** — position a `<div contenteditable>` over the canvas at the text's screen coords; let the browser handle caret, selection, IME, paste, native keyboard shortcuts.

Both approaches are well-established. tldraw, Excalidraw, and Figma all use variants of approach 2 for text editing. Custom canvas editors exist in code editors (CodeMirror v5, Monaco) where IDE-specific behavior (syntax highlight, multi-cursor) justifies the complexity, but those projects are full-time editor implementations.

## Decision

**Use a DOM `contenteditable` overlay.** Concretely:

1. On entering edit mode (placement or double-click handoff from Select), the Text tool creates a `<div contenteditable="plaintext-only">`, styles it to look identical to the canvas-rendered text (font, size, weight, italic, underline, padding, line-height), and appends it to `document.body`. The div is `position: fixed` and positioned via the camera transform's `board → screen` projection.
2. The on-canvas render pass (`rendertexts.ts`) skips the text whose id matches `textTool.getEditingId()`, so the canvas-rendered version doesn't double up with the editable.
3. The editor handles `keydown` itself with `e.stopPropagation()` on EVERY event so the global keymap (which binds many unmodified single letters to tool actions) can't hijack typing. The browser-native behavior for Cmd+A (select content in editable), Cmd+Z (undo last edit), and Cmd+V (paste) still fires because we only stop JS-level propagation, not the default action.
4. Cmd+B / Cmd+I / Cmd+U are intercepted in the editor's keydown handler and routed to the Text tool's `toggleFormat` (object-level bold / italic / underline mutation + `edit-text` op emission). The browser's default bold/italic/underline behaviour on the editable would wrap selections in `<b>` / `<i>` / `<u>` tags — incompatible with our plain-text content model.
5. On commit (Esc, outside-click, or tool switch), the editor's content is read via `el.innerText`, the overlay is removed, and the `edit-text` (or `create-text`) op is pushed.

## Consequences

**Acceptable:**

- Native caret, selection, IME composition, copy/cut/paste, undo-within-edit all work for free.
- The editor's positioning + sizing is screen-space and trivially synced to the camera transform.
- The contenteditable's `pre-wrap` CSS mode aligns with our canvas `wrapLine` greedy word-wrap when `wrapWidth` is set — the same word boundaries produce the same visual output in both renderers.
- Future text-tool features (selection-range formatting, find-and-replace within a single text) have a clear path: introduce `Range`-based mutations on the editor and reconcile to our `TextObject` schema.

**Costs:**

- The on-canvas render pass must skip the editing text to avoid double-rendering. A simple `editingId` parameter handles this but requires the tool to publish its edit state via `getEditingId()`.
- Camera pan/zoom during edit mis-positions the overlay until the next style refresh. We disabled the per-input style refresh (which was causing focus loss during edit); pan/zoom-during-edit is a documented v1 limitation that the user can work around by Esc-committing first.
- contenteditable behavior differs across browsers (Safari's `plaintext-only` quirk, Firefox's whitespace handling). We use `el.innerText.replace(/\r\n/g, '\n')` to normalize paste output and rely on `plaintext-only` to prevent style-tag insertion. Edge cases (older Safari ignoring `plaintext-only`) fall back to `innerText` doing the right thing because `<br>` correctly converts to `\n`.

## Considered alternatives

### Custom canvas-based text editor

Rejected. The complexity budget is enormous: caret blink, selection ranges, double-click word-select, triple-click line-select, shift+arrow extension, paste-as-plain-text, IME composition, RTL, accessibility (screen-reader access to the edit buffer). Each of these is a feature the browser provides for free via contenteditable. A canvas-based editor would consume v1.2 entirely and still ship fewer correctness guarantees than the DOM approach.

### `<textarea>` overlay

Rejected. `<textarea>` doesn't support per-character or per-range style differences (bold, italic, underline). For v1's object-level formatting model this is technically sufficient, but it constrains the path to range-level formatting later. `contenteditable` supports the simpler current case AND the future case.

### Custom `<input>` per text on the canvas with a virtual editor

Rejected as over-engineered. A virtual editor adds a layer of indirection (DOM → virtual buffer → canvas render) without solving a problem the simpler overlay model has.

## Future implications

If tables or sticky notes are added as v2 features, the single-overlay-per-text pattern doesn't compose cleanly. A table cell needs its own overlay, and tabbing between cells requires a coordinator. The right move at that point is a "text region" abstraction where the canvas owns the layout box and the overlay is the editable interior — not a `position:fixed` div per object. That refactor is not v1.2 work; it's a v2 design problem.

If syntax highlighting is needed (e.g. for AI-generated code blocks), the overlay model also doesn't directly support per-token coloring — `contenteditable` HTML inserted programmatically conflicts with `plaintext-only`. The right answer there is to either drop `plaintext-only` and validate the inserted HTML server-side, or embed CodeMirror/Monaco as a dedicated overlay component. Again, v2 design problem.
