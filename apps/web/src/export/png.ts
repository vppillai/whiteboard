/**
 * PNG export. Renders all non-deleted strokes (theme-aware bg + grid + strokes
 * with destination-out erasure) into a detached HTMLCanvasElement sized to
 * the board bounds, then converts via `canvas.toBlob`.
 *
 * Mirrors the on-screen `frame()` pass-1/pass-2 scaffolding so the export
 * matches what the user sees, using the shared `drawStrokeOntoLayer` helper
 * for the per-stroke work.
 */

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { makeCamera } from '../camera'
import { drawGrid } from '../grid'
import { getImageElement, loadImageElement } from '../imagecache'
import type { ImageStore } from '../imagestore'
import { applyCamera, type CanvasLayer, clearLayer, drawStrokeOntoLayer } from '../render'
import { renderShapes } from '../rendershapes'
import type { SettingsV1 } from '../settings'
import { effectiveOpacity, getStrokePath } from '../stroke'
import { fontCss, measureText, TEXT_PADDING_X, TEXT_PADDING_Y } from '../textgeom'
import { resolveInkColor } from '../theme'
import type { Bounds } from './bounds'

export interface PngExportOptions {
  /** Device-pixel-ratio multiplier. Default 1 (matches on-screen-at-100%
   *  zoom). PDF embed bumps to 2 for print quality. */
  dpr?: number
  /** When true, skip the theme-background fill so the PNG has a
   *  transparent background. Used by the lasso clipboard-copy path so
   *  drawings pasted into Docs / Slack / etc. don't bring a canvas-
   *  colored rectangle with them. File exports default `false` (we want
   *  the background visible in a standalone PNG file). */
  transparentBg?: boolean
}

/**
 * Render the board (theme bg + grid + images + strokes + erasure) into a
 * PNG blob. Background color reads from `--bg-canvas` so the export matches
 * the user's active theme — dark theme renders dark-bg PNG so light-ink
 * strokes are visible.
 *
 * Images render in the same z-order as on-screen (paste-time monotonic),
 * below the strokes composite. The `imageStore` is consulted to load any
 * image whose HTMLImageElement isn't already in the runtime cache (e.g.
 * exporting immediately after paste before the cache promise settled).
 */
