/**
 * Pointer-event router. Pure mechanism — owns pointer capture, button
 * filtering, and the should-skip predicate; dispatches every accepted event
 * to whichever `Tool` is currently active. The tool owns all interaction
 * logic (see `tools/types.ts` and ADR 0005).
 *
 * Events are filtered before dispatch:
 *
 *   - Only `pen` / `mouse` / `touch` pointer types reach the tool.
 *   - Only "purely primary" pointerdowns start interactions:
 *     `button === 0 && buttons === 1`. This keeps right-click and middle-
 *     click from the tool, AND keeps Wacom barrel-button-as-right-click
 *     scenarios (which can fire `button=0, buttons=3`) from accidentally
 *     starting a pen stroke.
 *   - `shouldSkip` lets the caller veto an event entirely (e.g. when pan
 *     is active because spacebar is held).
 */

import type { Tool, ToolContext } from './tools/types'

export interface PointerOptions {
  /** Returns the active tool. Read per event so tool switches apply on the
   *  next interaction without re-attaching the pipeline. */
  getActiveTool: () => Tool
  /** Cross-cutting capabilities passed to the tool (toBoard, getBrush, etc.). */
  context: ToolContext
  /**
   * Return true to skip the event entirely. Used by the pan handler so its
   * pointerdown short-circuits drawing.
   */
  shouldSkip?: (e: PointerEvent) => boolean
}

export function attachPointer(target: HTMLElement, opts: PointerOptions): () => void {
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse' && e.pointerType !== 'touch') return
    if (e.button !== 0 || e.buttons !== 1) return
    if (opts.shouldSkip?.(e)) return

    target.setPointerCapture(e.pointerId)
    e.preventDefault()
    opts.getActiveTool().onPointerDown(e, opts.context)
  }

  const onMove = (e: PointerEvent) => {
    opts.getActiveTool().onPointerMove(e, opts.context)
  }

  const onUp = (e: PointerEvent) => {
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    opts.getActiveTool().onPointerUp(e, opts.context)
  }

  target.addEventListener('pointerdown', onDown)
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onUp)

  return () => {
    target.removeEventListener('pointerdown', onDown)
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
  }
}
