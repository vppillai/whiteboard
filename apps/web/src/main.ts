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
 *   V or S             — select tool (universal pointer; click / marquee / Shift+click)
 *   L                  — laser tool (fading pointer trail)
 *   T                  — text tool  (Shift+T cycles theme)
 *   1 – 5              — brush preset
 *   C                  — color picker (at pointer)
 *   O                  — options (grid type, spacing)
 *   F                  — toggle distraction-free mode
 *   M                  — toggle metrics HUD
 *   ?                  — toggle help overlay
 *   Esc                — cancel / dismiss popover / clear selection
 *   Esc Esc            — toggle Draw ↔ Select
 *   ⌘/Ctrl + Z         — undo
 *   ⌘/Ctrl + Shift + Z — redo (also ⌘/Ctrl + Y)
 *   ⌘/Ctrl + A         — select all (strokes + images + texts; activates Select)
 *   ⌘/Ctrl + C / X     — copy / cut selection (single image → bytes; everything else → PNG + native bundle)
 *   ⌘/Ctrl + V         — paste image / text / whiteboard-native bundle
 *   ⌘/Ctrl + B / I / U — bold / italic / underline (in text edit or on selected text)
 *   Delete / Backspace — delete the active selection
 *   ⌘/Ctrl + 0         — reset zoom
 *   ⌘/Ctrl + 1         — fit all objects in view (resets zoom on an empty board)
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
import type {
  BrushConfig,
  ImageObject,
  Sample,
  ShapeObject,
  Stroke,
  TextObject,
} from '@whiteboard/shared'
import { BRUSH_IDS, BRUSH_PRESETS } from './brushes'
import { makeCamera, panByScreen, resetZoom, screenToBoard, zoomAt } from './camera'
import { createClearFlow } from './clearflow'
import { extractStrokesFromHtml } from './clipboardstrokes'
import { CURATED_COLORS, cyclePaletteIndex, openColorPicker } from './colorpicker'
import { exitDistractionFree, isDistractionFree, toggleDistractionFree } from './distractionfree'
import { attachEraserHold } from './eraserhold'
import { openExportPopover } from './exportpopover'
import { dismissFirstRunHint, mountFirstRunHint } from './firstrun'
import { drawGrid, invalidateGridColors } from './grid'
import { createHelpOverlay } from './helpoverlay'
import { _clearImageCache, evictImageElement, loadImageElement } from './imagecache'
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
import { dismissAllPopovers, findPopoverByTag } from './popover'
import { applyCamera, clearLayer, drawStrokeOntoLayer, drawStrokePath, setupCanvas } from './render'
import { renderImages } from './renderimages'
import { renderShapes } from './rendershapes'
import { renderTexts } from './rendertexts'
import { createResetFlow } from './resetflow'
import {
  type SelectionClipboardContext,
  pasteSelectionBundle,
  performSelectCopy,
} from './selectionclipboard'
import {
  getBrushId,
  getColor,
  getEffectiveBrushConfig,
  getLaserColor,
  getSettings,
  onChange as onSettingsChange,
  setBrushId,
  setColor,
  setLaserColor,
} from './settings'
import { createPanelContent } from './settings/panel-content'
import { type ShapeStore, createLocalShapeStore } from './shapestore'
import { dismissSidePanel, isSidePanelOpen, showSidePanel } from './sidepanel'
import { bboxesIntersect, effectiveOpacity, getStrokeBBox, getStrokePath } from './stroke'
import { type StrokeStore, createLocalStrokeStore } from './strokestore'
import { type TextStore, createLocalTextStore } from './textstore'
import { cycleMode, initTheme, resolveInkColor } from './theme'
import { openToolMenu } from './toolmenu'
import { createToolPill } from './toolpill'
import {
  type EraserTool,
  type Selection,
  type Tool,
  type ToolContext,
  type ToolId,
  createEraserTool,
  createLaserTool,
  createPenTool,
  createSelectTool,
  createTextTool,
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

  // TextStore — analog of StrokeStore / ImageStore for text objects. Single
  // store (no companion blob) since text records carry payload inline.
  const textStore: TextStore = createLocalTextStore()

  // ShapeStore — analog of TextStore for shape objects (rect / ellipse /
  // line / arrow). Single store, payload-inline, same pattern.
  const shapeStore: ShapeStore = createLocalShapeStore()

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
  const texts: TextObject[] = []
  const shapes: ShapeObject[] = []
  // Shared next-z sequence for images + texts so the user-visible stack
  // order interleaves naturally between object types. New objects always
  // appear above all existing ones.
  const nextObjectZ = (): number => {
    let max = 0
    for (const img of images) if (!img.deleted && img.z > max) max = img.z
    for (const t of texts) if (!t.deleted && t.z > max) max = t.z
    return max + 1
  }
  const nextImageZ = nextObjectZ
  const nextTextZ = nextObjectZ

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

  try {
    const persistedTexts = await textStore.load()
    texts.push(...persistedTexts)
    committedDirty = true
  } catch (err) {
    console.warn('whiteboard/web: failed to load persisted texts:', err)
  }

  try {
    const persistedShapes = await shapeStore.load()
    shapes.push(...persistedShapes)
    committedDirty = true
  } catch (err) {
    console.warn('whiteboard/web: failed to load persisted shapes:', err)
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

  // Same pattern for text records — single closure used by opCtx and the
  // Text tool. Errors are warn-and-continue (matching strokes / images).
  const persistText = (t: TextObject): void => {
    void textStore.update(t).catch((err) => {
      console.warn('whiteboard/web: failed to persist text:', err)
    })
  }

  // Same pattern for shape records — single closure used by opCtx (and the
  // Shape tool, in SH5). Errors are warn-and-continue.
  const persistShape = (s: ShapeObject): void => {
    void shapeStore.update(s).catch((err) => {
      console.warn('whiteboard/web: failed to persist shape:', err)
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
    texts,
    saveText: persistText,
    shapes,
    saveShape: persistShape,
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
    // Auto-switch to Select + select the new image so the user can drag
    // it into place immediately. `setTool` / `selectTool` are declared
    // further down — both are populated by the time a paste event can
    // actually fire (no TDZ risk since the body only runs on user input).
    onPasteSuccess: (id) => {
      setTool('select')
      selectTool.selectImageById(id)
    },
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

  const selectTool = createSelectTool({
    getImages: () => images,
    saveImageMeta: persistImageMeta,
    getTexts: () => texts,
    saveText: persistText,
    getStrokes: () => strokes,
    // Stroke persistence — same warn-and-continue policy as
    // persistImageMeta / persistText. Used by the Select tool's
    // stroke-drag path (per-tick saves) and stroke-delete path.
    saveStroke: (s) => {
      void strokeStore.save(s).catch((err) => {
        console.warn('whiteboard/web: failed to persist stroke (Select move/delete):', err)
      })
    },
    pushOp: (op) => pushUndoOp(op),
    markCommittedDirty: () => {
      committedDirty = true
    },
    // Select tool double-click on a text body → hand off to Text tool
    // so the user can edit immediately. setTool('text') cleanups Select
    // (drops the selection); editTextById then opens the editor on the
    // same text. The ctx is the Select tool's last pointer event ctx —
    // Text tool needs it to position the DOM overlay (it has no
    // pointer-event cache of its own yet).
    onTextDoubleClick: (id, ctx) => {
      setTool('text')
      textTool.editTextById(id, ctx)
    },
  })

  const laserTool = createLaserTool({
    getColor: getLaserColor,
    setColor: setLaserColor,
  })

  // Track the most recently active tool BEFORE Text was selected. Used
  // by the Text tool's Esc handler to return the user to the tool they
  // were on before. Updated in setTool() whenever the user switches AWAY
  // from a non-text tool; stays put when text is the active tool.
  let previousToolId: ToolId | null = null

  const textTool = createTextTool({
    getTexts: () => texts,
    nextZ: nextTextZ,
    pushOp: pushUndoOp,
    saveText: persistText,
    markCommittedDirty: () => {
      committedDirty = true
    },
    resolveColor: resolveInkColor,
    onEscExit: () => setTool(previousToolId ?? 'pen'),
  })

  const allTools: Record<ToolId, Tool> = {
    pen: penTool,
    eraser: eraserTool,
    select: selectTool,
    laser: laserTool,
    text: textTool,
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
    if (id !== 'pen' && id !== 'eraser' && id !== 'select' && id !== 'laser' && id !== 'text')
      return
    // Capture the OUTGOING tool id as "previous" — but only when leaving
    // a non-text tool. The Text tool's Esc-handler uses this to return
    // to where the user was before they pressed T. Switching away from
    // Text doesn't update previousToolId (so a subsequent T → Esc still
    // restores the original tool).
    if (tool.current.id !== 'text') {
      previousToolId = tool.current.id
    }
    tool.current.cleanup?.()
    tool.current = allTools[id]
    root.style.cursor = tool.current.cursor ?? ''
    toolPill.setActiveTool(id)
    // Select tool's own cleanup() already clears its multi-selection on
    // tool change (the cleanup hook fires via the line above). Just mark
    // dirty so the next frame paints without the removed selection halos.
    committedDirty = true
  }

  // Last-pointer (for popover anchoring on keyboard shortcuts AND for
  // pen.redraw's hover-prime via toolCtx.getLastPointer). Declared
  // BEFORE toolCtx so the closure below captures an already-initialized
  // binding instead of relying on toolCtx not being invoked
  // synchronously between this line and the let assignment further
  // down. Updated on every pointermove (the listener is later in this
  // function but the binding is hoisted into TDZ — see comment there).
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }

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
    getLastPointer: () => lastPointer,
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
  // `lastPointer` is declared earlier (above toolCtx) so its binding is
  // already initialized when toolCtx's getLastPointer closure captures
  // it. The listener body below assigns into that same binding.
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
  // Defensive document-level guard. The root listener above covers events
  // whose target is `root` or a descendant. But MANY app surfaces live
  // OUTSIDE root (toolpill, help pill, HUD, text editor overlay, etc.) —
  // a right-click on those would otherwise surface the browser's native
  // context menu. Inverted rule: ALWAYS preventDefault unless the target
  // is a form input where the browser menu (paste / spell-check) is
  // genuinely useful. Currently the only real inputs live in the settings
  // side panel; everything else is an inert visual.
  const onDocContextMenu = (e: Event): void => {
    const target = e.target as HTMLElement | null
    if (!target) return
    // Allow on real form inputs (the settings panel's hex / number /
    // text inputs). `closest` walks ancestors so a click on a label
    // inside a form input's container still allows the menu.
    if (target.closest('input, textarea')) return
    e.preventDefault()
  }
  document.addEventListener('contextmenu', onDocContextMenu)
  registerCleanup(() => document.removeEventListener('contextmenu', onDocContextMenu))

  // ---------------------------------------------------------------------
  //  Text-paste helpers — Cmd/Ctrl+V with non-image text on the
  //  clipboard creates a new TextObject at the cursor. Mirrors the
  //  image-paste flow (one op pushed, auto-switch to Select + select).
  //  Multi-line strings (with `\n`) become multi-line text. Whitespace-
  //  only paste is ignored.
  // ---------------------------------------------------------------------
  // Normalize line endings at the clipboard read boundary so downstream
  // measureText() — which splits on '\n' only — never sees a bare '\r'.
  // Centralizing here covers both clipboard read paths AND the in-editor
  // input handler (which has its own normalize since contenteditable
  // bypasses these reads).
  const normalizeLineEndings = (s: string): string => s.replace(/\r\n?/g, '\n')

  const readTextFromClipboardEvent = (dt: DataTransfer | null): string | null => {
    if (!dt) return null
    const t = dt.getData('text/plain')
    return t ? normalizeLineEndings(t) : null
  }

  const readTextFromAsyncClipboard = async (): Promise<string | null> => {
    if (!navigator.clipboard?.readText) return null
    try {
      const t = await navigator.clipboard.readText()
      return t ? normalizeLineEndings(t) : null
    } catch {
      // Permission denied / not in user gesture / etc.
      return null
    }
  }

  const pasteTextAtBoard = (content: string, board: { x: number; y: number }): void => {
    // Delegate to the Text tool's factory so paste and on-canvas
    // creation share the same TextObject construction (sticky defaults,
    // sizing, persistence, op). Auto-switch to Select afterwards so the
    // user can immediately drag — mirrors the image-paste UX.
    const id = textTool.createTextAt(content, board)
    setTool('select')
    selectTool.selectTextById(id)
    showInfoToast('Text pasted')
  }

  /** Subsystem context for `selectionclipboard.ts`. Built once at boot
   *  with closure references to the orchestrator's state; the
   *  subsystem reads via getters (so it sees live state) and writes
   *  through the exposed callbacks (so all side effects funnel through
   *  the orchestrator). */
  const selectionClipboardCtx: SelectionClipboardContext = {
    getStrokes: () => strokes,
    getImages: () => images,
    getTexts: () => texts,
    getSelections: () => selectTool.getSelections(),
    getSelectedImage: () => selectTool.getSelectedImage(),
    getSettings,
    loadImageBlob: (ref) => imageStore.loadBlob(ref),
    strokes,
    texts,
    saveStroke: (s) => strokeStore.save(s),
    saveText: persistText,
    pushOp: pushUndoOp,
    nextTextZ,
    showInfoToast,
    setToolSelect: () => setTool('select'),
    selectByIds: (items) => selectTool.selectByIds(items),
    clearSelection: () => selectTool.clearSelection(),
    markCommittedDirty: () => {
      committedDirty = true
    },
  }

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
    // Position uses the last known cursor location (in client coords →
    // board coords). Keyboard-triggered paste with no prior mouse activity
    // falls back to viewport center.
    const pasteAt = (): { x: number; y: number } => toBoard(lastPointer.x, lastPointer.y)
    void (async () => {
      const dt = e.clipboardData
      // Whiteboard-native paste first: if the clipboard's text/html slot
      // carries a `data-whiteboard-v1` marker, the user is pasting a
      // selection that was copied FROM this whiteboard. Restore as
      // vector strokes at the cursor rather than as a raster PNG.
      const html = dt?.getData('text/html')
      if (html) {
        const bundle = extractStrokesFromHtml(html)
        if (bundle) {
          e.preventDefault()
          pasteSelectionBundle(bundle, pasteAt(), selectionClipboardCtx)
          return
        }
      }
      // Try the synchronous ClipboardEvent path first when clipboardData
      // is non-null. This catches drag-drop, file managers, screenshot
      // utilities that populate `dataTransfer.files` / `dataTransfer.items`
      // with `kind === 'file'`.
      if (dt) {
        const blob = await readImageFromDataTransfer(dt)
        if (blob) {
          e.preventDefault()
          await pasteImageFromBlob(blob, pasteAt(), imagePasteCtx)
          return
        }
      }
      // Async Clipboard API fallback. CRITICAL for:
      //   - Google Docs / Google Slides image copy (puts image bytes
      //     only on the async API, not on `clipboardData.files`)
      //   - Safari with screenshot / annotation utilities
      //   - Some Linux DEs that route image data through the async
      //     clipboard portal only
      // Note: this runs even if `e.clipboardData` was null — without
      // this, the Google Docs round-trip (copy from sheet → paste back
      // into whiteboard) silently dropped the image.
      const fallback = await readImageFromClipboard()
      if (fallback) {
        e.preventDefault()
        await pasteImageFromBlob(fallback, pasteAt(), imagePasteCtx)
        return
      }
      // No image on the clipboard — try plain text. Pasting text onto
      // the canvas creates a new TextObject at the cursor with the
      // user's sticky-default font / size / color. Multi-line text
      // (with `\n` separators) becomes a multi-line text object;
      // whitespace-only paste is ignored.
      const text = readTextFromClipboardEvent(dt) ?? (await readTextFromAsyncClipboard())
      if (text?.trim()) {
        e.preventDefault()
        pasteTextAtBoard(text, pasteAt())
        return
      }
      // Nothing usable found. Surface a short toast so the user knows
      // the Cmd+V was seen but had nothing to land — common when copying
      // from sources that don't populate the system clipboard (Google
      // Docs's internal image clipboard, app-private formats, etc.).
      showInfoToast('Nothing to paste')
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

  // Copy / cut event wiring. The actual clipboard pipeline lives in
  // `selectionclipboard.ts`; this layer just gates on context and
  // delegates. Cut's delete is gated on clipboard-write success —
  // data-loss-prevention rule that's been here since v1.1's image cut.
  const onCopy = (e: ClipboardEvent): void => {
    if (isTextEditableTarget(e.target)) return
    if (tool.current !== selectTool) return
    if (selectTool.getSelections().length === 0) return
    e.preventDefault()
    void performSelectCopy(selectionClipboardCtx)
  }

  const onCut = (e: ClipboardEvent): void => {
    if (isTextEditableTarget(e.target)) return
    if (tool.current !== selectTool) return
    if (selectTool.getSelections().length === 0) return
    e.preventDefault()
    void (async () => {
      const ok = await performSelectCopy(selectionClipboardCtx)
      if (ok) selectTool.deleteSelected()
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
      const existingTools = findPopoverByTag('tools')
      if (existingTools) {
        // A tool menu is already up. If it's pinned, the user explicitly
        // asked for it to persist — flash it to redirect their eye (the
        // pinned menu IS their context menu now) and don't open a new
        // instance. Otherwise, the right-click acts as a toggle and
        // dismisses just the tool menu (any other coexisting popovers
        // — color, options, export — are unaffected; this is a
        // tool-menu-specific toggle, not a global cancel).
        if (existingTools.isPinned()) {
          existingTools.flashAttention()
        } else {
          existingTools.dismiss()
        }
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
          // Empty board → reset zoom (fitToContent returns false on
          // empty). Fall through so "Fit to view" always does something
          // visible rather than no-op'ing on a fresh canvas.
          const fit = fitToContent(
            camera,
            { strokes, images, texts },
            { width: target.width, height: target.height },
          )
          if (!fit) resetZoom(camera)
          onCameraChange()
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
            getTexts: () => texts,
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
      // the in-memory strokes, images, texts, and the IDB stores. See
      // ops.ts (clear is *not* an Op).
      strokes.length = 0
      images.length = 0
      texts.length = 0
      shapes.length = 0
      selectTool.clearSelection()
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
      void textStore.clear().catch((err) => {
        console.warn('whiteboard/web: text clear failed:', err)
      })
      void shapeStore.clear().catch((err) => {
        console.warn('whiteboard/web: shape clear failed:', err)
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

  /**
   * Cmd/Ctrl + B / I / U dispatcher. Two scopes:
   *   - Text tool currently EDITING a text → routes to the tool's
   *     toggleFormat (the editor's keydown handler intercepts first when
   *     focused; this is the backup for momentary-focus-loss cases).
   *   - Select tool has a TEXT selected (not editing) → toggle that
   *     text's font directly + emit an `edit-text` op so undo restores.
   * Other contexts: no-op (matches user expectation).
   */
  const toggleTextFormat = (which: 'bold' | 'italic' | 'underline'): void => {
    if (textTool.isEditing()) {
      textTool.toggleFormat(which)
      return
    }
    const sel = selectTool.getSelected()
    if (sel?.kind !== 'text') return
    const t = texts.find((x) => x.id === sel.id)
    if (!t || t.deleted) return
    // Spread `t.font` for the snapshot — `t.font` is mutated in-place
    // below, and `before.font` must be a SEPARATE object (not a live
    // reference) for undo to correctly restore the pre-toggle state.
    const before = {
      content: t.content,
      font: { ...t.font },
      color: t.color,
      wrapWidth: t.wrapWidth,
    }
    if (which === 'bold') t.font.bold = !t.font.bold
    else if (which === 'italic') t.font.italic = !t.font.italic
    else t.font.underline = !t.font.underline
    persistText(t)
    const after = {
      content: t.content,
      font: { ...t.font },
      color: t.color,
      wrapWidth: t.wrapWidth,
    }
    pushUndoOp({ kind: 'edit-text', textId: t.id, before, after })
    committedDirty = true
  }

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
        // Same fallback as the right-click "Fit to view" pill — empty
        // board resets zoom so the keyboard shortcut is never a silent
        // no-op.
        const fit = fitToContent(
          camera,
          { strokes, images, texts },
          { width: target.width, height: target.height },
        )
        if (!fit) resetZoom(camera)
        onCameraChange()
      },
      clear: clearFlow.request,
      toggleTheme: cycleMode,
      toggleColor: () => {
        // Toggle the color picker specifically — leaves any other
        // popovers (e.g. a pinned tools menu) alone. Same-tag toggle
        // dispatch.
        const existing = findPopoverByTag('color')
        if (existing) existing.dismiss()
        else openColorPicker(lastPointer)
      },
      toggleOptions: () => {
        const existing = findPopoverByTag('options')
        if (existing) existing.dismiss()
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
      selectSelectTool: () => setTool('select'),
      selectLaserTool: () => setTool('laser'),
      selectTextTool: () => setTool('text'),
      // Cmd+B/I/U routed to the text tool's external entry. No-ops when
      // not in edit mode (the tool's own contenteditable handler also
      // intercepts these; this is a backup for the edge case where the
      // editable lost focus momentarily).
      toggleTextBold: () => toggleTextFormat('bold'),
      toggleTextItalic: () => toggleTextFormat('italic'),
      toggleTextUnderline: () => toggleTextFormat('underline'),
      deleteSelection: () => {
        // Multi-aware Select tool owns the single-and-multi delete path
        // for all object kinds (Lasso absorbed; ADR 0014).
        if (tool.current === selectTool && selectTool.deleteSelected()) return true
        return false
      },
      selectAll: () => {
        // Guard: if a text editor is open, defer to its native Cmd+A
        // (the editor's keydown handler stops propagation; this guard
        // catches the edge case where focus drifted off the editor
        // momentarily and the global keymap saw the event). Switching
        // tools here would clean-up the text tool and destroy the
        // in-progress edit — exactly the wrong outcome for Cmd+A.
        if (textTool.isEditing()) return
        // Switch to the Select tool and populate its multi-selection
        // with every non-deleted object. Replaces the previous lasso-
        // plus-batchSelection split (Phase B3 of the lasso → select
        // absorption; ADR 0014 multi-select migration).
        setTool('select')
        selectTool.selectAll()
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
        // Esc closes the help overlay if open. Goes after popovers so a
        // user with both help AND a popover open dismisses one at a
        // time — same pattern as distraction-free above.
        if (help.isOpen()) {
          help.close()
          handled = true
        }
        // Esc cancels any Select-tool selection state — either a
        // committed multi-selection OR a marquee drag still in
        // progress. The marquee check matters because a user mid-
        // marquee has `getSelections().length === 0` until release,
        // so Esc would otherwise not abort the gesture and the
        // marquee would commit on the next pointer-up.
        if (
          tool.current === selectTool &&
          (selectTool.getSelections().length > 0 || selectTool.hasPendingMarquee())
        ) {
          selectTool.clearSelection()
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
        // Toggle export popover specifically. Doesn't touch a pinned
        // tools menu or other coexisting popovers.
        const existing = findPopoverByTag('export')
        if (existing) existing.dismiss()
        else
          openExportPopover({
            anchor: lastPointer,
            getStrokes: () => strokes,
            getImages: () => images,
            getTexts: () => texts,
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

      // Pending stamps are read through the EraserTool's `getPendingStamps`
      // extension (in-flight wipe sweep not yet committed); skipped if a
      // different tool is active.
      const pendingStamps = tool.current === eraserTool ? eraserTool.getPendingStamps() : null

      for (const s of strokes) {
        if (s.deleted) continue
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
      // Multi-selection outline predicate: true when the object is
      // part of a Select-tool selection with MORE than one item (the
      // single-selection case is painted by the Select tool's own
      // redraw — handles + outline). Cmd+A populates Select with
      // every non-deleted object, which is the primary user-facing
      // path for this visual.
      //
      // Set-cached per frame: a single .filter().map() walks the
      // selection once and the renderer's per-image / per-text lookup
      // is O(1). Without the cache, the prior `sels.some(...)` predicate
      // ran O(M) for every image and every text, producing O(N×M)
      // comparisons per frame on a Cmd+A of a large board.
      const sels = selectTool.getSelections()
      const multiSelectedImageIds =
        sels.length > 1 ? new Set(sels.filter((s) => s.kind === 'image').map((s) => s.id)) : null
      const multiSelectedTextIds =
        sels.length > 1 ? new Set(sels.filter((s) => s.kind === 'text').map((s) => s.id)) : null
      const multiSelectedShapeIds =
        sels.length > 1 ? new Set(sels.filter((s) => s.kind === 'shape').map((s) => s.id)) : null
      renderImages({
        images,
        layer: target.committed,
        camera,
        viewBBox,
        isMultiSelected: multiSelectedImageIds
          ? (id) => multiSelectedImageIds.has(id)
          : () => false,
      })

      // Texts render above images and below the strokes composite. The
      // currently-edited text id is masked out by the render so the DOM-
      // overlay editable doesn't double-render the same content.
      renderTexts({
        texts,
        layer: target.committed,
        camera,
        viewBBox,
        resolveColor: resolveInkColor,
        editingId: textTool.getEditingId(),
        isMultiSelected: multiSelectedTextIds ? (id) => multiSelectedTextIds.has(id) : () => false,
      })

      // Shapes render above texts and below the strokes composite, so
      // pen ink can naturally annotate on top of vector shapes the same
      // way it does on top of images and text.
      renderShapes({
        shapes,
        layer: target.committed,
        camera,
        viewBBox,
        resolveColor: resolveInkColor,
        isMultiSelected: multiSelectedShapeIds
          ? (id) => multiSelectedShapeIds.has(id)
          : () => false,
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
