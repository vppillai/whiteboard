# 0017. Whiteboard-native clipboard format

Date: 2026-05-13

## Status

Accepted.

## Context

After the Lasso → Select absorption ([ADR 0016](0016-lasso-into-select-absorption.md)), `Cmd/Ctrl+C` / `Cmd/Ctrl+X` on a multi-selection wrote PNG-only to the system clipboard. The PNG path was correct for external paste targets (Google Docs / Slack / Confluence) — those apps consume `image/png` and the transparent-background render dropped in cleanly. But pasting back *inside* the whiteboard re-imported the PNG as a new `ImageObject`, losing the underlying vector data. Strokes became opaque pixels; texts stopped being editable. The user explicitly asked for stroke / text round-trip when pasting back inside the whiteboard, while keeping the PNG path for external apps.

The constraint is the system clipboard itself. The clipboard is the only medium that survives:

- Cross-tab paste (two whiteboard windows, copy in one, paste in the other).
- Cross-document paste (whiteboard → external app).
- The user's mental model ("copy" = "system clipboard").

A whiteboard-internal handoff (e.g. an in-memory `lastCopiedSelection` field) would solve the round-trip but lose cross-tab, lose external paste, and surprise users whose muscle memory expects the system clipboard. Out.

The clipboard supports multiple MIME slots in a single `ClipboardItem`. The design space is: pick the slot(s), pick the wire format, pick the validation policy.

## Decision

**Dual-slot `ClipboardItem`. `image/png` for external apps; `text/html` carrying a `data-whiteboard-v1` data attribute for whiteboard-internal round-trip.**

### Slots

- **Slot 1: `image/png`** — the rendered selection PNG, transparent background. External targets read this. Unchanged from the previous PNG-only path; same renderer as the export pipeline.
- **Slot 2: `text/html`** — payload shape:

  ```html
  <div data-whiteboard-v1="<json-encoded-bundle>">
    <img src="data:image/png;base64,..." alt="Whiteboard selection" />
  </div>
  ```

  The data attribute carries the structured bundle. The embedded `<img>` keeps the HTML self-contained so rich-text targets that prefer `text/html` over `image/png` (Google Docs is the canonical case) still render the picture without a separate request. Internal paste reads this slot first via `extractStrokesFromHtml`.

### Schema

```ts
interface ClipboardStrokeBundle {
  v: 1
  strokes: Stroke[]
  texts?: TextObject[]
  shapes?: ShapeObject[]
  origin: { x: number; y: number }
}
```

- **`v: 1`** — integer schema version. Bumped only on *incompatible* changes (field removal, restructure). Additive fields stay at `v=1` (forward-compat — older readers silently ignore unknown fields).
- **`strokes`** — full Stroke records; freshly id'd on paste so source + paste can coexist.
- **`texts?`** — optional TextObject records; same fresh-id-on-paste treatment.
- **`shapes?`** — optional ShapeObject records; same fresh-id-on-paste treatment.
- **`origin: { x, y }`** — the union bbox top-left at copy time, in board coords. On paste, the whole selection translates by `(cursor - origin)` so relative layout is preserved and the user's group lands under the pointer.

### Validation

Three layers of defense for incoming bundles (parsed in `extractStrokesFromHtml`):

1. **Marker presence + extractable attribute** — `data-whiteboard-v1="..."` matched by regex (not DOMParser; lets the parser run in any JS runtime, including `bun:test`).
2. **Schema** — JSON parse + version match (`v === 1`) + required-field shape check (id / samples / startedAt / brush for strokes; id / content / transform / font / color for texts; id / kind / transform for shapes) + origin presence.
3. **DoS caps** — 5000 strokes, 5000 texts, 50000 samples per stroke. Bundles past any cap reject the entire bundle (the caller falls through to PNG paste).

Any layer failing → return `null` → caller uses PNG / text fallback. We never half-paste.

## Consequences

**Positive:**

- Round-trip preserves vector fidelity inside the whiteboard. Strokes stay editable, texts stay editable, group relative layout is preserved at paste time.
- PNG path keeps working for external apps. Existing Google Docs / Slack / Confluence workflows unchanged.
- Cross-tab paste works (the system clipboard is the medium).
- Forward-compat: additive optional fields can stay at `v=1`; older readers silently ignore unknown keys.
- DoS-safe: a malicious page can't flood the user's canvas via a hostile `data-whiteboard-v1` blob.

**Negative:**

- The single-image-selection fast path stays — for single-image copy/cut we still write raw image bytes via `writeImageToClipboard` (best fidelity, preserves the original format). Selections that include *one or more* images currently fall back to PNG-only (no native round-trip for image bytes). Future: a separate `image/png+ref:<id>` slot per image, or inline-base64 in the bundle JSON (size tradeoff — a 25 MB image inflates the clipboard payload meaningfully).
- The HTML attribute escape only handles three entities (`&`, `"`, `<`). Sufficient for our format (text/html attribute context, JSON payload) but worth re-auditing if a future schema field lands in an HTML rendering context.
- DoS caps reject *extremely* large legitimate selections. The 5000-item cap is roughly 25× a typical multi-selection (Cmd+A on a busy board is maybe 200 items); the 50000-samples-per-stroke cap is ~14 minutes of continuous 60fps drawing. Real selections won't hit either.

## Considered alternatives

### (A) Custom MIME type — `application/x-whiteboard-v1`

Rejected. Chrome supports custom MIME via the `unsanitized` clipboard flag, but Safari and Firefox enforce curated MIME allow-lists for writes. `text/html` is universally writable across all three browsers. The `data-` attribute on a `<div>` is invisible to humans pasting into a rich-text editor and survives the round-trip because browsers preserve unknown attributes during the standard HTML decode.

### (B) Plain `text/plain` with a JSON prefix

Shape: `WHITEBOARD-V1:{"v":1,...}`. Rejected. Pasting into a text editor or chat box (Slack DM, Discord, terminal) would display the JSON garbage. `text/html` with a data attribute is invisible — pasting into a rich-text target shows just the embedded `<img>`; pasting into a text-only target falls through to the `image/png` slot.

### (C) Inline image as base64 in the bundle, no separate `image/png` slot

Shape: drop slot 1, encode the PNG inside the bundle JSON. Rejected. Rich-text targets that read `text/html` would not get a visible image (they don't extract the data URL from a data attribute); harms the external-paste UX. The dual-slot approach is cheap (the PNG bytes are the same in both slots) and meaningfully better for the external-paste case.

### (D) Server-side handoff

Shape: the user copies, the client uploads to a server, paste fetches by id. Rejected. Requires sync infrastructure that doesn't exist pre-M3 ([ADR 0012](0012-sharing-deferred.md)). Worth revisiting when sync ships — specifically for image-bytes round-trip, which the current design defers — but for v1 we have no server side to handoff to.

## Related ADRs

- **0014 Select tool: Selection discriminated union** — the selection model that the clipboard subsystem reads from and writes back to via `selectByIds`.
- **0016 Lasso → Select absorption** — the immediate predecessor; item 7 there describes the PNG-only clipboard that this ADR supersedes.
- **0012 Sharing deferred** — the broader server-side handoff that alternative (D) defers to.
