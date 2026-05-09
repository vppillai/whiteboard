/**
 * Stroke geometry: turn a Stroke (samples + brush config) into a Path2D
 * suitable for canvas filling. Wraps perfect-freehand.
 *
 * Also exposes `effectiveOpacity(stroke)` — the opacity at which the stroke
 * should render, derived from the brush's base opacity and the stroke's
 * average pressure. Light-pressure strokes appear faded; heavy-pressure
 * strokes appear saturated. The variation is *between* strokes, not within
 * (per-segment alpha would require switching from a filled polygon to a
 * variable-width line renderer; deferred to a future ADR).
 */

import type { Sample, Stroke } from '@whiteboard/shared'
import { getStroke } from 'perfect-freehand'

/** Multiplier range applied to brush opacity. min = light pressure, max = heavy. */
const SHADE_MIN = 0.65
const SHADE_MAX = 1.0

const sampleToPoint = (s: Sample): [number, number, number] => [s.x, s.y, s.p]

/**
 * Build a fillable Path2D for `stroke`.
 *
 * @param predicted optional lookahead samples to draw visually but not commit.
 * @param last      `true` when the stroke is finalized (pointerup or persisted).
 *                  Controls perfect-freehand's end-cap algorithm: `true` produces
 *                  a clean polished cap; `false` leaves the end smoothed for
 *                  more samples. **Always pass `true` for committed strokes**;
 *                  passing `false` produces a serrated terminus.
 */
export function getStrokePath(
  stroke: Stroke,
  predicted: readonly Sample[] = [],
  last = false,
): Path2D | null {
  const points = [...stroke.samples, ...predicted].map(sampleToPoint)
  if (points.length === 0) return null

  const outline = getStroke(points, {
    size: stroke.brush.size,
    thinning: stroke.brush.thinning,
    smoothing: stroke.brush.smoothing,
    streamline: stroke.brush.streamline,
    start: { taper: stroke.brush.taperStart, cap: stroke.brush.capStart },
    end: { taper: stroke.brush.taperEnd, cap: stroke.brush.capEnd },
    last,
  })

  return outline.length === 0 ? null : outlineToPath2D(outline)
}

/**
 * Effective opacity for a stroke, factoring in its average pressure. Returns
 * `brush.opacity` if no samples; otherwise scales by SHADE_MIN..SHADE_MAX.
 */
export function effectiveOpacity(stroke: Stroke): number {
  const base = stroke.brush.opacity ?? 1
  if (stroke.samples.length === 0) return base
  let sum = 0
  for (const s of stroke.samples) sum += s.p
  const avgP = sum / stroke.samples.length
  return base * (SHADE_MIN + (SHADE_MAX - SHADE_MIN) * avgP)
}

function outlineToPath2D(outline: number[][]): Path2D {
  const path = new Path2D()
  const n = outline.length
  if (n === 0) return path

  if (n === 1) {
    const p = outline[0]
    if (p && p[0] !== undefined && p[1] !== undefined) {
      path.arc(p[0], p[1], 0.5, 0, Math.PI * 2)
    }
    return path
  }

  // Quadratic-curve hull around the outline points.
  const first = outline[0]
  if (!first || first[0] === undefined || first[1] === undefined) return path
  path.moveTo(first[0], first[1])

  for (let i = 0; i < n; i++) {
    const cur = outline[i]
    const nxt = outline[(i + 1) % n]
    if (!cur || !nxt) continue
    const x0 = cur[0]
    const y0 = cur[1]
    const x1 = nxt[0]
    const y1 = nxt[1]
    if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) continue
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }

  path.closePath()
  return path
}
