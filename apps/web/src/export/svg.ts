/**
 * SVG export. Custom serializer:
 *   - viewBox-bounded <svg>
 *   - optional grid <pattern> (dots / lines / ruled) — skipped for 'none'
 *   - per-stroke <path> derived from perfect-freehand outline
 *   - <mask> with subtractive <circle>s per erasedStamp so wipe-erased holes
 *     are preserved (M2 § 6.7.3)
 *   - highlighter detection: brushes with opacity < 0.6 + thinning === 0 get
 *     mix-blend-mode: multiply so they read like marker on paper
 *
 * No DOM dependency in the serializer itself — pure string output wrapped
 * in a Blob — so tests can verify content without jsdom.
 */

import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import { getStroke } from 'perfect-freehand'
import { imageAABB, imageCenter } from '../imagegeom'
import type { GridType, SettingsV1 } from '../settings'
import { FONT_CSS, TEXT_PADDING_X, TEXT_PADDING_Y, measureText, textAABB } from '../textgeom'
import { resolveInkColor } from '../theme'
import type { Bounds } from './bounds'

/** Image bytes pre-encoded as a data URI, keyed by image id. The caller
 *  prepares this so the serializer stays pure-string-out (no DOM/IO). */
export type ImageDataUriMap = Map<string, string>

export function exportSVG(
  strokes: Stroke[],
  images: readonly ImageObject[],
  imageDataUris: ImageDataUriMap,
  texts: readonly TextObject[],
  bounds: Bounds,
  settings: SettingsV1,
): Blob {
  // Resolve theme tokens at export time so the SVG matches the user's
  // active theme. Dark theme → dark bg + lighter grid; light theme → light
  // bg + darker grid. Strokes use resolveInkColor below (same path). Bun's
  // test runner has no DOM, so we fall back to sensible light-theme defaults.
  const styles = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const bg = styles?.getPropertyValue('--bg-canvas').trim() || '#ffffff'
  const gridDot = styles?.getPropertyValue('--grid-dot').trim() || 'rgba(0,0,0,0.18)'
  const gridLine = styles?.getPropertyValue('--grid-line').trim() || 'rgba(0,0,0,0.12)'

  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(bounds.x)} ${fmt(bounds.y)} ${fmt(bounds.width)} ${fmt(bounds.height)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}">`,
  )

  // Background rect (theme-derived). Always present so dark-theme exports
  // render correctly when opened in any viewer.
  parts.push(
    `<rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="${escapeAttr(bg)}"/>`,
  )

  // Grid (omitted for type 'none').
  if (settings.grid.type !== 'none') {
    parts.push(renderGridDefs(settings.grid.type, settings.grid.spacing, gridDot, gridLine))
    parts.push(
      `<rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="url(#wb-grid)"/>`,
    )
  }

  // Images (z-order; below strokes). One <image> per non-deleted image
  // whose data URI was prepared by the caller AND whose rotation-aware
  // bounding box intersects the export bounds — the latter prevents
  // off-screen images from bloating a `scope: 'visible'` export. Missing
  // data URIs are skipped silently so a single store miss doesn't abort
  // the whole SVG.
  //
  // Rotation: SVG's `transform="rotate(deg cx cy)"` rotates around the
  // image center. Radians → degrees because SVG takes degrees.
  const boundsMaxX = bounds.x + bounds.width
  const boundsMaxY = bounds.y + bounds.height
  const sortedImages = [...images].filter((i) => !i.deleted).sort((a, b) => a.z - b.z)
  for (const img of sortedImages) {
    const href = imageDataUris.get(img.id)
    if (!href) continue
    const bb = imageAABB(img)
    if (bb.maxX < bounds.x || bb.minX > boundsMaxX) continue
    if (bb.maxY < bounds.y || bb.minY > boundsMaxY) continue
    const { x, y, w, h } = img.transform
    const r = img.rotation ?? 0
    const center = imageCenter(img.transform)
    const transformAttr =
      r === 0
        ? ''
        : ` transform="rotate(${fmt((r * 180) / Math.PI)} ${fmt(center.x)} ${fmt(center.y)})"`
    parts.push(
      `<image href="${escapeAttr(href)}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="none"${transformAttr}/>`,
    )
  }

  // Texts go above images, below strokes (matching the on-screen layer
  // order). One <text> element per text object with one <tspan> per line
  // so positioning is explicit per line and CSS line-height isn't
  // required. Visibility cull by rotation-aware AABB intersection with
  // the export bounds; rotation transform via SVG's transform attribute.
  const sortedTexts = [...texts].filter((t) => !t.deleted).sort((a, b) => a.z - b.z)
  const textEls: string[] = []
  for (const t of sortedTexts) {
    const bb = textAABB(t)
    if (bb.maxX < bounds.x || bb.minX > boundsMaxX) continue
    if (bb.maxY < bounds.y || bb.minY > boundsMaxY) continue
    const r = t.rotation ?? 0
    // Use measureText so wrap-width text (greedy word-wrap split during
    // measurement) emits the same lines on export as it shows in the
    // editor. Without this, a wrapped block would export as a single
    // tspan-per-newline (visible only at hard-break positions).
    const m = measureText(t.content, t.font, t.wrapWidth)
    const baseX = t.transform.x + TEXT_PADDING_X
    const baseY = t.transform.y + TEXT_PADDING_Y
    const fill = resolveInkColor(t.color)
    const fontFamily = FONT_CSS[t.font.family]
    const fontStyle = t.font.italic ? ' font-style="italic"' : ''
    const fontWeight = t.font.bold ? ' font-weight="700"' : ''
    const transformAttr =
      Math.abs(r) < 1e-9
        ? ''
        : ` transform="rotate(${fmt((r * 180) / Math.PI)} ${fmt(t.transform.x + t.transform.w / 2)} ${fmt(t.transform.y + t.transform.h / 2)})"`
    const tspans = m.lines
      .map((line, i) => {
        // Use dominant-baseline=hanging so the y coordinate is the top of
        // the line — matches canvas's textBaseline='top' so the export
        // aligns with the editor's WYSIWYG view.
        const y = baseY + i * m.lineHeight
        return `<tspan x="${fmt(baseX)}" y="${fmt(y)}">${escapeText(line)}</tspan>`
      })
      .join('')
    const textDecoration = t.font.underline ? ' text-decoration="underline"' : ''
    textEls.push(
      `<text font-family="${escapeAttr(fontFamily)}" font-size="${fmt(t.font.size)}" fill="${escapeAttr(fill)}" dominant-baseline="hanging"${fontStyle}${fontWeight}${textDecoration}${transformAttr}>${tspans}</text>`,
    )
  }

  // Per-stroke. Collect mask <defs> separately and inject after grid.
  const maskDefs: string[] = []
  const strokeEls: string[] = []
  let idx = 0
  for (const s of strokes) {
    if (s.deleted) continue
    if (s.samples.length === 0) continue
    const points: [number, number, number][] = s.samples.map((p) => [p.x, p.y, p.p])
    const outline = getStroke(points, {
      size: s.brush.size,
      thinning: s.brush.thinning,
      smoothing: s.brush.smoothing,
      streamline: s.brush.streamline,
      start: { taper: s.brush.taperStart, cap: s.brush.capStart },
      end: { taper: s.brush.taperEnd, cap: s.brush.capEnd },
      simulatePressure: false,
      last: true,
    })
    if (outline.length === 0) continue
    const d = outlineToPath(outline)
    const fill = resolveInkColor(s.brush.color)
    const opacity = s.brush.opacity ?? 1
    const isHighlighter = opacity < 0.6 && s.brush.thinning === 0
    const styleAttr = isHighlighter ? ' style="mix-blend-mode:multiply"' : ''
    let maskAttr = ''
    if (s.erasedStamps && s.erasedStamps.length > 0) {
      const maskId = `wb-mask-${idx}`
      const circles = s.erasedStamps
        .map((st) => `<circle cx="${fmt(st.x)}" cy="${fmt(st.y)}" r="${fmt(st.r)}" fill="black"/>`)
        .join('')
      maskDefs.push(
        `<mask id="${maskId}"><rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="white"/>${circles}</mask>`,
      )
      maskAttr = ` mask="url(#${maskId})"`
    }
    strokeEls.push(
      `<path d="${d}" fill="${fill}" opacity="${fmt(opacity)}"${styleAttr}${maskAttr}/>`,
    )
    idx++
  }

  if (maskDefs.length > 0) {
    parts.push(`<defs>${maskDefs.join('')}</defs>`)
  }
  for (const el of textEls) parts.push(el)
  for (const el of strokeEls) parts.push(el)
  parts.push('</svg>')
  return new Blob([parts.join('\n')], { type: 'image/svg+xml' })
}

