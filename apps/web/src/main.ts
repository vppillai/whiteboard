/**
 * App entry point. Orchestrates: top-level state (strokes, undo / redo
 * stacks, camera, settings), the render loop, the tool registry, and the
 * keyboard / pointer / wheel event surfaces. Tool-specific rendering and
 * menu surfaces live inside each tool module (ADR 0007).
 *
 * Keyboard:
 *   B                  — drawing tool (current brush preset)
 *   P                  — drawing tool + Pen brush preset (default setup)
 *   E                  — eraser (tap toggles, hold spring-loads — see eraserhold.ts)
 *   1 – 5              — brush preset
 *   M                  — toggle metrics HUD
 *   T                  — cycle theme
 *   ?                  — toggle help overlay
 *   Esc                — cancel / dismiss popover
 *   ⌘/Ctrl + Z         — undo
 *   ⌘/Ctrl + Shift + Z — redo (also ⌘/Ctrl + Y)
 *   ⌘/Ctrl + 0         — reset zoom
 *   ⌘/Ctrl + 1         — fit all strokes to view
 *   ⌘/Ctrl + + / -     — zoom in / out
 *   ⌘/Ctrl + Shift + K — clear board (confirm)
 *   ⌘/Ctrl + ,         — toggle settings panel
 *
 * Pointer:
 *   Pen / mouse / touch — active tool's behavior
 *   Right-click         — tool menu (also via Wacom barrel button)
 *   Wheel               — pan; ⌘/Ctrl+wheel or pinch — zoom
 *   Space + drag        — pan
 *   Middle-mouse drag   — pan
 *
 * Query string:
 *   ?perftest=1 — synthetic stroke harness on load
 *   ?predict=1  — re-enable predicted events (off by default — ADR 0004)
 */

import './style.css'
import type { BrushConfig, ImageObject, Sample, Stroke } from '@whiteboard/shared'
import { BRUSH_IDS, BRUSH_PRESETS } from './brushes'
import { makeCamera, panByScreen, resetZoom, screenToBoard, zoomAt } from './camera'
import { createClearFlow } from './clearflow'
import { CURATED_COLORS, cyclePaletteIndex, openColorPicker } from './colorpicker'
import { exitDistractionFree, isDistractionFree, toggleDistractionFree } from './distractionfree'
import { attachEraserHold } from './eraserhold'
import { openExportPopover } from './exportpopover'
import { dismissFirstRunHint, mountFirstRunHint } from './firstrun'
import { drawGrid, invalidateGridColors } from './grid'
import { createHelpOverlay } from './helpoverlay'
import { _clearImageCache, evictImageElement, loadImageElement } from './imagecache'
import { writeImageToClipboard } from './imageclipboard'
import {
  type ImagePasteContext,
  pasteImageFromBlob,
  readImageFromClipboard,
  readImageFromDataTransfer,
  setupDragDropImagePaste,
} from './imagepaste'
import { type ImageStore, createLocalImageStore } from './imagestore'
import { attachKeymap } from './keymap'
import { MetricsCollector, bindHudToggle, createHud } from './metrics'
import { type Op, type OpContext, applyOp, unapplyOp } from './ops'
import { openOptionsMenu } from './optionsmenu'
import { attachPan } from './pan'
import { runPerftest } from './perftest'
import { createHelpPill } from './pill'
import { attachPointer } from './pointer'
import { dismissAllPopovers, getActiveTag } from './popover'
import { applyCamera, clearLayer, drawStrokeOntoLayer, drawStrokePath, setupCanvas } from './render'
import { renderImages } from './renderimages'
import { createResetFlow } from './resetflow'
import {
  getBrushId,
  getColor,
  getEffectiveBrushConfig,
  getSettings,
  onChange as onSettingsChange,
  setBrushId,
  setColor,
} from './settings'
import { createPanelContent } from './settings/panel-content'
import { dismissSidePanel, isSidePanelOpen, showSidePanel } from './sidepanel'
import { bboxesIntersect, effectiveOpacity, getStrokeBBox, getStrokePath } from './stroke'
import { type StrokeStore, createLocalStrokeStore } from './strokestore'
import { cycleMode, initTheme, resolveInkColor } from './theme'
import { openToolMenu } from './toolmenu'
import { createToolPill } from './toolpill'
import {
  type EraserTool,
  type LassoTool,
  type Tool,
  type ToolContext,
  type ToolId,
  createEraserTool,
  createLassoTool,
  createPenTool,
  createSelectTool,
} from './tools'
import { clearView, loadView, makeViewSaver } from './viewstate'
import { fitToContent } from './zoomfit'

// Compose a runtime BrushConfig from the active brush preset (shape) and the
// active color (settings). Called once per stroke at pointerdown.
const makeBrush = (): BrushConfig => ({ ...BRUSH_PRESETS[getBrushId()], color: getColor() })

/** Minimal informational toast — appears bottom-center, fades after 2 s.
 *  Reuses the .df-exit-toast styling for visual consistency with the
 *  distraction-free exit hint. M2 feel-test added for empty-board exports. */
