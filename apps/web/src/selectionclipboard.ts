/**
 * Selection-clipboard subsystem. Owns the copy / cut / paste flow for
 * the Select tool's current selection — the dual-slot `data-whiteboard-
 * v1` format that round-trips vector data inside the whiteboard while
 * still pasting as PNG into external apps (Google Docs / Slack /
 * Confluence).
 *
 * Extracted from main.ts so the orchestrator stays at one level of
 * abstraction (boot → state arrays → event wiring → render loop) and
 * the copy/paste pipeline is testable in isolation. Parallel to
 * `imagepaste.ts` which owns the image-paste subsystem with the same
 * Context-injected dependency pattern.
 *
 * Path selection in `performSelectCopy` (mirrored by `performSelectCut`):
 *   - Single image                → raw bytes via `writeImageToClipboard`
 *                                   (best fidelity, preserves original
 *                                   format)
 *   - Selection with NO images    → whiteboard-native bundle (strokes +
 *                                   texts) + rendered PNG. Vector
 *                                   round-trip inside the whiteboard;
 *                                   PNG for external apps.
 *   - Selection includes image(s) → PNG-only. Image bytes can't be
 *                                   round-tripped via the bundle without
 *                                   a separate blob slot; deferred.
 *
 * Paste path (`pasteSelectionBundle`):
 *   - Strokes: fresh id (so source + paste can coexist), samples
 *     translated by (cursor - bundle.origin), startedAt bumped to a
 *     monotone `now + i` so render-order sort stays stable.
 *   - Texts: fresh `t_` id, transform translated, z reassigned via
 *     `nextTextZ()` so stack order is stable; font deep-copied so
 *     subsequent edits don't mutate the bundle source.
 *   - One create / create-text op per item (N-undo-step convention
 *     matches v1.1 image batch + Cmd+A multi-delete).
 *   - Auto-switches to Select tool and pre-selects pasted items via
 *     `selectByIds` so the user can drag the whole group immediately.
 */

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { blobToDataUrl, buildClipboardHtml, type ClipboardStrokeBundle } from './clipboardstrokes'
import { makeShapeId, makeStrokeId, makeTextId } from './ids'
import { writeImageToClipboard, writePngBlobToClipboard } from './imageclipboard'
import type { Op } from './ops'
import type { SettingsV1 } from './settings'
import type { Selection } from './tools'

/** Dependencies the selection-clipboard subsystem needs from the
 *  orchestrator. Reads are getters (so the subsystem doesn't hold
 *  stale references); writes are direct (the arrays + side-effect
 *  callbacks ARE the public API the orchestrator exposes to other
 *  subsystems). */
export interface SelectionClipboardContext {
  // Read sources
  getStrokes: () => Stroke[]
  getImages: () => ImageObject[]
  getTexts: () => TextObject[]
  getShapes: () => ShapeObject[]
  getSelections: () => readonly Selection[]
  getSelectedImage: () => ImageObject | null
  getSettings: () => SettingsV1

  // External clipboard image-bytes path (single-image fast path).
  loadImageBlob: (blobRef: string) => Promise<Blob | null>

  // Paste-back write paths (in-memory arrays + persistence).
  strokes: Stroke[]
  texts: TextObject[]
  shapes: ShapeObject[]
  saveStroke: (s: Stroke) => Promise<void>
  saveText: (t: TextObject) => void
  saveShape: (s: ShapeObject) => void
  pushOp: (op: Op) => void
  nextTextZ: () => number
  nextShapeZ: () => number

  // Post-paste side effects.
  showInfoToast: (msg: string) => void
  setToolSelect: () => void
  selectByIds: (items: readonly Selection[]) => void
  clearSelection: () => void
  markCommittedDirty: () => void
}

/** Snapshot of the current Select selection categorized by kind.
 *  Constructed once per copy invocation so all downstream filtering
 *  reads from a consistent live view. */
interface SelectionSnapshot {
  strokes: Stroke[]
  images: ImageObject[]
  texts: TextObject[]
  shapes: ShapeObject[]
}

export function _shouldUseSingleImageFastPath(counts: {
  imageCount: number
  strokeCount: number
  textCount: number
  shapeCount: number
}): boolean {
  return (
    counts.imageCount === 1 &&
    counts.strokeCount === 0 &&
    counts.textCount === 0 &&
    counts.shapeCount === 0
  )
}

