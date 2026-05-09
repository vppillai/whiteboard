# Milestones

The work is broken into discrete milestones. Each milestone has a defined scope, exit criteria, and a documentation-update checklist that must be satisfied before the milestone is closed.

> **Status legend** — ⬜ not started · 🟦 in progress · ✅ complete

## Current state

| M  | Title                                                                    | Status |
|----|--------------------------------------------------------------------------|--------|
| —  | Repo + dev / deploy environment                                          | ✅     |
| M0 | Drawing core: latency, pan/zoom, theme, local persistence, undo/redo     | ✅ *(closed 2026-05-09; tagged `m0-drawing-core`)* |
| M1.5 | Popover primitive · color picker · options menu · configurable grid    | ⬜     |
| M1 | Eraser, lasso, additional brush presets                                  | ⬜     |
| M2 | Toolbar UI, keyboard shortcuts, export                                   | ⬜     |
| M3 | Server, sync, room URLs                                                  | ⬜     |
| M4 | Production deployment polish                                             | ⬜     |
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
- [ ] **Pen-down → first ink visible: ≤ 16 ms (1 frame).** Validate on Wacom Intuos with `?perftest=1` and a real-pen test.
- [ ] **Pen-to-photon during drag with prediction: ≤ 33 ms.** Validate on Intuos.
- [ ] **No dropped Wacom samples at 200 Hz on a 60 Hz display.** HUD `samples / event` should average > 1 during fast strokes.
- [ ] ADR added if the latency work surfaces an architectural choice.

### M1.5 — Popover primitive · color picker · options · grid config ⬜

**Why this exists** (out of order: it ships *before* M1). The user feel-test of M0 surfaced three asks at once — quick color picking, configurable grid / ruled paper, and a discoverable settings surface. All three want the same UI primitive: a **popover anchored at the pointer, dismissible, optionally pinnable**. Building that primitive once and reusing it three ways is much cleaner than the three ad-hoc popovers we'd otherwise grow into. Doing it before M1 means the eraser / lasso / brush-switcher tooling at M1 plugs into the existing popover system rather than getting retrofitted later.

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

### M1 — Eraser + lasso + brush presets ⬜

**Scope (revised after M0 close).** The remaining four brush presets (marker, pencil, highlighter, brush), the stroke-hit eraser, and lasso-select. Pan/zoom, undo/redo for stroke create, and persistence all shipped at M0. Lasso-driven move/delete extends undo/redo to those operations.

The toolbar UI is **explicitly held back to M2** so this milestone stays tight (~2–3 days). Brushes are switched in M1 via the existing keyboard shortcuts (`1`–`5`); the visual brush picker is M2.

**Exit criteria.**

- All five brushes render correctly with their tabled parameters.
- Stroke-hit eraser soft-deletes within hit radius (deleted flag on the Stroke; renderer skips deleted; redo restores).
- Lasso selects strokes; selected strokes can be deleted and moved.
- Undo / redo extends to delete and move (not just create).
- **Perf-at-scale gate**: `?perftest=scale&n=500` keeps pan / zoom under the 16 ms frame budget. If we miss, that's the WebGL trigger and an ADR.
- **Feel-test gate** on the target hardware (Wacom Intuos): user signs off that the new tools feel right.
- Architecture doc § 6 updated; CHANGELOG entry; per-tool notes as needed.

### M2 — Toolbar UI, settings, export ⬜

**Scope (revised).** Floating toolbar, palette, brush picker, settings panel (pressure curve, theme override, predicted-events toggle for screen-tablet users), PNG / SVG / PDF export. Local persistence already shipped at M0; image import decision happens at the start of this milestone.

The settings panel is the natural home for the screen-tablet prediction toggle (see SPEC § 10 backlog) and for any per-device pressure presets.

**Exit criteria.**

- Toolbar dockable to any edge, draggable. Decision on UI framework (vanilla vs Solid) made and noted (ADR if non-obvious).
- All M2-tagged keyboard shortcuts in [SPEC § 4.3](../SPEC.md#43-keyboard-shortcuts) work.
- Pressure curve UI saves per-brush; survives reload.
- Export PNG / SVG / PDF produces visually correct output (manual visual diff acceptable for v1).
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

### v1 ship 🎯

After M4: tag `v1.0.0`, write release notes, publish.

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
