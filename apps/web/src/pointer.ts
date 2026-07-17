/**
 * Pointer-event router. Pure mechanism — owns pointer capture, button
 * filtering, the should-skip predicate, and single-pointer ownership;
 * dispatches every accepted event to whichever `Tool` is currently active.
 * The tool owns all interaction logic (see `tools/types.ts` and ADR 0005).
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
 * Single-pointer ownership:
 *
 *   Only one pointer may drive a gesture at a time. The first accepted
 *   pointerdown becomes the "owner" until its matching pointerup /
 *   pointercancel (or an implicit pen-lift, below) clears it. While a
 *   gesture is owned:
 *
 *     - A pointerdown from any other pointerId is ignored outright — no
 *       capture, no dispatch. Without this, a stray second touch while
 *       drawing with the first finger would pass the button filter and
 *       re-invoke `onPointerDown`, corrupting the in-flight stroke.
 *     - A pointermove from a non-owning pointerId is dropped before it
 *       reaches the tool — it would otherwise corrupt the owner's
 *       hover/stroke state.
 *     - A pointerup / pointercancel is only dispatched when its pointerId
 *       matches the owner; other pointers' ups are ignored so a stray up
 *       from an unrelated pointer can't prematurely commit the active
 *       gesture.
 *
 *   When no gesture is owned, pointermoves keep flowing to the tool
 *   unfiltered (by pointerId) so hover previews — which aren't tied to
 *   any particular contact — keep working.
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
 *   The router tracks the owning pointerId, and a `pointermove` from
 *   that same owner with `buttons === 0` is treated as an implicit
 *   `pointerup` — release capture, route to the tool's `onPointerUp`,
 *   clear ownership. Every tool's `onPointerUp` is already idempotent
 *   (guards on its own active state), and a late genuine `pointerup` no
 *   longer matches any owner once ownership is cleared, so it's ignored
 *   by the router itself — harmless either way.
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
  // The pointerId currently owning an in-flight `onPointerDown` →
  // not-yet-`onPointerUp` gesture, or `null` when no gesture is active.
  // A single nullable owner (rather than a set) is the right shape here:
  // only one pointer may ever drive a gesture at a time (see file header).
  let ownerId: number | null = null

  const releaseOwner = (e: PointerEvent): void => {
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    ownerId = null
  }

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse' && e.pointerType !== 'touch') return
    if (e.button !== 0 || e.buttons !== 1) return
    if (opts.shouldSkip?.(e)) return
    // A gesture is already owned by another pointer — ignore this one
    // entirely (see "Single-pointer ownership" in the file header).
    if (ownerId !== null) return

    target.setPointerCapture(e.pointerId)
    ownerId = e.pointerId
    e.preventDefault()
    opts.getActiveTool().onPointerDown(e, opts.context)
  }

  const onMove = (e: PointerEvent) => {
    // A gesture is active and this move isn't from its owner — drop it
    // before it reaches the tool (see "Single-pointer ownership").
    if (ownerId !== null && e.pointerId !== ownerId) return

    // Implicit pen-lift: the owning pointer that no longer reports any
    // buttons is mechanically "up", even if `pointerup` hasn't arrived
    // yet. Route as a pointerup and stop the move from reaching the
    // tool, so the active stroke doesn't accumulate trailing
    // zero-pressure samples between the lift and the late pointerup.
    if (ownerId !== null && e.buttons === 0) {
      releaseOwner(e)
      opts.getActiveTool().onPointerUp(e, opts.context)
      return
    }
    opts.getActiveTool().onPointerMove(e, opts.context)
  }

  const onUp = (e: PointerEvent) => {
    // Only the owning pointer's up/cancel ends the gesture; a stray up
    // from an unrelated (or already-released) pointer is ignored (see
    // "Single-pointer ownership").
    if (e.pointerId !== ownerId) return
    releaseOwner(e)
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