function collectSelection(ctx: SelectionClipboardContext): SelectionSnapshot | null {
  const sels = ctx.getSelections()
  if (sels.length === 0) return null
  const strokeIds = new Set<string>()
  const imageIds = new Set<string>()
  const textIds = new Set<string>()
  const shapeIds = new Set<string>()
  for (const s of sels) {
    if (s.kind === 'stroke') strokeIds.add(s.id)
    else if (s.kind === 'image') imageIds.add(s.id)
    else if (s.kind === 'shape') shapeIds.add(s.id)
    else textIds.add(s.id)
  }
  return {
    strokes: ctx.getStrokes().filter((s) => strokeIds.has(s.id) && !s.deleted),
    images: ctx.getImages().filter((i) => imageIds.has(i.id) && !i.deleted),
    texts: ctx.getTexts().filter((t) => textIds.has(t.id) && !t.deleted),
    shapes: ctx.getShapes().filter((s) => shapeIds.has(s.id) && !s.deleted),
  }
}

/** Render the categorized selection to a PNG blob using the shared
 *  export pipeline. Transparent background so the paste lands cleanly
 *  in Google Docs / Slack / Confluence. Dynamic-imports the export
 *  module so its (~10kb) code isn't paid for on app boot — only on
 *  the first copy. */
async function renderSelectionAsPng(
  snap: SelectionSnapshot,
  settings: SettingsV1,
): Promise<Blob | null> {
  if (
    snap.strokes.length === 0 &&
    snap.images.length === 0 &&
    snap.texts.length === 0 &&
    snap.shapes.length === 0
  ) {
    return null
  }
  const { computeBoardBounds } = await import('./export/bounds')
  const { exportPNG } = await import('./export/png')
  const bounds = computeBoardBounds(snap.strokes, snap.images, snap.texts, snap.shapes)
  if (!bounds) return null
  return exportPNG(snap.strokes, snap.images, snap.texts, snap.shapes, bounds, settings, null, {
    dpr: 2,
    transparentBg: true,
  })
}

/** Union bbox top-left across strokes' samples + texts' rects. Used
 *  as `bundle.origin` so paste-back translates the union to the cursor
 *  preserving relative layout. Falls back to {0,0} if every contributor
 *  is empty (degenerate erased-but-not-compacted strokes; the paste
 *  path still works — strokes' samples land at their existing absolute
 *  coords relative to cursor). */
function selectionOrigin(
  ss: Stroke[],
  ts: TextObject[],
  shs: ShapeObject[],
): { x: number; y: number } {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const s of ss) {
    for (const p of s.samples) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
    }
  }
  for (const t of ts) {
    if (t.transform.x < minX) minX = t.transform.x
    if (t.transform.y < minY) minY = t.transform.y
  }
  // Shapes: use the normalized rect top-left. Lines/arrows with negative
  // w/h still need their bbox top-left, not the raw transform.x/y.
  for (const sh of shs) {
    const nx = sh.transform.w >= 0 ? sh.transform.x : sh.transform.x + sh.transform.w
    const ny = sh.transform.h >= 0 ? sh.transform.y : sh.transform.y + sh.transform.h
    if (nx < minX) minX = nx
    if (ny < minY) minY = ny
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 }
  return { x: minX, y: minY }
}

/** Short user-facing summary for copy / paste toasts. */
function bundleSummary(bundle: ClipboardStrokeBundle): string {
  const nS = bundle.strokes.length
  const nT = bundle.texts?.length ?? 0
  const nSh = bundle.shapes?.length ?? 0
  const parts: string[] = []
  if (nS > 0) parts.push(`${nS} stroke${nS === 1 ? '' : 's'}`)
  if (nT > 0) parts.push(`${nT} text${nT === 1 ? '' : 's'}`)
  if (nSh > 0) parts.push(`${nSh} shape${nSh === 1 ? '' : 's'}`)
  return parts.length === 0 ? 'nothing' : parts.join(' + ')
}

/** Write the whiteboard-native bundle to the clipboard. ClipboardItem
 *  carries both `image/png` (for external paste targets) and
 *  `text/html` with the `data-whiteboard-v1` attribute (for paste back
 *  into the whiteboard as vectors). On failure falls back to PNG-only
 *  — at least the external paste path works. */
async function writeSelectionBundleToClipboard(
  pngBlob: Blob,
  bundle: ClipboardStrokeBundle,
  onToast: (msg: string) => void,
): Promise<boolean> {
  try {
    const dataUrl = await blobToDataUrl(pngBlob)
    const html = buildClipboardHtml(bundle, dataUrl)
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngBlob,
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ])
    onToast(`Copied ${bundleSummary(bundle)}`)
    return true
  } catch (err) {
    console.warn('whiteboard/web: selection-bundle clipboard write failed:', err)
    return writePngBlobToClipboard(pngBlob, onToast)
  }
}

/** Unified copy path. Returns true on success so cut callers can gate
 *  their delete on a successful write. */
