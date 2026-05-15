# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each milestone (M0..M7 — see [docs/milestones.md](docs/milestones.md)) closes with a `[Unreleased]` → version-tagged entry here.

## [Unreleased]

No entries yet.

## [1.4.0] — 2026-05-14

**Shape tool — vector primitives (rect / ellipse / line / arrow).** One unified tool with four sub-modes, sticky color / stroke-width / fill defaults, translucent fill (alpha 0.25) so overlapping shapes read as tinted rather than blocked. Lines and arrows encode endpoints via the sign of `transform.w / h`, so the existing rect-based transform pipeline (rotation, resize handles, marquee, multi-drag) carries shapes without per-kind divergence. See [ADR 0018](docs/decisions/0018-shape-data-model.md) for the data-model rationale.

### Added

- **Shape tool with rect / ellipse / line / arrow sub-modes.** Drag-to-create, Shift = constrain (square / circle / 45° lines). Sticky `shapeKind` remembers the last-picked sub-mode across tool re-entries.
- **R / O / A / L keyboard shortcuts** activate the Shape tool AND set the sub-mode in one keystroke.
- **Fill-opacity slider** (per-shape) in both the Shape tool's contextual menu and the Select-tool's shape menu. Default 25%; range 5%–100%. Each shape captures the sticky opacity at creation so the slider doesn't retroactively retint existing shapes. Slider commits ONE undoable op per drag (on pointerup), not per slider-step.
- **Cmd+C / Cmd+V round-trips shapes** inside the whiteboard via the existing `data-whiteboard-v1` bundle (no schema break — `shapes` is an additive optional field). External paste targets still get a PNG.
- **PNG / SVG / PDF exports include shapes.** SVG export emits native `<rect>`, `<ellipse>`, `<line>`, and `<line>+<polyline>` for arrow head — so the exported file stays editable as shapes in other vector tools.
- **Select tool integrates shapes** as a first-class kind. Move / resize / rotate / multi-select / marquee / delete all work the same as for images / texts; the contextual menu picks up a Color / Stroke width / Fill / Fill opacity row when a single shape is selected. Line/arrow resize is **endpoint-based** rather than AABB-based so dragging an end past its origin flips the line direction naturally.
- **Right-click tool menu overhaul.** Icon-only pills with hover-tooltips (name + shortcut). Tool row split into 2 rows of 3. Shared swatch palette (curated + custom + "+") across every per-tool COLOR section, matching the standalone Color picker. Hover-revealed × badge on custom swatches deletes the color inline. Pinned menu persists across browser sessions (localStorage), survives Esc, auto-rebuilds when settings change, and auto-reappears at its saved anchor on page refresh. Tool changes via keyboard / double-Esc broadcast to the pinned menu so its contextual section refreshes for the new tool.

### Changed

- **Keymap rebinds to free up R / O / A / L for shape sub-modes.** `Shift+C` now opens the color picker (was `C`), `Shift+O` opens the options menu (was `O`), `P` activates the laser pointer (was `L`), `Shift+P` activates the pen-default brush (was `P`). The `L` key now maps to the line shape.
- **IDB schema bumps v4 → v5** to add a new `shapes` object store. Upgrade is purely additive; existing strokes / images / texts data is unchanged.

### Fixed

- **IDB upgrade no longer hangs boot silently** when another tab holds an older-version connection open. Added the missing `onblocked` handler so the open promise rejects loudly and the load try/catch surfaces a console warning instead of leaving the app stuck after attaching canvases.

## [1.3.1] — 2026-05-14

Patch — pinned right-click tool menu now genuinely stays pinned across every action, including ones that open another popover (Grid…, Export…, Color picker) or a side panel (Settings) or a confirm flow (Clear board). Previously a pin survived "selection events" in the popover primitive but any explicit `showPopover` call dismissed every existing popover regardless of pin state, so opening Grid / Export from a pinned tools menu killed the pin.

### Fixed

- **Popover primitive supports multi-popover coexistence.** The single-slot `active` registry becomes an array; new popovers replace only same-tag entries (so toggle shortcuts stay deterministic), while different-tag popovers — including pinned ones — coexist. Pinned tools menu now survives the user opening Grid / Export / Color from it.
- **`toolmenu.ts` Grid / Export / Clear handlers use `onAction`**, matching every other body interaction. Pinned menu rebuilds its content (showing fresh active-state highlights) instead of dismissing on every action.
- **Toggle keymap callers (`toggleColor`, `toggleOptions`, `openExport`) dismiss only their own tag** instead of nuking every active popover. Same-tag toggle dispatch via the new `findPopoverByTag` helper.

### Internal

- **`findPopoverByTag(tag)` + `isPopoverActive(tag)`** added to the popover module. `getActiveTag` / `getActivePopover` kept for back-compat but documented as deprecated — the "active" popover is ambiguous when multiple coexist.

## [1.3.0] — 2026-05-13

**Lasso → Select absorption + whiteboard-native clipboard + 4-lane review hardening.** Two major UX overhauls — the Lasso tool's selection model merges into the Select tool (single, multi, marquee all live there now), and `Cmd/Ctrl+C` / `Cmd/Ctrl+V` round-trip strokes + texts as vectors when pasting back inside the whiteboard (still PNG into external apps). Two parallel 4-lane critical code reviews fed substantial refactors: drag-state discriminated union, op-pipeline `transform-many` composite for the upcoming sync, clipboard subsystem extracted into its own module. Several small Tier-A bug fixes shipped along the way.

### Added

- **Click-to-select strokes in Select mode.** The Select tool's hit-test (previously texts-above-images only) now also picks the topmost stroke under the pointer when no floating object hits. Selected strokes get a dashed bbox + the standard Delete handling; no resize / rotate handles (strokes have no rect-derived geometry to drive them). `selectStrokeById(id)` helper exposed for the lasso → Select handoff when a single stroke is lassoed.
- **`Cmd/Ctrl+V` on canvas → TextObject from clipboard text.** When the clipboard carries text/plain (no image) and the active surface is the canvas (not a text-editable input), the paste lands as a new TextObject at the cursor with the user's sticky text defaults. Uses the same `create-text` op as the Text tool so undo just works.
- **"Nothing to paste" toast on dead clipboard.** `Cmd/Ctrl+V` on canvas with no clipboard image / text surfaces an info toast instead of silently doing nothing.
- **Google Docs paste path.** Some sources (notably Google Docs) emit a `paste` event with a populated `clipboardData.items` but no actual image bytes; the previous synchronous handler bailed silently. The handler now falls back to the async Clipboard API when synchronous extraction yields nothing, recovering the paste.

### Changed