function renderGridDefs(
  type: GridType,
  spacing: number,
  dotColor: string,
  lineColor: string,
): string {
  if (type === 'dots') {
    return `<defs><pattern id="wb-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.8" fill="${escapeAttr(dotColor)}"/></pattern></defs>`
  }
  if (type === 'lines') {
    return `<defs><pattern id="wb-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><path d="M 0 0 L ${spacing} 0 M 0 0 L 0 ${spacing}" stroke="${escapeAttr(lineColor)}" stroke-width="0.5" fill="none"/></pattern></defs>`
  }
  // 'ruled' — horizontal lines only (notebook paper).
  return `<defs><pattern id="wb-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><path d="M 0 0 L ${spacing} 0" stroke="${escapeAttr(lineColor)}" stroke-width="0.5" fill="none"/></pattern></defs>`
}

/** Escape SVG text content. `&` first to avoid double-encoding, then
 *  `<` and `>` so the content can't open or close adjacent elements. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  // Escape the SVG attribute-value reserved characters. Originally written
  // for color strings (which only need '<' and '"' guards in practice);
  // now also used for image data-URI hrefs, which can legitimately contain
  // '&' as part of a charset parameter or similar. '&' must be escaped
  // FIRST so the subsequent replacements don't double-encode the entity
  // (e.g. `&quot;` would become `&amp;quot;`).
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function outlineToPath(outline: number[][]): string {
  const n = outline.length
  if (n === 0) return ''
  const first = outline[0]
  if (!first || first[0] === undefined || first[1] === undefined) return ''

  // Mirror the canvas path in stroke.ts `outlineToPath2D`: quadratic-curve
  // hull around the outline points using `Q cur midX midY`. This matches
  // `quadraticCurveTo(cur_x, cur_y, midX, midY)` exactly, so the exported
  // SVG renders identically to the on-screen canvas (no sharp corners on
  // short strokes — the WYSIWYG export tenet).
  const parts: string[] = [`M ${fmt(first[0])} ${fmt(first[1])}`]
  for (let i = 0; i < n; i++) {
    const cur = outline[i]
    const nxt = outline[(i + 1) % n]
    if (!cur || !nxt) continue
    const x0 = cur[0]
    const y0 = cur[1]
    const x1 = nxt[0]
    const y1 = nxt[1]
    if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) continue
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2
    parts.push(`Q ${fmt(x0)} ${fmt(y0)} ${fmt(mx)} ${fmt(my)}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0'
}
