/**
 * Per-frame shape render pass for rect / ellipse / line / arrow.
 * Parallel to `renderimages.ts` and `rendertexts.ts` — extracted out of
 * main.ts so the render loop stays at one level of abstraction.
 *
 * Stacking: shapes render ABOVE texts and BELOW the strokes composite.
 * Pen ink naturally draws on top of shapes the same way it does on top
 * of images and text. This is a deliberate choice: shapes are bulk
 * vector regions (like images), and the strokes pass is the user's
 * freehand annotation layer, which should always sit on top.
 *
 * Transform model (uniform across all four kinds — see ADR 0018):
 *   - rect/ellipse: bbox is the transform rect; negative w/h is rare
 *     but tolerated by drawing in normalized form.
 *   - line/arrow:  endpoints are (x,y) → (x+w, y+h). Negative w/h
 *     encodes the start→end direction without a separate "endpoint"
 *     field. The rotation handle math is identical to rect because
 *     the center is still (x+w/2, y+h/2).
 *
 * The `isMultiSelected` predicate hooks the Select-tool multi-selection
 * outline the same way it does for images/texts. Single-selection is
 * painted by Select's own redraw.
 */

import type { ShapeObject } from '@whiteboard/shared'
import type { Camera } from './camera'
import type { CanvasLayer } from './render'

export interface ViewBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface RenderShapesParams {
  shapes: readonly ShapeObject[]
  layer: CanvasLayer
  camera: Camera
  viewBBox: ViewBBox
  /** Resolve a color token ('ink' / hex) to a CSS color string. */
  resolveColor: (token: string) => string
  /** Predicate identifying shapes that are part of a Select-tool
   *  multi-selection (length > 1). Single-selection visuals are painted
   *  by Select's own redraw with handles + outline. */
  isMultiSelected: (id: string) => boolean
}

const MULTI_SELECTION_OUTLINE_COLOR = '#2563eb'
const ROTATION_EPSILON = 1e-9
/** Arrow-head length expressed as a multiple of strokeWidth. Sized so
 *  thin lines still get visible heads but very thick lines don't drown
 *  the rest of the arrow. */
const ARROW_HEAD_LENGTH_PER_STROKE = 4
/** Arrow-head half-angle (radians). ~30° opening looks natural. */
const ARROW_HEAD_ANGLE = Math.PI / 6
/** Default alpha multiplier applied to fill when a shape doesn't carry
 *  its own `fillOpacity`. Pre-v1.4-late shapes (the field is optional)
 *  fall back here so re-loads of older boards still render correctly.
 *  Per-shape `fillOpacity` was added so the user can mix soft tints
 *  and saturated fills on the same board via the Shape tool menu's
 *  slider. */
const DEFAULT_FILL_ALPHA = 0.25

export function renderShapes(params: RenderShapesParams): void {
  const { shapes, layer, camera, viewBBox, resolveColor, isMultiSelected } = params
  const ctx = layer.ctx
  for (const s of shapes) {
    if (s.deleted) continue
    const bb = shapeAABB(s)
    if (bb.maxX < viewBBox.minX || bb.minX > viewBBox.maxX) continue
    if (bb.maxY < viewBBox.minY || bb.minY > viewBBox.maxY) continue
    const r = s.rotation ?? 0
    if (Math.abs(r) < ROTATION_EPSILON) {
      drawShape(ctx, s, resolveColor)
      if (isMultiSelected(s.id)) drawMultiSelectionOutline(ctx, s, camera.scale)
    } else {
      ctx.save()
      const cx = s.transform.x + s.transform.w / 2
      const cy = s.transform.y + s.transform.h / 2
      ctx.translate(cx, cy)
      ctx.rotate(r)
      const local: ShapeObject = {
        ...s,
        transform: {
          x: -s.transform.w / 2,
          y: -s.transform.h / 2,
          w: s.transform.w,
          h: s.transform.h,
        },
      }
      drawShape(ctx, local, resolveColor)
      if (isMultiSelected(s.id)) drawMultiSelectionOutline(ctx, local, camera.scale)
      ctx.restore()
    }
  }
}

/**
 * Public alias for `drawShape` — used by the Shape tool's live-layer
 * pointermove path to render the in-flight preview with the SAME draw
 * primitives the committed pass uses. Pulling it through a named export
 * (rather than inlining the dispatch in shape.ts) guarantees the live
 * preview never visually drifts from the final committed look.
 */
export function drawInFlightShape(
  ctx: CanvasRenderingContext2D,
  s: ShapeObject,
  resolveColor: (token: string) => string,
): void {
  drawShape(ctx, s, resolveColor)
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  s: ShapeObject,
  resolveColor: (token: string) => string,
): void {
  ctx.save()
  ctx.strokeStyle = resolveColor(s.color)
  ctx.lineWidth = s.strokeWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const fill = s.fill ? resolveColor(s.fill) : null

  switch (s.shape) {
    case 'rect':
      drawRect(ctx, s, fill)
      break
    case 'ellipse':
      drawEllipse(ctx, s, fill)
      break
    case 'line':
      drawLine(ctx, s)
      break
    case 'arrow':
      drawArrow(ctx, s)
      break
  }
  ctx.restore()
}