- **Tool menu reorder.** The right-click TOOL row now reads `Draw | Text | Eraser | Lasso | Select | Laser` (input verbs first, then mark-removal, then selection/transform, with the presentation accent at the end). The tool-pill cycle order mirrors this.
- **Empty-text auto-cleanup on commit.** Creating a text and Esc-committing without typing anything no longer leaves an empty TextObject behind. The text tool's `cleanup` / `commitEdit` paths now drop empty content as a final step.
- **`select.ts` decomposed.** Per-kind commit and render helpers (`commitImageDrag` / `commitStrokeDrag` / `commitTextDrag`; `drawStrokeSelection` / `drawFloatingObjectSelection`) replace the inline switch-on-kind branches at three call sites. Each helper has its own docblock; file is longer in LOC but switch-site density is lower and the dispatch shape is the chosen incremental migration step before any full vtable refactor (see [ADR 0014](docs/decisions/0014-select-tool-selection-union.md) *Migration trigger*).
- **`BatchSelection` module** (`apps/web/src/batchselection.ts`). The Cmd+A → Delete state for images + texts moves out of `main.ts` into a dedicated module with `markAll` / `clear` / `deleteAll` / `isMarked` surface. Reduces the orchestrator's surface and is straightforward to grow when strokes join the batch surface later.
- **Text-paste factory unified.** The "synchronous paste path" and "async clipboard fallback path" both route through a single `createTextFromClipboardText` factory, eliminating duplicated TextObject construction.
- **Text tool's Esc handoff is one-way (`onEscExit`).** The text tool no longer reaches up into its parent's tool-switching state; instead it calls a single `onEscExit(prevTool)` callback wired by `main.ts`. Cleaner boundary, easier to test.
- **Laser tool color via DI.** The laser tool reads its color through a `getColor()` injection rather than importing `settings` directly. Mirrors the rest of the tool surface and breaks the cycle for testability.
- **`BoardObject` base type** in `packages/shared/src/types.ts`. `ImageObject` and `TextObject` now `extends BoardObject` (shared fields: `id`, `transform`, `rotation?`, `z`, `createdAt`, `deleted?`). Structural extension — not a discriminated union — so kind-specific consumers stay statically typed. Strokes deliberately stay outside (sample-driven, not rect-driven).
- **Generic `flipDeletedOn` helper** in `ops.ts`. The per-kind `flipDeletedOn{Stroke,Image,Text}` undo paths collapsed into one parametric helper. One source of truth for the "find by id, mutate `deleted`, persist" pattern.
- **Commit-drag race guard on contextual-menu edits.** Right-clicking a selected text mid-drag could open the contextual menu before the drag committed; the menu's font/size/color edits would then race the pending `transform-text` op. The select tool now commits any in-flight drag before opening the contextual menu so menu edits land on a stable selection.

### Fixed (review hardening — Tier-A across 4 lanes)

- **`select.cleanup()` didn't commit an in-flight drag.** Switching tools mid-drag could orphan the drag state (no `transform-*` op pushed, but `view.obj.transform` already mutated). `cleanup()` now commits a pending drag through the same per-kind helper as pointerup.
- **`Cmd/Ctrl+1` fit-to-content didn't include images / texts.** Bounds computation walked strokes only; pasted images or texts could sit outside the framed rect. Now uses the same union as the export-bounds path.
- **Bare `\r` normalization in text input.** Some sources (older Office paste, certain Linux clipboards) deliver `\r` line separators; the editor's commit path now normalizes `\r\n` and bare `\r` to `\n` before persisting so wrap-width measurement and SVG export both behave.

### Lasso → Select absorption (BREAKING)

- **Multi-selection in Select tool (`V` or `S`).** The Select tool now owns all selection — single-object (with handles), multi-object (move + delete), and marquee drag selection. The previously-image/text/stroke `Selection` singleton becomes `Selection[]`; single-selection still drives the existing handle math, while multi-selection renders as a dashed group halo with move + delete only.
- **`Cmd/Ctrl+A` now switches to the Select tool** and selects every non-deleted object (strokes + images + texts). The previous routing (`Cmd+A` → batchSelection mark for images + texts, lasso for strokes) is replaced by a single Select-tool selection.
- **Marquee drag selection.** Pointer-down on empty canvas + drag draws a rectangle; release picks every object whose bbox / sample falls inside the rect. `Shift+drag` is additive (extends the existing selection rather than replacing it).
- **`Shift+click` toggles** an object in/out of the current Select-tool selection.
- **Group move** — dragging any object in a multi-selection moves the whole group; a single `move` op covers all displaced strokes and `transform-*` ops cover displaced images / texts.
- **`Cmd/Ctrl+C` / `Cmd/Ctrl+X` copies / cuts the selection as a transparent-background PNG** for paste into Google Docs / Slack / Confluence. The single-image-selection fast path still writes the raw image bytes (preserving the original encoding).
- **Lasso tool deleted.** `apps/web/src/tools/lasso.ts` removed; the `L` key no longer activates lasso (it remains bound to the laser pointer, unchanged). The `S` key is preserved as an alias for the Select tool to keep the muscle-memory shortcut.
- **`batchSelection` module removed.** Its purpose (the Cmd+A → Delete mark for images + texts) is now absorbed by the Select tool's multi-selection state.
- **`Esc` with a Select-tool selection** clears it (in addition to its existing cancel-pending-action role).

### Added (post-absorption follow-on)

- **Whiteboard-native clipboard round-trip for strokes + texts.** `Cmd/Ctrl+C` / `Cmd/Ctrl+X` now writes a dual-slot clipboard payload: `image/png` (transparent-background render, unchanged behavior for external paste targets) plus `text/html` carrying a `data-whiteboard-v1` data attribute with the serialized strokes + texts bundle. Pasting back inside the whiteboard reconstitutes the original objects as live vectors at the cursor (relative layout preserved via a bundle-origin field); pasting into Google Docs / Slack / Confluence still lands as PNG. Selections containing images keep the PNG-only path (image bytes round-trip is a future addition). Full design at [ADR 0017](docs/decisions/0017-whiteboard-native-clipboard-format.md).
- **`transform-many` composite op kind.** Multi-object move drags now emit a single composite op carrying per-item before/after transforms (image / text rects + stroke dx/dy deltas) instead of N independent per-item ops. One undo step reverses the whole group move; the M3 sync prep is the bigger win — one transaction and one wire update per peer per gesture instead of N.

### Fixed

- **IDB schema v3 → v4 corrective bump.** A small set of users ended up with v3 databases that were missing the `texts` store (likely a manual DevTools intervention or a one-time upgrade race). The v4 bump re-fires `onupgradeneeded` so the idempotent `if (!contains)` guards re-run and the missing `texts` store gets created. Healthy v3 DBs pass through as a no-op upgrade. Strokes + images + texts are preserved on the upgrade path.
- **Pinned tool menu persists across tool select + right-click.** Previously, the pinned right-click tool menu was dismissed when the user picked a tool from it or right-clicked again to re-open. The pin now survives both actions; the same menu instance flashes briefly on a repeat-open to acknowledge the intent.
- **Pinned tool menu rebuilds content on action.** Previously, picking a brush / tool / color from a pinned menu left stale active-state highlights (the pill that *was* active before the change kept its highlight). The menu now rebuilds its DOM body on action so the active pills track the current tool / brush / color.
- **Empty-board Fit to view resets zoom.** `Cmd/Ctrl+1` (or right-click → Fit to view) on a board with zero objects now resets zoom to 100 % instead of no-op'ing.
- **Select tool drag state unified into a discriminated union.** The previous three nullable state fields (`drag` / `multiDrag` / `marquee`) collapsed into a single `activeDrag: ActiveDrag | null` discriminated union. Mutual exclusion now lives in the type system rather than as a convention every transition site had to remember to maintain — closes potential silent-op-drop holes under deletion / Shift+click races. The `commitDrag` dispatcher correctly routes single vs multi via the union kind.
- **Clipboard bundle parser hardened.** Field-level structural validation (id / samples / startedAt / brush for strokes; id / content / transform / font / color for texts) + DoS caps (5000 strokes, 5000 texts, 50000 samples per stroke) reject malformed or attack-shaped bundles. Falls through cleanly to the PNG paste path on rejection so external clipboard sources still work.

