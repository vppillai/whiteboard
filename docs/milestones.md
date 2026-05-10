# Milestones

The work is broken into discrete milestones. Each milestone has a defined scope, exit criteria, and a documentation-update checklist that must be satisfied before the milestone is closed.

> **Status legend** — ⬜ not started · 🟦 in progress · ✅ complete

## Current state

| M  | Title                                                                    | Status |
|----|--------------------------------------------------------------------------|--------|
| —  | Repo + dev / deploy environment                                          | ✅     |
| M0 | Drawing core: latency, pan/zoom, theme, local persistence, undo/redo     | ✅ *(closed 2026-05-09; tagged `m0-drawing-core`)* |
| M1.4 | Refactor pass: tool abstraction, op-based undo, soft-delete, decompose main.ts | ✅ *(closed 2026-05-09; tagged `m1.4-refactor`)* |
| M1 | Tool surface refactor + eraser (pixel-mask wipe + object) + brush presets + lasso | ✅ *(closed 2026-05-09; tagged `m1-eraser-lasso`)* |
| M1.7 | Settings side panel + sync-ready schema (brush presets, fonts, swatches) | ✅ *(closed 2026-05-09; tagged `m1.7-settings-panel`)* |
| M2 | Toolbar UI, keyboard shortcuts, export                                   | ⬜     |
| M3 | Server, sync, room URLs                                                  | ⬜     |
| M4 | Production deployment polish                                             | ⬜     |
| M4.5 | PWA install + offline (manifest, service worker)                       | ⬜     |
| **v1 ship** |                                                                 | **—**  |
| M5 | AI: shape recognition                                                    | ⬜     |
| M6 | AI: handwriting → text                                                   | ⬜     |
| M7 | AI: math / LaTeX                                                         | ⬜     |

---

## Milestone definitions

### Pre-M0 — Repo + dev / deploy environment ✅

- Bun workspace layout (`apps/web`, `apps/server`, `packages/shared`).
- Multi-stage `Dockerfile` (deps → web-build → runtime).
- `docker-compose.yml` (production) and `docker-compose.dev.yml` (dev).
- `deploy.sh` with `.env` validation.
- Lint and format via Biome.
- Pre-commit hook (`scripts/pre-commit`).
- GitHub Actions CI (lint + typecheck).
- Documentation framework (this directory).
- ADRs 0001–0003.
- MIT license, README, CONTRIBUTING, CHANGELOG.

### M0 — Drawing core 🟦

> **Scope expanded** from the original "latency-only skeleton". User feedback during build pulled forward the things that make the tool genuinely usable from day one: theme support, infinite-canvas pan/zoom, and local persistence. Pan/zoom moved here from M1; persistence moved here from M2. The latency-validation gate is unchanged.

**Build (in code).**

- `<canvas>` (committed + live layers) with `pointerdown` / `pointermove` / `pointerup` handlers.
- `getCoalescedEvents()` consuming all Wacom samples between frames.
- `getPredictedEvents()` for visual lookahead on the live layer.
- `perfect-freehand` for stroke geometry; γ=2 pressure curve preset.
- Camera (pan + zoom). Wheel pans; Cmd/Ctrl+wheel or pinch zooms around the cursor.
- Theme: light / dark / system. Brush color stored as `'ink'` token, re-resolved on theme change.
- Local persistence via IndexedDB; auto-save on commit; hydrate on load.
- Subtle dot grid; sleek minimal HUD; help overlay; theme pill.
- `?perftest=1` synthetic stroke harness reporting JS-side input-to-render latency.
- Server now serves the built SPA with SPA fallback + cache-immutable hashed assets.

**Exit criteria.**

