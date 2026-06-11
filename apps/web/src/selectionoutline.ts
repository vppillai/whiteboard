/**
 * Shared multi-selection outline painter. The image / text / shape
 * render passes each decorate objects that are part of a Select-tool
 * multi-selection (length > 1) with the same dashed accent outline —
 * previously three copy-pasted implementations. Kept separate from
 * `geom.ts` so the pure-geometry module stays free of canvas types.
 *
 * Stroke width and dash pattern divide by camera scale so the outline
 * reads as ~2px thick at any zoom level — matches the way the Select
 * tool draws its handles. Single-selection visuals are painted by
 * Select's own redraw with handles + outline.
 */

const MULTI_SELECTION_OUTLINE_COLOR = '#2563eb'

/** Thin dashed outline around the (axis-aligned, caller-normalized)
 *  rect of an object that's part of a Select-tool multi-selection. */
export function drawMultiSelectionOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  ctx.save()
  ctx.strokeStyle = MULTI_SELECTION_OUTLINE_COLOR
  ctx.lineWidth = 2 / scale
  ctx.setLineDash([6 / scale, 4 / scale])
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}
