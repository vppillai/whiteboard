/**
 * Background grid renderer in screen space. Supports four types:
 *
 *   - dots:  spaced dots at every (spacing, spacing) board-position
 *   - lines: square grid (horizontal + vertical lines)
 *   - ruled: notebook paper (horizontal lines only)
 *   - none:  no grid drawn
 *
 * Grid fades out by skipping the draw entirely when the projected screen
 * spacing falls below MIN_SCREEN_SPACING — beyond that point, dots/lines
 * would visually merge into noise.
 */

import type { Camera } from './camera'
import type { CanvasLayer } from './render'
import type { GridConfig, GridType } from './settings'

const MIN_SCREEN_SPACING = 6

export type { GridType }

export function drawGrid(
  layer: CanvasLayer,
  camera: Camera,
  screenW: number,
  screenH: number,
  config: GridConfig,
): void {
  if (config.type === 'none') return

  const screenSpacing = config.spacing * camera.scale
  if (screenSpacing < MIN_SCREEN_SPACING) return

  const color =
    getComputedStyle(document.documentElement).getPropertyValue('--grid-dot').trim() ||
    'rgba(0,0,0,0.06)'

  const ctx = layer.ctx
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  const dpr = window.devicePixelRatio || 1

  if (config.type === 'dots') {
    drawDots(ctx, camera, screenW, screenH, config.spacing, dpr, color)
  } else {
    drawLines(ctx, camera, screenW, screenH, config.spacing, dpr, color, config.type === 'lines')
  }

  ctx.restore()
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  screenW: number,
  screenH: number,
  spacing: number,
  dpr: number,
  color: string,
): void {
  ctx.fillStyle = color
  const dotSize = Math.max(1, Math.round(dpr))

  const startBoardX = Math.floor(camera.x / spacing) * spacing
  const startBoardY = Math.floor(camera.y / spacing) * spacing
  const endBoardX = camera.x + screenW / camera.scale + spacing
  const endBoardY = camera.y + screenH / camera.scale + spacing

  for (let bx = startBoardX; bx < endBoardX; bx += spacing) {
    for (let by = startBoardY; by < endBoardY; by += spacing) {
      const sx = (bx - camera.x) * camera.scale
      const sy = (by - camera.y) * camera.scale
      ctx.fillRect(sx * dpr - dotSize / 2, sy * dpr - dotSize / 2, dotSize, dotSize)
    }
  }
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  screenW: number,
  screenH: number,
  spacing: number,
  dpr: number,
  color: string,
  withVertical: boolean,
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, Math.round(dpr * 0.7))
  ctx.beginPath()

  const startBoardX = Math.floor(camera.x / spacing) * spacing
  const startBoardY = Math.floor(camera.y / spacing) * spacing
  const endBoardX = camera.x + screenW / camera.scale + spacing
  const endBoardY = camera.y + screenH / camera.scale + spacing

  for (let by = startBoardY; by < endBoardY; by += spacing) {
    const sy = ((by - camera.y) * camera.scale * dpr) | 0
    ctx.moveTo(0, sy + 0.5)
    ctx.lineTo(screenW * dpr, sy + 0.5)
  }

  if (withVertical) {
    for (let bx = startBoardX; bx < endBoardX; bx += spacing) {
      const sx = ((bx - camera.x) * camera.scale * dpr) | 0
      ctx.moveTo(sx + 0.5, 0)
      ctx.lineTo(sx + 0.5, screenH * dpr)
    }
  }

  ctx.stroke()
}
