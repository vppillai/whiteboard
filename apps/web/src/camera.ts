/**
 * Camera: viewport-into-board mapping. (camera.x, camera.y) is the board-space
 * point that lands at viewport (0, 0). camera.scale > 1 means zoomed in.
 *
 * All math here is pure; no side effects, no DOM.
 */

export interface Camera {
  /** Board-space point at viewport (0, 0). */
  x: number
  y: number
  /** 1 board px maps to `scale` CSS px. Range clamped at usage sites. */
  scale: number
}

export const MIN_SCALE = 0.1
export const MAX_SCALE = 8

export function makeCamera(): Camera {
  return { x: 0, y: 0, scale: 1 }
}

export function screenToBoard(
  camera: Camera,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: screenX / camera.scale + camera.x,
    y: screenY / camera.scale + camera.y,
  }
}

export function boardToScreen(
  camera: Camera,
  boardX: number,
  boardY: number,
): { x: number; y: number } {
  return {
    x: (boardX - camera.x) * camera.scale,
    y: (boardY - camera.y) * camera.scale,
  }
}

export function panByScreen(camera: Camera, dxScreen: number, dyScreen: number): void {
  camera.x -= dxScreen / camera.scale
  camera.y -= dyScreen / camera.scale
}

/**
 * Zoom around a focus point in screen coordinates so that the board point
 * under the focus stays anchored.
 */
export function zoomAt(
  camera: Camera,
  focusScreenX: number,
  focusScreenY: number,
  factor: number,
): void {
  const before = screenToBoard(camera, focusScreenX, focusScreenY)
  camera.scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE)
  camera.x = before.x - focusScreenX / camera.scale
  camera.y = before.y - focusScreenY / camera.scale
}

export function resetZoom(camera: Camera): void {
  camera.scale = 1
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
