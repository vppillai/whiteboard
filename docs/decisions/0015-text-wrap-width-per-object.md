# 0015. Text wrap-width as a per-object field

Date: 2026-05-13

## Status

Accepted. Ships as part of v1.2 with the text tool's E/W edge-handle wrap adjustment.

## Context

A text object on the canvas can be in one of two layout modes:

- **Auto-width**: the rect grows in width with content; the user inserts hard line breaks via Enter.
- **Wrap-width**: the rect has a FIXED width set by the user; content greedy-word-wraps to fit; height grows with the wrapped line count.

The v1.2 text tool ships both modes. The question: where does the wrap-width VALUE live?

Three places were considered:

1. **Per-TextObject field** — `wrapWidth?: number` on the TextObject schema; persists with the text record.
2. **A global setting** — `settings.textDefaults.wrapWidth: number | null`; applied to new texts on creation; not stored per-object.
3. **An "auto-fit / fixed-width" mode flag** + a derived width — `mode: 'auto' | 'fixed'`; when fixed, width is read from `transform.w` directly.

Each has different reload / undo / sync semantics.

## Decision

**Per-TextObject field. `wrapWidth?: number` on `TextObject`.** Undefined means auto-width; positive number means wrap to that board-pixel width.

Concretely:

1. `packages/shared/src/types.ts`: `wrapWidth?: number` is added to `TextObject` (optional). Persisted records without the field load as auto-width; new records default to undefined.
2. `textgeom.measureText(content, font, wrapWidth?)`: gains an optional third argument. When set, raw lines flatMap through `wrapLine`, a greedy whitespace-tokenized word-wrap with character-split fallback for any single token exceeding the width.
3. `textgeom.resizeToFit`: reads `t.wrapWidth`; when set, pins `transform.w = wrapWidth + 2 * TEXT_PADDING_X` and lets `transform.h` grow with the measured wrapped-line count.
4. The DOM-overlay editor (`tools/text.ts`'s `applyEditorStyles`) switches between two CSS modes:
   - `wrapWidth` set → `width = wrapWidth × scale`, `white-space: pre-wrap`, `word-wrap: break-word`. Browser word-wrap aligns with our canvas word-wrap because both use the same word-boundary algorithm (greedy whitespace tokenization).
   - unset → `white-space: pre`, no max-width. Editor grows in width with content.
5. The Select tool's E and W edge handles for text drag the `wrapWidth` field (NOT `font.size`). Anchor-preserving math keeps the OPPOSITE edge pinned in board space. Minimum 40 board-pixels so the user can't shrink to unreadability.
6. The `edit-text` op's `before`/`after` payload carries `wrapWidth: number | undefined` alongside content/font/color. Undo of an E/W drag restores the prior auto-width (or different fixed width) cleanly. `setTextEdit` explicitly assigns `t.wrapWidth = payload.wrapWidth` on apply.

## Consequences

**Acceptable:**

- Each text remembers its layout choice. A user can have one paragraph at fixed-width 300 px next to a single-line heading at auto-width; reload preserves the distinction.
- Undo round-trips cleanly because `wrapWidth` rides in the same op as font / color / content changes.
- The schema field is OPTIONAL, so v1.0.x / v1.1 records (which predate the feature) load without migration as auto-width. No IDB schema bump needed for wrap-width itself (the bump 2 → 3 was for the `texts` store as a whole).
- The DOM editor's `pre-wrap` mode lets the browser do soft-wrap; `innerText` extraction preserves hard-newlines-only, so the canonical content stays plain-text and the wrap-width is the only layout signal.

**Costs:**

- Three new layers (measureText / resizeToFit / renderTexts) each carry the wrap-width branch, plus PNG / SVG export. The greedy word-wrap algorithm lives in `wrapLine` as a single function shared by all renderers, so the duplication risk is contained — but the four call sites (canvas render, PNG render, SVG render, DOM editor styles) must agree on what "wrapped" means. They do today via `measureText`'s output; future format additions (PDF text embed, RTF export) must consume the same `m.lines` array.
- Soft-wrap boundary CAN diverge between the DOM editor (browser's CSS line-break algorithm) and our canvas word-wrap (greedy whitespace tokenization) for edge cases like punctuation, CJK characters, or non-breaking spaces. v1.2 doesn't ship CJK / RTL support; if it lands later, the wrap algorithm needs to use `Intl.Segmenter` instead of `\S+\s*`.

## Considered alternatives

### Global wrap-width setting

Rejected. The whole point of wrap-width is that different paragraphs need different widths (a heading vs a body paragraph in a presentation slide). A single global setting can't express that. The user would have to keep changing the setting between texts, and the most-recently-created text would dictate the layout of every prior text. Worse UX, worse semantic.

### Mode flag + derived width

Rejected. A `mode: 'auto' | 'fixed'` flag would mean "auto → derive width from content; fixed → read width from transform.w". The mode flag plus a derived width is operationally identical to a single `wrapWidth?: number` field but requires two pieces of state. The optional field is simpler. The "auto = undefined, fixed = number" encoding is also self-documenting (a missing field means "auto-width" naturally).

### Wrap-on-export only

Rejected. Some tools (Excalidraw v1) only wrap text on export, leaving the editor in auto-mode and dropping any visible wrap during edit. That's confusing — what you see while editing isn't what you get on export. The WYSIWYG tenet (the editor matches the canvas render which matches the export) overrules.

## Future implications

If multi-column layouts arrive (e.g. magazine-style two-column text blocks), wrap-width per object is already the right primitive. Each column is a separate TextObject with its own wrapWidth; the editor and renderer handle them independently.

If table cells are added, each cell becomes its own text-object-like record with its own wrap-width set to the column width. The pattern composes.

If `Intl.Segmenter` is added for proper CJK / RTL line-break, the `wrapLine` function gains a `splitter` strategy (whitespace vs grapheme-cluster vs ICU line-break) without changing the public `measureText` signature.

## Related ADRs

- **0013 Text contenteditable overlay**: the DOM editor that consumes the wrap-width CSS modes
- **0014 Select tool Selection union**: the Select tool that drags wrap-width via E/W handles
- **0010 Settings data model**: where sticky text defaults live (font, size, B/I/U — but NOT wrap-width, which is per-object)