function showInfoToast(msg: string): void {
  const id = 'whiteboard-info-toast'
  let toast = document.getElementById(id)
  if (!toast) {
    toast = document.createElement('div')
    toast.id = id
    toast.className = 'df-exit-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.classList.add('visible')
  window.setTimeout(() => {
    toast?.classList.remove('visible')
    window.setTimeout(() => toast?.remove(), 300)
  }, 2000)
}

const ZOOM_WHEEL_FACTOR = 1.0015 // per pixel of deltaY

/**
 * Render-frame duration recorder for `?perftest=...` modes. When non-null,
 * the main `frame()` function pushes its actual render duration (the time
 * spent inside the `committedDirty` block) into this array on every frame
 * that does work. Harnesses set this to an empty array before driving the
 * test, then read out + null after. Module-level so harness functions
 * (top-level) and `frame()` (inside `main()` closure) can share it.
 */
let perfRecording: number[] | null = null

async function main(): Promise<void> {
  initTheme()

  // StrokeStore seam: main.ts talks to a `StrokeStore` interface rather than
  // calling storage.ts directly. v1 wires the local IDB-backed implementation.
  // The seam preserves the future-sharing option per ADR 0012 — when sharing
  // returns (design archive at docs/superpowers/specs/2026-05-10-m3-sync-design.md),
  // a Y.Doc-backed store with the same surface plugs in here.
  const strokeStore: StrokeStore = createLocalStrokeStore()

  // ImageStore — the equivalent seam for pasted images. Same shape as
  // StrokeStore (load / insert / update / hard-delete / clear) but with
  // a binary-blob side channel because images carry bytes that don't
  // belong inside a small JSON record. v1 is local IDB-backed; sync of
  // image binaries is deferred to M5.1 per ADR 0012.
  const imageStore: ImageStore = createLocalImageStore()

  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')
  // Programmatically focusable (without joining the tab order) so dialogs
  // like the clear-board toast can hand focus back here on close.
  root.tabIndex = -1

  const target = setupCanvas(root)
  const camera = makeCamera()

  // ---------------------------------------------------------------------
  //  Teardown registry. Modules that add global listeners return cleanup
  //  functions; we collect them and run them all on page unload AND on
  //  Vite HMR `dispose` so a hot-replaced main.ts doesn't double-stack
  //  listeners (defensive — vite currently force-reloads on save because
  //  no module calls `import.meta.hot.accept`, but the discipline keeps
  //  the codebase safe if anyone adds `accept()` later).
  // ---------------------------------------------------------------------
  const cleanups: Array<() => void> = []
  const registerCleanup = (fn: () => void): void => {
    cleanups.push(fn)
  }
  registerCleanup(() => target.cleanup())

  // Restore last-saved camera position. Per-device, no sync; reset on clear-
  // board. Infinite canvas has no canonical "origin" — wherever you left off
  // is home.
  const persistedView = loadView()
  if (persistedView) {
    camera.x = persistedView.x
    camera.y = persistedView.y
    camera.scale = persistedView.scale
  }
  const viewSaver = makeViewSaver(camera)

  // ---------------------------------------------------------------------
  //  Static UI: metrics HUD, help overlay, help pill
  // ---------------------------------------------------------------------
  const metrics = new MetricsCollector()
  const hud = createHud()
  document.body.appendChild(hud.el)
  registerCleanup(bindHudToggle(hud))
  hud.setVisible(false) // M to toggle

  document.body.appendChild(createHelpPill())
  const help = createHelpOverlay()
  document.body.appendChild(help.el)

  // First-run discovery hint (M2). Idempotent + respects localStorage flag —
  // no-op for users who've seen it. Dismissed at the first create-op
  // emission point in the pen tool's onStrokeCommit callback below.
  mountFirstRunHint(document.body)

  // ---------------------------------------------------------------------
  //  App state — strokes + op-based undo / redo (ADR 0006)
  // ---------------------------------------------------------------------
  const strokes: Stroke[] = []
  const undoStack: Op[] = []
  const redoStack: Op[] = []
  // Cap stack growth so long sessions don't accumulate unbounded memory.
  // FIFO eviction of the oldest entries: the user loses the ability to undo
  // beyond UNDO_MAX historical actions, which is a fair trade for bounded
  // memory in multi-day dev sessions. Sized for a typical drawing session;
  // bump if feel-testing shows users hitting the cap routinely.
  const UNDO_MAX = 500
  const pushUndoOp = (op: Op): void => {
    undoStack.push(op)
    if (undoStack.length > UNDO_MAX) {
      undoStack.splice(0, undoStack.length - UNDO_MAX)
    }
    redoStack.length = 0
  }
  let committedDirty = true

  try {
    const persisted = await strokeStore.load()
    strokes.push(...persisted)
  } catch (err) {
    console.warn('whiteboard/web: failed to load persisted strokes:', err)
  }

  // Image state — parallel to strokes. Sorted by z (paste-time monotone)
  // so iteration order is render order. nextImageZ() picks the next slot
  // above the current max so newly-pasted images stack on top.
  const images: ImageObject[] = []
  const nextImageZ = (): number => {
    let max = 0
    for (const img of images) if (!img.deleted && img.z > max) max = img.z
    return max + 1
  }

  // Images marked for batch delete via Cmd/Ctrl+A. Distinct from the Select
  // tool's single-image selection (which carries handles + transform UX);
  // this is just a "next Delete press also removes these" flag. Cleared on
  // pointerdown / tool change / Esc / after delete. Visualized as a thin
  // outline in the per-frame image render pass below.
  const imagesMarkedForBatchDelete = new Set<string>()
  const clearImageBatchSelection = (): void => {
    if (imagesMarkedForBatchDelete.size === 0) return
    imagesMarkedForBatchDelete.clear()
    committedDirty = true
  }

  try {
    const { images: persistedImages, compactedBlobRefs } = await imageStore.load()
    images.push(...persistedImages)
    // Compaction may have removed persisted-but-soft-deleted records from
    // IDB. Evict any runtime cache entries that might be lingering for
    // those blobRefs so memory is reclaimed too. (Cache is usually empty
    // at startup; this matters when an HMR cycle leaves stale state.)
    for (const blobRef of compactedBlobRefs) evictImageElement(blobRef)
    // Eagerly prefetch the HTMLImageElement for each persisted image
    // so the first frame after startup renders them immediately
    // instead of skipping (cache returns null while load is pending).
    // Fire-and-forget — each completed load triggers committedDirty.
    // TODO(M5): cap parallel decode count or lazy-load on viewport entry
    // when image counts grow (currently all decode in parallel at startup).
    for (const img of persistedImages) {
      void imageStore
        .loadBlob(img.blobRef)
        .then((blob) => (blob ? loadImageElement(img.blobRef, blob) : null))
        .then(() => {
          committedDirty = true
        })
        .catch((err) => {
          console.warn(`whiteboard/web: failed to decode image ${img.id}:`, err)
        })
    }
  } catch (err) {
    console.warn('whiteboard/web: failed to load persisted images:', err)
  }

  // ---------------------------------------------------------------------
  //  Pointer-coordinate mapping. Cached canvas rect (M1.5 perf fix).
  // ---------------------------------------------------------------------
  let canvasRect = root.getBoundingClientRect()
  const onWindowResize = (): void => {
    canvasRect = root.getBoundingClientRect()
  }
  window.addEventListener('resize', onWindowResize)
  registerCleanup(() => window.removeEventListener('resize', onWindowResize))
  const toBoard = (clientX: number, clientY: number): { x: number; y: number } =>
    screenToBoard(camera, clientX - canvasRect.left, clientY - canvasRect.top)

  // ---------------------------------------------------------------------
  //  Camera-change hook: marks committed dirty + queues view save.
  // ---------------------------------------------------------------------
  const onCameraChange = (): void => {
    committedDirty = true
    viewSaver.queueSave()
  }
  const pan = attachPan({ root, camera, onCameraChange })
  registerCleanup(pan.cleanup)

  // ---------------------------------------------------------------------
  //  Tool registry. Pen and eraser implement the Tool interface (ADR 0005,
  //  extended in ADR 0007). Each owns its cursor/stroke rendering and
  //  contextual menu section. Main.ts only handles cross-tool concerns
  //  (committing strokes, applying ops, switching tools).
  // ---------------------------------------------------------------------
  const params = new URLSearchParams(location.search)
  // URL flag wins over the settings toggle (session override per ADR 0004).
  // Evaluated once at boot — the URL doesn't change without a reload.
  const urlPredictFlag = params.has('predict')
  // Pen tool calls this on every pointermove so the settings panel toggle
  // takes effect without a reload.
  const shouldUsePrediction = (): boolean => urlPredictFlag || getSettings().predictedEvents

  // Single source of truth for "persist an image metadata change". Both the
  // op-context (used by undo/redo apply) and the Select tool fire this on
  // every move/resize/rotate, so consolidating the closure keeps the error
  // policy (currently: warn-and-continue) in one place — future changes
  // like surfacing a toast or retry only touch this line.
  const persistImageMeta = (img: ImageObject): void => {
    void imageStore.updateMeta(img).catch((err) => {
      console.warn('whiteboard/web: failed to persist image metadata:', err)
    })
  }

  const opCtx: OpContext = {
    strokes,
    saveStroke: (s) => {
      void strokeStore.save(s).catch((err) => {
        console.warn('whiteboard/web: failed to persist stroke:', err)
      })
    },
    images,
    saveImageMeta: persistImageMeta,
    markDirty: () => {
      committedDirty = true
    },
  }

  // Image-paste context. Three input paths converge through this object:
  //   - Ctrl/Cmd+V → the document-level 'paste' event listener below
  //   - Drag-drop file onto canvas → setupDragDropImagePaste below
  // (Right-click → Paste image is deferred; see spec section 4. Browser
  // paste-event covers >95% of the use case and is the conventional path.)
  const imagePasteCtx: ImagePasteContext = {
    imageStore,
    images,
    nextImageZ,
    pushUndoOp,
    markDirty: () => {
      committedDirty = true
    },
    showInfoToast,
  }

  const penTool = createPenTool({
    shouldUsePrediction,
    callbacks: {
      onStrokeCommit(stroke) {
        strokes.push(stroke)
        pushUndoOp({ kind: 'create', strokeId: stroke.id })
        // Don't clear live here — the next RAF redraws committed (with this
        // stroke baked in) and clears live, avoiding a flicker.
        committedDirty = true
        // First-run hint fades on first stroke commit. Idempotent — no-ops
        // after the first call and after the localStorage flag is set.
        dismissFirstRunHint()
        void strokeStore.save(stroke).catch((err) => {
          console.warn('whiteboard/web: failed to persist stroke:', err)
        })
      },
    },
  })

  const eraserTool: EraserTool = createEraserTool({
    callbacks: {
      getStrokes: () => strokes,
      onObjectErase: (id) => {
        const op: Op = { kind: 'delete', strokeIds: [id] }
        applyOp(op, opCtx)
        pushUndoOp(op)
      },
      onWipeErase: (edits) => {
        if (edits.length === 0) return
        // ADR 0009: pending stamps live in eraserTool until pointerup, then
        // applyOp adds them to each stroke's `erasedStamps` and saves —
        // ops are the source of truth, the sweep was just a render preview.
        const op: Op = { kind: 'eraseStamps', edits }
        applyOp(op, opCtx)
        pushUndoOp(op)
      },
    },
  })

  const lassoTool: LassoTool = createLassoTool({
    callbacks: {
      getStrokes: () => strokes,
      onDelete: (ids) => {
        if (ids.length === 0) return
        const op: Op = { kind: 'delete', strokeIds: ids }
        applyOp(op, opCtx)
        pushUndoOp(op)
      },
      onMove: (ids, dx, dy) => {
        if (ids.length === 0 || (dx === 0 && dy === 0)) return
        const op: Op = { kind: 'move', strokeIds: ids, dx, dy }
        applyOp(op, opCtx)
        pushUndoOp(op)
      },
    },
  })

  const selectTool = createSelectTool({
    getImages: () => images,
    saveImageMeta: persistImageMeta,
    pushOp: (op) => pushUndoOp(op),
    markCommittedDirty: () => {
      committedDirty = true
    },
  })

  const allTools: Record<'pen' | 'eraser' | 'lasso' | 'select', Tool> = {
    pen: penTool,
    eraser: eraserTool,
    lasso: lassoTool,
    select: selectTool,
  }
  const tool: { current: Tool } = { current: penTool }
  // Apply the initial tool's cursor — `setTool` only fires on changes, so
  // without this the CSS default (`#app { cursor: crosshair }`) shows on
  // load until the user first switches tools.
  root.style.cursor = tool.current.cursor ?? ''

  // ---------------------------------------------------------------------
  //  Settings side panel + reset flow. Single togglePanel function drives
  //  Cmd/Ctrl+, , the right-click → Settings… row, and the toolpill gear.
  //  Toggle = open if closed, dismiss if open. Each open builds a fresh
  //  panel-content tree so live `onChange` subscriptions are torn down on
  //  close via the cleanup callback the panel-content factory returns.
  // ---------------------------------------------------------------------
  const resetFlow = createResetFlow({ refocusOnClose: root })
  const togglePanel = (): void => {
    if (isSidePanelOpen()) {
      dismissSidePanel()
      return
    }
    const content = createPanelContent({
      onResetClick: () => resetFlow.request(),
    })
    showSidePanel({
      title: 'Settings',
      content: content.el,
      refocusOnClose: root,
      tag: 'settings',
      onDismiss: content.cleanup,
    })
  }

  const toolPill = createToolPill({
    initial: 'pen',
    onCycle: (next) => {
      setTool(next)
      // Hand focus back to the canvas so subsequent keystrokes don't go
      // through the pill button.
      root.focus({ preventScroll: true })
    },
    onSettingsClick: () => {
      togglePanel()
      // Hand focus back to the canvas so Cmd/Ctrl+, etc. keep working
      // after a gear tap.
      root.focus({ preventScroll: true })
    },
  })
  document.body.appendChild(toolPill.el)
  const setTool = (id: ToolId): void => {
    if (tool.current.id === id) return
    if (id !== 'pen' && id !== 'eraser' && id !== 'lasso' && id !== 'select') return
    tool.current.cleanup?.()
    tool.current = allTools[id]
    root.style.cursor = tool.current.cursor ?? ''
    toolPill.setActiveTool(id)
    // Tool change drops Cmd+A image-batch marks. (Pen/Eraser etc. won't
    // surface a "Delete deletes the marked images" affordance, so leaving
    // them marked is misleading.)
    clearImageBatchSelection()
    committedDirty = true // active tool changed; selection halos may toggle
  }

  // ---------------------------------------------------------------------
  //  Tool context — passed to every tool event. Carries cross-cutting
  //  capabilities so tools render directly without callbacks.
  // ---------------------------------------------------------------------
  const toolCtx: ToolContext = {
    toBoard,
    getBrush: () => getEffectiveBrushConfig(getBrushId(), getColor()),
    liveLayer: target.live,
    camera,
    dpr: target.dpr,
    resolveColor: resolveInkColor,
    markCommittedDirty: () => {
      committedDirty = true
    },
    setCursor: (cursor) => {
      // Set on root (which contains both canvas layers) so the cursor is
      // visible regardless of which layer happens to be topmost or what
      // the active tool's static `cursor` field is set to. Empty string
      // restores the static tool cursor; useful when leaving a hit zone.
      root.style.cursor = cursor || tool.current.cursor || ''
    },
  }

  // ---------------------------------------------------------------------
  //  Pointer pipeline (active tool dispatch + pan filter)
  // ---------------------------------------------------------------------
  const detachPointer = attachPointer(root, {
    getActiveTool: () => tool.current,
    context: toolCtx,
    shouldSkip: pan.isPanIntent,
  })

  // Last-pointer (for popover anchoring on keyboard shortcuts). Metrics
  // count is 1 per event here — pen / eraser tools already call
  // `e.getCoalescedEvents()` to extract samples; a second call in this
  // listener was paying for the same array allocation twice per pointermove
  // and showing up as GC pressure during sustained drawing. The HUD's
  // samples/event metric loses fidelity (always reads 1); events/sec is
  // unaffected. If samples/event accuracy matters again, thread a
  // `noteSampleCount` callback through ToolContext (matches the
  // `markCommittedDirty` pattern) so tools report from where they already
  // hold the coalesced array.
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  root.addEventListener('pointermove', (e) => {
    if (!(e instanceof PointerEvent)) return
    lastPointer = { x: e.clientX, y: e.clientY }
    metrics.notePointerEvent(1)
  })

  // When the pointer exits the canvas root, drop any tool-set hover cursor
  // (resize / rotate / move) so we don't leave a "ready to rotate" affordance
  // showing while the user is over the gear menu or off-canvas. Reset to the
  // active tool's static cursor — `setCursor('')` restores it via the
  // fallthrough in toolCtx.setCursor.
  root.addEventListener('pointerleave', () => {
    root.style.cursor = tool.current.cursor ?? ''
  })

  // ---------------------------------------------------------------------
  //  Right-click → tool menu (capture phase + stopImmediatePropagation so
  //  the draw handler can't see right-click; pen drivers can fire
  //  button=0,buttons=3 for barrel-as-right-click and we want to handle it
  //  cleanly regardless).
  // ---------------------------------------------------------------------
  root.addEventListener('contextmenu', (e) => e.preventDefault())

  // Any pointer-down on the canvas drops a pending Cmd+A image-batch
  // selection. The marks are a transient "press Delete next" affordance;
  // continuing into any other gesture (drawing, lasso, select) means the
  // user moved on.
  root.addEventListener(
    'pointerdown',
    () => {
      clearImageBatchSelection()
    },
    { capture: true },
  )

  // ---------------------------------------------------------------------
  //  Image paste — three input paths feeding one PasteImage op (see
  //  imagepaste.ts):
  //    - 'paste' event on document (Ctrl/Cmd+V; standard browser flow)
  //    - 'drop' + 'dragover' on canvas (filesystem file or in-browser
  //      image drag)
  //    - Async clipboard read as a fallback when 'paste' has no image
  //      (some browsers route screenshot-tool clipboard data only
  //      through the async API)
  // ---------------------------------------------------------------------
  const onPaste = (e: ClipboardEvent): void => {
    // Don't hijack paste in text-editable contexts (settings inputs, etc.).
    const targetEl = e.target as HTMLElement | null
    if (
      targetEl instanceof HTMLInputElement ||
      targetEl instanceof HTMLTextAreaElement ||
      targetEl?.isContentEditable
    ) {
      return
    }
    const dt = e.clipboardData
    if (!dt) return
    // Position uses the last known cursor location (in client coords →
    // board coords). Keyboard-triggered paste with no prior mouse activity
    // falls back to viewport center.
    const pasteAt = (): { x: number; y: number } => toBoard(lastPointer.x, lastPointer.y)
    void (async () => {
      const blob = await readImageFromDataTransfer(dt)
      if (blob) {
        e.preventDefault()
        await pasteImageFromBlob(blob, pasteAt(), imagePasteCtx)
        return
      }
      // Fallback: async clipboard API. Some browsers (Safari with screen-
      // capture tools, certain Linux DEs) only expose image data through
      // the async API, not the synchronous ClipboardEvent.
      const fallback = await readImageFromClipboard()
      if (fallback) {
        e.preventDefault()
        await pasteImageFromBlob(fallback, pasteAt(), imagePasteCtx)
      }
    })()
  }
  document.addEventListener('paste', onPaste)
  registerCleanup(() => document.removeEventListener('paste', onPaste))

  // Drag-drop. Attached to the canvas root so it fires regardless of
  // which child element receives the drop. preventDefault inside the
  // handlers wins over the page-level no-op so the OS doesn't navigate
  // to a file:// URL.
  registerCleanup(setupDragDropImagePaste(root, toBoard, imagePasteCtx))

  // ---------------------------------------------------------------------
  //  Copy / cut for selected image. Mirrors the paste handler's
  //  "skip in text-editable contexts" rule so settings inputs keep their
  //  native cut/copy. Only fires when the Select tool is active AND an
  //  image is currently selected — any other state lets the event through
  //  to the browser default (which is a no-op on canvas but matters for
  //  inputs).
  //
  //  Cut's delete only fires AFTER the clipboard write succeeds; failing
  //  to write but still deleting would lose the image with nowhere to
  //  paste it back from.
  // ---------------------------------------------------------------------
  const isTextEditableTarget = (el: EventTarget | null): boolean =>
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)

  const clipboardImageDeps = {
    loadBlob: (ref: string) => imageStore.loadBlob(ref),
    onToast: showInfoToast,
  }

  const onCopy = (e: ClipboardEvent): void => {
    if (isTextEditableTarget(e.target)) return
    if (tool.current !== selectTool) return
    const img = selectTool.getSelectedImage()
    if (!img) return
    e.preventDefault()
    void writeImageToClipboard(img, clipboardImageDeps)
  }

  const onCut = (e: ClipboardEvent): void => {
    if (isTextEditableTarget(e.target)) return
    if (tool.current !== selectTool) return
    const img = selectTool.getSelectedImage()
    if (!img) return
    e.preventDefault()
    void (async () => {
      const written = await writeImageToClipboard(img, clipboardImageDeps)
      if (written) selectTool.deleteSelected()
    })()
  }
  document.addEventListener('copy', onCopy)
  document.addEventListener('cut', onCut)
  registerCleanup(() => {
    document.removeEventListener('copy', onCopy)
    document.removeEventListener('cut', onCut)
  })

  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 2) return
      e.stopImmediatePropagation()
      e.preventDefault()
      if (getActiveTag() === 'tools') {
        dismissAllPopovers()
        return
      }
      openToolMenu({
        at: { x: e.clientX, y: e.clientY },
        getActiveTool: () => tool.current,
        onSelectTool: setTool,
        onResetZoom: () => {
          resetZoom(camera)
          onCameraChange()
        },
        onZoomToFit: () => {
          if (fitToContent(camera, strokes, { width: target.width, height: target.height })) {
            onCameraChange()
          }
        },
        onClear: clearFlow.request,
        togglePanel,
        onExport: () => {
          // Open the export popover at the same anchor — scope + format
          // choice live there. Single source of truth for export decisions.
          openExportPopover({
            anchor: { x: e.clientX, y: e.clientY },
            getStrokes: () => strokes,
            getImages: () => images,
            imageStore,
            camera,
            viewportWidth: target.width,
            viewportHeight: target.height,
            onEmptyBoard: () => showInfoToast('Nothing to export'),
            onSuccess: (fmt) => showInfoToast(`Exported ${fmt.toUpperCase()}`),
          })
        },
      })
    },
    { capture: true },
  )

  // ---------------------------------------------------------------------
  //  Wheel — pan (plain) or zoom (Cmd/Ctrl/pinch).
  // ---------------------------------------------------------------------
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const fx = e.clientX - canvasRect.left
      const fy = e.clientY - canvasRect.top
      if (e.ctrlKey || e.metaKey) {
        zoomAt(camera, fx, fy, ZOOM_WHEEL_FACTOR ** -e.deltaY)
      } else {
        panByScreen(camera, -e.deltaX, -e.deltaY)
      }
      onCameraChange()
    },
    { passive: false },
  )

  // ---------------------------------------------------------------------
  //  Theme + settings change hooks
  // ---------------------------------------------------------------------
  const onThemechange = (): void => {
    invalidateGridColors()
    committedDirty = true
  }
  document.documentElement.addEventListener('themechange', onThemechange)
  registerCleanup(() => document.documentElement.removeEventListener('themechange', onThemechange))
  registerCleanup(
    onSettingsChange(() => {
      committedDirty = true
    }),
  )

  // ---------------------------------------------------------------------
  //  Clear-board flow
  // ---------------------------------------------------------------------
  const clearFlow = createClearFlow({
    refocusOnClose: root,
    onPerformClear: () => {
      // Destructive boundary by design — undo/redo stacks reset alongside
      // the in-memory strokes, images, and the IDB stores. See ops.ts
      // (clear is *not* an Op).
      strokes.length = 0
      images.length = 0
      imagesMarkedForBatchDelete.clear()
      undoStack.length = 0
      redoStack.length = 0
      camera.x = 0
      camera.y = 0
      camera.scale = 1
      committedDirty = true
      clearView()
      void strokeStore.clear().catch((err) => {
        console.warn('whiteboard/web: stroke clear failed:', err)
      })
      void imageStore.clear().catch((err) => {
        console.warn('whiteboard/web: image clear failed:', err)
      })
      _clearImageCache()
    },
  })

  // ---------------------------------------------------------------------
  //  Undo / redo
  // ---------------------------------------------------------------------
  const undo = (): void => {
    const op = undoStack.pop()
    if (!op) return
    unapplyOp(op, opCtx)
    redoStack.push(op)
  }
  const redo = (): void => {
    const op = redoStack.pop()
    if (!op) return
    applyOp(op, opCtx)
    undoStack.push(op)
  }

  // ---------------------------------------------------------------------
  //  Keyboard shortcuts
  // ---------------------------------------------------------------------
  registerCleanup(
    attachEraserHold({
      getActiveToolId: () => tool.current.id,
      setTool,
    }),
  )

  // Double-Esc toggle: tracks the timestamp of the most recent Esc that
  // had nothing to cancel ("no-op Esc"). A second no-op Esc within the
  // double-tap window toggles between Draw and Select. Any Esc that
  // actually cancelled state (popover, lasso, image-batch mark, …)
  // resets this so the sequence "Esc dismisses popover → quick Esc"
  // doesn't surprise the user with an unintended tool switch.
  const ESCAPE_DOUBLE_TAP_MS = 350
  let lastEscapeNoOpAt = Number.NEGATIVE_INFINITY

  registerCleanup(
    attachKeymap({
      undo,
      redo,
      zoomReset: () => {
        resetZoom(camera)
        onCameraChange()
      },
      zoomIn: () => {
        zoomAt(camera, target.width / 2, target.height / 2, 1.2)
        onCameraChange()
      },
      zoomOut: () => {
        zoomAt(camera, target.width / 2, target.height / 2, 1 / 1.2)
        onCameraChange()
      },
      zoomToFit: () => {
        if (fitToContent(camera, strokes, { width: target.width, height: target.height })) {
          onCameraChange()
        }
      },
      clear: clearFlow.request,
      toggleTheme: cycleMode,
      toggleColor: () => {
        if (getActiveTag() === 'color') dismissAllPopovers()
        else openColorPicker(lastPointer)
      },
      toggleOptions: () => {
        if (getActiveTag() === 'options') dismissAllPopovers()
        else openOptionsMenu(lastPointer)
      },
      toggleHelp: help.toggle,
      selectBrush: (index1Based) => {
        const id = BRUSH_IDS[index1Based - 1]
        if (id) setBrushId(id)
      },
      selectDrawingTool: () => setTool('pen'),
      selectPenDefault: () => {
        setTool('pen')
        setBrushId('pen')
      },
      selectEraserSticky: () => setTool('eraser'),
      selectLassoTool: () => setTool('lasso'),
      selectSelectTool: () => setTool('select'),
      deleteSelection: () => {
        // Cmd+A also marks images for batch delete. Drain that set first
        // (independent of which tool is active) so the user can hit
        // Cmd+A → Delete from any tool to remove all images.
        let didDelete = false
        if (imagesMarkedForBatchDelete.size > 0) {
          for (const id of imagesMarkedForBatchDelete) {
            const img = images.find((i) => i.id === id)
            if (!img || img.deleted) continue
            img.deleted = true
            void imageStore.updateMeta(img).catch((err) => {
              console.warn('whiteboard/web: failed to persist image delete:', err)
            })
            pushUndoOp({ kind: 'delete-image', imageId: id })
            didDelete = true
          }
          imagesMarkedForBatchDelete.clear()
          committedDirty = true
        }
        if (tool.current === selectTool && selectTool.deleteSelected()) didDelete = true
        if (tool.current === lassoTool && lassoTool.deleteSelection()) didDelete = true
        return didDelete
      },
      selectAll: () => {
        // Strokes via the existing lasso path …
        setTool('lasso')
        lassoTool.selectAll()
        // … plus images via the batch-mark set so the next Delete removes
        // them too. Visually a thin outline appears around each image (see
        // the per-frame image render pass).
        imagesMarkedForBatchDelete.clear()
        for (const img of images) {
          if (!img.deleted) imagesMarkedForBatchDelete.add(img.id)
        }
        committedDirty = true
      },
      togglePanel,
      cancel: () => {
        let handled = false
        // Distraction-free exits first — popovers are dismissed on entry so
        // there shouldn't be one to handle, but if state diverged for any
        // reason, exiting distraction-free is the most user-visible action.
        if (isDistractionFree()) {
          exitDistractionFree()
          handled = true
        }
        if (clearFlow.cancel()) handled = true
        if (dismissAllPopovers()) handled = true
        // Esc also drops any Cmd+A image-batch marks before falling back
        // to a tool switch — same semantic as Esc in lasso (clear the
        // pending selection).
        if (imagesMarkedForBatchDelete.size > 0) {
          clearImageBatchSelection()
          handled = true
        }
        // Esc in lasso mode falls back to the pen tool. The lasso's `cleanup`
        // hook (called from `setTool`) clears any in-progress polygon and
        // selection state, so switching is a clean reset.
        if (tool.current === lassoTool) {
          setTool('pen')
          handled = true
        }
        // Double-Esc toggle: if THIS Esc cancelled real state, reset the
        // double-tap window so a follow-up Esc doesn't surprise the user
        // by switching tools mid-cleanup. If nothing was cancelled, check
        // whether the prior Esc was a recent no-op too — that's the
        // double-tap signal, toggle Draw ↔ Select.
        if (handled) {
          lastEscapeNoOpAt = Number.NEGATIVE_INFINITY
        } else {
          const now = performance.now()
          if (now - lastEscapeNoOpAt < ESCAPE_DOUBLE_TAP_MS) {
            const next: ToolId = tool.current.id === 'select' ? 'pen' : 'select'
            setTool(next)
            lastEscapeNoOpAt = Number.NEGATIVE_INFINITY
            handled = true
          } else {
            lastEscapeNoOpAt = now
          }
        }
        return handled
      },
      toggleDistractionFree: () =>
        toggleDistractionFree({
          appEl: root,
          dismissPopover: () => dismissAllPopovers(),
          dismissSidePanel: () => dismissSidePanel(),
        }),
      cyclePaletteBackward: () => {
        const next = CURATED_COLORS[cyclePaletteIndex(getColor(), -1)]
        if (next) setColor(next)
      },
      cyclePaletteForward: () => {
        const next = CURATED_COLORS[cyclePaletteIndex(getColor(), 1)]
        if (next) setColor(next)
      },
      openExport: () => {
        if (getActiveTag() === 'export') dismissAllPopovers()
        else
          openExportPopover({
            anchor: lastPointer,
            getStrokes: () => strokes,
            getImages: () => images,
            imageStore,
            camera,
            viewportWidth: target.width,
            viewportHeight: target.height,
            onEmptyBoard: () => showInfoToast('Nothing to export'),
            onSuccess: (fmt) => showInfoToast(`Exported ${fmt.toUpperCase()}`),
          })
      },
    }),
  )

  // ---------------------------------------------------------------------
  //  Render loop. Committed layer rebuilt on dirty (camera, commit, theme,
  //  settings). Live layer is owned by the active tool; we ask it to redraw
  //  after committed redraws so in-flight content survives camera changes.
  // ---------------------------------------------------------------------
  function frame(now: DOMHighResTimeStamp): void {
    metrics.noteFrame(now)

    if (committedDirty) {
      const renderStart = perfRecording !== null ? performance.now() : 0
      const viewBBox = {
        minX: camera.x,
        minY: camera.y,
        maxX: camera.x + target.width / camera.scale,
        maxY: camera.y + target.height / camera.scale,
      }

      // ----- Pass 1: per-stroke draw + per-stroke destination-out -----
      // ADR 0009: strokes go to a dedicated offscreen so destination-out
      // for eraser stamps doesn't subtract from the grid. Each stroke's
      // stamps must be applied *immediately after that stroke is drawn*
      // and *before the next stroke is drawn*; otherwise a global
      // destination-out at the end would also subtract pixels of any
      // later stroke that crosses the same position, making erased
      // regions permanent dead zones.
      clearLayer(target.strokes)
      applyCamera(target.strokes, camera, target.dpr)

      // Strokes the lasso is live-moving are skipped here and ghost-painted
      // on live by the lasso's `redraw()` at offset.
      const dragState = tool.current === lassoTool ? lassoTool.getDragState() : null
      const draggingIds = dragState?.ids

      // Pending stamps are read through the EraserTool's `getPendingStamps`
      // extension (in-flight wipe sweep not yet committed); skipped if a
      // different tool is active.
      const pendingStamps = tool.current === eraserTool ? eraserTool.getPendingStamps() : null

      for (const s of strokes) {
        if (s.deleted) continue
        if (draggingIds?.has(s.id)) continue
        if (!bboxesIntersect(getStrokeBBox(s), viewBBox)) continue
        const path = getStrokePath(s, [], true)
        if (!path) continue
        drawStrokeOntoLayer(
          target.strokes,
          path,
          resolveInkColor(s.brush.color),
          effectiveOpacity(s),
          s.erasedStamps,
          pendingStamps?.get(s.id),
        )
      }

      // ----- Pass 3: committed layer (grid + images + composited strokes) -----
      clearLayer(target.committed)
      applyCamera(target.committed, camera, target.dpr)
      drawGrid(target.committed, camera, target.width, target.height, getSettings().grid)

      // Image layer — draws onto committed in board-space (camera transform
      // is already applied above). Layered BELOW the strokes composite so
      // pen strokes always draw on top of images, which is the whole point
      // of the "paste an image and draw on top" feature. See renderimages.ts
      // for the per-image draw loop (viewport cull, rotation, batch-delete
      // outline).
      renderImages({
        images,
        layer: target.committed,
        camera,
        viewBBox,
        isMarkedForBatchDelete: (id) => imagesMarkedForBatchDelete.has(id),
      })

      // Composite the strokes offscreen onto committed in pixel space
      // (identity transform) so the strokes pixel-for-pixel overlay the
      // grid + images. The strokes layer already has the camera transform
      // baked into its content.
      const cCtx = target.committed.ctx
      cCtx.save()
      cCtx.setTransform(1, 0, 0, 1, 0, 0)
      cCtx.drawImage(target.strokes.el, 0, 0)
      cCtx.restore()

      committedDirty = false

      // Live layer needs to refresh too: clear stale content; ask the active
      // tool to re-render its in-flight state if any.
      clearLayer(target.live)
      tool.current.redraw?.(toolCtx)

      if (perfRecording !== null) {
        perfRecording.push(performance.now() - renderStart)
      }
    }

    hud.update(metrics.state)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // Cleanup on unload AND on HMR dispose. Run all registered teardowns +
  // detach the pointer pipeline. Idempotent (cleanups array is drained).
  registerCleanup(detachPointer)
  const runAllCleanups = (): void => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn()
      } catch (err) {
        console.warn('whiteboard/web: teardown failed:', err)
      }
    }
  }
  window.addEventListener('beforeunload', runAllCleanups)
  if (import.meta.hot) {
    import.meta.hot.dispose(runAllCleanups)
  }

  // Perftest mode.
  if (params.has('perftest')) {
    const mode = params.get('perftest')
    const dirty = (): void => {
      committedDirty = true
    }
    if (mode === 'erase') {
      void runErasePerfMode(strokes, target, dirty)
    } else if (mode === 'scale') {
      void runScalePerfMode(strokes, target, camera, dirty)
    } else {
      void runPerfMode(camera, target, dirty)
    }
  }
}

