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
  /** Rotation in radians around the rect center. Defaults to 0 when absent
   *  (omitted on persisted records that pre-date rotation support). */
  rotation?: number
  /** Paste-order monotone increasing. Higher z renders later (on top of older images, below all strokes). */
  z: number
  /** Wall-clock ms; tie-breaker plus debug aid. */
  createdAt: number
  /** Soft-delete (matches Stroke pattern; preserves undo). */
  deleted?: boolean
}

/**
 * Closed set of font families the text tool exposes. Each maps to a CSS
 * font-family string at render time (see `apps/web/src/textgeom.ts`). The
 * names are stable identifiers — the actual CSS stack can evolve (fallback
 * fonts added, default size adjusted) without rewriting persisted records.
 */
export type TextFontFamily = 'mono' | 'sans' | 'serif'

/**
 * Text object on the canvas — a first-class non-stroke object placed and
 * edited by the dedicated Text tool (`T` key). Rendered above images and
 * below strokes so the pen draws on top of text the same way it draws on
 * top of images.
 *
 * Formatting is OBJECT-LEVEL (the whole TextObject is bold / italic /
 * underline, or none of the above). Range-styled rich text within a text
 * isn't supported in v1 — Figma-basic / Excalidraw model. The
 * contenteditable handles cursor + selection during editing; persisted
 * content is plain text with `\n` line separators.
 *
 * Width / height are stored after measurement so the renderer doesn't
 * have to re-measure every frame, but they're recomputed whenever
 * content / font / size / bold / italic changes (underline only affects
 * pixels, not metrics).
 *
 * The font choice is a closed enum (`TextFontFamily`); the actual CSS
 * font-family stack lives in the render module so the persisted record
 * stays small and migration-safe.
 */
export interface TextObject {
  id: string
  /** Multi-line content with '\n' separators. Plain text. */
  content: string
  font: {
    family: TextFontFamily
    /** Pixel size in board space. */
    size: number
    bold: boolean
    italic: boolean
    underline: boolean
  }
  /** Color token — same scheme as brushes ('ink' for theme-aware, or hex). */
  color: string
  /** Top-left corner + measured w/h in board space. Resize at v1 means
   *  font-size change; w/h are recomputed from measurement on every edit. */
  transform: { x: number; y: number; w: number; h: number }
  /** Rotation in radians around the rect center. Defaults to 0 when absent.
   *  Mirrors `ImageObject.rotation` for future symmetry. */
  rotation?: number
  /** When set, text wraps to this width (in board pixels) via greedy
   *  word-wrap during measurement. Height grows with content. When
   *  absent (the default), text auto-grows in width — no wrap. v1.2:
   *  Select tool's E/W edge handles on a text adjust this value. */
  wrapWidth?: number
  /** Stack order against other texts + images (paste-time monotone). */
  z: number
  /** Wall-clock ms; tie-breaker plus debug aid. */
  createdAt: number
  /** Soft-delete (matches Stroke / ImageObject pattern; preserves undo). */
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
