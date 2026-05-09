# 0005. Tool abstraction

Date: 2026-05-09

## Status

Accepted

## Context

Through M0 and M1.5 the pointer pipeline hardcoded "draw a stroke" as the only thing it did. `pointer.ts` owned stroke creation directly: `pointerdown` started a `Stroke`, `pointermove` pushed samples, `pointerup` committed.

M1's eraser, lasso-select, and lasso-move are different *interaction modes* mapped from the same physical input. M2's text and the post-v1 backlog's laser pointer add more. Every mode has different state, different lifecycle, different rendering needs:

| Mode | Pointerdown | Pointermove | Pointerup |
|---|---|---|---|
| Pen | Begin a `Stroke` | Append samples | Commit stroke |
| Eraser | Begin hit-test sweep | Hit-test, mark deleted | End sweep |
| Lasso | Begin polyline | Extend polyline | Close, intersect, select |
| Laser | Begin transient indicator | Update indicator pos | Fade out, no commit |
| Text | Drop caret | Drag-handle? | Commit / focus input |

A 5-way conditional inside a single pointer module is the wrong shape. Each mode is a coherent unit of behavior with its own state.

## Decision

Define a `Tool` interface (`apps/web/src/tools/types.ts`):

```ts
interface Tool {
  id: ToolId
  cursor?: string
  onPointerDown(e: PointerEvent, ctx: ToolContext): void
  onPointerMove(e: PointerEvent, ctx: ToolContext): void
  onPointerUp(e: PointerEvent, ctx: ToolContext): void
  cleanup?(): void
}

interface ToolContext {
  toBoard(clientX: number, clientY: number): { x: number; y: number }
  getBrush(): BrushConfig
}
```

`pointer.ts` becomes a pure router: it owns capture, the button-filter (`button === 0 && buttons === 1`), and the optional `shouldSkip` veto, then dispatches to the active tool. The active tool is read per event from a `getActiveTool: () => Tool` callback so a future tool switch applies on the next interaction without rewiring.

`tools/pen.ts` is the only `Tool` implementation in M1.4. It takes the same callbacks (`onStrokeStart`, `onStrokeUpdate`, `onStrokeCommit`) the previous `pointer.ts` accepted directly — behavior is byte-identical.

## Consequences

**Easier.**

- Adding a tool at M1+ is a single new file in `tools/` that conforms to the interface. No diff to `pointer.ts`.
- Tool-specific state (the eraser's hit-test cache, the lasso's polyline) lives within each tool, not as flags on a shared object.
- The active-tool surface is one ref in `main.ts` (today) or one settings field once the side panel lands at M1.7.

**Harder.**

- One more layer of indirection. Tool implementations take a `ToolContext` rather than reaching directly into nearby state.
- Cross-tool concerns (eraser needs the strokes array; lasso needs to dispatch a move op) flow through `main.ts` callbacks. We'll watch for whether that splices nicely or grows into "everything goes through main.ts." If the latter, extending `ToolContext` to carry an `AppState` value is the next move.

**Risks.**

- `ToolContext` could grow into a god-object as tools demand more capabilities. Mitigation: review the surface at every M1+ tool addition; prefer giving a tool a closure over passing one-off concerns through the context.
- The pointer module no longer enforces "only the pen produces strokes" — any tool can fire whatever side effects it wants on `pointerdown`. If a tool misbehaves (e.g. forgets to handle pointerup), the pointer module won't notice. Mitigation: `cleanup` exists for tool teardown; we can add a short-lived assertion in dev if we ever hit a stuck-tool bug.
