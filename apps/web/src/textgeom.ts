/**
 * Text-object geometry + font helpers. Single source of truth for:
 *   - Resolving a `TextFontFamily` enum to a CSS font-family stack
 *   - Composing the canvas `font` shorthand from family / size / bold / italic
 *   - Measuring multi-line content against the active font (line-height,
 *     bounding box)
 *   - Hit-testing a board-space point against a text rect
 *
 * Centralizing the font + measurement math here keeps the on-screen render
 * (`rendertexts.ts`), the export render (`png.ts`), the DOM-overlay editor
 * (`tools/text.ts`), and the SVG export (`svg.ts`) in sync. Drift in any
 * one of them would show up as the edited text not matching the rendered
 * text — fatal for a WYSIWYG editor.
 */

import type { TextFontFamily, TextObject } from '@whiteboard/shared'

/**
 * CSS font-family stack for each closed-set family. The first entry is
 * the preferred font; subsequent entries are fallbacks. These are common-
 * across-platforms picks — `ui-monospace` / `ui-sans-serif` / `ui-serif`
 * lead on modern browsers and fall back to OS-default stacks.
 */
export const FONT_CSS: Record<TextFontFamily, string> = {
  mono: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
}

/**
 * Vertical metric — line-height as a multiplier of the font size. Tuned
 * to match what the contenteditable DOM overlay produces when no custom
 * line-height is set, so the canvas-rendered text and the editable line
 * up pixel-for-pixel during edit transitions.
 */
export const LINE_HEIGHT_MULT = 1.25

/** Inner padding around text content in board pixels. Gives the editable
 *  a visible "padding" feel (no text touching the cursor's left edge) and
 *  reserves room for the underline pixel. */
export const TEXT_PADDING_X = 6
export const TEXT_PADDING_Y = 4

/**
 * Compose the canvas 2D `font` shorthand. Order is `[italic] [bold]
 * <size>px <family>` per the CSS font shorthand grammar. Caller passes the
 * raw size in board-pixels; the camera transform handles screen scaling
 * at draw time.
 */
export function fontCss(font: TextObject['font']): string {
  const style = font.italic ? 'italic ' : ''
  const weight = font.bold ? '700 ' : ''
  return `${style}${weight}${font.size}px ${FONT_CSS[font.family]}`
}

/**
 * Measure the bounding box for the given content in the given font.
 * Returns content-only width/height (no padding) and the per-line widths
 * so the underline pass can stroke each line without re-measuring.
 *
 * Uses a detached canvas's 2D context for measurement — same algorithm
 * the render passes use, so what you measure is what you draw. The
 * canvas is module-singleton to avoid allocating one per call.
 *
 * Edge case: an empty content string measures as a zero-width line so the
 * text retains its caret height during placement (otherwise an empty
 * placeholder text would have w=h=0 and be invisible to the hit-tester).
 */
let measureCanvas: HTMLCanvasElement | null = null
let measureCtx: CanvasRenderingContext2D | null = null

export interface TextMeasurement {
  /** Content-only width (max of per-line widths). */
  width: number
  /** Content-only height (lines × line-height in pixels). */
  height: number
  /** Per-line widths, in the same order as content.split('\n'). */
  lineWidths: number[]
  /** Per-line content (cached split so callers don't redo it). */
  lines: string[]
  /** Computed line-height in pixels (font.size × LINE_HEIGHT_MULT). */
  lineHeight: number
}

/**
 * Greedy word-wrap a single line into multiple lines fitting `maxWidth`.
 * Used only when the text has `wrapWidth` set. Splits on whitespace runs
 * but keeps trailing whitespace with the preceding word. A single
 * "word" that exceeds maxWidth on its own is character-split — defensive
 * for long URLs / no-break sequences.
 */
