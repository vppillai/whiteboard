/**
 * Color eyedropper tool. Modal — activated via `I` key, right-click TOOL pill,
 * or programmatic `setTool('eyedropper')`. On pointermove, samples the strokes
 * offscreen layer (ADR 0009) at cursor position. On pointerdown, commits the
 * sampled color to settings and reverts to the previous tool.
 *
 * Conforms to ADR 0007: owns its cursor (the live-layer sampled-color disc),
 * sample logic, and right-click pill (added in toolmenu.ts at Task 17).
 *
 * Sample source: the strokes offscreen layer (NOT committed — grid lives on
 * committed and would pollute samples). Alpha < 0.5 holds the previous sample
 * so the cursor disc doesn't flicker over wipe-erased regions.
 */

import { applyCamera, clearLayer } from '../render'
import { pushRecentColor, setColor } from '../settings'
import type { Tool, ToolContext, ToolId } from './types'

export interface EyedropperToolCallbacks {
  /** Look up the strokes offscreen canvas (ADR 0009 destination-out target). */
  getStrokesCanvas: () => HTMLCanvasElement
  /** Switch the active tool — typically the orchestrator's setTool. */
  setTool: (id: ToolId) => void
}

export interface EyedropperToolOptions {
  callbacks: EyedropperToolCallbacks
}

export function createEyedropperTool(opts: EyedropperToolOptions): Tool {
  const { callbacks } = opts
  let prevToolId: ToolId | null = null
  let lastSampledHex: string | null = null
  let cursorClientX = 0
  let cursorClientY = 0
  let cursorActive = false

  return {
    id: 'eyedropper',
    // Hide the OS cursor — we draw our own filled disc on the live layer.
    cursor: 'none',

    onActivate(fromTool: ToolId) {
      // Remember the caller so pointerdown can revert. If the user
      // activates eyedropper while already in eyedropper (no-op in
      // practice — setTool guards against that), don't pin a loop.
      prevToolId = fromTool === 'eyedropper' ? null : fromTool
    },

    onPointerDown(_e: PointerEvent, _ctx: ToolContext) {
      if (lastSampledHex) {
        setColor(lastSampledHex)
        pushRecentColor(lastSampledHex)
      }
      const restore = prevToolId
      prevToolId = null
      cursorActive = false
      lastSampledHex = null
      if (restore !== null && restore !== 'eyedropper') {
        callbacks.setTool(restore)
      }
    },

    onPointerMove(e: PointerEvent, ctx: ToolContext) {
      cursorClientX = e.clientX
      cursorClientY = e.clientY
      cursorActive = true
      const sampled = sampleAt(callbacks.getStrokesCanvas(), e.clientX, e.clientY, ctx.dpr)
      if (sampled !== null) {
        lastSampledHex = sampled
      }
      // Redraw the cursor disc on the live layer.
      drawCursorDisc(ctx, cursorClientX, cursorClientY, lastSampledHex)
    },

    onPointerUp(_e: PointerEvent, _ctx: ToolContext) {
      // Commit happens on pointerdown; no-op here.
    },

    redraw(ctx: ToolContext) {
      if (!cursorActive) return
      drawCursorDisc(ctx, cursorClientX, cursorClientY, lastSampledHex)
    },

    cleanup() {
      cursorActive = false
      lastSampledHex = null
      prevToolId = null
    },
  }
}

function drawCursorDisc(
  ctx: ToolContext,
  clientX: number,
  clientY: number,
  hex: string | null,
): void {
  const layer = ctx.liveLayer
  clearLayer(layer)
  // Cursor is drawn in screen pixels (not board pixels) — use identity
  // transform scaled by DPR. The disc follows the screen cursor.
  applyCamera(layer, ctx.camera, ctx.dpr)
  const c = layer.ctx
  const dpr = ctx.dpr
  // Convert client coords to canvas pixel coords.
  const canvasRect = layer.el.getBoundingClientRect()
  const px = (clientX - canvasRect.left) * dpr
  const py = (clientY - canvasRect.top) * dpr
  c.save()
  // Reset to identity so we draw in screen pixels regardless of camera.
  c.setTransform(1, 0, 0, 1, 0, 0)
  const r = 8 * dpr // 16 px diameter at 1× DPR
  c.beginPath()
  c.arc(px, py, r, 0, Math.PI * 2)
  c.fillStyle = hex ?? '#ffffff'
  c.fill()
  // Contrast ring (white over black) so the disc is visible on any backdrop.
  c.lineWidth = 1.5 * dpr
  c.strokeStyle = '#ffffff'
  c.stroke()
  c.lineWidth = 0.5 * dpr
  c.strokeStyle = '#000000'
  c.stroke()
  c.restore()
}

function sampleAt(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  dpr: number,
): string | null {
  try {
    const rect = canvas.getBoundingClientRect()
    const px = Math.round((clientX - rect.left) * dpr)
    const py = Math.round((clientY - rect.top) * dpr)
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null
    const c = canvas.getContext('2d')
    if (!c) return null
    const data = c.getImageData(px, py, 1, 1).data
    return rgbaToHex(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0)
  } catch {
    return null
  }
}

export function rgbaToHex(r: number, g: number, b: number, a: number): string | null {
  if (a < 128) return null
  const hex = (n: number) =>
    Math.max(0, Math.min(255, n | 0))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
