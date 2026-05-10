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

import type { Stroke } from '@whiteboard/shared'
import { getStroke } from 'perfect-freehand'
import type { GridType, SettingsV1 } from '../settings'
import { resolveInkColor } from '../theme'
import type { Bounds } from './bounds'

export function exportSVG(strokes: Stroke[], bounds: Bounds, settings: SettingsV1): Blob {
  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(bounds.x)} ${fmt(bounds.y)} ${fmt(bounds.width)} ${fmt(bounds.height)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}">`,
  )

  // Grid (omitted for type 'none').
  if (settings.grid.type !== 'none') {
    parts.push(renderGridDefs(settings.grid.type, settings.grid.spacing))
    parts.push(
      `<rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="url(#wb-grid)"/>`,
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
  for (const el of strokeEls) parts.push(el)
  parts.push('</svg>')
  return new Blob([parts.join('\n')], { type: 'image/svg+xml' })
}

function renderGridDefs(type: GridType, spacing: number): string {
  if (type === 'dots') {
    return `<defs><pattern id="wb-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.8" fill="#d4d4d8"/></pattern></defs>`
  }
  if (type === 'lines') {
    return (
      `<defs><pattern id="wb-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse">` +
      `<path d="M 0 0 L ${spacing} 0 M 0 0 L 0 ${spacing}" stroke="#e4e4e7" stroke-width="0.5" fill="none"/></pattern></defs>`
    )
  }
  // 'ruled' — horizontal lines only (notebook paper).
  return (
    `<defs><pattern id="wb-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse">` +
    `<path d="M 0 0 L ${spacing} 0" stroke="#e4e4e7" stroke-width="0.5" fill="none"/></pattern></defs>`
  )
}

function outlineToPath(outline: number[][]): string {
  if (outline.length === 0) return ''
  const parts: string[] = []
  const first = outline[0]
  if (!first || first[0] === undefined || first[1] === undefined) return ''
  parts.push(`M ${fmt(first[0])} ${fmt(first[1])}`)
  for (let i = 1; i < outline.length; i++) {
    const p = outline[i]
    if (!p || p[0] === undefined || p[1] === undefined) continue
    parts.push(`L ${fmt(p[0])} ${fmt(p[1])}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0'
}
