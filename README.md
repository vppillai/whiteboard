# Whiteboard

[![CI](https://github.com/vppillai/whiteboard/actions/workflows/ci.yml/badge.svg)](https://github.com/vppillai/whiteboard/actions/workflows/ci.yml)
[![Pages deploy](https://github.com/vppillai/whiteboard/actions/workflows/pages.yml/badge.svg)](https://github.com/vppillai/whiteboard/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A low-latency, browser-based whiteboard tuned for Wacom Intuos and other indirect-input pen tablets. Offline-first, single-command Docker or GitHub Pages deploy.

**Live demo:** [https://vppillai.github.io/whiteboard/](https://vppillai.github.io/whiteboard/)

## Features

- **Five brush presets** — pen, marker, pencil, highlighter, brush — each with an independently customizable pressure curve.
- **Two eraser modes** — pixel-mask wipe ("cuts through" strokes, leaves disconnected runs alive) and object delete (whole object: stroke, text, image, or shape).
- **Select tool (`V` or `S`) — universal selection.** Click any object (image, text, shape, or stroke) to manipulate it with handles (images and shapes get resize handles + rotation; texts get 4 corners + E/W wrap-width edges + rotation; strokes are move-only via body-drag). Marquee-drag on empty canvas to multi-select, `Shift+click` to toggle individual objects, `Cmd/Ctrl+A` to select everything across all kinds. Drag any selected object to move the whole group; `Delete` to remove all. Double-click the rotation handle to reset to 0°; double-click a text body to edit.
- **Universal clipboard** — `Cmd/Ctrl+C` / `Cmd/Ctrl+X` writes both a transparent-background PNG and a structured stroke + text + shape bundle to the clipboard. Pasting back inside the whiteboard restores those objects as live vectors with relative layout preserved; pasting into Google Docs / Slack / Confluence lands as PNG. A single-image selection writes the original image bytes for full-fidelity round-trip.
- **Image paste** — `Ctrl/Cmd+V` or drag-drop a PNG / JPEG / WebP / GIF onto the canvas; lands as a floating object below the strokes layer so pen-on-image is the natural workflow. Auto-switches to the Select tool with handles shown so the user can drag into place.
- **Text** (`T`) — multi-line text objects with mono / 12 px defaults. Bold / italic / underline via `Cmd/Ctrl+B/I/U`. Right-click menu for font / size / color. `Ctrl/Cmd+V` on the canvas with clipboard text creates a new TextObject at the cursor. Texts copied from the whiteboard paste back natively as text objects (with their font / size / color / wrap-width preserved). Drag the E/W edge handle on a selected text in `V` mode to set a wrap width and reflow content.
- **Shape tool** — rectangle (`R`), ellipse (`O`), arrow (`A`), line (`L`). Drag to create; `Shift` constrains (square / circle / 45° lines). Sticky color, stroke width, and fill toggle (filled shapes get a translucent tint behind the outline). Resize handles + rotation work in `V` mode the same as for images and texts.
- **Laser** (`P`) — fading polyline trail for presentations; color via the curated palette. Nothing persists.
- **Exports** — PNG, SVG, PDF; all include images, texts, and shapes in z-order with rotation preserved. SVG exports emit native `<rect>` / `<ellipse>` / `<line>` for shapes so the output stays editable in other vector tools.
- **Pressure-curve editor** — per-brush bezier graph with a live test pad. Mouse-mode synthetic pressure (velocity-shaped) ships on by default for mouse strokes.
- **Infinite canvas** — wheel-pan, `Cmd/Ctrl+wheel` zoom, `Cmd/Ctrl+0` reset, `Cmd/Ctrl+1` zoom-to-fit.
- **Themes** — light / dark / system; the `ink` color token tracks the theme.
- **Color picker** (`Shift+C`) — curated palette, custom swatches, recent colors.
- **Configurable grid** — dots / lines / ruled / none, multiple spacings.
- **Distraction-free mode** (`F`) — hides app chrome for clean drawing.
- **Settings panel** (`Cmd/Ctrl+,`) — brush tuning, swatches, theme, grid, advanced.
- **Op-based undo / redo** — cheap, bounded at 500 entries, listener-cleanup wired through HMR + `beforeunload`.
- **Local persistence** — IndexedDB; pick up where you left off after reload; no account required.
- **Comprehensive keyboard shortcuts** — `?` opens the in-app overlay. `Esc Esc` toggles Draw ↔ Select; `Shift+T` cycles theme (unmodified `T` is the Text tool).
- **Sub-33 ms pen-to-photon latency** on Wacom Intuos — instrumented and measured (`?perftest=1`).

## Why this exists

Browser whiteboards built on tldraw or excalidraw are capable, but they feel imprecise on a screenless Wacom Intuos. The likely reasons:

- They don't use `PointerEvent.getCoalescedEvents()`, so ~75% of the tablet's 200 Hz sample rate is dropped at a 60 Hz display.
- They don't use `getPredictedEvents()` for visual lookahead.
- SVG-based stroke rendering can't sub-frame-update.
- Default pressure curves aren't tuned for the Intuos pressure profile.

This project rebuilds the input and render pipeline from scratch around those constraints. See [SPEC.md](SPEC.md) for the full design and [ADR 0004](docs/decisions/0004-input-pipeline-tuning.md) for the specific input-pipeline choices.

## Quick start

### Try it now

The simplest path is the deployed GitHub Pages instance: **[vppillai.github.io/whiteboard](https://vppillai.github.io/whiteboard/)**.

### Run with Docker

```bash
git clone https://github.com/vppillai/whiteboard.git
cd whiteboard
cp .env.example .env
./deploy.sh
```

The app is then at `http://localhost:8787`. See [docs/deployment.md](docs/deployment.md) for reverse-proxy mounting, TLS, and operational notes.

### Self-host on GitHub Pages

Fork the repo, enable Pages with "GitHub Actions" as the source (*Settings → Pages → Source*), and push to `main`. The included [`pages.yml`](.github/workflows/pages.yml) workflow builds with `BASE_PATH=/whiteboard/` and deploys automatically. Custom domain? Update the `BASE_PATH` env in the workflow.

### Develop locally

```bash
bun install
bun run install-hooks
bun run dev
```

See [docs/development.md](docs/development.md).

## Documentation

| Doc | Audience |
|---|---|
| [SPEC.md](SPEC.md) | Product spec — features, tenets, scope. |
| [docs/architecture.md](docs/architecture.md) | System design + as-built status. |
| [docs/deployment.md](docs/deployment.md) | Docker, GitHub Pages, reverse-proxy, ops. |
| [docs/development.md](docs/development.md) | Local setup, testing, project layout. |
| [docs/milestones.md](docs/milestones.md) | Milestone history and roadmap. |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records (ADRs). |
| [CHANGELOG.md](CHANGELOG.md) | Release-by-release changes. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor guide. |

## Roadmap

Current backlog, tracked in [docs/milestones.md](docs/milestones.md) and [SPEC § 10 Backlog](SPEC.md):

- **PWA install + offline shell** — manifest, service worker, install affordance.
- **Deployment polish** — clean-host validation, reverse-proxy paths, release notes.
- **Live multi-user collaboration** — fully designed; deferred per [ADR 0012](docs/decisions/0012-sharing-deferred.md). The design archive at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md) is the starting point when sharing returns.
- **AI features** (v2) — shape recognition, handwriting → text, math → LaTeX. All in-browser via `transformers.js` + WebGPU. No telemetry, no cloud.

## Project status

**v1.4.6** — single-user, offline-first, production-ready for the indirect-input drawing case the project was built for. Lint, typecheck, and 274 unit tests run on every push (`bun test`); latency budget (≤ 33 ms pen-to-photon) is feel-tested on Wacom Intuos at every milestone close.

> **Authorship note.** This codebase is AI-generated under human direction: produced primarily by an AI coding assistant working from a human-authored spec, with design decisions, feel-test gates, and acceptance by a human. Published as OSS for anyone solving the same indirect-input drawing problem.

## License

[MIT](LICENSE).

## Acknowledgments

- [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) — Steve Ruiz's stroke-geometry library; the math behind every brush stroke here.