export async function exportPNG(
  strokes: Stroke[],
  images: readonly ImageObject[],
  texts: readonly TextObject[],
  shapes: readonly ShapeObject[],
  bounds: Bounds,
  settings: SettingsV1,
  imageStore: ImageStore | null,
  options: PngExportOptions = {},
): Promise<Blob> {
  const dpr = options.dpr ?? 1
  const w = Math.max(1, Math.ceil(bounds.width * dpr))
  const h = Math.max(1, Math.ceil(bounds.height * dpr))

  const strokesLayer = makeDetachedLayer(w, h)
  const committedLayer = makeDetachedLayer(w, h)

  // Camera anchored on bounds top-left, no zoom — board coord (bounds.x,
  // bounds.y) maps to canvas (0, 0).
  const camera = makeCamera()
  camera.x = bounds.x
  camera.y = bounds.y
  camera.scale = 1

  // Pre-resolve image elements: the export must be synchronous past this
  // point so we don't drop frames waiting on Blob decodes mid-render.
  // Per-image failures are isolated — one bad decode shouldn't abort the
  // whole export (`Promise.allSettled`, not `Promise.all`). The bad image
  // is silently dropped from the output, matching the SVG path's
  // "missing data URI = skip" semantics.
  const visibleImages = [...images].filter((i) => !i.deleted).sort((a, b) => a.z - b.z)
  const imageEls = new Map<string, HTMLImageElement>()
  if (imageStore) {
    const results = await Promise.allSettled(
      visibleImages.map(async (img) => {
        const cached = getImageElement(img.blobRef)
        if (cached) return { id: img.id, el: cached }
        const blob = await imageStore.loadBlob(img.blobRef)
        if (!blob) return null
        const el = await loadImageElement(img.blobRef, blob)
        return { id: img.id, el }
      }),
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) imageEls.set(r.value.id, r.value.el)
      else if (r.status === 'rejected') {
        console.warn('whiteboard/export: image decode failed during PNG export:', r.reason)
      }
    }
  } else {
    for (const img of visibleImages) {
      const el = getImageElement(img.blobRef)
      if (el) imageEls.set(img.id, el)
    }
  }

  // ----- Pass 1: per-stroke draw + destination-out onto strokes layer -----
  clearLayer(strokesLayer)
  applyCamera(strokesLayer, camera, dpr)
  for (const s of strokes) {
    if (s.deleted) continue
    if (s.samples.length === 0) continue
    const path = getStrokePath(s, [], true)
    if (!path) continue
    drawStrokeOntoLayer(
      strokesLayer,
      path,
      resolveInkColor(s.brush.color),
      effectiveOpacity(s),
      s.erasedStamps,
    )
  }

  // ----- Pass 2: committed = (theme bg) + grid + images + composited strokes -----
  clearLayer(committedLayer)
  const cCtx = committedLayer.ctx
  // Theme background — read CSS variable at export time so light / dark
  // themes produce matching PNGs. Skipped when `transparentBg` is set
  // (clipboard-copy path), so pasting into Google Docs / Slack / etc.
  // doesn't bring along a canvas-colored rectangle. The grid is ALSO
  // skipped on transparent renders — a grid on a transparent background
  // looks wrong (no canvas underneath it) and isn't what a "drawing only"
  // copy implies.
  if (!options.transparentBg) {
    cCtx.save()
    cCtx.setTransform(1, 0, 0, 1, 0, 0)
    cCtx.fillStyle = resolveBgColor()
    cCtx.fillRect(0, 0, w, h)
    cCtx.restore()
  }
  applyCamera(committedLayer, camera, dpr)
  if (!options.transparentBg) {
    drawGrid(committedLayer, camera, bounds.width, bounds.height, settings.grid)
  }
  // Images go between grid and strokes — they're "below" the strokes
  // visually. drawImage uses the current board-space transform; rotation
  // is applied by translating to the image center, rotating, drawing
  // centered, and restoring.
  for (const img of visibleImages) {
    const el = imageEls.get(img.id)
    if (!el) continue
    const { x, y, w: iw, h: ih } = img.transform
    const r = img.rotation ?? 0
    if (r === 0) {
      cCtx.drawImage(el, x, y, iw, ih)
    } else {
      cCtx.save()
      cCtx.translate(x + iw / 2, y + ih / 2)
      cCtx.rotate(r)
      cCtx.drawImage(el, -iw / 2, -ih / 2, iw, ih)
      cCtx.restore()
    }
  }
  // Texts go above images, below strokes — matching the on-screen layer
  // order. Each text is rendered via the same per-line fillText pass the
  // on-canvas render uses, so what you see is what you export.
  const visibleTexts = [...texts].filter((t) => !t.deleted).sort((a, b) => a.z - b.z)
  for (const t of visibleTexts) {
    const r = t.rotation ?? 0
    if (Math.abs(r) < 1e-9) {
      drawTextOntoCanvas(cCtx, t)
    } else {
      cCtx.save()
      const cx = t.transform.x + t.transform.w / 2
      const cy = t.transform.y + t.transform.h / 2
      cCtx.translate(cx, cy)
      cCtx.rotate(r)
      const local: TextObject = {
        ...t,
        transform: {
          x: -t.transform.w / 2,
          y: -t.transform.h / 2,
          w: t.transform.w,
          h: t.transform.h,
        },
      }
      drawTextOntoCanvas(cCtx, local)
      cCtx.restore()
    }
  }

  // Shapes render above texts and below the strokes composite — same
  // stacking as the on-screen pass (see renderShapes.ts). We reuse
  // renderShapes directly so the in-app render and the exported PNG
  // can't visually drift. viewBBox is the full export bounds — no
  // culling is desired for export.
  renderShapes({
    shapes,
    layer: committedLayer,
    camera,
    viewBBox: {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
    },
    resolveColor: resolveInkColor,
    isMultiSelected: () => false,
  })

  cCtx.save()
  cCtx.setTransform(1, 0, 0, 1, 0, 0)
  cCtx.drawImage(strokesLayer.el, 0, 0)
  cCtx.restore()

  return new Promise((resolve, reject) => {
    committedLayer.el.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('export/png: canvas.toBlob returned null'))
    }, 'image/png')
  })
}

function resolveBgColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim()
  return v || '#ffffff'
}

function makeDetachedLayer(w: number, h: number): CanvasLayer {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  const ctx = el.getContext('2d')
  if (!ctx) throw new Error('export/png: 2D canvas context unavailable')
  return { el, ctx }
}

/** Draw one text object's lines + optional underline onto a 2D context.
 *  Mirrors the on-screen renderer's drawText path in rendertexts.ts —
 *  same metrics + same wrap-width handling so the export matches what
 *  the user sees. Caller has already applied any rotation / translation
 *  to the context. */
function drawTextOntoCanvas(ctx: CanvasRenderingContext2D, t: TextObject): void {
  ctx.save()
  ctx.font = fontCss(t.font)
  ctx.fillStyle = resolveInkColor(t.color)
  ctx.textBaseline = 'top'
  const m = measureText(t.content, t.font, t.wrapWidth)
  const baseX = t.transform.x + TEXT_PADDING_X
  const baseY = t.transform.y + TEXT_PADDING_Y
  for (let i = 0; i < m.lines.length; i++) {
    const line = m.lines[i] ?? ''
    const y = baseY + i * m.lineHeight
    ctx.fillText(line, baseX, y)
    if (t.font.underline) {
      const w = m.lineWidths[i] ?? 0
      const underlineY = y + t.font.size * 1.05
      ctx.beginPath()
      ctx.moveTo(baseX, underlineY)
      ctx.lineTo(baseX + w, underlineY)
      ctx.lineWidth = Math.max(1, t.font.size * 0.07)
      ctx.strokeStyle = resolveInkColor(t.color)
      ctx.stroke()
    }
  }
  ctx.restore()
}
