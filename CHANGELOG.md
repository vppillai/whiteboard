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
- **Clear-board shortcut**: `⌘/Ctrl + Shift + K` → `⌘/Ctrl + Shift + C` (mnemonic: **C** for **C**lear). Now requires a **two-step confirmation**: first press primes a 3-second toast; second press within that window actually clears. `Esc` cancels. Removes the foot-gun where a single accidental keypress wiped the board. *Note: on Linux / Windows Chrome, this combo also opens DevTools' element inspector — if that becomes a problem we'll revisit, but Mac users (the primary target) have the combo free unless DevTools is already open.*
- Plan refreshed against M0 learnings: `M4` trimmed (multi-stage Dockerfile, static serving, healthcheck, `deploy.sh` already shipped at M0); `process.md` adds an explicit *feel-test on target hardware* gate per milestone close, plus a `?perftest=scale` performance-at-stroke-count gate from M1 onward; `SPEC § 10` reorganized into "decided", "still open", and "backlog" (screen-tablet support, mobile / touch UX, accessibility now tracked there).
- New ADR [0004](docs/decisions/0004-input-pipeline-tuning.md) captures the input-pipeline decisions that drove M0 feel.

### Fixed

- Committed strokes now finalize with `last: true` in `perfect-freehand`, producing a clean polished cap. Previously strokes (including persisted ones) re-rendered with `last: false`, leaving a slightly serrated leading edge that read as "blocky" under inspection.
- Live stroke rendering moved out of the RAF queue and into the pointer handlers themselves. With `desynchronized: true` on the canvas context, this trims roughly half a frame of perceived latency on the wet ink.
- Default brush retuned for a more felt-marker-like feel: `size 3 → 3.5`, `thinning 0.6 → 0.45`, `smoothing 0.5 → 0.7`, `streamline 0.5 → 0.4`, `pressureGamma 2.0 → 1.7`. Streamline was deliberately *reduced* — higher streamline trades latency for smoothing.
- Predicted events disabled by default. On indirect-input devices (Wacom Intuos non-screen), the predicted lookahead leads the cursor and visibly flickers when the pen changes direction. Re-enable with `?predict=1` to A/B-test on hardware where the trade-off is favorable (e.g. screen tablets).
- Brush gained an `opacity` field; the default pen now renders at 0.94 alpha so overlapping strokes layer subtly, which reads as "real ink" rather than digital fill.

### Added

- **Cross-device panning**: spacebar-held drag pans on any pointer device (pen, mouse, trackpad). Middle-mouse-button drag also pans (for Wacom users who map a pen barrel-button to middle-click via the tablet driver). Cursor switches to grab/grabbing accordingly via the `[data-input]` CSS hook. Wheel and trackpad two-finger pan still work, unchanged.
- **Undo / redo** for stroke creation. `Cmd/Ctrl+Z` undoes; `Cmd/Ctrl+Shift+Z` (or `Cmd/Ctrl+Y` for Windows muscle-memory) redoes. Redo history clears whenever a new stroke is committed and is not persisted across reloads — matches every other drawing tool. Undone strokes are removed from the IndexedDB store; redoing re-persists them.
- Help overlay (`?`) refreshed with the new pan and undo options.
- GPU compositor hints on canvas elements (`transform: translateZ(0)`, `will-change: transform`) so the present-to-screen path doesn't repaint neighbouring DOM. The 2D canvas was already GPU-composited; this just makes each layer its own compositor surface.
