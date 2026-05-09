/**
 * Subtle dot grid that fills the visible viewport in screen space.
 * Hides as the camera zooms out far enough that dots would visually merge.
 */

import type { Camera } from './camera'
import type { CanvasLayer } from './render'

const BOARD_SPACING = 24
const MIN_SCREEN_SPACING = 6

export function drawGrid(
  layer: CanvasLayer,
  camera: Camera,
  screenW: number,
  screenH: number,
): void {
  const screenSpacing = BOARD_SPACING * camera.scale
  if (screenSpacing < MIN_SCREEN_SPACING) return

  const dotColor =
    getComputedStyle(document.documentElement).getPropertyValue('--grid-dot').trim() ||
    'rgba(0,0,0,0.06)'

  const ctx = layer.ctx
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = dotColor

  const startBoardX = Math.floor(camera.x / BOARD_SPACING) * BOARD_SPACING
  const startBoardY = Math.floor(camera.y / BOARD_SPACING) * BOARD_SPACING
  const endBoardX = camera.x + screenW / camera.scale + BOARD_SPACING
  const endBoardY = camera.y + screenH / camera.scale + BOARD_SPACING

  const dpr = window.devicePixelRatio || 1
  const dotSize = Math.max(1, Math.round(dpr))

  for (let bx = startBoardX; bx < endBoardX; bx += BOARD_SPACING) {
    for (let by = startBoardY; by < endBoardY; by += BOARD_SPACING) {
      const sx = (bx - camera.x) * camera.scale
      const sy = (by - camera.y) * camera.scale
      ctx.fillRect(sx * dpr - dotSize / 2, sy * dpr - dotSize / 2, dotSize, dotSize)
    }
  }

  ctx.restore()
}
