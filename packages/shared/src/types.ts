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
  /** 0..1 fill alpha. Defaults to 1 when omitted. < 1 produces visible
   *  layering where strokes overlap, which reads as "real ink". */
  opacity?: number
}

export interface Stroke {
  id: string
  brush: BrushConfig
  samples: Sample[]
  /** performance.now() at pointerdown. */
  startedAt: number
  /**
   * Soft-delete flag. The renderer filters strokes with `deleted === true`;
   * undo of a stroke creation flips this to `true`; redo flips it back to
   * `false`. The stroke is never removed from the in-memory array or from
   * IndexedDB, which keeps undo / redo cheap and CRDT-friendly when M3
   * sync lands.
   */
  deleted?: boolean
  /**
   * Cursor-disk stamps that erase pixels from this stroke at render time
   * ([ADR 0009](docs/decisions/0009-pixel-mask-eraser.md)). Each
   * `{ x, y, r }` is one cursor position recorded during a wipe sweep
   * (board coords, board-pixel radius). Sparse — omitted when the stroke
   * has not been wiped.
   *
   * Semantically a per-stroke pixel mask: the renderer draws the stroke
   * outline normally and then applies `globalCompositeOperation =
   * 'destination-out'` for each stamp, subtracting the disk's pixels
   * from the rendered ink.
   */
  erasedStamps?: { x: number; y: number; r: number }[]
}
