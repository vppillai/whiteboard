/**
 * Object-id generators. Centralized so the prefix convention and the
 * `crypto.randomUUID()` fallback (for older / non-secure-context
 * browsers) stay consistent across every entry point that creates a
 * stroke / text / image.
 *
 * Convention:
 *   - Strokes: `s_<uuid>` — was bare UUID prior to v1.3; the prefix
 *     is now uniform so a glance at any persisted id tells you the
 *     kind. Existing bare-UUID strokes continue to validate (id is
 *     opaque to consumers).
 *   - Texts: `t_<uuid>` — unchanged from v1.2.
 *
 * Fallback format `<prefix>_<base36-time>_<base36-rand>` keeps the
 * prefix consistent in environments without `crypto.randomUUID`
 * (older browsers, non-HTTPS contexts where webcrypto is restricted).
 */

const STROKE_PREFIX = 's_'
const TEXT_PREFIX = 't_'
const SHAPE_PREFIX = 'sh_'
const IMAGE_PREFIX = 'img_'

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}${crypto.randomUUID()}`
  }
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Fresh id for a new Stroke. Used by the pen tool's live stroke
 *  finalization and the clipboard paste-back path. */
export function makeStrokeId(): string {
  return randomId(STROKE_PREFIX)
}

/** Fresh id for a new TextObject. Used by the text tool's placement
 *  + buildTextFromDefaults factory and the clipboard paste-back path. */
export function makeTextId(): string {
  return randomId(TEXT_PREFIX)
}

/** Fresh id for a new ShapeObject. v1.4. Prefix `sh_` to keep stroke/
 *  text/shape ids visually distinct in persisted logs. */
export function makeShapeId(): string {
  return randomId(SHAPE_PREFIX)
}

/** Fresh id for a new ImageObject. Prefix `img_`. Centralized here so the
 *  prefix convention + `crypto.randomUUID()` fallback stay uniform with
 *  stroke / text / shape ids; the image-paste flow imports this. */
export function makeImageId(): string {
  return randomId(IMAGE_PREFIX)
}
