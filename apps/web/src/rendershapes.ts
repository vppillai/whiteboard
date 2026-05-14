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
    ctx.fillRect(nx, ny, nw, nh)
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
    ctx.fill()
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
