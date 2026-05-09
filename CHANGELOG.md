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

### Fixed

- Committed strokes now finalize with `last: true` in `perfect-freehand`, producing a clean polished cap. Previously strokes (including persisted ones) re-rendered with `last: false`, leaving a slightly serrated leading edge that read as "blocky" under inspection.
- Live stroke rendering moved out of the RAF queue and into the pointer handlers themselves. With `desynchronized: true` on the canvas context, this trims roughly half a frame of perceived latency on the wet ink.
- Default brush retuned for a more felt-marker-like feel: `size 3 → 3.5`, `thinning 0.6 → 0.45`, `smoothing 0.5 → 0.7`, `streamline 0.5 → 0.4`, `pressureGamma 2.0 → 1.7`. Streamline was deliberately *reduced* — higher streamline trades latency for smoothing.