function wrapLine(line: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (line === '' || maxWidth <= 0) return [line]
  if (measure(line) <= maxWidth) return [line]
  const tokens = line.match(/\S+\s*/g) ?? [line]
  const out: string[] = []
  let current = ''
  for (const tok of tokens) {
    const candidate = current + tok
    if (measure(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) {
      out.push(current.trimEnd())
      current = ''
    }
    if (measure(tok) > maxWidth) {
      // Word exceeds the wrap width on its own — character-split.
      let chunk = ''
      for (const ch of tok) {
        if (measure(chunk + ch) > maxWidth) {
          if (chunk) out.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      if (chunk) current = chunk
    } else {
      current = tok
    }
  }
  if (current) out.push(current.trimEnd())
  return out.length > 0 ? out : [line]
}

/**
 * Per-TextObject measurement cache. The committed re-render pass calls
 * `measureText(t.content, t.font, t.wrapWidth)` once per visible text per
 * dirty frame — for boards with many wrapped texts the greedy word-wrap +
 * per-token `ctx.measureText` calls were a hot allocation/CPU site. Same
 * pattern as `bboxCache` in `stroke.ts` — keyed by object identity, dropped
 * via `invalidateTextMeasurement` whenever an op mutates content / font /
 * wrapWidth (see `setTextEdit` in ops.ts).
 */
const measurementCache = new WeakMap<TextObject, TextMeasurement>()

/** Cached form of `measureText` keyed by the TextObject reference. The
 *  in-edit text is rendered through the DOM overlay, not the canvas pass,
 *  so its measurement is never consulted while content is mutating. */
export function getTextMeasurement(t: TextObject): TextMeasurement {
  let m = measurementCache.get(t)
  if (!m) {
    m = measureText(t.content, t.font, t.wrapWidth)
    measurementCache.set(t, m)
  }
  return m
}

/** Drop the cached measurement for `t`. Called from `setTextEdit` (the
 *  one ops.ts site that mutates content / font / wrapWidth in place) so
 *  the next renderpass re-measures against the new payload. */
export function invalidateTextMeasurement(t: TextObject): void {
  measurementCache.delete(t)
}

export function measureText(
  content: string,
  font: TextObject['font'],
  wrapWidth?: number,
): TextMeasurement {
  const lineHeight = font.size * LINE_HEIGHT_MULT
  const rawLines = content === '' ? [''] : content.split('\n')

  // Resolve a measurement primitive. Three tiers, in order of fidelity:
  //   1. DOM canvas (browser, accurate per-glyph metrics)
  //   2. `0.6 × size × char-count` heuristic (bun:test / no DOM)
  //   3. Same heuristic if the canvas context isn't available
  let measure: (s: string) => number
  if (typeof document === 'undefined') {
    measure = (s) => s.length * font.size * 0.6
  } else {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas')
      measureCtx = measureCanvas.getContext('2d')
    }
    if (measureCtx) {
      measureCtx.font = fontCss(font)
      const ctx = measureCtx
      measure = (s) => ctx.measureText(s).width
    } else {
      measure = (s) => s.length * font.size * 0.6
    }
  }

  const lines =
    wrapWidth && wrapWidth > 0 ? rawLines.flatMap((l) => wrapLine(l, wrapWidth, measure)) : rawLines
  const lineWidths = lines.map(measure)
  return {
    width: lineWidths.length === 0 ? 0 : Math.max(0, ...lineWidths),
    height: lines.length * lineHeight,
    lineWidths,
    lines,
    lineHeight,
  }
}

/**
 * Recompute a TextObject's transform.w/h from its content + font. Returns
 * a NEW TextObject (immutable update). Padded so the rendered rect
 * matches what the DOM-overlay editor shows during edit. Used by the
 * text tool after any edit op (content change, font change, B/I toggle).
 */
export function resizeToFit(t: TextObject): TextObject {
  // When wrapWidth is set, the rect's width is FIXED to wrapWidth +
  // padding — the content wraps to fit that width, and only the height
  // grows with the wrapped line count. Without wrapWidth, the width is
  // the natural measured width (longest line).
  const m = measureText(t.content, t.font, t.wrapWidth)
  const w =
    t.wrapWidth && t.wrapWidth > 0 ? t.wrapWidth + TEXT_PADDING_X * 2 : m.width + TEXT_PADDING_X * 2
  return {
    ...t,
    transform: {
      ...t.transform,
      w,
      h: m.height + TEXT_PADDING_Y * 2,
    },
  }
}

/**
 * Axis-aligned bounding box of the text rect, accounting for rotation.
 * Mirrors `imageAABB` so callers (export bounds, viewport cull) can use
 * the same pattern across object types.
 */
export function textAABB(t: TextObject): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const r = t.rotation ?? 0
  const { x, y, w, h } = t.transform
  if (Math.abs(r) < 1e-9) {
    return { minX: x, minY: y, maxX: x + w, maxY: y + h }
  }
  // Rotated AABB via corner rotation around center.
  const cx = x + w / 2
  const cy = y + h / 2
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const corners: { x: number; y: number }[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of corners) {
    const dx = p.x - cx
    const dy = p.y - cy
    const px = cx + dx * cos - dy * sin
    const py = cy + dx * sin + dy * cos
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Point-in-text-rect test. Uses the rotation-aware reverse-rotation trick
 * (rotate the test point into the text's local space, then a plain AABB).
 * Currently text is unrotated in v1 so this collapses to a plain AABB,
 * but the shape stays symmetric with `pointInImage` for the future.
 */
export function pointInText(p: { x: number; y: number }, t: TextObject): boolean {
  const r = t.rotation ?? 0
  const { x, y, w, h } = t.transform
  if (Math.abs(r) < 1e-9) {
    return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h
  }
  const cx = x + w / 2
  const cy = y + h / 2
  const cos = Math.cos(-r)
  const sin = Math.sin(-r)
  const dx = p.x - cx
  const dy = p.y - cy
  const localX = cx + dx * cos - dy * sin
  const localY = cy + dx * sin + dy * cos
  return localX >= x && localX <= x + w && localY >= y && localY <= y + h
}
