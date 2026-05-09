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

### Planned (M1.x — segment-eraser)

- **Eraser model upgrade scheduled** as a dedicated milestone. Feel-test on Intuos surfaced that stroke-hit erasure (touch any sample → whole stroke removed) doesn't feel like a real eraser. M1.x switches to **segment-level** erasure ("cuts through") via a per-sample mask. Design captured in [ADR 0008](docs/decisions/0008-segment-eraser.md): rejected alternatives (split-stroke, pixel-erase) documented; sample-mask chosen for cache-friendliness, CRDT-friendliness, and identity preservation. Implementation lands as M1.x between M1 and M1.7. SPEC § 4.1 carries a v1 caveat until M1.x ships.

### Refactored (M1.6 — tool surface; code complete, feel-test pending)

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
