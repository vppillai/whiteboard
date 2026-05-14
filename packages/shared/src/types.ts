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

/**
 * Common shape of every "floating" board object that the Select tool
 * manipulates uniformly — currently `ImageObject` and `TextObject`,
 * future shapes / sticky notes / arrows. Strokes have their own shape
 * (sample-driven, not rect-driven) and are NOT a BoardObject.
 *
 * Why centralize: every new object kind would otherwise re-declare the
 * same six fields and risk drift (z type narrowing, rotation default
 * semantics, soft-delete invariant). The Select tool's `ObjectView`
 * already consumes this shape uniformly via the discriminated union.
 *
 * Field invariants:
 * - `transform` rect is axis-aligned (rotation is a separate field so
 *   undo / op math operates on the unrotated rect).
 * - `rotation` absent ≡ 0; persisted records pre-dating rotation
 *   support read as 0 without migration.
 * - `z` is paste-time monotone (no manual reordering at v1; see
 *   `nextObjectZ` in main.ts).
 * - `deleted` undefined ≡ false; soft-delete preserves undo + future
 *   CRDT compatibility (ADR 0012).
 */
export interface BoardObject {
  id: string
  transform: { x: number; y: number; w: number; h: number }
  rotation?: number
  z: number
  createdAt: number
  deleted?: boolean
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
export interface ImageObject extends BoardObject {
  blobRef: string
  format: 'png' | 'jpeg' | 'webp' | 'gif'
  /** Original pixel dimensions; preserved for aspect-ratio-constrained resize. */
  natural: { w: number; h: number }
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
export interface TextObject extends BoardObject {
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
  /** When set, text wraps to this width (in board pixels) via greedy
   *  word-wrap during measurement. Height grows with content. When
   *  absent (the default), text auto-grows in width — no wrap. v1.2:
   *  Select tool's E/W edge handles on a text adjust this value. */
  wrapWidth?: number
  // `transform`, `rotation?`, `z`, `createdAt`, `deleted?` come from
  // BoardObject. `transform.w/h` are measurement-derived and recomputed
  // on every edit (content/font/size/bold/italic change).
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

/**
 * Closed set of shape kinds the Shape tool draws. Each maps to a specific
 * canvas-render strategy in `renderShapes.ts`; the persisted record stays
 * small (just an enum tag) so format evolution is cheap.
 *
 * Transform model for each kind:
 * - `rect`    — `transform` is the AABB; draw an outline (+ optional fill).
 * - `ellipse` — `transform` is the bounding AABB; draw an inscribed ellipse.
 * - `line`    — `transform` represents from→to: from = (x, y), to =
 *               (x+w, y+h). The "bbox" is degenerate (negative w/h are
 *               allowed); rotation rotates the line around its midpoint.
 * - `arrow`   — same as `line`, with an arrowhead at the (x+w, y+h) end.
 *
 * Unified rect-based encoding (rather than `from`/`to` endpoint pairs for
 * lines/arrows) means every shape kind reuses the existing handle math,
 * rotate math, and resize semantics that the Select tool already runs over
 * `BoardObject.transform`. Lines/arrows just happen to allow negative-w/h
 * rects, which the renderer interprets as direction.
 */
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'

/**
 * Drawn shape on the canvas — a first-class object kind alongside images,
 * texts, and strokes. Created by the Shape tool (`R` / `O` / `A` / `L`
 * for the four kinds). Rendered in a dedicated `renderShapes` pass below
 * the strokes composite so pen strokes naturally draw on top of shapes
 * the same way they draw on top of images.
 *
 * Style is OBJECT-LEVEL — the whole shape has one stroke color, one
 * stroke width, and at most one fill. No per-segment styling. Matches
 * the Figma / Excalidraw v1 model.
 *
 * Fill semantics: absent / 'none' = outline-only. Otherwise a color
 * token (`'ink'` for theme-aware, or hex). Line + arrow kinds ignore
 * `fill` — they're stroke-only. Persisted records emit `fill: undefined`
 * for outline-only rects/ellipses to keep the format compact.
 *
 * The Select tool drives move / resize / rotate / delete via the same
 * BoardObject-shaped handle math used for images and texts; no shape-
 * specific UX divergence.
 */
export interface ShapeObject extends BoardObject {
  /** Which shape primitive this record draws. */
  shape: ShapeKind
  /** Stroke color token — same scheme as brushes (`'ink'` for theme-aware,
   *  or hex). */
  color: string
  /** Stroke width in board pixels (constant under zoom-out, so a 4-px
   *  stroke at scale=1 renders as 2-px at scale=0.5). */
  strokeWidth: number
  /** Optional fill color token. Absent / 'none' = outline-only. Line /
   *  arrow kinds ignore this. */
  fill?: string
  /** Optional fill-opacity multiplier in [0.05, 1.0]. Applied as a
   *  globalAlpha during the fill pass so the shape reads as a tint
   *  behind the outline. Absent → renderer's default (currently 0.25).
   *  Stored per-shape so users can mix soft tints and saturated fills
   *  on the same board; the Shape tool's contextual menu writes the
   *  sticky default that new shapes inherit at creation. v1.4. */
  fillOpacity?: number
}