### Refactor (internal)

- **Object id generation centralized in `apps/web/src/ids.ts`.** `makeStrokeId` and `makeTextId` were duplicated in 3+ call sites with subtly different prefix conventions. Single source of truth now; clipboard paste-back, paste flow, and text creation all route through these helpers.
- **`Selection` type exported from the Select tool.** External callers — the clipboard paste path in `main.ts`, the selection-clipboard module — name the shape directly rather than re-declaring a structural copy.
- **`isMarkedForBatchDelete` renamed to `isMultiSelected` across the render pipeline.** Name reflects current reality (the predicate is consulted for ANY multi-selection halo, not just batch-delete marking, since Lasso → Select absorption). The per-frame O(N×M) predicate (M images / texts × N selections) is replaced with a single per-frame `Set<string>` build (O(N+M) construction + O(1) lookup); removes the quadratic hotspot for boards with large multi-selections.
- **Clipboard pipeline extracted into `apps/web/src/selectionclipboard.ts`.** Parallel to `imagepaste.ts` with the same Context-injected dependency pattern. The orchestrator drops ~270 LOC and the copy / cut / paste-back flow becomes testable in isolation.

### Notes

- Bundle and test-count effects pending the next versioned release; this section accumulates them as features land.

## [1.2.0] — 2026-05-13

**Text tool + Select tool generalization + presentation laser + UX polish.** First-class text objects with full edit / rotate / resize / wrap-width support. Select tool extended to operate on texts alongside images via a discriminated-union selection model. Ephemeral laser pointer for presentations. Mouse-mode synthetic pressure, double-Esc Draw↔Select toggle, idle / jiggle pen halo, image copy/cut, lasso copy-as-PNG, and a handful of input-pipeline + workflow fixes. 127 unit tests at release (up from 100 at v1.1.0). Main bundle 43 KB gz (up from 34.65 KB; well within the 150 KB SPEC budget). IDB schema bump 2 → 3 (new `texts` store; existing strokes + images preserved). Full design notes in [ADRs 0013–0015](docs/decisions/).

### Added

- **Text tool (`T`)** — first-class non-stroke object type. Click empty canvas to create + edit; click existing text in Text mode tentatively drags or releases-to-edit. Multi-line via Enter. **`Esc` commits + returns to the previous tool**. Default font: mono / 12 px / no B/I/U / ink color (all sticky-per-session). Right-click contextual menu offers Mono / Sans / Serif / sizes 12 / 14 / 18 / 24 / 36 / color palette / B/I/U toggles. **`Cmd/Ctrl + B / I / U`** toggles object-level bold / italic / underline (works both inside the editor AND when a text is selected in Select tool). Clipboard paste into the editor uses native browser behavior. Full design at [ADR 0013](docs/decisions/0013-text-contenteditable-overlay.md).
- **Text wrap-width** — drag the **E/W edge handle** on a selected text to set a fixed wrap width; content greedy-word-wraps to fit; height grows naturally with line count. Auto-width (no wrap, rect grows with content) remains the default. Both modes persist per-object and round-trip cleanly through undo. The DOM editor's `pre-wrap` CSS aligns with the canvas greedy word-wrap for WYSIWYG. Full design at [ADR 0015](docs/decisions/0015-text-wrap-width-per-object.md).
- **Select tool extension to texts** — `Selection = { kind: 'image' | 'text'; id }` discriminated union with a uniform `ObjectView` abstraction. Click any object (texts above images by z) to select. **Image and text both** support: drag-body-to-move, drag-rotation-handle-to-rotate, double-click-rotation-handle to reset 0°, Delete to soft-delete. Resize differs by kind: image = anchor-preserving rect resize (corners + edges, Shift = aspect-lock); text corner = font-size scaling, text E/W edge = wrap-width adjustment. **Double-click a text in Select mode** → hands off to Text tool's edit mode on that text. **Right-click contextual menu on a selected text** shows Color / Font / Size / B/I/U pills. Full design at [ADR 0014](docs/decisions/0014-select-tool-selection-union.md).
- **Laser tool (`L`)** — ephemeral fading polyline trail patterned after tldraw v5's laser. Each pen-down draws a disjoint stroke; trails fade over ~2.2 s after pen-up. Color selection via the curated palette (stored separately from pen color — `laserColor` setting defaults to red `#ef4444`). Nothing persists.
- **Mouse-mode synthetic pressure** — velocity-to-pressure shaping for `pointerType === 'mouse'` strokes (slow = thicker, saturated fast = thinner; V_SAT = 1.6 px/ms, P_MAX = 0.85, P_MIN = 0.3). Toggleable in the settings panel's Input section (default on). Pen / touch unaffected.
- **Double-Esc toggles Draw ↔ Select.** When the first Esc has nothing to cancel, the second within 350 ms toggles tools. If the first did cancel state, the window resets to avoid surprise tool switches mid-cleanup.
- **Image Cmd/Ctrl + C / X** — copies / cuts a Select-tool-selected image to the system clipboard. Non-PNG sources are re-encoded to PNG via canvas for cross-browser compat. Cut deletes only after the clipboard write succeeds.
- **Lasso Cmd/Ctrl + C / X** — copies / cuts lasso-selected strokes as a **transparent-background PNG** to the system clipboard. Paste anywhere — Google Docs / Slack / Confluence / back to canvas. dpr=2 for crisp embeds.
- **Auto-switch to Select after image paste** — newly pasted image is selected immediately with handles so the user can drag it into place.
- **Idle pen halo** — after 5 s of cursor inactivity, the locator ring widens (22 px) + brightens (alpha 0.9) + gains a soft shadow glow. Movement demotes back to the faint gated ring.
- **Jiggle-to-show HiViz halo** — back-and-forth pointer motion (path-length / displacement ratio > 3 over a 300 ms sliding window) briefly promotes the halo for 600 ms. Gated on `!active` so active scribbling never bloom-promotes.
- **Export filename gains seconds** — `whiteboard-YYYY-MM-DD-HHMMSS.{png,svg,pdf}`. Back-to-back exports within the same minute don't collide.

### Changed (schema + persistence — v1.1 compatible)

- **IDB schema bumped to `DB_VERSION = 3`** with a new `texts` object store (text records carry payload inline; no companion blob store). v1.0.x / v1.1 records upgrade in place — the `onupgradeneeded` handler creates only the missing store.
- **Op-pipeline extended** with five new text op kinds: `create-text`, `delete-text`, `transform-text`, `edit-text`, `rotate-text`. `OpContext` gains `texts` + `saveText`. `edit-text` carries `{ content, font, color, wrapWidth }` in both `before` and `after` payloads so undo restores wrap-width alongside font changes.
- **TextObject schema** in `@whiteboard/shared` adds `wrapWidth?: number` (optional; undefined = auto-width). Persisted records without the field load as auto-width — no migration needed.
- **Settings**: six new sticky text defaults (`textFont`, `textSize`, `textBold`, `textItalic`, `textUnderline`, `textColor`), plus `mouseSyntheticPressure` and `laserColor`. All migrated with defaults so older IDB state upgrades cleanly.
- **`StrokeStore` + `ImageStore` + `TextStore` are now three parallel interface seams.** TextStore mirrors the StrokeStore / ImageStore shape (load / insert / update / hardDelete / clear + onRemoteChange no-op). Image binaries remain deferred to M5.1 sync per [ADR 0012](docs/decisions/0012-sharing-deferred.md).
- **`ToolContext.getLastPointer()`** — new method exposing the most-recent pointer client coords. Consumed by the pen tool's `redraw` to prime hover when activated via tool switch.
- **Export pipeline** accepts texts in PNG / SVG / PDF. `computeBoardBounds` includes rotation-aware text AABBs. `exportPNG` renders texts above images and below the strokes composite; gains a `transparentBg` option used by the lasso clipboard path. `exportSVG` emits `<text>` with one `<tspan>` per measured (wrapped) line.

