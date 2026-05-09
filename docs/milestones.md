# Milestones

The work is broken into discrete milestones. Each milestone has a defined scope, exit criteria, and a documentation-update checklist that must be satisfied before the milestone is closed.

> **Status legend** — ⬜ not started · 🟦 in progress · ✅ complete

## Current state

| M  | Title                                                                    | Status |
|----|--------------------------------------------------------------------------|--------|
| —  | Repo + dev / deploy environment                                          | ✅     |
| M0 | Drawing core: latency, pan/zoom, theme, local persistence                | 🟦 *(code complete, Intuos latency validation pending)* |
| M1 | Brushes + eraser + lasso + undo/redo                                     | ⬜     |
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

### M1 — Brushes + eraser + lasso + undo/redo ⬜

**Scope (revised).** Adds the remaining brush presets, eraser, lasso select, undo/redo. Pan/zoom and persistence already shipped at M0+.

**Exit criteria.**

- All five brushes render correctly with their tabled parameters.
- Stroke-hit eraser deletes (soft) within hit radius.
- Lasso selects strokes; selected strokes can be deleted, moved.
- Undo / redo across stroke create, delete, move.
- 1000-stroke board pans / zooms at 60 fps on the M0 reference machine.
- Architecture doc updated; CHANGELOG entry; per-tool docs as needed.

### M2 — Toolbar UI, keyboard shortcuts, export ⬜

**Scope (revised).** Floating toolbar, palette, brush presets, settings UI (pressure curve, hide-toolbar mode), PNG / SVG / PDF export. Local persistence already shipped at M0+; if needed, refine here.

**Exit criteria.**

- Toolbar dockable to any edge, draggable.
- All keyboard shortcuts in [SPEC § 4.3](../SPEC.md#43-keyboard-shortcuts) work.
- Pressure curve UI saves per-brush; survives reload.
- Export PNG / SVG / PDF produces visually correct output (manual visual diff acceptable for v1).
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

### M4 — Production deployment polish ⬜

**Scope.** Static-file serving from the server, sub-path support, healthcheck, structured logging, deploy.sh polish.

**Exit criteria.**

- `./deploy.sh` produces a working production stack on a clean host given only Docker.
- `BASE_PATH=/whiteboard` works behind a reverse proxy (verified with the provided Caddy / Nginx examples).
- Healthcheck passes; container marked healthy by `docker compose ps`.
- Resource usage matches `deployment.md` § "Resource sizing" expectations.
- `docs/deployment.md` cross-validated against the actual deploy.

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
