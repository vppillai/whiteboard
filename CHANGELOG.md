# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each milestone (M0..M7 — see [docs/milestones.md](docs/milestones.md)) closes with a `[Unreleased]` → version-tagged entry here.

## [Unreleased]

### Added

#### Milestone M0 — drawing core (code complete; Intuos latency validation pending)

- Drawing surface: two-canvas (committed + live) renderer, `perfect-freehand` stroke geometry, γ=2 pressure curve preset.
- Pointer pipeline: `getCoalescedEvents()` for full 200 Hz Wacom sampling; `getPredictedEvents()` for visual lookahead.
- Infinite canvas: wheel-pan, Cmd/Ctrl+wheel and trackpad pinch zoom around the cursor; `Cmd/Ctrl+0` reset, `Cmd/Ctrl+±` step zoom; subtle dot grid that fades when zoomed out.
- Theme support: light / dark / system, persisted; brush ink color follows theme via an `'ink'` token re-resolved at render time. `T` cycles modes.
- Local persistence: IndexedDB-backed auto-save on stroke commit; existing strokes hydrate on app boot.
- Metrics HUD (toggle `M`): live FPS, events / second, samples / event, last event-to-frame delta.
- Synthetic perftest harness (`?perftest=1`) reporting mean / p50 / p95 / max event-to-render latency in JS.
- Help overlay (toggle `?`) and theme-mode pill.
- Server (placeholder) now serves the built SPA from `apps/web/dist` with SPA fallback and immutable caching for `/assets/*`.

#### Pre-M0 — repository scaffold

- Bun workspace layout, multi-stage Docker, GitHub Actions CI, Biome, pre-commit hooks.
- Product spec ([SPEC.md](SPEC.md)) v0.1.
- ADRs 0001–0003: greenfield canvas, Bun runtime, Y.js CRDT.
- MIT license, contributor guide, README with AI-generated disclosure.

### Changed

- Milestone scope: M0 expanded to include theme, local persistence, and pan/zoom (originally scoped to M1/M2). M1 and M2 sized down accordingly. See `docs/milestones.md`.
- **Clear-board shortcut**: now `⌘/Ctrl + Shift + K`, with a **two-step confirmation** (first press primes a 3-second toast; second press within that window actually clears; `Esc` cancels). The combo migrated `K → Backspace → C → K` over the M0 / M1.5 iteration as user testing surfaced trade-offs: `Backspace` was unmnemonic; `C` collided with system-level shortcuts. Settled on `K` + confirmation so the foot-gun of single-key accidental clear is gone regardless of which letter we pick.
- Plan refreshed against M0 learnings: `M4` trimmed (multi-stage Dockerfile, static serving, healthcheck, `deploy.sh` already shipped at M0); `process.md` adds an explicit *feel-test on target hardware* gate per milestone close, plus a `?perftest=scale` performance-at-stroke-count gate from M1 onward; `SPEC § 10` reorganized into "decided", "still open", and "backlog" (screen-tablet support, mobile / touch UX, accessibility now tracked there).
- New ADR [0004](docs/decisions/0004-input-pipeline-tuning.md) captures the input-pipeline decisions that drove M0 feel.

### Fixed

- Committed strokes now finalize with `last: true` in `perfect-freehand`, producing a clean polished cap. Previously strokes (including persisted ones) re-rendered with `last: false`, leaving a slightly serrated leading edge that read as "blocky" under inspection.
- Live stroke rendering moved out of the RAF queue and into the pointer handlers themselves. With `desynchronized: true` on the canvas context, this trims roughly half a frame of perceived latency on the wet ink.
- Default brush retuned for a more felt-marker-like feel: `size 3 → 3.5`, `thinning 0.6 → 0.45`, `smoothing 0.5 → 0.7`, `streamline 0.5 → 0.4`, `pressureGamma 2.0 → 1.7`. Streamline was deliberately *reduced* — higher streamline trades latency for smoothing.
- Predicted events disabled by default. On indirect-input devices (Wacom Intuos non-screen), the predicted lookahead leads the cursor and visibly flickers when the pen changes direction. Re-enable with `?predict=1` to A/B-test on hardware where the trade-off is favorable (e.g. screen tablets).
- Brush gained an `opacity` field; the default pen now renders at 0.94 alpha so overlapping strokes layer subtly, which reads as "real ink" rather than digital fill.

