/**
 * Tool abstraction. Each tool maps the same pen / mouse / touch input to a
 * different interaction (draw, erase, lasso-select, laser pointer, text).
 * The pointer module routes events to the active tool; tools own all
 * tool-specific state, rendering, and menu UI.
 *
 * The original M1.4 interface (ADR 0005) was just `onPointerDown / Move /
 * Up`. M1.6 (ADR 0007) extends it with `renderContextualMenu` so each tool
 * owns its right-click menu section. Cursor and live-stroke rendering are
 * done by tools directly via `ctx.liveLayer`, `ctx.camera`, and `ctx.dpr` —
 * no separate render hook because it's just normal pointer-handler code.
 */

import type { BrushConfig } from '@whiteboard/shared'
import type { Camera } from '../camera'
import type { CanvasLayer } from '../render'

export interface ToolContext {
  /** Convert client coordinates (e.clientX, e.clientY) to board coordinates. */
  toBoard(clientX: number, clientY: number): { x: number; y: number }
  /** Current brush configuration. Tools that produce strokes call this once
   *  per stroke to snapshot the brush at start time. */
  getBrush(): BrushConfig
  /** Live canvas layer. Tools render their cursor / in-flight stroke / etc.
   *  directly to it; they're responsible for clearing it before drawing. */
  liveLayer: CanvasLayer
  /** Camera transform; tools call applyCamera(liveLayer, camera, dpr). */
  camera: Camera
  dpr: number
  /** Resolve a brush-color token (e.g. `'ink'`) to a CSS color. */
  resolveColor(token: string): string
}

export type ToolId = 'pen' | 'eraser' | 'lasso' | 'laser' | 'text'

export interface Tool {
  id: ToolId
  /** CSS cursor while this tool is active. Caller applies it to the canvas. */
  cursor?: string
  /** Pointerdown — pen tip / mouse / touch contact start. Already filtered
   *  to button === 0 + pure-primary by the pointer module. */
  onPointerDown(e: PointerEvent, ctx: ToolContext): void
  /** Pointermove during contact OR hover. Tools that render a hover preview
   *  do so here when the pointer isn't in contact. */
  onPointerMove(e: PointerEvent, ctx: ToolContext): void
  /** Pointerup or pointercancel — contact ended. */
  onPointerUp(e: PointerEvent, ctx: ToolContext): void
  /**
   * Append the tool's contextual section to a host element (the right-click
   * menu's content). The tool owns what shows up — colors / brushes for
   * drawing tools; size pills for the eraser; etc. Call `dismiss()` after a
   * selection to close the popover.
   */
  renderContextualMenu?(host: HTMLElement, dismiss: () => void): void
  /**
   * Re-render the tool's live-layer content using its current internal state,
   * without an input event. Called after camera changes / committed-layer
   * redraws so an in-flight stroke or cursor doesn't go stale. Optional —
   * tools that only render in response to pointer events can omit it.
   */
  redraw?(ctx: ToolContext): void
  /** Optional teardown when the tool is being deactivated (e.g. user
   *  switches to another tool). Cancel any in-flight gesture cleanly. */
  cleanup?(): void
}
