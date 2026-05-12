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

export function measureText(content: string, font: TextObject['font']): TextMeasurement {
  // No DOM (bun:test runs without one) — fall back to a coarse heuristic
  // so tests can construct TextObjects without crashing. `0.6 × size` is
  // the standard monospace width approximation; close enough for
  // measurement-light tests. Check BEFORE touching `document` so the
  // ReferenceError doesn't fire.
  if (typeof document === 'undefined') {
    const lines = content === '' ? [''] : content.split('\n')
    const lineHeight = font.size * LINE_HEIGHT_MULT
    const lineWidths = lines.map((l) => l.length * font.size * 0.6)
    return {
      width: Math.max(0, ...lineWidths),
      height: lines.length * lineHeight,
      lineWidths,
      lines,
      lineHeight,
    }
  }
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
    measureCtx = measureCanvas.getContext('2d')
  }
  if (!measureCtx) {
    // DOM exists but canvas context unavailable — same coarse fallback.
    const lines = content === '' ? [''] : content.split('\n')
    const lineHeight = font.size * LINE_HEIGHT_MULT
    const lineWidths = lines.map((l) => l.length * font.size * 0.6)
    return {
      width: Math.max(0, ...lineWidths),
      height: lines.length * lineHeight,
      lineWidths,
      lines,
      lineHeight,
    }
  }
  measureCtx.font = fontCss(font)
  const lines = content === '' ? [''] : content.split('\n')
  const lineHeight = font.size * LINE_HEIGHT_MULT
  const lineWidths = lines.map((l) => measureCtx?.measureText(l).width ?? 0)
  return {
    width: Math.max(0, ...lineWidths),
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
  const m = measureText(t.content, t.font)
  return {
    ...t,
    transform: {
      ...t.transform,
      w: m.width + TEXT_PADDING_X * 2,
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