### Added

#### Milestone M1.5 — popover foundation

- **Popover primitive** (`popover.ts`). Anchored at a client point, viewport-clamped, with a header containing pin and close buttons. **Single-instance**: opening any popover replaces any existing one (pinning keeps a popover alive across click-outside and selection events, but not across an explicit request to open a different popover). `Esc` and the close button always dismiss. Identity tags via `tag` make toggle behavior (press the same shortcut to dismiss) trivial for callers.
- **Color picker** (`C` to open at pointer; `C` again to dismiss). 5×2 swatch grid: theme `ink` token plus nine curated accent colors that read on both light and dark backgrounds. Selection sets the brush color and dismisses unless pinned. Inline "recent colors" row updates on selection, persists across reloads (max 6).
- **Options menu** (`O` to open at pointer; `O` again to dismiss). Grid type selector (dots / lines / ruled / none) and spacing pills (16 / 24 / 32 / 48 px). Defaults to pinned because options are usually adjusted iteratively.
- **Configurable grid lines now visible**. Lines and ruled grids use a separate `--grid-line` CSS token (more visible alpha) than the dot grid's `--grid-dot`. Per-pixel alpha for spread-out lines must be higher than for pixel-sized dots to read at the same overall weight; M1.5's first cut shared the value and lines were nearly invisible.

### Fixed / Changed (M1 — eraser UX + keyboard expansion + clear-flow focus)

- **Eraser mode no longer persists across sessions.** Selecting the **Item** pill in the right-click ERASER section was being written to localStorage as `eraserMode: 'item'`, which then stuck across reloads. Users perceived this as "wipe-erase doesn't work" because every gesture locked into Object/Item mode at pointerdown (eraser.ts:156). Fix: `eraserMode` is session-scoped — `settings.ts` reloads default `'wipe'` on every session, and the persisted shape excludes the field. Item is still selectable via the menu (within the session) and via Shift held at pointerdown (mid-gesture). Wipe size, brush, color, and grid persistence are unchanged.
- **`P` key** — switch to Draw tool **and** the Pen brush preset. The "go to my default drawing setup" key. Equivalent to right-click → Draw + Pen brush in one keystroke. `B` still works as before (Draw tool, current brush preset preserved).
- **`E` key is now pure spring-loaded.** Press E → eraser; release E → revert to the previous tool. Always reverts. Mirrors the pen-tablet idiom of spring-loaded modifier keys (Photoshop, Krita). Implemented in a small dedicated module `apps/web/src/eraserhold.ts` modeled on `pan.ts`'s spacebar-pan pattern.
- **`Shift+E` is the new sticky-eraser** (separate key from the spring-loaded modifier — avoids fragile time- or stroke-based discrimination on the same key). `Shift+E` toggles the eraser tool persistently; switch back via `B` / `P` / right-click.
- **Clear-board confirm focuses the destructive button.** When `⌘/Ctrl+Shift+K` opens the "Clear the whole board?" toast, the **Clear** button now receives focus, so Enter activates it (native button behavior). On both confirm and cancel paths, focus is handed back to `#app` (made programmatically focusable via `tabindex="-1"`) so subsequent keystrokes don't go through a stale button. CSS suppresses the focus ring on `#app`.
- SPEC § 4.3 keyboard table updated with `B` / `P` / `E (hold)` / `Shift+E` rows; help overlay (`?`) updated to match.

### Changed (M1 — wipe-eraser is pixel-mask "cuts through")