/**
 * Populate a fresh batch of synthetic strokes for the at-scale perftests.
 * Lays them out in a uniform grid covering the viewport so panning + zooming
 * always has visible content. Each stroke is a short horizontal line.
 */
function populatePerfStrokes(
  strokes: Stroke[],
  target: ReturnType<typeof setupCanvas>,
  count: number,
): void {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / cols)
  const cellW = target.width / cols
  const cellH = target.height / rows
  const samplesPerStroke = 30
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const x0 = col * cellW + cellW * 0.1
    const y0 = row * cellH + cellH * 0.5
    const samples: Sample[] = []
    for (let j = 0; j < samplesPerStroke; j++) {
      const u = j / (samplesPerStroke - 1)
      samples.push({ x: x0 + u * cellW * 0.8, y: y0, p: 0.7, t: 0 })
    }
    strokes.push({ id: `perf-${i}`, brush: makeBrush(), samples, startedAt: 0 })
  }
}

/**
 * Render a perftest result banner with mean / p50 / p95 / max render-frame
 * durations. Click to dismiss.
 */
function reportPerf(
  banner: HTMLElement,
  opts: { title: string; rows: string[]; framesObserved: number[] },
): void {
  banner.replaceChildren()
  const heading = document.createElement('div')
  heading.textContent = opts.title
  heading.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:10px'
  banner.appendChild(heading)

  const sorted = [...opts.framesObserved].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  const sum = sorted.reduce((a, b) => a + b, 0)
  const r2 = (v: number): number => Math.round(v * 100) / 100
  const max = sorted[sorted.length - 1] ?? 0
  const n = Math.max(1, opts.framesObserved.length)

  const pre = document.createElement('pre')
  pre.textContent = [
    ...opts.rows,
    `frames         ${opts.framesObserved.length}`,
    `render frame   mean ${r2(sum / n)} · p50 ${r2(at(0.5))} · p95 ${r2(at(0.95))} · max ${r2(max)}  (ms)`,
    'budget         16 ms / frame',
  ].join('\n')
  banner.appendChild(pre)

  const note = document.createElement('div')
  note.textContent =
    "Measures actual render duration (instrumented in `frame()`'s committed-redraw block). Tap to dismiss."
  note.style.cssText = 'margin-top:12px;font-size:11px;color:var(--fg-muted);max-width:520px'
  banner.appendChild(note)
  banner.style.pointerEvents = 'auto'
  banner.addEventListener('click', () => banner.remove(), { once: true })
}

