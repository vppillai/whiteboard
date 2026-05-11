# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each milestone (M0..M7 — see [docs/milestones.md](docs/milestones.md)) closes with a `[Unreleased]` → version-tagged entry here.

## [Unreleased]

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
