/**
 * Whiteboard-native clipboard format for strokes + texts. Round-trips
 * vector data when the user copies inside the whiteboard and pastes
 * back inside the whiteboard, while still being friendly to external
 * paste targets (Google Docs / Slack / Confluence) that consume the
 * `image/png` clipboard slot.
 *
 * Wire format (clipboard `text/html` slot):
 *
 *   <div data-whiteboard-v1="<json-encoded-bundle>">
 *     <img src="data:image/png;base64,..." alt="Whiteboard selection" />
 *   </div>
 *
 * The data attribute carries the structured bundle (strokes + texts);
 * the inline <img> makes the HTML self-contained so rich-text targets
 * that prefer text/html over image/png still render the picture. The
 * image/png blob is written to the clipboard as a separate slot for
 * targets that read it directly.
 *
 * On paste back into the whiteboard, we detect the marker via
 * `extractStrokesFromHtml`, freshly id'd-and-translated objects are
 * added to the canvas at the cursor position (preserving relative
 * layout via the `origin` field). Selections that include IMAGES
 * skip this format and fall back to PNG-only — image-bytes round-trip
 * requires a separate blob slot that's a future addition.
 *
 * `texts` is optional in the schema for forward-compat: a future
 * version that adds images could keep v=1 and append an optional
 * `images` field; readers ignore unknown fields. Bump `v` only on
 * truly incompatible changes (e.g. removing strokes or restructuring
 * origin); then older versions silently fall through to PNG paste.
 */

import type { Stroke, TextObject } from '@whiteboard/shared'

const MARKER_VERSION = 1

export interface ClipboardStrokeBundle {
  v: typeof MARKER_VERSION
  strokes: Stroke[]
  /** Texts in the bundle. Optional — empty / absent on stroke-only
   *  selections (the field is also called out as optional so existing
   *  pre-text-support callers and persisted snapshots still type-check). */
  texts?: TextObject[]
  /** Bounding-box top-left of the selection at copy time. On paste, the
   *  whole selection translates by `(cursor - origin)` so relative
   *  layout is preserved and the user's pasted group lands under the
   *  pointer. Computed across ALL items in the bundle (strokes' samples
   *  plus texts' rects) so the union bbox top-left is what lands at
   *  the cursor — strokes and texts retain their relative positions. */
  origin: { x: number; y: number }
}

/** Build the `text/html` clipboard payload. Encodes the bundle as a
 *  JSON string inside `data-whiteboard-v1` and embeds the rendered PNG
 *  as a base64 data URL so the HTML stays self-contained for rich-
 *  text paste targets. */
export function buildClipboardHtml(bundle: ClipboardStrokeBundle, pngDataUrl: string): string {
  const json = JSON.stringify(bundle)
  // Escape double-quotes for safe attribute embedding. Browsers parse
  // the attribute back via the standard HTML decoder so `&quot;` is
  // round-trip safe.
  const encoded = json.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<div data-whiteboard-v1="${encoded}"><img src="${pngDataUrl}" alt="Whiteboard selection" /></div>`
}

/** Decode the three HTML entities `buildClipboardHtml` encodes. We
 *  control both ends of this round-trip, so we don't need a general-
 *  purpose HTML decoder — limiting the substitution set to known
 *  inputs keeps the implementation portable across runtimes that may
 *  not ship a DOMParser (Bun's test environment is one). */
function decodeAttributeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

const ATTR_MATCH = /data-whiteboard-v1="([^"]*)"/

/** Parse a `text/html` clipboard payload looking for the whiteboard
 *  marker. Returns the bundle if found and the version matches; null
 *  otherwise (which is the signal for callers to use the existing
 *  PNG / text paste fallbacks).
 *
 *  Uses a regex match rather than DOMParser so the function works in
 *  any JS runtime (browsers, bun:test, server-side renders). The
 *  attribute value can't contain a raw `"` (the build function
 *  encodes it as `&quot;`), so the `[^"]*` capture is safe. */
export function extractStrokesFromHtml(html: string): ClipboardStrokeBundle | null {
  if (!html || !html.includes('data-whiteboard-v1')) return null
  const match = html.match(ATTR_MATCH)
  if (!match || !match[1]) return null
  const json = decodeAttributeEntities(match[1])
  try {
    const parsed = JSON.parse(json) as ClipboardStrokeBundle
    if (parsed.v !== MARKER_VERSION) return null
    if (!Array.isArray(parsed.strokes)) return null
    // `texts` is optional. If present, must be an array. Anything else
    // (string / object / null) is treated as malformed → drop the
    // whole bundle so we don't half-paste.
    if (parsed.texts !== undefined && !Array.isArray(parsed.texts)) return null
    if (
      !parsed.origin ||
      typeof parsed.origin.x !== 'number' ||
      typeof parsed.origin.y !== 'number'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Read a Blob as a base64 data URL — used to inline the rendered PNG
 *  into the HTML clipboard payload. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'))
    r.readAsDataURL(blob)
  })
}