async function runPerfMode(
  camera: ReturnType<typeof makeCamera>,
  target: ReturnType<typeof setupCanvas>,
  markCommittedDirty: () => void,
): Promise<void> {
  const banner = document.createElement('div')
  banner.id = 'whiteboard-banner'
  banner.textContent = 'Running perftest…'
  document.body.appendChild(banner)

  const synth: Stroke = {
    id: 'perftest',
    brush: makeBrush(),
    samples: [],
    startedAt: performance.now(),
  }

  const result = await runPerftest({ width: target.width, height: target.height }, (s: Sample) => {
    const board = screenToBoard(camera, s.x, s.y)
    synth.samples.push({ ...s, x: board.x, y: board.y })
    clearLayer(target.live)
    applyCamera(target.live, camera, target.dpr)
    const path = getStrokePath(synth, [], false)
    if (path) {
      drawStrokePath(
        target.live,
        path,
        resolveInkColor(synth.brush.color),
        synth.brush.opacity ?? 1,
      )
    }
  })

  const finalPath = getStrokePath(synth, [], true)
  if (finalPath) {
    drawStrokePath(
      target.committed,
      finalPath,
      resolveInkColor(synth.brush.color),
      effectiveOpacity(synth),
    )
  }
  clearLayer(target.live)
  markCommittedDirty()

  banner.replaceChildren()
  const heading = document.createElement('div')
  heading.textContent = 'Perftest complete'
  heading.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:10px'
  banner.appendChild(heading)

  const pre = document.createElement('pre')
  pre.textContent = [
    `samples       ${result.totalSamples}`,
    `duration      ${result.durationMs.toFixed(0)} ms`,
    `fps           ${result.fps}`,
    `event→render  mean ${result.eventToRenderMs.mean} · p50 ${result.eventToRenderMs.p50} · p95 ${result.eventToRenderMs.p95} · max ${result.eventToRenderMs.max}  (ms)`,
  ].join('\n')
  banner.appendChild(pre)

  const note = document.createElement('div')
  note.textContent =
    'JS-side input-to-render only. Compositor + display latency adds ~16–32 ms on typical hardware. Tap or click anywhere to dismiss.'
  note.style.cssText = 'margin-top:12px;font-size:11px;color:var(--fg-muted);max-width:520px'
  banner.appendChild(note)
  banner.style.pointerEvents = 'auto'
  banner.addEventListener('click', () => banner.remove(), { once: true })
}

