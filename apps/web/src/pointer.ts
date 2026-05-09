/**
 * Pointer pipeline. Owns the in-flight stroke and emits lifecycle callbacks.
 *
 * Key behaviors:
 *   - getCoalescedEvents(): consume every Wacom sample between frames
 *     (Intuos sends 200 Hz; a 60 Hz display drops ~70% of samples without this).
 *   - getPredictedEvents(): visual lookahead, drawn on the live layer but
 *     never committed to the stroke.
 *   - setPointerCapture: keep events flowing even if the cursor briefly
 *     leaves the target during a stroke.
 *
 * The caller provides `toBoard(clientX, clientY)` so this module is camera-
 * agnostic — it sees board-space coordinates only.
 */

import type { BrushConfig, Sample, Stroke } from '@whiteboard/shared'

export interface PointerCallbacks {
  onStrokeStart: (stroke: Stroke) => void
  /**
   * Called once per pointermove event. `predicted` is replaced each event;
   * do not retain references across calls.
   */
  onStrokeUpdate: (stroke: Stroke, predicted: Sample[]) => void
  onStrokeCommit: (stroke: Stroke) => void
}

export interface AttachOptions {
  getBrush: () => BrushConfig
  toBoard: (clientX: number, clientY: number) => { x: number; y: number }
  /** Return true to skip drawing on this pointerdown (e.g. caller is panning). */
  shouldSkip?: (e: PointerEvent) => boolean
  callbacks: PointerCallbacks
}

interface SampleSource {
  clientX: number
  clientY: number
  pressure: number
  tiltX?: number
  tiltY?: number
  timeStamp: number
}

export function attachPointer(target: HTMLElement, opts: AttachOptions): () => void {
  let active: Stroke | null = null

  const sample = (e: SampleSource, brush: BrushConfig): Sample => {
    const { x, y } = opts.toBoard(e.clientX, e.clientY)
    return {
      x,
      y,
      p: applyGamma(e.pressure, brush.pressureGamma),
      tx: e.tiltX,
      ty: e.tiltY,
      t: e.timeStamp,
    }
  }

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'pen' && e.pointerType !== 'mouse' && e.pointerType !== 'touch') return
    if (opts.shouldSkip?.(e)) return

    target.setPointerCapture(e.pointerId)
    e.preventDefault()

    const brush = opts.getBrush()
    active = {
      id: makeId(),
      brush,
      samples: [sample(e, brush)],
      startedAt: e.timeStamp,
    }
    opts.callbacks.onStrokeStart(active)
  }

  const onMove = (e: PointerEvent) => {
    if (!active) return
    const brush = active.brush

    const coalesced = e.getCoalescedEvents()
    if (coalesced.length === 0) {
      active.samples.push(sample(e, brush))
    } else {
      for (const ce of coalesced) active.samples.push(sample(ce, brush))
    }

    const predicted = e.getPredictedEvents().map((pe) => sample(pe, brush))
    opts.callbacks.onStrokeUpdate(active, predicted)
  }

  const onUp = (e: PointerEvent) => {
    if (!active) return
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    opts.callbacks.onStrokeCommit(active)
    active = null
  }

  const onCancel = (e: PointerEvent) => {
    if (!active) return
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
    active = null
  }

  target.addEventListener('pointerdown', onDown)
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onCancel)

  return () => {
    target.removeEventListener('pointerdown', onDown)
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onCancel)
  }
}

function applyGamma(p: number, gamma: number): number {
  if (p <= 0 || gamma === 1) return p
  return p ** gamma
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