function drawRect(ctx: CanvasRenderingContext2D, s: ShapeObject, fill: string | null): void {
  const { x, y, w, h } = s.transform
  // Normalize so a user-drawn rect with negative w/h still paints.
  const nx = w >= 0 ? x : x + w
  const ny = h >= 0 ? y : y + h
  const nw = Math.abs(w)
  const nh = Math.abs(h)
  if (fill) {
    ctx.fillStyle = fill
    const prevAlpha = ctx.globalAlpha
    ctx.globalAlpha = prevAlpha * (s.fillOpacity ?? DEFAULT_FILL_ALPHA)
    ctx.fillRect(nx, ny, nw, nh)
    ctx.globalAlpha = prevAlpha
  }
  ctx.strokeRect(nx, ny, nw, nh)
}

function drawEllipse(ctx: CanvasRenderingContext2D, s: ShapeObject, fill: string | null): void {
  const { x, y, w, h } = s.transform
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = Math.abs(w / 2)
  const ry = Math.abs(h / 2)
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  if (fill) {
    ctx.fillStyle = fill
    const prevAlpha = ctx.globalAlpha
    ctx.globalAlpha = prevAlpha * (s.fillOpacity ?? DEFAULT_FILL_ALPHA)
    ctx.fill()
    ctx.globalAlpha = prevAlpha
  }
  ctx.stroke()
}

function drawLine(ctx: CanvasRenderingContext2D, s: ShapeObject): void {
  const { x, y, w, h } = s.transform
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w, y + h)
  ctx.stroke()
}

function drawArrow(ctx: CanvasRenderingContext2D, s: ShapeObject): void {
  const { x, y, w, h } = s.transform
  const tipX = x + w
  const tipY = y + h
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(tipX, tipY)
  ctx.stroke()
  // Arrow head — only draw if the line has nonzero length, otherwise
  // `atan2` is undefined and we'd paint a triangle at the origin point.
  const len = Math.hypot(w, h)
  if (len < 1e-6) return
  const angle = Math.atan2(h, w)
  const headLen = s.strokeWidth * ARROW_HEAD_LENGTH_PER_STROKE
  const ax1 = tipX - headLen * Math.cos(angle - ARROW_HEAD_ANGLE)
  const ay1 = tipY - headLen * Math.sin(angle - ARROW_HEAD_ANGLE)
  const ax2 = tipX - headLen * Math.cos(angle + ARROW_HEAD_ANGLE)
  const ay2 = tipY - headLen * Math.sin(angle + ARROW_HEAD_ANGLE)
  ctx.beginPath()
  ctx.moveTo(ax1, ay1)
  ctx.lineTo(tipX, tipY)
  ctx.lineTo(ax2, ay2)
  ctx.stroke()
}

function drawMultiSelectionOutline(
  ctx: CanvasRenderingContext2D,
  s: ShapeObject,
  scale: number,
): void {
  // Outline the AXIS-ALIGNED bbox of the (already de-rotated) shape so
  // line/arrow get a useful selection indicator. For lines/arrows with
  // negative w/h we normalize so the rect is well-formed.
  const { x, y, w, h } = s.transform
  const nx = w >= 0 ? x : x + w
  const ny = h >= 0 ? y : y + h
  const nw = Math.abs(w)
  const nh = Math.abs(h)
  ctx.save()
  ctx.strokeStyle = MULTI_SELECTION_OUTLINE_COLOR
  ctx.lineWidth = 2 / scale
  ctx.setLineDash([6 / scale, 4 / scale])
  ctx.strokeRect(nx, ny, nw, nh)
  ctx.restore()
}

/**
 * Rotation-aware AABB for a shape. Mirrors `textAABB` / image AABB
 * logic. For non-rotated shapes the bbox is the normalized transform
 * rect padded by half the stroke width (so stroke edges aren't clipped
 * by the viewport cull). For rotated shapes we rotate the four corners
 * of that padded rect around the center.
 */
