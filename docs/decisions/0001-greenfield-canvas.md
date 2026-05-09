# 0001. Greenfield canvas, not a tldraw / excalidraw fork

Date: 2026-05-09

## Status

Accepted

## Context

The motivating problem for this project is that existing browser whiteboards (tldraw, excalidraw) feel imprecise on a screenless Wacom Intuos. The likely causes — diagnosed pre-build — are at the input pipeline and render-loop layer:

1. Pointer events without `getCoalescedEvents()` drop ~75% of the Wacom 200 Hz sample rate at a 60 Hz display.
2. No `getPredictedEvents()` lookahead, so the wet ink trails the cursor by 1–2 frames.
3. SVG-based stroke rendering can't sub-frame-update; canvas + RAF can.
4. Default pressure curves are not tuned for Intuos pressure profiles.

Both tldraw and excalidraw are excellent products, but they are *opinionated app frameworks*, not drawing primitives. Their architecture binds the input pipeline tightly to their rendering and tooling layers.

Two options were considered:

- **Fork an existing tool** (tldraw or excalidraw) and surgically replace the input / render pipeline.
- **Greenfield** the drawing core, using `perfect-freehand` (the same stroke-geometry library tldraw is built on, by the same author) as the only shared dependency.

## Decision

Greenfield the drawing core. Use `perfect-freehand` for stroke geometry. The core is expected to be ~2–3k LOC.

## Consequences

**Easier.**

- Full control of the latency-critical pipeline (pointer → render). No fighting an existing framework's assumptions.
- Smaller surface area to optimize, debug, and reason about.
- Smaller bundle (target: < 150 KB gz initial load).
- Architecture can be tuned end-to-end for the indirect-input use case rather than the median use case the existing tools serve.

**Harder.**

- Tooling that comes "free" in tldraw / excalidraw (multi-shape select, rich-text, embeddings, infinite undo, etc.) must be written here. The product spec deliberately scopes most of these *out* of v1 to keep this manageable.
- We lose the implicit testing benefit of using a battle-tested framework; we own the bugs.
- Future contributors need to understand the architecture, not just plug into a known framework.

**Risks.**

- Underestimating the "long tail" of small UX details that a mature tool handles. Mitigation: brutally constrained v1 scope (see [SPEC.md](../../SPEC.md) § Non-goals).
- We discover, halfway through M0, that the latency problem isn't actually solvable with the techniques we identified. Mitigation: the M0 milestone is explicitly a *latency-validation* milestone; if numbers can't hit, we course-correct before building further on the assumption.
