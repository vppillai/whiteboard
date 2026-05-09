# 0007. Tool surface — cursor + contextual menu owned by tools

Date: 2026-05-09

## Status

Accepted. Extends [ADR 0005](0005-tool-abstraction.md) (the M1.4 Tool interface).

## Context

The M1.4 Tool interface (ADR 0005) was deliberately thin:

```ts
interface Tool {
  id: ToolId
  cursor?: string
  onPointerDown(e, ctx): void
  onPointerMove(e, ctx): void
  onPointerUp(e, ctx): void
}
```

Two tools later (pen + eraser), the cracks showed. ~85 LOC of cursor rendering lived in `main.ts` (`renderPenHover` with five brush-specific shapes, `renderEraserCursor` with mode reticle) and ~60 LOC of contextual menu logic lived in `toolmenu.ts` (`if (toolId === 'pen') renderContextualForDraw() else if (toolId === 'eraser') renderContextualForEraser()`). Each new tool would replicate the pattern in two unrelated files.

The natural shape: tools own their cursor, their stroke geometry, *and* their UI surface. The two outside files (`main.ts` and `toolmenu.ts`) become orchestrators that don't grow per-tool.

## Decision

Extend the `Tool` interface and `ToolContext`:

```ts
interface ToolContext {
  toBoard(clientX, clientY): { x, y }
  getBrush(): BrushConfig
  // New — tools render directly to the live layer:
  liveLayer: CanvasLayer
  camera: Camera
  dpr: number
  resolveColor(token: string): string
}

interface Tool {
  id: ToolId
  cursor?: string
  onPointerDown(e, ctx): void
  onPointerMove(e, ctx): void  // tool draws cursor / preview / stroke here
  onPointerUp(e, ctx): void
  // New:
  renderContextualMenu?(host: HTMLElement, dismiss: () => void): void
  redraw?(ctx: ToolContext): void
  cleanup?(): void
}
```

Three additions:

1. **`ToolContext` carries rendering capabilities.** `liveLayer`, `camera`, `dpr`, and `resolveColor` are passed to every tool event so tools can render synchronously without callbacks back to `main.ts`.

2. **`renderContextualMenu(host, dismiss)`** lets each tool append its own menu section. Pen owns COLOR + BRUSH; Eraser owns the 4 size pills; future tools (lasso, laser, text) own theirs. `toolmenu.ts` becomes a dispatcher that calls `activeTool.renderContextualMenu(...)` and adds the static TOOL / VIEW / CLEAR rows below.

3. **`redraw(ctx)`** lets the orchestrator ask the active tool to re-render its current state (e.g., in-flight stroke) without an input event. Called after the committed layer redraws so a stroke-in-progress survives camera changes.

A small `menu-ui.ts` module exposes shared DOM helpers (`sectionLabel`, `pill`, `swatch`, `pillRow`, `fullItem`, `separator`, `paletteGrid`) so tools can build menu sections consistently. Both tools and `toolmenu.ts` import from it; the dependency graph stays one-directional.

## Consequences

**Easier.**

- Adding a tool at M1+ is a single new file in `tools/` that conforms to the extended interface. Lasso, laser, and text will not touch `main.ts` or `toolmenu.ts` beyond a registry entry.
- Cursor rendering, stroke rendering, and contextual menus are co-located with the tool that produces them. When the eraser's reticle visual changes, the diff is in `tools/eraser.ts` — not split across three files.
- `main.ts` (646 LOC after M1's feature work) drops to ~500 LOC and stays focused on top-level state, the render loop, and event surfaces.
- `toolmenu.ts` (296 LOC) drops to ~120 LOC and stops growing per tool.
- Tools that don't need a menu section or a redraw simply omit the optional methods.

**Harder.**

- `ToolContext` is wider. New tools have to acknowledge the `liveLayer` / `camera` / `dpr` parameters even if they don't render on the live layer (they can ignore). The trade-off is favorable — the alternative was per-tool callback bundles passed through main.ts.
- Tools that render on the live layer have to manage their own `clearLayer + applyCamera` scaffolding. The `menu-ui` helpers don't extend to canvas drawing because there isn't a useful common shape yet (each tool's render is structurally different — circle vs rectangle vs polygon vs bitmap). If a third tool's render duplicates the scaffolding, we extract it then.

**Risks.**

- A tool could render to the live layer mid-orchestration and conflict with the orchestrator's own "clear after committed-redraw" sweep. Mitigation: orchestrator clears live, then calls `tool.redraw(ctx)` immediately. Sequence is deterministic. Tools shouldn't render on the live layer outside their own pointer handlers and `redraw`.
- `ToolContext` is mutable (the camera and liveLayer references are shared). Tools must not retain references across event callbacks — they should look up `ctx.camera.scale` etc. at use time. So far no enforcement; trust + code review until it's an issue.