- [x] Code complete, lint + typecheck clean, web build < 25 KB raw / < 9 KB gz.
- [x] Production Docker stack builds and serves the SPA end-to-end.
- [x] `docs/architecture.md` § 6 updated.
- [x] `CHANGELOG.md` entry under `[Unreleased]`.
- [x] **Pen-down → first ink visible: ≤ 16 ms (1 frame).** Validated on Wacom Intuos with `?perftest=1` and a real-pen test at M0 close; confirmed across M1.4 / M1.5 / M1 feel-tests.
- [x] **Pen-to-photon during drag with prediction: ≤ 33 ms.** Validated on Intuos at M0 close (predicted events disabled by default — see ADR 0004 for the indirect-input rationale; re-enable with `?predict=1` to A/B).
- [x] **No dropped Wacom samples at 200 Hz on a 60 Hz display.** Confirmed at M0 close via the metrics HUD (`samples / event` averaged well above 1 during fast strokes).
- [x] ADR added if the latency work surfaces an architectural choice. Covered by [ADR 0004](decisions/0004-input-pipeline-tuning.md) (predicted-events default-off, sync render in pointer handler) — written during M0 close.

### M1.5 — Popover primitive · color picker · options · grid config — absorbed into M0 / M1

> **Status: absorbed; no separate tag.** Each M1.5 deliverable shipped — the popover primitive, color picker, options menu, configurable grid renderer, and the `settings` module — but landed piecemeal across the M0 and M1 work as need surfaced rather than as a single coherent milestone. The sub-milestone boundary stopped being meaningful, so the tag concept is dropped in favor of the M0 / M1 history. The CHANGELOG groups the deliverables under "Milestone M1.5 — popover foundation" because that captures the design intent. The original definition below is preserved as design history. Mirrors the M1.6-rolled-into-M1 decision (see M1 section).

**Why this existed** (originally out of order: scoped to ship *before* M1). The user feel-test of M0 surfaced three asks at once — quick color picking, configurable grid / ruled paper, and a discoverable settings surface. All three wanted the same UI primitive: a **popover anchored at the pointer, dismissible, optionally pinnable**. Building that primitive once and reusing it three ways was much cleaner than the three ad-hoc popovers we'd otherwise have grown into. Doing it before M1 meant the eraser / lasso / brush-switcher tooling at M1 plugged into the existing popover system rather than getting retrofitted later.

**Scope.**

- **Popover primitive** (`apps/web/src/popover.ts`). Anchored at a client point, viewport-clamped, pin / close in the header, Esc + click-outside dismiss, single-instance arbitration (opening another closes the previous unless pinned).
- **Color picker popover** (`apps/web/src/colorpicker.ts`). Compact 5×2 swatch grid: the theme `ink` token plus nine curated accent colors (red, orange, yellow, green, cyan, blue, purple, pink, gray). Inline row of "recent colors" (max 6) below. Click selects → applies to the active brush → dismisses (unless pinned). `C` opens it at the current pointer position.
- **Options popover** (`apps/web/src/optionsmenu.ts`). Hosts grid type (dots / lines / ruled / none) and spacing (16 / 24 / 32 / 48 px). `O` opens it at the current pointer position. Same primitive, same pin behavior, room to grow as more settings show up at M2.
- **Configurable grid renderer** (`apps/web/src/grid.ts`). Extends from the M0 dot grid to support all four types and configurable spacing; reads from a settings module.
- **Settings module** (`apps/web/src/settings.ts`). Holds current brush color, recent colors, and grid config. Persists to localStorage. Emits a change event so the renderer redraws.

**Exit criteria.**