### Fixed (review hardening — Tier-A across 4-lane parallel reviews)

A 4-lane parallel review across the v1.2 batch surfaced six MUST-FIX bugs.

- **Tool-switch dropped the text edit op.** The Text tool's `cleanup()` persisted content but never pushed `create-text` / `edit-text`. Switch from Text → Pen mid-edit and undo couldn't reverse anything. Fix: `cleanup()` routes through `commitEdit()` so the op lands in undo before the editor tears down.
- **`wrapWidth` lost on undo.** E/W edge-handle drags mutated `t.wrapWidth` but the `edit-text` op carried only `{ content, font, color }`. Fix: `wrapWidth` added to the payload + restored in `setTextEdit`.
- **Typing in text mode exited after 1-2 letters.** The global keymap binds many unmodified single letters (b/p/s/v/l/t/f/c/o + 1-5) to tool / brush actions. Without `stopPropagation` on the editor's `keydown`, typing those letters hijacked the keystroke and switched tools. Fix: editor's `keydown` stops propagation on EVERY event.
- **Cmd+B/I/U on a Select-tool-selected text did nothing.** Only the editor's own handler was wired. Fix: main.ts's `toggleTextFormat` dispatcher checks Text tool's edit state first, then falls through to Select tool's text selection.
- **Double-click misfire after empty-space click.** Click text → click empty → click same text quickly tripped the editor handoff. Fix: reset the double-click window in the empty-space deselect branch.
- **Cmd+A while editing destroyed the edit.** Edge case where focus drifted off the editor momentarily. Fix: `selectAll` short-circuits when `textTool.isEditing()`.

### Fixed (other Tier-A)

- **Pen pointer not shown after Esc-Esc Select → Pen.** Pen tool's `lastHover` was null after `cleanup()`. Fix: `getLastPointer()` lets `pen.redraw` prime the hover.
- **Pen-lift trail on Wacom Intuos.** Some driver versions don't reliably fire `pointerup` — instead they send `pointermove(buttons === 0)` trailing samples. The router treats `buttons === 0` on a captured pointer as an implicit `pointerup`.
- **Right-click menus stacked (browser + app)** for clicks on overlay elements outside `root`. Fix: `document`-level guard preventDefaults unless target is a form input.
- **Right-click in text edit showed browser menu.** Fix: dedicated `contextmenu` listener on the editor element.
- **Laser trail connected disjoint strokes** and showed dot-beads under shadowBlur glow. Fix: per-sample `continueFromPrev` + `butt` lineCap.

### Changed (review hygiene — Tier-B)

- `clearImageBatchSelection` renamed to `clearObjectBatchSelection` (covers images + texts).
- `TEXT_PADDING_X` imported in `select.ts` (was hard-coded `2 * 6`).
- `beforeTextSnapshot` is an assertion, not a silent null-guard.
- `storage.ts` documents the IDB migration constraint (create-only vs index/field mutations).
- main.ts file-header JSDoc updated for T-key migration.
- SVG export's `dominant-baseline` moved to `<tspan>` (where it actually controls the y-coord interpretation).
- Editor `keydown` `stopPropagation` insulates the editor from the global keymap.

### Notes

- **Storage upgrade path.** v1.0.x users have only `strokes`; v1.1 users have `strokes` + `images` + `images-blob`. Opening v1.2 triggers a single `onupgradeneeded` that creates the missing `texts` store; existing data untouched. Upgrade is one-way.
- **Bundle size.** Main chunk grew from 34.65 KB gz (v1.1.0) to 43 KB gz (+8.35 KB) — text + Select extension + laser + clipboard re-encode. Lazy chunks (jsPDF, html2canvas, DOMPurify) unchanged.
- **Sharing-deferred posture preserved.** All new objects ride the same `StrokeStore`-pattern store seam ([ADR 0012](docs/decisions/0012-sharing-deferred.md)).

## [1.1.0] — 2026-05-12

**Image paste and manipulation.** Pasted (or drag-dropped) raster images become first-class floating objects on the canvas, manipulable through a dedicated **Select tool** (`V`) — move, resize (corner + edge handles, Shift for aspect-lock), rotate (handle above top edge, double-click to reset to 0°), delete. PNG / SVG / PDF export include images in z-order with rotation preserved. Image bytes live in IndexedDB alongside strokes; v1.0.x users upgrade in place via a DB version bump (existing strokes preserved). Undo / redo cover paste / move / resize / rotate / delete. 100 unit tests at release (up from 92). Main bundle 34.65 KB gz (up from 28.70 KB gz; well within the 150 KB gz SPEC budget). Full design archive at [`docs/superpowers/specs/2026-05-12-image-paste-design.md`](docs/superpowers/specs/2026-05-12-image-paste-design.md).

### Added

- **Image paste — three input paths converging on one `paste-image` op:**
  - `Ctrl/Cmd + V` paste via the document `paste` event (skips text-editable contexts like the settings panel inputs).
  - Async clipboard API fallback for browsers and DEs where the synchronous event doesn't surface image data (Safari, some screenshot tools, several Linux desktops).
  - Drag-drop a filesystem image onto the canvas — `dragover` / `drop` listeners with the `preventDefault` dance required for `drop` to actually fire.
  - Accepted MIME types: PNG, JPEG, WebP, GIF. 25 MB blob cap; oversize attempts surface a toast and abort.
  - Pasted image lands at natural pixel size with top-left at the cursor.
- **Select tool (`V`).** Dedicated tool for floating-object manipulation (image — strokes still go through Lasso). Reachable from the bottom-right tool pill, right-click tool menu, or keyboard. Pointer-down on an image (reverse-z first-hit) selects it; pointer-down on empty space deselects. Hover cursor flips between `move`, the appropriate directional resize cursor per handle, and a custom rotate cursor (circular arrow with white halo for visibility on both themes).
- **Move / resize / rotate.**
  - Move: drag the body of a selected image. Drag emits one `transform-image` op at pointer-up so the whole drag is one undo step.
  - Resize: drag any of the 8 handles (4 corners, 4 edge midpoints). Corner handles preserve the natural aspect ratio when **Shift** is held. Edge handles are 1-axis (Shift is ignored). Anchor stays pixel-fixed at the opposite corner / edge midpoint across the whole drag, including under rotation (resize-while-rotated has no drift).
  - Rotate: 9th handle ~24 screen-px above the top-center edge with a connecting line. Drag rotates around the image center. **Double-click the rotate handle** (within 350 ms) snaps back to 0° as a single undoable op. Resize handles' cursors rotate with the image, bucketed to the nearest 45° so they match the visible handle direction at every rotation.