export function shapeAABB(s: ShapeObject): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const { x, y, w, h } = s.transform
  const half = s.strokeWidth / 2
  // For arrows, the head can extend slightly past the tip endpoint in
  // the direction perpendicular to the line. The arrow head sits
  // ~headLen back from the tip, so it doesn't push the bbox outward
  // beyond the line — but its perpendicular extent is sin(angle)*headLen.
  // We approximate by inflating the same `half` already used for the
  // stroke, plus headLen for arrows.
  const arrowPad =
    s.shape === 'arrow'
      ? s.strokeWidth * ARROW_HEAD_LENGTH_PER_STROKE * Math.sin(ARROW_HEAD_ANGLE)
      : 0
  const pad = half + arrowPad
  const nx = w >= 0 ? x : x + w
  const ny = h >= 0 ? y : y + h
  const nw = Math.abs(w)
  const nh = Math.abs(h)
  const r = s.rotation ?? 0
  if (Math.abs(r) < ROTATION_EPSILON) {
    return { minX: nx - pad, minY: ny - pad, maxX: nx + nw + pad, maxY: ny + nh + pad }
  }
  const cx = x + w / 2
  const cy = y + h / 2
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const corners: Array<[number, number]> = [
    [nx - pad, ny - pad],
    [nx + nw + pad, ny - pad],
    [nx + nw + pad, ny + nh + pad],
    [nx - pad, ny + nh + pad],
  ]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const [px, py] of corners) {
    const dx = px - cx
    const dy = py - cy
    const rx = cx + dx * cos - dy * sin
    const ry = cy + dx * sin + dy * cos
    if (rx < minX) minX = rx
    if (rx > maxX) maxX = rx
    if (ry < minY) minY = ry
    if (ry > maxY) maxY = ry
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Hit-test: returns true when board point `p` is inside (or, for line/
 * arrow, within strokeWidth tolerance of) the shape. Used by the Select
 * tool's tap-select pass.
 *
 * Per-kind logic:
 *   - rect: rotated-rect AABB after inverse-rotation around the center
 *     (same pattern as pointInImage).
 *   - ellipse: rotated-ellipse interior test (inverse-rotate the point,
 *     then check (x/rx)² + (y/ry)² ≤ 1).
 *   - line / arrow: distance from p to the line segment (after inverse-
 *     rotation), within max(strokeWidth/2, screenTol) tolerance.
 *
 * `screenTol` is a board-space tolerance the caller scales by 1/zoom so
 * thin shapes are still tap-selectable at any zoom level. Caller passes
 * the same Lasso/Select-style tolerance used for strokes.
 */
export function pointInShape(
  p: { x: number; y: number },
  s: ShapeObject,
  screenTol: number,
): boolean {
  const r = s.rotation ?? 0
  const cx = s.transform.x + s.transform.w / 2
  const cy = s.transform.y + s.transform.h / 2
  const local =
    Math.abs(r) < ROTATION_EPSILON ? p : rotatePointAroundCenter(p, { x: cx, y: cy }, -r)
  const { x, y, w, h } = s.transform
  const nx = w >= 0 ? x : x + w
  const ny = h >= 0 ? y : y + h
  const nw = Math.abs(w)
  const nh = Math.abs(h)
  const tol = Math.max(s.strokeWidth / 2, screenTol)

  if (s.shape === 'rect') {
    if (s.fill) {
      return local.x >= nx && local.x <= nx + nw && local.y >= ny && local.y <= ny + nh
    }
    // Outline-only rect: hit only when near an edge (within tol).
    const insideX = local.x >= nx - tol && local.x <= nx + nw + tol
    const insideY = local.y >= ny - tol && local.y <= ny + nh + tol
    if (!insideX || !insideY) return false
    const nearLeft = Math.abs(local.x - nx) <= tol
    const nearRight = Math.abs(local.x - (nx + nw)) <= tol
    const nearTop = Math.abs(local.y - ny) <= tol
    const nearBottom = Math.abs(local.y - (ny + nh)) <= tol
    return nearLeft || nearRight || nearTop || nearBottom
  }

  if (s.shape === 'ellipse') {
    const ecx = nx + nw / 2
    const ecy = ny + nh / 2
    const rx = nw / 2
    const ry = nh / 2
    if (rx < 1e-6 || ry < 1e-6) return false
    const dx = (local.x - ecx) / rx
    const dy = (local.y - ecy) / ry
    const d2 = dx * dx + dy * dy
    if (s.fill) return d2 <= 1
    // Outline-only ellipse: hit when on the boundary within tol. We
    // approximate by checking that d2 is near 1 with a tolerance scaled
    // by the smaller of rx/ry so it reads roughly as constant-thickness.
    const minR = Math.min(rx, ry)
    if (minR < 1e-6) return false
    const tolFrac = tol / minR
    return d2 >= (1 - tolFrac) * (1 - tolFrac) && d2 <= (1 + tolFrac) * (1 + tolFrac)
  }

  // line / arrow: distance from local point to segment from (x,y) to
  // (x+w, y+h). The endpoint encoding preserves draw direction; the
  // hit test doesn't care about direction, just distance.
  const ax = x
  const ay = y
  const bx = x + w
  const by = y + h
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) {
    // Zero-length segment — fall back to point-distance check.
    const px = local.x - ax
    const py = local.y - ay
    return px * px + py * py <= tol * tol
  }
  let t = ((local.x - ax) * dx + (local.y - ay) * dy) / len2
  if (t < 0) t = 0
  if (t > 1) t = 1
  const projX = ax + t * dx
  const projY = ay + t * dy
  const ex = local.x - projX
  const ey = local.y - projY
  return ex * ex + ey * ey <= tol * tol
}

/** Rotate `p` around `center` by angle (radians). Same shape as
 *  imagegeom.rotateAroundPoint — kept local to avoid an extra
 *  cross-file dependency in this geometry helper. */
function rotatePointAroundCenter(
  p: { x: number; y: number },
  center: { x: number; y: number },
  angle: number,
): { x: number; y: number } {
  if (angle === 0) return p
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}