- All four grid types render correctly at all four spacings; switching is immediate and persistent across reloads.
- Color picker opens at the pointer; selecting a color applies to the next stroke; pinning keeps the popover after selection; recent-colors row updates correctly and persists across reloads.
- Theme cycle (`T`) still works — `ink` strokes update with theme; literal-color strokes don't.
- Bundle stays under 30 KB raw / 12 KB gz (popover + picker + options should add ~3–4 KB gz).
- **Feel-test gate**: pen interaction with the popovers feels right (hit targets are pen-friendly; popovers don't get in the way of drawing; pinning behavior matches expectation).
- `docs/architecture.md` § 6 updated; CHANGELOG entry; per-module notes as needed.
- Tagged commit `m1.5-popover-foundation`.

### M1.4 — Refactor pass before M1 ⬜

**Why this exists** (out of order: ships *between* M1.5 and M1). After several M0 / M1.5 iterations the codebase accumulated debt that would compound at M1: `main.ts` is 641 LOC and growing, the pointer pipeline hardcodes "draw" as the only tool, undo handles only stroke-creation, and the spec's `Stroke.deleted` soft-delete flag is dormant. Each of those is a hack-magnet for M1's eraser / lasso work. A focused day of cleanup before adding features keeps the M1 PR honest.

**No new behavior.** This is a structural change. Lint, typecheck, build, and a feel-test on the target hardware should all show identical observable behavior to M1.5.

**Scope.**

- **Decompose `main.ts`.** Extract `pan.ts`, `clearflow.ts`, `helpoverlay.ts`, `pill.ts`, `keymap.ts`. `main.ts` becomes a thin orchestrator (~250 LOC).
- **Tool abstraction** (`tools/`). Define `Tool` interface (`onPointerDown` / `onPointerMove` / `onPointerUp` / optional cleanup); implement `PenTool` as the only initial tool. Pointer pipeline routes events to the active tool. ADR 0005 captures the choice.
- **Operation-based undo** (`ops.ts`). Replace the per-stroke redo stack with a uniform `Op` type (`create` / `delete` / `move` / `clearAll`), each with `apply` / `unapply`. Existing undo behavior reproduces; future tools (eraser, lasso-move, lasso-delete) plug in without growing the undo logic. ADR 0006.
- **Soft-delete strokes**. Honor `Stroke.deleted` from the spec: render loop filters deleted strokes; undo of stroke creation flips the flag rather than removing from IDB. Sets up M3's CRDT-friendly persistence.

**Exit criteria.**

- Lint, typecheck, web build, Docker smoke all clean.
- `bun run --filter @whiteboard/web build` bundle within ±1 KB gz of M1.5.
- Feel-test on the target hardware: the user notices no change in drawing, panning, theme, persistence, undo/redo, or any other interaction. Anything subtly different is a regression.
- ADRs 0005 and 0006 written; architecture as-built table updated; CHANGELOG entry.
- Tagged commit `m1.4-refactor`.

### M1 — Tool surface + eraser + brush presets + lasso ✅

> **Closed 2026-05-09.** Tagged `m1-eraser-lasso`. Perf gates verified on dev hardware:
> `?perftest=scale&n=500` mean 3.65 ms / p95 5.7 ms / max 7 ms (44% of 16 ms budget);
> `?perftest=erase&n=500` mean 3.98 ms / p95 4.4 ms / max 5.1 ms (32% of budget).
> Both well under the WebGL trigger.


**Originally a sub-milestone called M1.6.** The tool abstraction from M1.4 (ADR 0005) was deliberately thin; with pen and eraser shipped, the pattern's gaps were visible (~85 LOC of cursor rendering in `main.ts`, ~60 LOC of contextual menu logic in `toolmenu.ts`). M1.6 was scoped as "code-complete; feel-test pending" but as M1's surface kept shifting (pixel-mask eraser, hold-E spring-loading, P key, clear-flow focus), the M1.6 boundary stopped being meaningful — it's all M1. The tag concept is dropped; the work is part of M1's history. The ADR 0007 extension survives as the live tool interface.

The original M1.6 deliverables — now part of M1:
- `Tool` interface extended with `renderContextualMenu(host, dismiss)` and `redraw(ctx)`. ADR 0007.
- `ToolContext` carries `liveLayer`, `camera`, `dpr`, `resolveColor`, `markCommittedDirty`.
- Pen + eraser cursor rendering moved into the tool modules.
- COLOR / BRUSH / ERASER menu sections moved into tools.
- New `menu-ui.ts` for shared DOM helpers.
- `toolmenu.ts` is a dispatcher; per-tool sections own themselves.

**M1 scope (revised twice).** The remaining four brush presets (marker, pencil, highlighter, brush), the **pixel-mask wipe + object** eraser, and lasso-select. Pan/zoom, undo/redo for stroke create, and persistence all shipped at M0. Lasso-driven move/delete extends undo/redo to those operations.

The toolbar UI is **explicitly held back to M2** so this milestone stays tight. Brushes are switched in M1 via the existing keyboard shortcuts (`1`–`5`); the visual brush picker is M2.

**Eraser model.** Two modes:
- **Wipe (pixel-mask)** — "cuts through" — implemented per [ADR 0009](decisions/0009-pixel-mask-eraser.md). Each pointer event during a sweep records a cursor disk `{ x, y, r }` on every overlapping stroke's `erasedStamps` list; renderer applies `globalCompositeOperation = 'destination-out'` for every stamp on a dedicated offscreen strokes canvas, composited onto committed after the grid. Cursor circle = erased pixels, exactly. Single `eraseStamps` op per gesture for clean undo. (ADR 0008's per-sample mask was implemented mid-milestone and superseded — see ADR 0008 *Status* note.)
- **Object (whole-stroke)** — Item pill or Shift-modifier; soft-deletes the topmost stroke under the cursor; emits a `delete` op.