- **Wipe-eraser is segment-level via a per-stroke pixel mask** ([ADR 0009](docs/decisions/0009-pixel-mask-eraser.md)). Each `Stroke` carries `erasedStamps?: { x, y, r }[]` — a list of cursor-disk records added during wipe sweeps. The renderer applies `globalCompositeOperation = 'destination-out'` for every stamp on a dedicated offscreen strokes canvas, then composites onto the committed canvas after the grid. The visible cursor circle and the erased pixels match 1:1 — no over-erase, no trail past the cursor, no perfect-freehand outline drift at run boundaries.
- **New `eraseStamps` op** in `ops.ts`. Sweep records pending stamps in tool-internal state (renderer queries them via `EraserTool.getPendingStamps()` for live preview). On pointerup, the tool emits one op carrying per-stroke `{ strokeId, addedStamps }` edits; `applyOp` mutates the stroke's `erasedStamps`. `unapplyOp` removes the same stamps by exact field equality. Single Cmd+Z restores the whole sweep.
- **Three-canvas render pipeline.** `RenderTarget` gains a `strokes` offscreen layer (NOT in DOM). Render order each frame: clear strokes → draw outlines → apply destination-out for every stamp → clear committed → draw grid → composite strokes onto committed in pixel space. Grid sits on the committed canvas, untouched by destination-out.
- **Object-mode eraser unchanged behaviorally** (Item pill or Shift-modifier). Two callbacks: `onObjectErase(strokeIds[])` emits a `delete` op; `onWipeErase(StampEdit[])` emits an `eraseStamps` op.
- **Storage migration is implicit** — pre-existing strokes load with `erasedStamps` undefined; renderer treats absence as "no erasure." Same on-disk shape; no schema bump.
- **`?perftest=erase` synthetic harness** populates N strokes (`&n=`, default 500) and drives a sinusoidal sweep, reporting actual per-frame render cost. Verifies the ADR 0009 16 ms / frame budget. Companion `?perftest=scale=N` drives synthetic pan + zoom over the same population to verify the M1 perf-at-scale exit criterion. Both harnesses share `populatePerfStrokes` and `reportPerf` helpers, and read render durations from a module-level `perfRecording` flag that the main `frame()` function pushes into when active — so the reported numbers are the actual render cost (clear → outlines → destination-out → composite), not the harness's tick body.
- ADR 0008 (per-sample mask) was implemented mid-milestone and shipped to feel-test; **superseded by ADR 0009** after Wacom Intuos testing surfaced that sample-based representation cannot pixel-precisely match the cursor footprint regardless of tolerance arithmetic. Both ADRs preserved as design history; ADR 0008's *Considered alternatives* explicitly justifies why ADR 0009's "per-stroke pixel mask" is distinct from the "global pixel raster" 0008 rejected.
- **`docs/process.md`** gains a "tool changes require a feel-test scenario before code-complete" rule, captured from the four-iteration journey through this work.
- SPEC § 4.1 describes pixel-mask as the shipped wipe behavior; milestones.md M1 row updated to 🟦.

### Added (M1 — tool indicator pill)

- **Bottom-right tool pill** (`apps/web/src/toolpill.ts`) — small persistent indicator showing the active tool, tap to cycle (`Draw → Eraser → Lasso → Draw`). Pen-friendly one-step activation alongside the existing `S` / `B` / `P` / `Shift+E` keyboard paths and the right-click → TOOL menu. Pill mirrors the existing bottom-left help pill in placement and style; clicking it refocuses `#app` so subsequent keystrokes don't go through the button. Styles in `style.css` use `--pill-bg` / `--pill-fg` for theme-awareness.

### Added (M1 — lasso tool)

