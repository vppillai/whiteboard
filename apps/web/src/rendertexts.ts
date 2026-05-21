/**
 * Per-frame text render pass. Parallel to `renderimages.ts` — extracted
 * out of main.ts so the orchestrator's render loop stays at a single
 * level of abstraction (grid → renderImages → renderTexts → composite
 * strokes).
 *
 * Texts render in z-order, ABOVE images and BELOW the strokes composite,
 * so pen strokes naturally draw on top of text the same way they draw on
 * top of images. The text being edited in the DOM-overlay editor is
 * skipped via the `editingId` parameter — otherwise the canvas-rendered
 * version would be visible behind the editable, which double-shows the
 * content.
 *
 * Bold / italic / size / family are applied via canvas `font` shorthand
 * (composed by `fontCss` in textgeom.ts). Underline is drawn explicitly
 * as a horizontal line stroked at the baseline + ~2 px — `textBaseline =
 * 'top'` makes per-line positioning straightforward.
 *
 * The `isMultiSelected` predicate hooks the Select-tool multi-selection
 * outline the same way it does for images: each text that's part of a
 * multi-selection (length > 1) gets a dashed accent outline. The
 * single-selection visual is painted by Select's own redraw.
 */

import type { TextObject } from '@whiteboard/shared'
import type { Camera } from './camera'
import type { CanvasLayer } from './render'
import { fontCss, getTextMeasurement, TEXT_PADDING_X, TEXT_PADDING_Y, textAABB } from './textgeom'

export interface ViewBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface RenderTextsParams {
  texts: readonly TextObject[]
  layer: CanvasLayer
  camera: Camera
  viewBBox: ViewBBox
  /** Resolve a color token ('ink' / hex) to a CSS color string. */
  resolveColor: (token: string) => string
  /** Id of the text currently in DOM-overlay edit mode — skipped so the
   *  on-canvas version doesn't double up with the editable. Null when
   *  no text is being edited. */
  editingId: string | null
  /** Predicate identifying texts that are part of a Select-tool
   *  multi-selection (length > 1). The single-selection visual is
   *  painted by Select's own redraw with handles + outline. */
  isMultiSelected: (id: string) => boolean
}

const MULTI_SELECTION_OUTLINE_COLOR = '#2563eb'
const ROTATION_EPSILON = 1e-9

export function renderTexts(params: RenderTextsParams): void {
  const { texts, layer, camera, viewBBox, resolveColor, editingId, isMultiSelected } = params
  const ctx = layer.ctx
  for (const t of texts) {
    if (t.deleted) continue
    if (t.id === editingId) continue
    // Viewport cull via rotation-aware AABB. Matches the image cull.
    const bb = textAABB(t)
    if (bb.maxX < viewBBox.minX || bb.minX > viewBBox.maxX) continue
    if (bb.maxY < viewBBox.minY || bb.minY > viewBBox.maxY) continue
    const r = t.rotation ?? 0
    if (Math.abs(r) < ROTATION_EPSILON) {
      drawText(ctx, t, resolveColor)
      if (isMultiSelected(t.id)) drawMultiSelectionOutline(ctx, t, camera.scale)
    } else {
      ctx.save()
      const cx = t.transform.x + t.transform.w / 2
      const cy = t.transform.y + t.transform.h / 2
      ctx.translate(cx, cy)
      ctx.rotate(r)
      // Draw a translated/rotated text by composing the same draw call
      // relative to the rect's local top-left (in rotated frame).
      const local: TextObject = {
        ...t,
        transform: {
          x: -t.transform.w / 2,
          y: -t.transform.h / 2,
          w: t.transform.w,
          h: t.transform.h,
        },
      }
      drawText(ctx, local, resolveColor)
      if (isMultiSelected(t.id)) drawMultiSelectionOutline(ctx, local, camera.scale)
      ctx.restore()
    }
  }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  t: TextObject,
  resolveColor: (token: string) => string,
): void {
  ctx.save()
  ctx.font = fontCss(t.font)
  ctx.fillStyle = resolveColor(t.color)
  ctx.textBaseline = 'top'
  // Get the rendered-line list via measureText so wrap-width text
  // (where the content was split by greedy word-wrap during measurement)
  // draws the same lines it measured. Without this, `content.split('\n')`
  // would skip soft-wrap splits and produce a clipped render. Cached per-
  // TextObject via `getTextMeasurement` so committed-dirty re-renders
  // don't re-pay the greedy word-wrap cost on every frame.
  const m = getTextMeasurement(t)
  const baseX = t.transform.x + TEXT_PADDING_X
  const baseY = t.transform.y + TEXT_PADDING_Y
  for (let i = 0; i < m.lines.length; i++) {
    const line = m.lines[i] ?? ''
    const y = baseY + i * m.lineHeight
    ctx.fillText(line, baseX, y)
    if (t.font.underline) {
      // Underline a couple of pixels below the baseline. Reuse the
      // per-line width measureText computed (m.lineWidths[i]) so the
      // underline matches the glyph extent exactly.
      const w = m.lineWidths[i] ?? 0
      const underlineY = y + t.font.size * 1.05
      ctx.beginPath()
      ctx.moveTo(baseX, underlineY)
      ctx.lineTo(baseX + w, underlineY)
      ctx.lineWidth = Math.max(1, t.font.size * 0.07)
      ctx.strokeStyle = resolveColor(t.color)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawMultiSelectionOutline(
  ctx: CanvasRenderingContext2D,
  t: TextObject,
  scale: number,
): void {
  const { x, y, w, h } = t.transform
  ctx.save()
  ctx.strokeStyle = MULTI_SELECTION_OUTLINE_COLOR
  ctx.lineWidth = 2 / scale
  ctx.setLineDash([6 / scale, 4 / scale])
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}
