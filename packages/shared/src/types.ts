/**
 * Types shared between web and server. All coordinates are in board space
 * (CSS pixels at zoom 1.0); the camera transform translates to screen space
 * at render time.
 */

export interface Sample {
  /** Board-space x, CSS pixels. */
  x: number
  /** Board-space y, CSS pixels. */
  y: number
  /** Pressure 0..1 with γ curve already applied. */
  p: number
  /** Pen tilt in degrees, if reported by the device. */
  tx?: number
  ty?: number
  /** performance.now() at sample acquisition. */
  t: number
}

export interface BrushConfig {
  /** Base stroke size in CSS pixels at full pressure. */
  size: number
  /** CSS color. */
  color: string
  /** perfect-freehand thinning [-1, 1]. */
  thinning: number
  /** perfect-freehand smoothing [0, 1]. */
  smoothing: number
  /** perfect-freehand streamline [0, 1]. */
  streamline: number
  /** Per-end taper distance in pixels. */
  taperStart: number
  taperEnd: number
  /** Whether to draw the start/end cap. */
  capStart: boolean
  capEnd: boolean
  /** Pressure curve gamma. p_out = p_in ** gamma. ~2.0 for Wacom Intuos. */
  pressureGamma: number
}

export interface Stroke {
  id: string
  brush: BrushConfig
  samples: Sample[]
  /** performance.now() at pointerdown. */
  startedAt: number
}
