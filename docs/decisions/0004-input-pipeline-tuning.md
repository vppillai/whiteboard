# 0004. Input pipeline tuned for indirect-input pen tablets

Date: 2026-05-09

## Status

Accepted

## Context

The motivating problem for this project is that drawing on a screenless Wacom Intuos in browser-based whiteboards (tldraw, excalidraw) feels imprecise. The diagnosis pre-build identified four input/render-pipeline issues; M0 implementation surfaced a fifth. All five interact, and several have non-obvious tradeoffs that a future contributor could plausibly want to undo without understanding why we landed where we did. They are documented together because they are a coherent set of decisions all driven by the same constraint: minimizing perceived input-to-render latency on **indirect input**, where the user's eye tracks a cursor on a separate display rather than the pen tip.

## Decision

### 1. Use `PointerEvent.getCoalescedEvents()` for every `pointermove`

Wacom Intuos delivers samples at ~200 Hz. A 60 Hz display fires `pointermove` at most once per frame — without `getCoalescedEvents()`, that means ~70% of pen samples are dropped. We unpack every coalesced sample into the stroke. Cost: tiny (an extra array iteration per pointer event). Win: the perfect-freehand outline is built from the full pressure / position history, not a downsampled approximation.

### 2. **Disable** `PointerEvent.getPredictedEvents()` by default

Predicted lookahead is a screen-tablet feature. On a screen tablet, the user looks at the pen tip; the predicted ink fills in latency between pen and screen, which the user perceives as "ink keeps up." On indirect input, the user's eye is on the cursor; predicted ink visibly *leads* the cursor. When the prediction is wrong (direction change, sudden slowdown), the wrong ink renders and is then overwritten — visible as a flicker.

The user feel-test confirmed this: with prediction on, repeated reports of "transient glitchy artifacts during drawing." Disabling prediction made them disappear.

The plumbing is preserved. `?predict=1` re-enables it for A/B testing, and the brush-level / global flag is wired so a future M2 setting can offer it as a per-device preference (relevant once we have screen-tablet users).

### 3. Render the live stroke synchronously inside the `pointer` handler, not via a RAF dirty flag

The textbook pattern for canvas drawing apps is `pointermove → set dirty flag → next requestAnimationFrame redraws`. With a 60 Hz display, that adds a 0–16 ms wait between input and render. With `desynchronized: true` on the canvas context, the browser's low-latency canvas path can present pixels without waiting for the next compositor frame — so we draw inline in the pointer handler.

The committed layer remains RAF-driven (camera changes, post-commit redraws, theme switches). Only the in-flight stroke skips RAF.

### 4. `desynchronized: true` on the 2D canvas context

Opt into the low-latency canvas mode where supported. This is what makes (3) a real win — without it, draws still wait for the compositor. With it, the wet ink can reach the screen sooner than the next frame. There is no documented downside on modern Chrome / Safari / Firefox; on hardware that doesn't support it, the flag is ignored.

### 5. `last: true` on perfect-freehand for committed (and persisted) strokes

`getStroke({ last: false })` produces an outline that assumes more samples are coming and leaves the end smoothed-over for that case. `getStroke({ last: true })` finalizes the cap. M0's first cut used `last: false` everywhere — including for the committed render and on hydration from IndexedDB. The user feel-test reported "blocky, just a tiny bit," which traced to the unfinished terminus on every committed stroke. Fixed by passing `last: true` on every committed render. The in-flight render keeps `last: false` because the assumption (more samples expected) holds.

## Consequences

**Easier.**

- The implementation has minimal abstraction. Each decision is enforced in one place (`pointer.ts` for 1, 2; `main.ts` for 3; `render.ts` for 4; `stroke.ts` + render call sites for 5).
- A contributor working in M1+ can rely on `pointermove` happening synchronously once per frame and producing a fresh live render — no surprising RAF semantics.

**Harder.**

- Future support for screen tablets (iPad pen, Wacom MobileStudio) needs the prediction flag re-enabled. A per-device preference UI lands at M2; until then, screen-tablet users either pass `?predict=1` or accept slightly higher perceived latency.
- The synchronous render in `pointermove` means the browser's batching of pointer events also batches our renders. Most browsers fire one `pointermove` per frame even when many native events arrive, so we render at 60 Hz max — but on a future high-refresh display + low-rate input, we could over-render. Not measured to be a problem yet; will revisit if it becomes one.

**Risks.**

- A browser-side regression in `getCoalescedEvents()` quality could silently downsample. Mitigation: the metrics HUD shows `samples / event`; if that drops below 1 average during fast strokes, we know.
- Re-enabling prediction "for screen tablets" without checking the indirect-input regression is the most likely future mistake. This document and the user-facing setting (when added at M2) need to make the trade-off legible.
