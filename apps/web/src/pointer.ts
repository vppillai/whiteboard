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
 *
 * Pen-lift recovery (Wacom Intuos hardening):
 *
 *   Some Wacom Intuos driver versions don't reliably fire `pointerup`
 *   when the pen lifts off the tablet — instead they send a trail of
 *   `pointermove` events with `buttons === 0` while `pointerup` arrives
 *   late (or not at all, until `pointercancel` rescues it). The naïve
 *   router would append those zero-pressure samples to the active
 *   stroke, producing the "stroke trails off after lift" symptom.
 *
 *   The router tracks which pointer IDs are in an active capture, and
 *   any `pointermove` for one of those IDs with `buttons === 0` is
 *   treated as an implicit `pointerup` — release capture, route to
 *   the tool's `onPointerUp`, forget the ID. Every tool's
 *   `onPointerUp` is already idempotent (guards on its own active
 *   state), so a late genuine `pointerup` is harmless.
 *
 *   Mouse buttons are physical-switch-driven, so during a mouse drag
 *   `buttons` reliably stays at 1; this branch only fires for pen / touch
 *   when contact is lost.
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
  // Pointer IDs that have a live `onPointerDown` → not-yet-`onPointerUp`
  // interaction. Used to detect implicit pen-lift (see file header).
  const captured = new Set<number>()

  const releaseCaptured = (e: PointerEvent): void => {
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    captured.delete(e.pointerId)
  }

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse' && e.pointerType !== 'touch') return
    if (e.button !== 0 || e.buttons !== 1) return
    if (opts.shouldSkip?.(e)) return

    target.setPointerCapture(e.pointerId)
    captured.add(e.pointerId)
    e.preventDefault()
    opts.getActiveTool().onPointerDown(e, opts.context)
  }

  const onMove = (e: PointerEvent) => {
    // Implicit pen-lift: a captured pointer that no longer reports any
    // buttons is mechanically "up", even if `pointerup` hasn't arrived
    // yet. Route as a pointerup and stop the move from reaching the
    // tool, so the active stroke doesn't accumulate trailing
    // zero-pressure samples between the lift and the late pointerup.
    if (captured.has(e.pointerId) && e.buttons === 0) {
      releaseCaptured(e)
      opts.getActiveTool().onPointerUp(e, opts.context)
      return
    }
    opts.getActiveTool().onPointerMove(e, opts.context)
  }

  const onUp = (e: PointerEvent) => {
    releaseCaptured(e)
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
