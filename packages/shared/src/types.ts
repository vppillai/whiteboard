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
  /** Elapsed milliseconds since the stroke's pointerdown (t = 0 at start).
   *  Epoch-independent so the value survives page reloads and is comparable
   *  across peers if/when the deferred sharing layer returns (ADR 0012). */
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
  /** Optional override of pressureGamma. Quadratic bezier from (0,0) to mid to (1,1)
   *  in normalized 0–1 coords. When present, replaces `pressureGamma` at render time. */
  pressureCurve?: { mid: [number, number] }
}

/**
 * Pasted image on the canvas — a first-class non-stroke object. Stored
 * alongside strokes and rendered below the stroke layer so pen strokes
 * draw on top naturally.
 *
 * Pen / Eraser tools treat images as inert (no hit-testing, no selection
 * state). The dedicated Select tool drives move / resize / delete. Z-order
 * is paste-time monotonic (no manual reordering at v1).
 *
 * The binary lives in a sibling IDB object store (`images-blob`) keyed by
 * `blobRef`. v1: `blobRef === id`. Separate field is forward-compat for
 * a future where the bytes live on a sync server (M5.1 per ADR 0012).
 */
export interface ImageObject {
  id: string
  blobRef: string
  format: 'png' | 'jpeg' | 'webp' | 'gif'
  /** Original pixel dimensions; preserved for aspect-ratio-constrained resize. */
  natural: { w: number; h: number }
  /** Canvas-space rect — (x, y) is the top-left. */
  transform: { x: number; y: number; w: number; h: number }
  /** Paste-order monotone increasing. Higher z renders later (on top of older images, below all strokes). */
  z: number
  /** Wall-clock ms; tie-breaker plus debug aid. */
  createdAt: number
  /** Soft-delete (matches Stroke pattern; preserves undo). */
  deleted?: boolean
}

export interface Stroke {
  id: string
  brush: BrushConfig
  samples: Sample[]
  /** Wall-clock milliseconds (Date.now()) at pointerdown. Used as the
   *  render-order sort key — must come from the same time base on every
   *  peer so multi-device merges interleave strokes chronologically. */
  startedAt: number
  /**
   * Soft-delete flag. The renderer filters strokes with `deleted === true`;
   * undo of a stroke creation flips this to `true`; redo flips it back to
   * `false`. The stroke is never removed from the in-memory array or from
   * IndexedDB, which keeps undo / redo cheap and preserves CRDT-friendliness
   * for the deferred future sharing layer (ADR 0012).
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
