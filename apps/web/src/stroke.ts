/**
 * Stroke geometry: turn a Stroke (samples + brush config) into a Path2D
 * suitable for canvas filling. Wraps perfect-freehand.
 */

import type { Sample, Stroke } from '@whiteboard/shared'
import { getStroke } from 'perfect-freehand'

const sampleToPoint = (s: Sample): [number, number, number] => [s.x, s.y, s.p]

/**
 * Build a fillable Path2D for `stroke`. If `predicted` is provided, those
 * samples are appended to the live geometry as visual lookahead — they do
 * NOT become part of the committed stroke.
 */
export function getStrokePath(stroke: Stroke, predicted: readonly Sample[] = []): Path2D | null {
  const points = [...stroke.samples, ...predicted].map(sampleToPoint)
  if (points.length === 0) return null

  const outline = getStroke(points, {
    size: stroke.brush.size,
    thinning: stroke.brush.thinning,
    smoothing: stroke.brush.smoothing,
    streamline: stroke.brush.streamline,
    start: { taper: stroke.brush.taperStart, cap: stroke.brush.capStart },
    end: { taper: stroke.brush.taperEnd, cap: stroke.brush.capEnd },
    last: false,
  })

  return outline.length === 0 ? null : outlineToPath2D(outline)
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