- **`Cmd/Ctrl + A` includes images.** Existing select-all (switches to lasso, selects all strokes) now also marks all images with a dashed 2 px outline (visually distinct from the Select tool's solid handles so the two modes don't read as the same thing). The next Delete / Backspace soft-deletes all marked images alongside the lasso's stroke deletion. Marks clear on Esc, tool change, pointer-down on the canvas, or after a successful delete.
- **Export filename now includes seconds** — `whiteboard-YYYY-MM-DD-HHMMSS.{png,svg,pdf}`. Back-to-back exports within the same minute no longer overwrite each other (or trigger the browser's `(1)` disambiguator). Fixed-width zero-padded fields keep file-manager lexical sort matching chronological order.
- **Export-success toast.** PNG / SVG / PDF all surface a `Exported PNG/SVG/PDF` toast on download trigger so the empty-board / blank-area case is no longer silent.

### Changed (schema + persistence — v1.0.x compatible)

- **IDB schema bumped to `DB_VERSION = 2`** with two new object stores: `images` (cheap-to-scan metadata, keyed on `id`) and `images-blob` (raw `Blob`, keyed on `blobRef`). The metadata / binary split keeps the per-frame metadata scan light while bytes are paged independently. Existing `strokes` store is untouched — v1.0.x users upgrade in place; the `onupgradeneeded` handler only creates the missing stores. `saveImage` writes both stores in one transaction so a crash mid-paste can't leave half-state.
- **Op-based undo extended** with four new op kinds: `paste-image`, `delete-image`, `transform-image` (move + resize), `rotate-image`. Mirrors the existing stroke ops (`create` / `delete` / `move` / `eraseStamps`). `OpContext` gains `images` and `saveImageMeta`. Undo / redo of any image action runs at the same op-pipeline depth as a stroke action.
- **Export pipeline accepts images.** `computeBoardBounds(strokes, images)` includes image AABBs (rotation-aware) in the export bounding box. `exportPNG` decodes images via the runtime cache or `ImageStore.loadBlob` and draws them in z-order before compositing strokes on top. `exportSVG` accepts a pre-built data-URI map (kept pure-string-out; the dispatcher prepares URIs via `FileReader.readAsDataURL` before calling) and emits `<image href="data:…">` elements in z-order, with `transform="rotate(deg cx cy)"` for rotated entries. `exportPDF` passes through to PNG and inherits image support with no jspdf API change.
- **Image render pass extracted to `apps/web/src/renderimages.ts`.** Single `renderImages({ images, layer, camera, viewBBox, isMarkedForBatchDelete })` entry point owns the per-image draw loop (viewport cull via rotation-aware AABB, rotation transform, batch-delete dashed outline). `main.ts` now describes the render pipeline at one level of abstraction (clear → grid → renderImages → composite strokes).
- **`StrokeStore`-equivalent seam for images.** `ImageStore` interface in `apps/web/src/imagestore.ts` (load / insert / updateMeta / hardDelete / clear + `onRemoteChange` no-op for v1) preserves the future-sharing option per [ADR 0012](docs/decisions/0012-sharing-deferred.md) — image binaries are deferred to M5.1 when sharing returns. Local concrete impl wraps `storage.ts`.
- **New helper modules.** `imagegeom.ts` (single source of truth for rotation math: `imageCenter`, `rotateAroundPoint`, `rectCorners`, `imageAABB`, `pointInImage`; uses an explicit `ROTATION_EPSILON = 1e-9` for float-drift-safe fast-paths). `imagepaste.ts` (the paste pipeline). `imagecache.ts` (HTMLImageElement cache with Blob URL lifecycle management — `URL.revokeObjectURL` fires the moment decode completes, with a cancellation flag so an evict-during-decode doesn't leave stale entries behind).

### Fixed (review hardening — tier-A, [ea5c8d6](https://github.com/vppillai/whiteboard/commit/ea5c8d6))

A 4-lane parallel code review surfaced eight correctness bugs in the in-progress image work; each one is a real behavior bug, not a code-smell complaint.

- **Blob URL leak** (`imagecache.ts`). `URL.createObjectURL` was never revoked after `onload`, leaking one object URL per paste for the page lifetime. Now revoked the moment decode completes (the bitmap is owned by the `HTMLImageElement` at that point). Eviction also handles in-flight loads via a cancellation flag.
- **Clear board didn't reset images** (`main.ts` onPerformClear). Strokes were cleared but `images` / `imagesMarkedForBatchDelete` / the IDB image store / the runtime cache all survived. After a clear there was no UI path to remove pasted images (undo stack wiped). Clear is now genuinely destructive across both object types.
- **`escapeAttr` didn't escape `&`** (`svg.ts`). Image data-URI hrefs can contain `&` in charset / parameter positions; the prior color-string-only escape left them raw, producing malformed SVGs in edge cases. `&` is now escaped first so subsequent replacements don't double-encode.
- **Pointer-cancel could leave drag state stuck** (`tools/select.ts`). Defense-in-depth: `onPointerDown` now commits any lingering drag before starting a new one, in case a prior pointerup / cancel was dropped by the browser (window blur, OS gesture steal, missed event).
- **Resize-while-rotated drifted progressively** (`tools/select.ts`). The old math projected the pointer into local space using the rect's center captured at drag-start but mutated the rect's center each tick. Pivot vs target diverged; error compounded. New math captures the anchor (opposite corner / edge midpoint) in **board** space at drag-start, projects `(pointer - anchor)` onto the image's rotated x/y axes via dot products to derive local dimensions, and re-derives center from `anchor + signed half-diagonal`. Anchor stays pixel-fixed at any rotation.
- **Triple-click rotation reset emitted spurious ops** (`tools/select.ts`). `lastRotateHandleDownAt` was initialized to `0`; the first click within 350 ms of page-load tripped the double-click branch via `performance.now() - 0 < 350`. Now initialized to `Number.NEGATIVE_INFINITY`; the timestamp is also always recorded (not zeroed on double-click) so a subsequent quick click doesn't trip again.
- **`deleteSelected` didn't guard against already-deleted** (`tools/select.ts`). If a `Cmd+A` batch loop ran first and soft-deleted an image, then `selectTool.deleteSelected` fired again on the same image, two `delete-image` ops were pushed. Now guards and returns false if the image is already deleted.
- **SVG `scope: 'visible'` included off-screen images** (`export/svg.ts`). The image loop emitted `<image>` elements unconditionally regardless of bounds intersection. Now uses the rotation-aware AABB to cull before emitting.

### Changed (review hygiene — tier-B, [fbb97fb](https://github.com/vppillai/whiteboard/commit/fbb97fb))

Tech-debt cleanup atop the tier-A bug fixes. All changes either tighten an invariant or harden a fast path; no user-visible behavior change.

- **`deleteImage(id, blobRef)`** — `blobRef` now explicit so a future schema where the binary identifier differs from the record id (content-addressed dedupe, server URL) can't silently leak blob rows. v1 has `blobRef === id` but the abstraction is cheap to preserve.
- **`partitionImagesForCompaction`** returns `{id, blobRef}` tuples for the same reason; `loadAllImages()` now returns `{images, compactedBlobRefs}` so callers can evict matching runtime cache entries when persistence compacts soft-deleted records.
- **`saveImageMeta` gains an `onabort` handler** matching `saveImage` — silent transaction aborts no longer disappear.
- **`Math.abs(r) < 1e-9`** everywhere instead of `r === 0`. Guards the fast unrotated path against float drift (rotate-to-zero overshoot, `-0`, accumulated 1e-15 error from repeated transforms).
- **Single `persistImageMeta` closure** in `main.ts` replaces two identical inline closures (`opCtx` + `selectTool` deps). One source of truth for "how persistence errors surface" — future toast / retry policy edits touch one site.
- **`pointerleave` on canvas root** drops the active hover cursor (resize / rotate) when the pointer exits, so a "ready to rotate" affordance doesn't linger while the user is over the gear menu or off-canvas.
- **PNG export uses `Promise.allSettled`** instead of `Promise.all` so one bad image decode doesn't abort the whole export. Bad decodes log a warning and are silently dropped — matches the SVG path's "missing data URI = skip" semantics.
- **Dead-code removal.** `SelectTool.getSelectedImageId()` removed (no callers; live-delete flows through `deleteSelected()` instead).

### Notes

- **Storage upgrade path.** Users on v1.0.x have only the `strokes` object store in their `whiteboard-local` IDB database. Opening v1.1.0 triggers an `onupgradeneeded` to version 2, which creates the missing `images` and `images-blob` stores. Existing stroke data is untouched. The upgrade is one-way (no `v2 → v1` downgrade); users who roll back will see their pasted images preserved in IDB but unused.
- **Bundle size.** Main chunk grew from 28.70 KB gz (v1.0.0) to 34.65 KB gz (+5.95 KB gz) — well within the 150 KB gz SPEC budget. Growth attributable to the new modules (`imagepaste`, `imagecache`, `imagegeom`, `imagestore`, `renderimages`, `tools/select`, the rotation-aware AABB / hit-test helpers, and the four new op kinds).
- **Sharing-deferred posture preserved.** Image binaries are explicitly tagged for M5.1 (deferred to when sharing returns; see [ADR 0012](docs/decisions/0012-sharing-deferred.md) and the `TODO(M5.1)` in `imagestore.ts`). The `ImageStore` interface is the seam.

## [1.0.0] — 2026-05-11

**First production release** — single-user offline-first whiteboard for indirect-input pen tablets. Sub-33 ms pen-to-photon latency on Wacom Intuos. Five brush presets with per-brush pressure curves. Pixel-mask + object erasers. Lasso select / move / delete. Op-based undo / redo. PNG / SVG / PDF export. IndexedDB local persistence. Settings side panel with custom swatches and curve editor. Distraction-free mode. Comprehensive keyboard shortcuts. Live collaboration is deferred to post-v1 per [ADR 0012](docs/decisions/0012-sharing-deferred.md); the full design is archived at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md). Deploys via Docker (`./deploy.sh`) or GitHub Pages (auto-deployed by [`.github/workflows/pages.yml`](.github/workflows/pages.yml)). 92 unit tests, 0 lint issues, 0 typecheck errors at release. Main bundle 28.70 KB gz (well under the 150 KB gz SPEC budget).

### Changed (sharing deferred — 2026-05-10)

- **Live collaboration / sharing layer deferred from v1** per [ADR 0012](docs/decisions/0012-sharing-deferred.md). The original M3 milestone (Bun WebSocket relay, Y.Doc-backed shared rooms, Y.Awareness presence, SQLite snapshot persistence, owner-token-gated admin endpoints, share-gated UX, in-flight crash recovery) was fully brainstormed and designed on 2026-05-10 — all 16 prep-doc open decisions plus a 17th (undo-manager scope) were closed and captured. Hours later, the project owner reassessed the scope against the SPEC § 0 tenets ("snappy, sleek, user-friendly are paramount") and chose to defer the entire feature. Sharing is the heaviest feature on the v1 roadmap; deferring it dramatically shrinks v1's surface (no server-side state, no runtime service, no WebSocket, no ~75 KB sync chunk, no operator complexity around `OWNER_TOKEN` / `DATA_DIR` / backup volumes). The full design is preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md) with a `DEFERRED` status header — it is the starting point for a future implementation when sharing returns, not a fresh brainstorm.
- **v1 path becomes M2.1 → M4 (deployment polish) → M4.5 (PWA install + offline) → tag `v1.0.0`.** v1 ships as "a fast offline whiteboard with installable PWA," sized for the single-user, single-device Wacom Intuos case the project was built for.
- **`StrokeStore` interface seam (M2.1) kept in place.** The abstraction costs nothing (one interface, one concrete implementation) and preserves the future-sharing option. Forward-looking comments in `strokestore.ts`, `storage.ts`, `main.ts`, `tools/eraser.ts`, and `packages/shared/src/types.ts` were reworded from "M3 will..." to "future sync work will..." / "deferred per ADR 0012" — no behavior change.
- **CRDT-friendly schema decisions stay**: `Stroke.startedAt` wall-clock, `Stroke.id` ULID, op-pipeline-routed mutations, `erasedStamps` append-only. These are good designs on their own merits and preserve the option to wrap strokes as `Y.Map` later without a schema break.
- **`apps/server/src/index.ts`** no longer reads `OWNER_TOKEN`. The server boots stateless at v1.
- **`.env.example`** drops `OWNER_TOKEN`, `DATA_DIR`, `MAX_ROOMS`, `MAX_BOARD_BLOB_MB`. Only `PORT`, `PUBLIC_ORIGIN`, `BASE_PATH`, `LOG_LEVEL` remain. The deferred vars return when sharing returns.
- **`deploy.sh`** drops the `OWNER_TOKEN` validation gate. The `.env` file is still required but now only sourced for `docker compose` substitution.
- **`docs/deployment.md`** rewritten for the stateless v1 shape: no SQLite volume, no backup/restore procedure, simpler env vars table, smaller resource sizing, lighter troubleshooting.
- **`SPEC.md`** updated: § 1 Goals revised (sharing line replaced with offline-first + deferred-sharing note), § 2 Architecture diagram simplified (no Y.Doc / WebSocket / SQLite), § 5 Collaboration converted to a "deferred — see ADR 0012" stub, § 6 Persistence rewritten (client IDB only, no server), § 8 Deployment `.env.example` simplified, § 9 Milestones table reflects the new v1 path, § 10 Backlog gains the detailed sharing entry pointing to the design archive.
- **`docs/architecture.md`** updated: § 1 diagram simplified, § 2.1 `sync/` row marked deferred, § 2.2 server responsibilities reduced to M0 entries, § 2.3 shared types stripped of WebSocket envelope mention, § 2.4 server persistence subsection rewritten as "deferred", § 3 protocol table trimmed (REST: `/`, `/assets/*`, `/health` only; WS removed), § 4 stroke model footnote updated, § 5 deployment topology reflects stateless container, § 6 as-built rows marked 🟡 Deferred for live collaboration / room URLs / server SQLite / crash recovery; `StrokeStore` seam + IDB compaction added as ✅ Complete (M2.1).
- **`docs/milestones.md`** M3 row marked 🟡 Deferred with link to ADR 0012 + archive; M3 milestone-definition block replaced with a deferral stub; M4 scope updated for stateless shape (no SQLite backup, simplified env, WebSocket-through-proxy moved to forward-compat note).
- **ADR 0003** (Y.js for collaboration) status updated to "Accepted — implementation deferred from v1 per ADR 0012." The technology choice itself stands when sharing returns.
- **`docs/decisions/README.md`** ADR index brought up to date (entries 0008–0012 added; 0008 marked superseded by 0009).
- **`README.md`** updated: tagline changed from "Live collaboration via shareable room links" to "Offline-first"; Status section updated to reflect M2.1-shipped state and v1 path; "Today" feature list updated through M2.1; "Coming up" split into pre-v1 (M4 / M4.5) and post-v1 (sharing / AI); Y.js acknowledgment removed; layout description updated; deploy quick-start no longer mentions `OWNER_TOKEN`; **new "Deploy to GitHub Pages" quick-start section** added (the stateless v1 fits cleanly on any static host).

### Added (release readiness — 2026-05-10)

- **GitHub Pages deploy workflow** (`.github/workflows/pages.yml`). Builds the web bundle with `BASE_PATH=/whiteboard/`, writes `.nojekyll`, publishes via `actions/deploy-pages@v4`. Triggers on push to `main` or manual dispatch. Enables zero-server deployment for the v1 stateless shape; documented in `docs/deployment.md` § "GitHub Pages (zero-server deploy)".
- **CI now runs the test suite** (`.github/workflows/ci.yml`). The check job previously ran lint + typecheck + build only. Added `bun test` step between typecheck and build — the 92-test suite now blocks merges on regression. The docker smoke-test step also dropped its `OWNER_TOKEN` env injection (no longer needed at v1).

### Fixed (release readiness — 2026-05-10)

- **SPEC.md opening sentence** no longer claims live collaboration (was the first thing a new reader saw — directly contradicted the deferral narrative below it).
- **SPEC § 3.4 `Stroke` type** updated to match the actual M2.1 schema (`brush: BrushConfig`, `startedAt`, `erasedStamps`) — was stale since M1.7 / M2.1 schema changes and showed pre-CRDT-hardening fields (`brushId` / `color` / `size` / `authorId` / `createdAt`).
- **SPEC § 3.4 storage line** "Stored in Y.js as `Y.Array<Y.Map>`" replaced with the accurate "Stored locally in IndexedDB as one row per stroke" + CRDT-compatibility note pointing to ADR 0012.
- **`docs/architecture.md` § 4** inline comment for `startedAt` corrected: was `performance.now()`, actually `Date.now()` (M2.1 cross-peer-sort hardening).
- **`docs/architecture.md` § 2.2** "Responsibilities 3–5..." reworded to list the active 1–2 explicitly without dangling reference to nonexistent prior numbering.
- **`docs/development.md` Testing section** rewritten — was claiming "tests not yet present, `bun run test` is a no-op" while 92 tests pass. Now describes the actual Bun-test setup, file co-location pattern, and CI hook.
- **`docs/development.md` project layout** server description corrected from "(Bun, WebSocket, SQLite)" to "(Bun, static file serving; stateless at v1)".
- **`apps/server/src/index.ts`** `/health` endpoint reports `stage: 'M2.1'` (was stuck at `'M0'` since the M0 stub).
- **ADR 0012 § Status** citation corrected: "SPEC § 0 Goal" → "SPEC § 1 Goals" (Goals live in § 1; § 0 is the Tenets section).
- **CHANGELOG M2.1 entries** reworded to remove "M3 will add..." forward references that contradicted the deferral entry's claim that all such language was cleaned up; now phrased as "future sync work would..." with links to ADR 0012, consistent with the code comments.

### Added (M2.1 — pre-M3 hardening)

- **`StrokeStore` interface seam** (`apps/web/src/strokestore.ts`). `main.ts`
  now talks to a `StrokeStore` (load / save / delete / clear + an
  `onRemoteChange` stub) instead of calling `storage.ts` directly. A future
  sync implementation (deferred per [ADR 0012](docs/decisions/0012-sharing-deferred.md))
  would add a Y.Doc-backed store with the same surface — sync would become
  a single-line factory swap at startup rather than a refactor of
  `main.ts`.
- **IDB compaction on load.** Strokes loaded with `deleted === true` have
  no undo path (undo stack is empty on startup) — hard-delete them in a
  background fire-and-forget after load. `partitionForCompaction` is the
  pure helper, unit-testable without an IDB polyfill.

### Changed (M2.1)

- **Identity scrub.** Copyright updated to `Vysakh Pillai (embeddedinn.ca)`;
  local git author identity going-forward is `Vysakh Pillai
  <vysakhpillai@gmail.com>`. Past commits retain the GitHub noreply email
  (no history rewrite).
- **`Stroke.startedAt` is now `Date.now()`** (wall-clock ms) instead of
  `performance.now()` (tab-relative). Required for cross-peer chronological
  z-order if/when sharing returns ([ADR 0012](docs/decisions/0012-sharing-deferred.md))
  — performance.now's tab-origin epoch would have interleaved two peers'
  strokes non-chronologically when sorted into the render order.
- **`Sample.t` is now elapsed ms from pointerdown** (`t = 0` at first
  sample). Epoch-independent; survives page reloads and is comparable
  across peers. Pre-#11 it was an absolute `performance.now()` value that
  carried stale navigation-epoch timestamps across reloads.
- **Object-eraser no longer mutates `stroke.deleted` directly.** The
  deletion path is now exclusive to the op pipeline (`applyOp →
  flipDeleted`), which keeps it CRDT-compatible for the deferred future
  sharing layer ([ADR 0012](docs/decisions/0012-sharing-deferred.md))
  where strokes would wrap as `Y.Map` (direct field assignment doesn't
  propagate through Y.js).
  Collapsed the unused multi-id `objectDeleted: Set<string>` machinery
  to a single `objectDeletedId: string | null` — object mode only ever
  deletes one stroke per tap.
- **Right-click EXPORT row** removed (now part of M2's polish, but
  reinforced in M2.1's StrokeStore commit). The `Export…` pill opens the
  popover so scope choice is consistent with Cmd/Ctrl+E.
- **SVG export uses quadratic curves** (`Q cur midX midY`) matching the
  canvas hull `quadraticCurveTo`. WYSIWYG fidelity restored — short
  strokes no longer exported with sharp corners.
- **Canvas `getStrokePath` passes `simulatePressure: false`** so the canvas
  and exports use the same perfect-freehand options. Pressure is already
  gamma/curve-applied at sample time; PF's velocity simulation would
  re-author the curve and diverge from the file.
- **Curve editor SVG reference + grid lines** now use `var(--border, …)`
  instead of hardcoded light-theme grays — visible in dark mode.
- **Brush thumbnail re-render gated** to inputs that actually affect its
  output (`pressureGamma`, `pressureCurve.mid`). Unrelated settings
  changes (color, grid, swatch) no longer trigger N × SVG rebuild.
- **Grid theme tokens cached** at module scope (`grid.ts`). `getComputedStyle`
  was forcing a style recalc every 60 Hz frame during pan/zoom. Tokens
  are invalidated by the existing `themechange` listener.
- **`fonts` field removed from `SettingsV1`.** Was reserved for the
  descoped Text tool. Will be re-introduced on a V1 → V2 schema bump
  when Text actually lands.
- **`applyGamma` dead code** removed from `pen.ts`.

### Fixed (M2.1)

- **Help-key handler `preventDefault`s** so the browser's own
  `Shift+/` shortcuts (Firefox quick-find, etc.) don't fire alongside
  the in-app help toggle.

### Added (M2 — export, polish, settings addenda)

- **Export PNG / SVG / PDF.** Right-click → EXPORT row (sibling to TOOL / VIEW / SETTINGS) with PNG / SVG / PDF pills, and `Cmd/Ctrl+E` opens a popover at cursor with the same three pills. Both paths converge on `exportBoard(format, { getStrokes })`. Filename: `whiteboard-YYYY-MM-DD-HHMM.{ext}`. Defaults: all non-deleted strokes, fit to bounding box + 32 px margin, PNG at 1× DPR. PDF embeds a rasterized PNG (SVG-vector PDF deferred per spec § 9 — `jspdf` SVG support is uneven). SVG export uses `<mask>` with subtractive `<circle>` per `erasedStamp` so partial-erased strokes export with their holes intact. Highlighter strokes (opacity < 0.6 + thinning === 0) export with `mix-blend-mode: multiply`. `jspdf` (~70 KB gz) is dynamically imported on first PDF export so non-PDF users never load it. Empty board: `exportBoard` no-ops with a console warn (a toast is a future polish).
- **Pressure curve UI** in the settings panel. Each Brush preset card grows a 30 × 18 px clickable thumbnail next to the title. Click expands the card with a 200 × 120 px SVG graph editor (draggable midpoint handle, dashed reference diagonal, light grid lines at 0.25/0.5/0.75) + a 120 × 80 px test-stroke pad. Drag the midpoint or click anywhere on the graph to create / adjust the override. "Reset *<Brush>* curve" link clears it. Schema: `presets[brushId].pressureCurve?: { mid: [number, number] }` — quadratic bezier with the mid as a **through-point** (not a control point — the curve passes through `(mid_x, mid_y)` at `t = 0.5`). Sparse override of `pressureGamma` — absent = γ scalar applies. The bezier inversion is closed-form (quadratic formula) so `applyPressure` stays under 1 µs per sample on the hot stroke-render path.
- **Predicted-events toggle.** Settings panel Advanced section gains a board-level toggle "Predicted events" with help text explaining indirect-input (Wacom Intuos) vs direct-input (iPad / Surface / MobileStudio) trade-offs. Schema: `predictedEvents: boolean` at top-level `SettingsV1`, default `false` (ADR 0004). URL `?predict=1` continues to win as session override. `pointer.ts` / `pen.ts` read the setting on every `pointermove` (not captured at boot) so the toggle takes effect immediately without a reload.
- **First-run discovery hint.** Empty-board overlay: *"Right-click for tools · ? for help"* centered ~25% from viewport bottom, theme-aware muted color. Fades over 200 ms on first stroke commit; localStorage `whiteboard:hint-shown=true` set at fade-start. Never shown again on this device. Module exports a `FirstRunStorage` interface for unit-testability without DOM.
- **`Shift+[` / `Shift+]` palette cycle.** Cycles the 10 curated colors in grid order with wrap-around. Bound globally (works regardless of active tool — pre-selects color for next stroke). Skips custom + recent picks. DRY win: `CURATED_COLORS` is now a single exported constant in `colorpicker.ts` (was duplicated in `pen.ts` as `PALETTE`).
- **`F` distraction-free mode.** Hides app chrome (Help pill, Tool pill, popovers, settings panel) via a single `body.distraction-free` CSS class. Does *not* invoke the browser Fullscreen API — F11 already covers that universally. On entry: dismisses any open popover, auto-closes settings panel, shows a 2-second toast *"Press Esc or F to exit."* `Esc` or `F` again exits.
### Changed (M2)

- **Color eyedropper descoped** at feel-test (originally SPEC § 4.1 v1 deliverable; built and removed during M2 close pass). The right-click context menu's COLOR section and the `C` color picker already cover the "set my brush to color X" use case without adding a tool. Implementation removed cleanly: `tools/eyedropper.ts` + tests deleted, `ToolId` union narrowed, `I` key + Pick pill + toolpill label removed, `Tool.onActivate` interface addition (which existed only for the eyedropper's revert-to-caller behavior) removed. SPEC § 4.1 + § 4.3 updated.
- **Toolbar UI dropped** from v1 scope per [ADR 0011](docs/decisions/0011-toolbar-deferred.md). The right-click context menu (M1.5 → M1), keyboard shortcuts, color picker popover, settings side panel (M1.7), and toolpill (M1) cover the discovery and one-click surfaces a toolbar would have served. SPEC § 4.2 retired; § 1 Goals updated; § 10 open decisions sweep done.
- **`render.ts` extracts `drawStrokeOntoLayer`** — pure refactor, no on-screen behavior change. The per-stroke outline + destination-out work is now a shared helper between `frame()` and the PNG export pipeline; avoids a "two renderers slowly drifting" problem for the erasure-stamp handling.
- **`stroke.ts` adds `applyPressure(input, brush)`** that dispatches to `bezierY(x, mid)` when the brush has a `pressureCurve` override; otherwise falls through to `input ** pressureGamma`. Existing perfect-freehand integration's `applyGamma` call site in `pen.ts` swaps to `applyPressure`. Behavior identical until M2's curve UI is used.
- **`Esc` in lasso mode falls back to pen tool** (small UX gap discovered mid-milestone). The lasso's existing `cleanup` hook clears any in-progress polygon and selection state, so the switch is a clean reset rather than a partial cancel.
- **Settings schema** gains `predictedEvents: boolean` (top-level) and `pressureCurve?: { mid: [number, number] }` (per-brush via `Partial<Omit<BrushConfig, 'color'>>`). No `schemaVersion` bump — `migrate()`'s mechanical-fill (ADR 0010) handles missing fields on load. `validateOnePreset` deep-validates the new field type. `PresetField` union + `isValidPresetField` allowlist extended. Old `whiteboard:settings` blobs migrate cleanly.

### Fixed (M2)

- **`migrate()` deep-validates `predictedEvents`** (boolean check; falls back to `false` if a tampered localStorage carries a non-boolean — same defensive pattern as M1.7.1's `validatePresets`).
- **`clearPresetCurve` actually deletes the field** (was setting `cur.pressureCurve = undefined`, which leaves the key in `Object.keys(cur)` and prevented the GC of an empty preset entry). Bracket-notation `delete cur['pressureCurve']` works around biome's `noDelete` literal-key flag.
- **Bounded `undoStack` at 500 entries** with FIFO eviction of the oldest. Caps memory growth in long-lived browser tabs. Trade: lose ability to undo beyond 500 historical actions; gain bounded memory.
- **Listener cleanup discipline** (Option C side-pass on `main` during M2). `metrics.bindHudToggle`, `pan.attachPan`, `render.setupCanvas` (via `RenderTarget.cleanup`), `keymap.attachKeymap`, `eraserhold.attachEraserHold`, and `settings.onChange` all return teardown functions. `main.ts` collects them in a `cleanups` array and runs them on `window.beforeunload` AND `import.meta.hot.dispose` (defensive — vite currently force-reloads on save because no module calls `import.meta.hot.accept()`, but the discipline keeps the codebase safe if anyone adds `accept()` later).
- **Removed duplicate `getCoalescedEvents()` call** in the `root` `pointermove` listener (Option C side-pass). The pen / eraser / lasso tools already call it in their own `onPointerMove` handlers; the listener's call was a redundant array allocation per pointermove — measurable GC pressure during sustained 200 Hz Wacom drawing. Trade: HUD's samples/event metric now reads 1 always; events/sec is unaffected.

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