/**
 * `?perftest=erase` — synthetic eraser sweep across N pre-populated strokes.
 * Verifies the ADR 0009 budget: wipe responsive within the 16 ms frame at
 * 500 strokes. Frame durations are recorded by the main `frame()` function
 * via `perfRecording`, so the reported number is the *actual* render cost
 * (clear strokes layer + draw outlines + apply destination-out for stamps
 * + composite onto committed), not the harness's tick body.
 *
 * Override defaults: `?perftest=erase&n=500&r=12&dur=2000`.
 */
async function runErasePerfMode(
  strokes: Stroke[],
  target: ReturnType<typeof setupCanvas>,
  markCommittedDirty: () => void,
): Promise<void> {
  const banner = document.createElement('div')
  banner.id = 'whiteboard-banner'
  banner.textContent = 'Erase perftest: populating strokes…'
  document.body.appendChild(banner)

  const params = new URLSearchParams(window.location.search)
  const strokeCount = Number(params.get('n')) || 500
  const eraserRadius = Number(params.get('r')) || 12
  const sweepDurationMs = Number(params.get('dur')) || 2000
  const stampHz = 200

  populatePerfStrokes(strokes, target, strokeCount)
  markCommittedDirty()
  // Let one frame paint the populated strokes before we start recording —
  // we don't want the initial-render cost to skew the sweep stats.
  await new Promise<void>((r) => requestAnimationFrame(() => r()))

  banner.textContent = 'Erase perftest: sweeping…'

  const totalStamps = Math.floor((sweepDurationMs / 1000) * stampHz)
  const startT = performance.now()
  const recordings: number[] = []
  perfRecording = recordings
  let stampIdx = 0

  // Drive a synthetic sinusoidal sweep at `stampHz`. Stamps are applied
  // directly to overlapping strokes (bypassing the op layer — we're
  // measuring render cost, not the op pipeline). The main `frame()`
  // records its own render duration into `recordings` while perfRecording
  // is non-null.
  await new Promise<void>((resolve) => {
    const tick = (now: DOMHighResTimeStamp): void => {
      const elapsed = now - startT
      const targetCount = Math.min(
        totalStamps,
        Math.floor((elapsed / sweepDurationMs) * totalStamps),
      )
      while (stampIdx < targetCount) {
        const u = stampIdx / Math.max(1, totalStamps - 1)
        const x = u * target.width
        const y = target.height / 2 + Math.sin(u * Math.PI * 4) * (target.height / 4)
        for (const s of strokes) {
          if (s.deleted) continue
          const tol = eraserRadius + s.brush.size / 2
          const bb = getStrokeBBox(s)
          if (x + tol < bb.minX || x - tol > bb.maxX) continue
          if (y + tol < bb.minY || y - tol > bb.maxY) continue
          if (!s.erasedStamps) s.erasedStamps = []
          s.erasedStamps.push({ x, y, r: eraserRadius })
        }
        stampIdx++
      }
      markCommittedDirty()
      if (stampIdx >= totalStamps) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  perfRecording = null

  reportPerf(banner, {
    title: 'Erase perftest complete',
    rows: [
      `strokes        ${strokeCount}`,
      `eraser radius  ${eraserRadius} px`,
      `sweep dur      ${sweepDurationMs} ms`,
      `total stamps   ${totalStamps}`,
    ],
    framesObserved: recordings,
  })
}

/**
 * `?perftest=scale` — synthetic pan + zoom drive over N pre-populated
 * strokes. Verifies M1's perf-at-scale gate: pan / zoom holds the 16 ms
 * frame budget at 500 strokes. Render durations come from the same
 * `perfRecording` instrumentation as `?perftest=erase`.
 *
 * Override defaults: `?perftest=scale&n=500&dur=2000`.
 */
async function runScalePerfMode(
  strokes: Stroke[],
  target: ReturnType<typeof setupCanvas>,
  camera: ReturnType<typeof makeCamera>,
  markCommittedDirty: () => void,
): Promise<void> {
  const banner = document.createElement('div')
  banner.id = 'whiteboard-banner'
  banner.textContent = 'Scale perftest: populating strokes…'
  document.body.appendChild(banner)

  const params = new URLSearchParams(window.location.search)
  const strokeCount = Number(params.get('n')) || 500
  const durationMs = Number(params.get('dur')) || 2000

  // Snapshot camera so we can restore on completion (the user shouldn't be
  // left somewhere weird in board space).
  const initialCam = { x: camera.x, y: camera.y, scale: camera.scale }

  populatePerfStrokes(strokes, target, strokeCount)
  markCommittedDirty()
  await new Promise<void>((r) => requestAnimationFrame(() => r()))

  banner.textContent = 'Scale perftest: panning + zooming…'

  const startT = performance.now()
  const recordings: number[] = []
  perfRecording = recordings

  // Sinusoidal pan + zoom — covers a wide range of camera positions and
  // scales so viewport-clip cache + per-stroke bbox math is exercised.
  await new Promise<void>((resolve) => {
    const tick = (now: DOMHighResTimeStamp): void => {
      const elapsed = now - startT
      const u = Math.min(1, elapsed / durationMs)
      camera.x = initialCam.x + Math.sin(u * Math.PI * 4) * (target.width * 0.6)
      camera.y = initialCam.y + Math.cos(u * Math.PI * 4) * (target.height * 0.4)
      camera.scale = initialCam.scale * (1 + 0.4 * Math.sin(u * Math.PI * 6))
      markCommittedDirty()
      if (u >= 1) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  perfRecording = null

  // Restore camera so the user lands back where they started.
  camera.x = initialCam.x
  camera.y = initialCam.y
  camera.scale = initialCam.scale
  markCommittedDirty()

  reportPerf(banner, {
    title: 'Scale (pan + zoom) perftest complete',
    rows: [`strokes        ${strokeCount}`, `drive dur      ${durationMs} ms`],
    framesObserved: recordings,
  })
}

void main()
