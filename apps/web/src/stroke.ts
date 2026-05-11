/**
 * Stroke geometry: turn a Stroke (samples + brush config) into a Path2D
 * suitable for canvas filling. Wraps perfect-freehand.
 *
 * Erasure is **pixel-mask via destination-out** ([ADR 0009](../../docs/
 * decisions/0009-pixel-mask-eraser.md)): each stroke carries a list of
 * `erasedStamps` — cursor-disk records — that the renderer applies as
 * destination-out fills on the offscreen strokes layer. Strokes are still
 * rendered as one outline; they don't break into runs.
 *
 * `effectiveOpacity(stroke)` is the opacity at which a stroke renders,
 * derived from the brush's base opacity and the stroke's average pressure.
 * Light-pressure strokes appear faded; heavy-pressure strokes appear
 * saturated. The variation is *between* strokes, not within. (Per-segment
 * alpha would require switching from a filled polygon to a variable-width
 * line renderer; deferred to a future ADR.)
 */

import type { BrushConfig, Sample, Stroke } from '@whiteboard/shared'
import { getStroke } from 'perfect-freehand'

/** Multiplier range applied to brush opacity. min = light pressure, max = heavy.
 *  Tuned by user feel-test: 0.65 was too faded; 0.78 keeps light strokes
 *  readable while preserving a visible delta from heavy strokes. */
const SHADE_MIN = 0.78
const SHADE_MAX = 1.0

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Cached AABB per stroke (envelope of the rendered outline, padded for
 * brush size + taper). Lazy: computed on first `getStrokeBBox` call,
 * invalidated explicitly when a `move` op translates the stroke.
 *
 * WeakMap keying lets the cache evaporate when a stroke leaves the in-
 * memory array.
 */
const bboxCache = new WeakMap<Stroke, BBox>()

export function getStrokeBBox(stroke: Stroke): BBox {
  let bbox = bboxCache.get(stroke)
  if (!bbox) {
    bbox = computeStrokeBBox(stroke)
    bboxCache.set(stroke, bbox)
  }
  return bbox
}

export function invalidateStrokeBBox(stroke: Stroke): void {
  bboxCache.delete(stroke)
}

export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

/**
 * Append the given stamps to `stroke.erasedStamps`. Stamps are not
 * deduplicated (callers can pass duplicates safely; `destination-out`
 * is idempotent in pixel space). The bbox does NOT change — stamps
 * subtract from the rendered ink, they don't enlarge the envelope.
 */
export function addErasedStamps(
  stroke: Stroke,
  stamps: ReadonlyArray<{ x: number; y: number; r: number }>,
): void {
  if (stamps.length === 0) return
  if (!stroke.erasedStamps) stroke.erasedStamps = []
  for (const s of stamps) stroke.erasedStamps.push({ x: s.x, y: s.y, r: s.r })
}

/**
 * Remove the given stamps from `stroke.erasedStamps` (used by `unapply`
 * of an `eraseStamps` op — undo of a wipe). Match by exact field
 * equality. If a previous apply added duplicate stamps, only one
 * instance is removed per matching unapply entry — symmetric.
 */
export function removeErasedStamps(
  stroke: Stroke,
  stamps: ReadonlyArray<{ x: number; y: number; r: number }>,
): void {
  if (stamps.length === 0 || !stroke.erasedStamps) return
  const list = stroke.erasedStamps
  for (const s of stamps) {
    for (let i = list.length - 1; i >= 0; i--) {
      const existing = list[i]
      if (!existing) continue
      if (existing.x === s.x && existing.y === s.y && existing.r === s.r) {
        list.splice(i, 1)
        break
      }
    }
  }
  if (list.length === 0) stroke.erasedStamps = undefined
}

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
    // Match the SVG/PDF export path: pressure already gamma/curve-applied
    // at sample time, so perfect-freehand's velocity-derived simulation
    // would just blur the curve we already authored. Keep both paths
    // identical so WYSIWYG exports stay consistent with the canvas.
    simulatePressure: false,
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

function computeStrokeBBox(stroke: Stroke): BBox {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const s of stroke.samples) {
    if (s.x < minX) minX = s.x
    if (s.y < minY) minY = s.y
    if (s.x > maxX) maxX = s.x
    if (s.y > maxY) maxY = s.y
  }
  // Pad by brush size + max taper to encompass perfect-freehand outline.
  const pad = stroke.brush.size + Math.max(stroke.brush.taperStart, stroke.brush.taperEnd) + 2
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
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

/**
 * Quadratic bezier from (0,0) through mid to (1,1) in normalized 0–1 coords.
 * `mid` is a through-point on the curve (not a control point). The curve
 * always passes through (mx, my) when x === mx.
 *
 * Implementation: convert through-point mid to a bezier control point Q using
 * the t=0.5 through-point formula: Q = 2·mid − 0.5·(P0+P2) = (2mx−0.5, 2my−0.5).
 * Then solve x(t) = 2(1−t)t·Qx + t² for t via the quadratic formula, and
 * evaluate y(t) = 2(1−t)t·Qy + t².
 *
 * Quadratic to solve: (1−2Qx)t² + 2Qx·t − x = 0
 */
export function bezierY(x: number, mid: readonly [number, number]): number {
  const [mx, my] = mid
  // Control point derived from through-point at t=0.5
  const qx = 2 * mx - 0.5
  const qy = 2 * my - 0.5
  const a = 1 - 2 * qx
  const b = 2 * qx
  const c = -x
  let t: number
  if (Math.abs(a) < 1e-9) {
    // Degenerate: linear in t → t = -c / b
    t = b === 0 ? 0 : -c / b
  } else {
    const disc = b * b - 4 * a * c
    const sqrtDisc = Math.sqrt(Math.max(0, disc))
    // Two roots; pick the one in [0, 1] closest to x (t ≈ x for well-behaved
    // curves, so this selects the forward root and avoids the extraneous one
    // at the opposite boundary).
    const t1 = (-b + sqrtDisc) / (2 * a)
    const t2 = (-b - sqrtDisc) / (2 * a)
    const inRange1 = t1 >= -1e-9 && t1 <= 1 + 1e-9
    const inRange2 = t2 >= -1e-9 && t2 <= 1 + 1e-9
    if (inRange1 && inRange2) {
      // Both roots in range: pick the one closest to x (the "forward" root).
      t = Math.abs(t1 - x) <= Math.abs(t2 - x) ? t1 : t2
    } else if (inRange1) {
      t = t1
    } else {
      t = t2
    }
  }
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const y = 2 * (1 - t) * t * qy + t * t
  return y < 0 ? 0 : y > 1 ? 1 : y
}

/**
 * Map raw pen pressure to effective pressure for stroke rendering. When a
 * brush has a `pressureCurve` override, use the bezier; otherwise fall back
 * to the `pressureGamma` power curve.
 */
export function applyPressure(input: number, brush: BrushConfig): number {
  if (brush.pressureCurve) return bezierY(input, brush.pressureCurve.mid)
  return input ** brush.pressureGamma
}