**Exit criteria.**

- All five brushes render correctly with their tabled parameters.
- Wipe eraser visually matches the cursor 1:1 — pixels under the cursor disk disappear, nothing past the cursor disappears (verified by feel-test on Wacom Intuos).
- One `eraseStamps` op per wipe gesture; single Cmd+Z restores the whole sweep. Object-mode emits a `delete` op as before.
- Lasso selects strokes; selected strokes can be deleted and moved.
- Undo / redo extends to delete, move, and eraseStamps (not just create).
- **Perf-at-scale gate**: `?perftest=erase&n=500` keeps wipe rendering under the 16 ms frame budget (ADR 0009). `?perftest=scale&n=500` keeps pan / zoom under the same budget. Both harnesses report actual render-frame durations via `perfRecording` instrumentation in `frame()`. Misses trigger an ADR.
- **Feel-test gate** on the target hardware (Wacom Intuos): user signs off that the new tools feel right — including the eraser feeling like a physical eraser.
- Architecture doc § 6 updated; CHANGELOG entry; per-tool notes as needed.

### M1.7 — Settings side panel + sync-ready schema ✅

> **Closed 2026-05-09.** Tagged `m1.7-settings-panel`. Perf gates verified
> on dev hardware:
> `?perftest=erase&n=500` mean 4.92 ms / p95 6.8 ms / max 16.1 ms (one-frame
> outlier; 30% of 16 ms budget at p95).
> `?perftest=scale&n=500` mean 3.83 ms / p95 6.9 ms / max 15.6 ms (43% of
> budget at p95).
> Slight regression on max-frame from M1's baseline (5.1 ms erase / 7 ms
> scale) traces to the per-stroke destination-out fix that the M1.7 feel-
> test surfaced — accepted as a correct-over-fast trade-off (the M1
> renderer was incorrectly subtracting one stroke's eraser stamps from
> later strokes' pixels; see commit `946e52b`).
> Wacom Intuos feel-test signed off: drawing, eraser, draw-over-erase,
> custom swatch add via picker + panel, brush slider live-update,
> reset-to-defaults priming-toast flow, panel toggle via gear / right-
> click menu / `Cmd/Ctrl+,`, theme isolation across reset, panel-closed-
> on-reload, v0→v1 settings migration. ADR 0010 accepted.

**Why this existed.** User wanted a discoverable settings surface — a side panel with controls for brush presets (sizes, opacities), text fonts (for the Text tool when it lands), and custom user-defined color swatches beyond the curated palette. Longer-term, those settings will sync to a backend after user login lands. Designing the data model now (versioned, ID-keyed, serializable) avoids a breaking migration when sync arrives.

**Scope.**

- **Side panel UI.** Slide-in from one edge (right is the typical default), pen-friendly hit targets, dismissible. Lives alongside the existing popover system but is a longer-lived surface — opened deliberately via keyboard or the tool menu, closed deliberately. Sections: **Brush presets**, **Custom swatches**, **Fonts** (placeholder for Text tool), **Grid** (move from the popover here?), **Theme**, **Advanced**, plus a footer **Reset to defaults** action that wipes the persisted settings (with two-step confirm — same priming-toast pattern as clear-board) and reloads `DEFAULTS`. User profile / project state is not affected; only the user-tunable preferences.
- **`settings.ts` schema redesign**:
  - Versioned root (`{ schemaVersion: 1, ... }`).
  - Brush presets as a keyed map: `{ presets: Record<string, BrushPreset>, activePresetId: string }`.
  - Custom swatches as `string[]` (user-added hex colors that show in the color picker alongside the curated palette).
  - Fonts (for the Text tool) as `string[]`.
  - Reserved fields for future sync: `syncedAt?: number`, `remoteId?: string`.
  - Migration path from the current schema (color + grid).
- **No backend.** No user login, no remote sync, no auth. Local-only storage. The schema fields are *placeholders* the future sync layer will fill in.
- **ADR 0010** — settings data model design (sync-readiness, migration strategy). (Next available number; 0001–0009 are taken.)

**Exit criteria.**

- Side panel toggleable (some key — `S` is taken by lasso, so a different one or a chord; final binding decided during M1.7).
- Brush size adjustable from the panel; immediately reflects in the active brush.
- Custom swatch addable (small "+" tile in the color picker that opens a hex input or color sampler); shows alongside the curated palette and persists.
- Theme selector and grid options accessible from the panel (in addition to existing popovers — gives people who prefer panels a single place to find everything).
- **Reset to defaults** action present in the panel footer; two-step confirm; wipes `whiteboard:settings` (and any session-scoped state like `eraserMode`) and reloads `DEFAULTS`. Verified to leave the strokes / IDB store untouched.
- Schema version field present; loading old `whiteboard:settings` localStorage data migrates cleanly.
- ADR written for settings schema (next available number); architecture as-built and SPEC § 10 updated; CHANGELOG entry.
- Tagged commit `m1.7-settings-panel`.

**Future sync (post-M1.7, post-v1):** when a backend lands, the settings store gets a "synced" boolean per record and conflict resolution (last-write-wins or per-field merge). That work is *not* in M1.7's scope — just the schema design that won't need to break.

### M2 — Toolbar UI, settings, export ⬜

**Scope (revised).** Floating toolbar, palette, brush picker, settings panel (pressure curve, theme override, predicted-events toggle for screen-tablet users), PNG / SVG / PDF export. Local persistence already shipped at M0; image import decision happens at the start of this milestone.

The settings panel is the natural home for the screen-tablet prediction toggle (see SPEC § 10 backlog) and for any per-device pressure presets.

**Exit criteria.**

- Toolbar dockable to any edge, draggable. Decision on UI framework (vanilla vs Solid) made and noted (ADR if non-obvious).
- All M2-tagged keyboard shortcuts in [SPEC § 4.3](../SPEC.md#43-keyboard-shortcuts) work.
- Pressure curve UI saves per-brush; survives reload.
- Export PNG / SVG / PDF produces visually correct output (manual visual diff acceptable for v1).
- **Cursor preview**: a small circle at the cursor showing the brush's effective size + color before any stroke. Disappears during contact.
- **First-run hint**: empty board shows a single subtle line ("Right-click for tools · ? for help") that fades on first stroke. Not shown on subsequent visits.
- **Color eyedropper** (per [SPEC § 4.1](../SPEC.md#41-tool-set-v1)): a tool-menu entry / shortcut that samples color from existing strokes and sets the brush color.
- **Feel-test gate** on the target hardware: toolbar interaction doesn't disrupt drawing; settings persist sensibly.
- `docs/architecture.md` updated; CHANGELOG entry.

### M3 — Server, sync, room URLs ⬜

**Scope.** Bun server with y-websocket relay, room creation, owner-token auth, SQLite snapshot persistence, peer presence, IndexedDB ↔ server reconciliation.

**Exit criteria.**

- Two browsers in the same `/b/<id>` see each other's strokes and cursors.
- Disconnect / reconnect: late peer hydrates from SQLite, then merges live updates.
- `OWNER_TOKEN` gates rename / delete / export-all.
- Snapshots written every 30 s idle and on last-disconnect.
- 16 concurrent peers in one room, no dropped updates over 5 minutes of mixed editing.
- **In-flight stroke crash recovery**: client auto-saves the in-flight stroke every ~2 s during long strokes, so a tab crash mid-stroke loses at most a couple of seconds of pen movement.
- `docs/architecture.md` § 6 updated; deployment doc cross-checked; CHANGELOG entry; ADR if the protocol or auth design materially changed from spec.

### M4 — v1 deployment polish ⬜

**Scope (revised — much shipped early).** Most of the original M4 scope landed at M0 (multi-stage Dockerfile, static-file serving with SPA fallback, immutable-asset caching, healthcheck, `deploy.sh` with `.env` validation). M4 is now the v1-ship gate: validate end-to-end on a clean host, exercise the reverse-proxy paths against real proxies, and write release notes.

**Exit criteria.**

- `./deploy.sh` produces a working production stack on a clean host given only Docker (validated by re-pulling on a fresh VM).
- `BASE_PATH=/whiteboard` works behind a real reverse proxy (Caddy and Nginx, both tested against the provided snippets).
- WebSocket upgrade works through the proxy (relevant once M3 ships sync).
- Backup / restore procedure in `docs/deployment.md` exercised end-to-end at least once.
- v1.0.0 release notes drafted from the `[Unreleased]` section of `CHANGELOG.md`.
- Tag `v1.0.0`.

### M4.5 — PWA install + offline ⬜

**Scope.** Make a deployed instance installable as a Progressive Web App so users can run it from their dock / home screen with a native-app feel. Strong tenet fit ("sleek").

- `manifest.json` with name, theme colors honoring `prefers-color-scheme`, `display: standalone`, scope, start URL.
- App icons (square + maskable, 192 / 512 px).
- Service worker caching the SPA shell (HTML, CSS, JS, fonts) with stale-while-revalidate for updates.
- Install affordance: a single subtle option in the help overlay or a one-time pill nudge after N strokes ("Install as app"). No browser-default install banners on first load.
- Theme color and splash adapt to system theme so the install feels native in light / dark.
- Service worker is no-op in dev (Vite dev server) and only registers in production build.

**Exit criteria.**

- App is installable via the browser's address-bar install icon (Chrome / Edge desktop, Safari iOS).
- After install, app launches in standalone mode (no URL chrome) with correct theme color.
- Offline: app loads, draws, persists strokes locally with no network. Reload after going offline still works.
- Lighthouse PWA score ≥ 90.
- ADR if any non-obvious choice surfaces (e.g. the install-prompt policy).
- `docs/deployment.md` updated; CHANGELOG entry; tag `m4.5-pwa`.

### v1 ship 🎯

After M4.5: tag `v1.0.0`, write release notes, publish.

### M5 — AI: shape recognition ⬜

In-browser stroke-feature classifier. ONNX via `transformers.js` + WebGPU.

**Exit criteria.** Lasso → press `R` → suggests rectangle / circle / arrow / line / polygon when applicable; accept / reject UI; model loads lazily; rejection rate on synthetic test set ≤ 10%.

### M6 — AI: handwriting → text ⬜

In-browser HTR over a lasso region.

**Exit criteria.** Recognition over English handwriting at acceptable WER (target: ≤ 15% on a clean test sample); editable text node output; model loads lazily; works offline.

### M7 — AI: math / LaTeX ⬜

In-browser handwritten-equation → LaTeX, rendered with KaTeX.

**Exit criteria.** Common equations (algebra, calculus, simple matrices) recognized and rendered; model loads lazily and only when invoked.

---

## Per-milestone review checklist

Before closing a milestone, the reviewer (which may be the same person who built it) confirms:

- [ ] All exit criteria met.
- [ ] Code passes `bun run lint` and `bun run typecheck` cleanly.
- [ ] `docs/architecture.md` § 6 ("As-built") reflects what was built.
- [ ] Other docs (`development.md`, `deployment.md`) updated if the milestone changed how to develop or deploy.
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`.
- [ ] An ADR exists for any non-obvious architectural choice made during the milestone.
- [ ] `docs/milestones.md` (this file) status updated.
- [ ] Tagged commit created.

See [process.md](process.md) for the rationale and a longer description of the review process.
