/**
 * Tool abstraction. Each tool maps the same pen / mouse / touch input to a
 * different interaction (draw, erase, lasso-select, laser pointer, text).
 * The pointer module routes events to the active tool; tools own all
 * tool-specific state and logic.
 *
 * `ToolContext` carries cross-cutting capabilities every tool needs —
 * coordinate mapping and the active brush — so tools don't take five
 * constructor arguments.
 */

import type { BrushConfig } from '@whiteboard/shared'

export interface ToolContext {
  /** Convert client coordinates (e.clientX, e.clientY) to board coordinates. */
  toBoard(clientX: number, clientY: number): { x: number; y: number }
  /** Current brush configuration. Tools that produce strokes call this once
   *  per stroke to snapshot the brush at start time. */
  getBrush(): BrushConfig
}

export type ToolId = 'pen' | 'eraser' | 'lasso' | 'laser' | 'text'

export interface Tool {
  id: ToolId
  /** CSS cursor while this tool is active. Caller applies it to the canvas. */
  cursor?: string
  /** Pointerdown — pen tip / mouse / touch contact start. Already filtered
   *  to button === 0 + pure-primary by the pointer module. */
  onPointerDown(e: PointerEvent, ctx: ToolContext): void
  /** Pointermove during contact. */
  onPointerMove(e: PointerEvent, ctx: ToolContext): void
  /** Pointerup or pointercancel — contact ended. */
  onPointerUp(e: PointerEvent, ctx: ToolContext): void
  /** Optional teardown when the tool is being deactivated (e.g. user
   *  switches to another tool). Cancel any in-flight gesture cleanly. */
  cleanup?(): void
}