- **Lasso select-move-delete** as a single new file (`apps/web/src/tools/lasso.ts`) conforming to the extended `Tool` interface (ADR 0007). No diffs to `main.ts` or `toolmenu.ts` beyond a registry entry and the keymap callbacks — the contract held.
- **Three-phase state machine**: idle → lasso (drawing polygon) → moving (dragging selection). Drag in empty space draws a polygon; tap on a stroke single-selects it; drag inside the existing selection's union bbox moves all selected strokes. Pointerup picks the right phase exit based on movement.
- **Polygon-in-stroke hit test**: any sample of a stroke inside the closed polygon = stroke selected. Standard ray-casting, sample-level. Single-tap path uses sample-distance to the click point with an 8 px tolerance.
- **Selection visualization**: per-stroke **halo** (perfect-freehand outline traced with a wider accent-blue line on the live layer) + **dashed bounding-box** outline around the selection union. Both rendered in `lasso.redraw()` so they survive committed-dirty cycles. Marching-ants animation deferred — would force a live redraw every frame, breaking the dirty-driven render-loop optimization; revisit if static dashes feel flat in feel-test.
- **Drag-to-move with ghost preview**. `LassoTool.getDragState()` returns `{ ids, dx, dy }` while moving; the orchestrator's render loop skips those strokes from the offscreen pass, and `lasso.redraw()` paints them on the live layer at offset. On pointerup, a single `move` op fires (existing op kind from M1.4); undo restores the original positions.
- **`move` op now translates `erasedStamps` alongside samples** so a partly-erased stroke keeps its holes in the right place after a move (ADR 0009 stamps live in absolute board coords, like the samples themselves).
- **Keyboard**: `S` activates lasso; `Delete` / `Backspace` deletes selection (preventDefault only on success so Backspace can still go-back when there's nothing selected); `⌘/Ctrl + A` activates lasso and selects all non-deleted strokes.
- **Right-click → ERASER section** still works when eraser active; lasso adds its own **Selection (N)** section with **Delete** + **Clear** pills (the latter just deselects). TOOL row's Lasso pill is now enabled.
- SPEC § 4.3 keyboard table: `S`, `Delete` / `Backspace`, `⌘/Ctrl + A` flipped to ✅. Help overlay (`?`) updated. milestones.md M1 row reflects lasso shipped. architecture.md as-built table gains the `tools/lasso.ts` entry.

### Refactored (M1 — tool surface; was M1.6 sub-milestone)

- **Tool interface extended** (ADR 0007 supersedes 0005's interface). Each tool now owns its cursor / stroke / hover rendering AND its right-click menu section. `ToolContext` carries `liveLayer`, `camera`, `dpr`, `resolveColor` so tools render directly to the live layer without callbacks.
- **`renderContextualMenu(host, dismiss)`** — pen owns COLOR + BRUSH; eraser owns the 4-pill ERASER section. `toolmenu.ts` becomes a dispatcher that calls `activeTool.renderContextualMenu()`.
- **`redraw(ctx)`** — orchestrator can ask the active tool to re-render its in-flight state (e.g., during stroke when camera changes). Pen implements; eraser doesn't need it.
- New `menu-ui.ts` with shared DOM helpers (sectionLabel / pill / swatch / pillRow / fullItem / separator / paletteGrid). Tools import from it; `toolmenu.ts` does too.
- `main.ts`: 646 → ~500 LOC. `toolmenu.ts`: 296 → ~120 LOC. Pen / eraser tool modules grow proportionally — net structure-not-size win.
- **Wipe-erase now deletes progressively during the sweep** (was: only at pointerup). `sweepHit` flips `Stroke.deleted` immediately on each new hit and the eraser asks for a committed-layer redraw via a new `ToolContext.markCommittedDirty()` hook. Single delete op still emits at pointerup so one undo restores the whole sweep; the op's apply is idempotent on already-deleted strokes.
- **VIEW row uses pills** (Reset zoom · Fit to view · Grid…) matching TOOL / BRUSH / ERASER for pen-friendly consistency.
- **SPEC § 0** now structurally enforces the snappy tenet — calls out pointer dispatch sync, live render in input handler, per-tool ownership, cached stroke math, viewport culling, per-surface menu ownership as the load-bearing structure.

### Added (M1 — eraser, brushes, polish)

- **5 brush presets** (Pen / Marker / Pencil / Highlighter / Brush). Switch with `1`–`5` keys or the right-click BRUSH section. Per-brush hover cursor: pen / marker / pencil are filled circles of varying weight; highlighter is a chisel rectangle; brush has a soft halo.
- **Eraser tool** (`E` shortcut). Two modes:
  - **Wipe** (default) at three sizes (Small / Medium / Large = 6 / 12 / 24 px). Sweep deletes all crossed strokes as one undoable op.
  - **Item** — single tap deletes only the topmost stroke under the cursor. Selectable as a 4th pill OR temporarily activated by Shift held during a wipe-mode click.
  - Cursor: red circle for wipe; circle + center reticle for item. Different cursor in hover when Shift is held so the prospective mode is visible.
- **Shift-constrained drawing**: hold Shift mid-stroke to snap to a straight line from pointerdown to current cursor. Renders with `last: true` so the line cap shows live, not just on commit.
- **`Cmd/Ctrl + 1` zoom-to-fit** — fits all non-deleted strokes in the viewport with a margin.
- **Stroke clipping** — render loop skips strokes whose AABB doesn't intersect the visible viewport. Per-stroke AABB cached in a `WeakMap` (lazy compute, invalidated on `move` op).
- **Right-click menu reorganized** with section labels (COLOR / BRUSH / TOOL / VIEW). Sections become contextual: Draw shows COLOR + BRUSH; Eraser shows ERASER; future tools own theirs (M1.6 plumbing).
- **Pen hover preview** — small semi-transparent dot at cursor showing the active brush's effective shape and color. Disappears the instant you start a stroke.
- **`Fit to view` in the right-click menu** under VIEW.
- Drawing tool's user-facing label changed `Pen` → `Draw` to disambiguate from the Pen brush preset (internal `ToolId 'pen'` unchanged).

### Added (M1.4 — refactor pass before M1; closed)

- **Tool abstraction.** New `Tool` interface (`apps/web/src/tools/types.ts`) with `onPointerDown` / `onPointerMove` / `onPointerUp` / optional `cleanup`. `pointer.ts` becomes a pure event router that dispatches to whichever tool is active. `PenTool` (`tools/pen.ts`) is the only implementation today; eraser / lasso / laser / text plug in at M1+ without touching `pointer.ts`. See ADR 0005.
- **Operation-based undo / redo.** New `ops.ts` defines `Op = create | delete | move` with `apply` / `unapply`. The undo and redo stacks are now uniform `Op[]`; stroke-create emits `{ kind: 'create', strokeId }`. M1's eraser and lasso work plug in by emitting a different op kind. See ADR 0006.
- **Soft-delete strokes.** `Stroke.deleted` is now honored — render loop filters strokes with `deleted: true`. Strokes never leave the in-memory array or IDB on undo; just a flag flip. Cheaper, CRDT-friendlier (M3), position-stable.
- **`main.ts` decomposed.** Extracted `pan.ts`, `helpoverlay.ts`, `pill.ts`, `clearflow.ts`, `keymap.ts`, `viewstate.ts`. `main.ts` now ~470 LOC of orchestration, down from 641.
- **Camera position persists across reload.** Per-device localStorage. Reset to origin only on clear-board. Infinite canvas means there's no canonical home — wherever you left off is home.
- ADR 0005 (tool abstraction) and ADR 0006 (op-based undo) added.

### Performance

- **Cached canvas-rect.** `toBoard` no longer calls `getBoundingClientRect()` per pointer sample; the rect is captured at init and refreshed on `resize`. Surfaced as input lag during sustained drawing because incidental DOM mutations (popover open / close, dataset attr flips, theme toggles) had been invalidating layout.
- **Removed duplicate document-level `pointermove` listener.** Was tracking lastPointer for an edge case (popovers anchoring at cursor when cursor is over a popover); fired on every pointer movement anywhere in the document.

### Changed (M0+ feel polish)

- **Pen-pressure response strengthened**. `thinning` 0.45 → 0.6 (wider line-width range between light and heavy pressure), `pressureGamma` 1.7 → 1.3 (more responsive at low pressure). New: stroke opacity scales with the stroke's average pressure (0.65× to 1.0× of the base brush opacity), so light strokes appear faded and heavy strokes saturated. Per-segment shade *within* a stroke (Procreate-style) requires a different render approach (variable-width line segments instead of a filled outline) — deferred to M2 with an ADR.
- **Metrics HUD hidden by default.** Press `M` to show. Most of the time the user just wants to draw; the metrics surface only when something's worth measuring.
- **Theme indicator removed** from the bottom-left pill. Theme cycling is silent now (the visible color change is its own indicator). Pill simplified to "? for help"; help overlay gained a clickable link to the GitHub repo at the bottom.
- **Configurable grid renderer** (`grid.ts`). Square-line and ruled (horizontal-only) grids in addition to the existing dot grid; reads from the settings store. None disables the grid entirely.
- **Settings module** (`settings.ts`). Single source of truth for current brush color, recent colors, and grid configuration. Persists to localStorage. Subscribers notified synchronously on change so the renderer can mark itself dirty.
- Help overlay updated; `Esc` now closes any open popover (and still cancels a pending clear-confirm).

#### Milestone M0 — drawing core (closed)
- **Undo / redo** for stroke creation. `Cmd/Ctrl+Z` undoes; `Cmd/Ctrl+Shift+Z` (or `Cmd/Ctrl+Y` for Windows muscle-memory) redoes. Redo history clears whenever a new stroke is committed and is not persisted across reloads — matches every other drawing tool. Undone strokes are removed from the IndexedDB store; redoing re-persists them.
- Help overlay (`?`) refreshed with the new pan and undo options.
- GPU compositor hints on canvas elements (`transform: translateZ(0)`, `will-change: transform`) so the present-to-screen path doesn't repaint neighbouring DOM. The 2D canvas was already GPU-composited; this just makes each layer its own compositor surface.

### Added (M1.7 — settings side panel + sync-ready schema)

- **Side panel** (`Cmd/Ctrl + ,`) sliding in from the right edge as an overlay
  (canvas keeps full width). Built on a new `sidepanel.ts` primitive deliberately
  decoupled from M1.7 content so future panels (AI features, file browser) can
  compose without rework. ADR 0010.
- **Versioned settings schema** (`SettingsV1`) with `schemaVersion: 1`, sparse
  brush preset overrides, custom swatches, recent colors, fonts (reserved),
  and reserved sync fields (`syncedAt?`, `remoteId?`). Eager migrate-on-load
  from the v0 shape; mechanical fill of new fields with defaults.
- **Brush preset tuning** in the panel — per-brush sliders for size, opacity,
  pressureGamma. Live-updates strokes after the slider change (existing
  committed strokes are unaffected; their brush is captured at pointerdown).
  "Reset this preset" link restores SPEC defaults.
- **Custom swatches** integrated into the color picker grid (with a 1.5 px ring
  distinguishing them from curated). New "+" tile in the picker opens a
  sub-popover with hex text input + OS color picker + Add. Same swatchadd
  component reused in the panel's Custom swatches section.
- **Recent colors** implemented for the first time (was in CHANGELOG M1.5
  but never landed). Stored as `settings.recentColors`, capped at 6, MRU order.
  Picker auto-pushes on color pick (excludes the `'ink'` token).
- **Advanced section** (collapsed by default) with the remaining 8 BrushConfig
  knobs per brush — thinning, smoothing, streamline, taperStart, taperEnd,
  capStart, capEnd. Same sparse-override semantics.
- **Grid + Theme** sections in the panel duplicate the popover / `T` key
  surfaces — both paths write the same state.
- **Reset to defaults** footer wipes Scope-B targets (presets, customSwatches,
  recentColors, scalar settings); theme deliberately preserved (lives in
  separate `whiteboard:theme` storage key — see ADR 0010 § Theme isolation).
  Two-step confirm via the shared `destructiveconfirm.ts` primitive
  (refactored out of `clearflow.ts`; the clear-board flow now uses it too).
- **First-time bun test infrastructure**: `bun test` runs across workspaces.
  `settings.test.ts` covers `migrate()` (v0 → v1, malformed, partial,
  type-mismatched, idempotent, hex filtering, recent cap), brush preset
  composition, custom swatch + recent color set semantics, `resetAll()`.
- **Toolpill gains a gear zone** to the left of the tool-name zone — a
  pen-friendly entry to the panel.
- **Right-click menu Settings… row** opens the panel.

### Changed (M1.7)

- **`settings.ts` rewritten** to v1 schema. Existing getters/setters preserved
  with the same names; new helpers: `getEffectiveBrushConfig(brushId, color)`,
  `setPresetField(id, field, value)`, `clearPreset(id)`, `addCustomSwatch`,
  `removeCustomSwatch`, `pushRecentColor`, `resetAll`.
- **`clearflow.ts` collapsed** to a thin wrapper around `destructiveconfirm`.
  Behavior is identical; the priming-toast pattern is now reusable.
- **`colorpicker.ts` extended** to render the integrated grid + "+" tile.

### Fixed (M1.7)

- Recent-colors row was listed in CHANGELOG M1.5 but never actually
  implemented. M1.7 ships it for the first time and folds it into the
  versioned settings schema.

### Fixed (M1.7.1 — hardening pass)

Three minor concerns flagged by the M1.7 holistic code review, plus a
favicon polish item:

- **`validatePresets` now deep-validates preset field types.** The
  earlier shallow cast accepted any object as a `Partial<BrushConfig>`,
  so a tampered `localStorage` could surface `NaN` at render time
  (e.g. `{ size: 'banana' }`). New `validateOnePreset` filters fields
  to known numeric (`size` / `thinning` / `smoothing` / `streamline` /
  `taperStart` / `taperEnd` / `pressureGamma` / `opacity`) and boolean
  (`capStart` / `capEnd`) keys, with per-field type checks. Preset
  entries with no surviving fields are dropped entirely.
- **`migrate(null)` returns a clean `SettingsV1`.** Previously the
  null-input branch returned `cloneSettings(DEFAULTS)`, which is a
  `State` (carrying the session-only `eraserMode`) — a type-contract
  violation that would surface if a future sync layer treated
  `migrate()`'s output as authoritative for persistence. New
  `defaultV1()` helper returns a fresh `SettingsV1` literal; `DEFAULTS`
  layers `eraserMode: 'wipe'` on top for the in-memory `State`.
- **`persist()` now debounces writes (100 ms).** Slider drags fired
  one `input` event per drag step (~60 Hz); each step did
  `JSON.stringify(state) + localStorage.setItem`. On slow devices,
  that's ~60 ms of main-thread work per second of drag. The new
  debounce coalesces a flurry of writes into a single trailing-edge
  write. Trailing edits flush via `pagehide` so a slider tweak right
  before tab close isn't lost. `__resetForTesting` cancels any
  pending timer to keep tests deterministic.
- **Inline SVG favicon** at `apps/web/public/favicon.svg` referenced
  from `apps/web/index.html` silences the persistent
  `/favicon.ico 404` in dev / production logs. The icon is a small
  scribble path that scales cleanly across favicon sizes.

5 new unit tests cover the validatePresets / migrate(null) paths.
26 tests pass in total (was 21 at M1.7 close).