export async function performSelectCopy(ctx: SelectionClipboardContext): Promise<boolean> {
  const snap = collectSelection(ctx)
  if (!snap) return false

  // Single-image fast path: raw bytes, preserves original format.
  if (
    _shouldUseSingleImageFastPath({
      imageCount: snap.images.length,
      strokeCount: snap.strokes.length,
      textCount: snap.texts.length,
      shapeCount: snap.shapes.length,
    })
  ) {
    const img = snap.images[0]
    if (img) {
      return writeImageToClipboard(img, {
        loadBlob: ctx.loadImageBlob,
        onToast: ctx.showInfoToast,
      })
    }
  }

  const pngBlob = await renderSelectionAsPng(snap, ctx.getSettings())
  if (!pngBlob) return false

  // No images → write native bundle + PNG.
  if (
    snap.images.length === 0 &&
    (snap.strokes.length > 0 || snap.texts.length > 0 || snap.shapes.length > 0)
  ) {
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: snap.strokes,
      texts: snap.texts.length > 0 ? snap.texts : undefined,
      shapes: snap.shapes.length > 0 ? snap.shapes : undefined,
      origin: selectionOrigin(snap.strokes, snap.texts, snap.shapes),
    }
    return writeSelectionBundleToClipboard(pngBlob, bundle, ctx.showInfoToast)
  }

  // Selection contains image(s) → PNG only.
  return writePngBlobToClipboard(pngBlob, ctx.showInfoToast)
}

/** Paste a whiteboard-native bundle at the cursor. Strokes and texts
 *  get fresh ids, positions translated by (cursor - origin) preserving
 *  relative layout; one create / create-text op per item; auto-
 *  switches to Select and pre-selects the pasted group. */
export function pasteSelectionBundle(
  bundle: ClipboardStrokeBundle,
  board: { x: number; y: number },
  ctx: SelectionClipboardContext,
): void {
  const bundleTexts = bundle.texts ?? []
  const bundleShapes = bundle.shapes ?? []
  if (bundle.strokes.length === 0 && bundleTexts.length === 0 && bundleShapes.length === 0) return
  const dx = board.x - bundle.origin.x
  const dy = board.y - bundle.origin.y
  const now = Date.now()
  const newSelection: Selection[] = []

  for (let i = 0; i < bundle.strokes.length; i++) {
    const src = bundle.strokes[i]
    if (!src) continue
    const id = makeStrokeId()
    const translatedSamples = src.samples.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))
    const translatedStamps = src.erasedStamps?.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }))
    const pasted: Stroke = {
      ...src,
      id,
      samples: translatedSamples,
      erasedStamps: translatedStamps,
      startedAt: now + i,
      deleted: undefined,
    }
    ctx.strokes.push(pasted)
    void ctx.saveStroke(pasted).catch((err) => {
      console.warn('whiteboard/web: failed to persist pasted stroke:', err)
    })
    ctx.pushOp({ kind: 'create', strokeId: id })
    newSelection.push({ kind: 'stroke', id })
  }

  for (const src of bundleTexts) {
    if (!src) continue
    const id = makeTextId()
    const pasted: TextObject = {
      ...src,
      id,
      transform: {
        ...src.transform,
        x: src.transform.x + dx,
        y: src.transform.y + dy,
      },
      // Deep-copy nested font so future edits don't mutate the source
      // bundle (which the user might paste again).
      font: { ...src.font },
      z: ctx.nextTextZ(),
      createdAt: now,
      deleted: undefined,
    }
    ctx.texts.push(pasted)
    ctx.saveText(pasted)
    ctx.pushOp({ kind: 'create-text', textId: id })
    newSelection.push({ kind: 'text', id })
  }

  for (const src of bundleShapes) {
    if (!src) continue
    const id = makeShapeId()
    const pasted: ShapeObject = {
      ...src,
      id,
      transform: {
        ...src.transform,
        x: src.transform.x + dx,
        y: src.transform.y + dy,
      },
      z: ctx.nextShapeZ(),
      createdAt: now,
      deleted: undefined,
    }
    ctx.shapes.push(pasted)
    ctx.saveShape(pasted)
    ctx.pushOp({ kind: 'create-shape', shapeId: id })
    newSelection.push({ kind: 'shape', id })
  }

  ctx.markCommittedDirty()
  // Auto-switch to Select and pre-select the pasted items. setTool
  // is a no-op when Select is already active, so explicit
  // clearSelection() commits any in-flight drag from the prior
  // session before installing the new selection.
  ctx.setToolSelect()
  ctx.clearSelection()
  ctx.selectByIds(newSelection)
  ctx.showInfoToast(`Pasted ${bundleSummary(bundle)}`)
}
