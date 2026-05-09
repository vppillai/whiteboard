# Whiteboard

Low-latency, browser-based whiteboard tuned for Wacom Intuos and other indirect-input pen tablets. Live collaboration via shareable room links. Single-command Docker deployment.

> **About this project** — This tool was built to solve a specific problem: getting Procreate / OneNote-quality drawing in a browser-based whiteboard while using a screenless Wacom Intuos. Existing tools (tldraw, excalidraw) didn't hit the latency and pen-feel target.
>
> This codebase is **AI-generated under human direction** — produced primarily by an AI coding assistant working from a human-authored spec, with design decisions and acceptance gates by a human. It's published as open source in case someone else has the same problem and would benefit from a starting point: fork it, modify it, ship something better.
>
> **No warranty, no support commitment, no roadmap promise.**

## Status

Early alpha. **Milestone M0 — drawing core — is in code**: drawing with `perfect-freehand`, infinite-canvas pan / zoom, light / dark / system themes, local persistence via IndexedDB, and a metrics HUD. Latency validation on a Wacom Intuos is the remaining M0 gate. Brushes beyond the default pen, eraser, lasso, undo/redo, multi-user collaboration, and exports are upcoming milestones.

See [docs/milestones.md](docs/milestones.md) for the full plan and current state.

## Why this exists

Browser whiteboards built on tldraw or excalidraw work but feel imprecise on a screenless Wacom Intuos. The likely reasons:

- They don't use `PointerEvent.getCoalescedEvents()`, so ~75% of the tablet's 200 Hz sample rate is dropped at a 60 Hz display.
- They don't use `getPredictedEvents()` for visual lookahead.
- SVG-based stroke rendering can't sub-frame-update.
- Default pressure curves aren't tuned for the Intuos pressure profile.

This project rebuilds the input and render pipeline from scratch around those constraints. See [SPEC.md](SPEC.md) for the full design.

## Features

**Today (M0 in code; pending Intuos latency validation):**

- Drawing with `perfect-freehand` stroke geometry, γ=2 pressure curve preset.
- Infinite canvas; wheel to pan, Cmd/Ctrl+wheel or trackpad pinch to zoom around the cursor.
- Light / dark / system themes (`T` to cycle); brush "ink" color follows the theme.
- Local persistence: pick up where you left off after reload — no account required.
- Sub-33 ms pen-to-photon latency target on a Wacom Intuos (validate via `?perftest=1` and a real-pen test).
- Live metrics HUD (`M`): FPS, events / s, coalesced samples / event, event → frame.
- Help overlay (`?`).

**Coming up:**

- 5 brush presets (pen, marker, pencil, highlighter, brush) with per-brush pressure curves — M1.
- Stroke-hit eraser, lasso select, undo / redo — M1.
- Floating toolbar with comprehensive keyboard shortcuts — M2.
- PNG / SVG / PDF export — M2.
- Live multi-user collaboration via shareable room URLs (CRDT, offline-capable) — M3.
- **v2:** in-browser AI for rough-shape → clean primitive, handwriting → text, math → LaTeX. WebGPU only; no telemetry, no cloud.

## Quick start

### Run with Docker

```bash
git clone https://github.com/vppillai/whiteboard.git
cd whiteboard
cp .env.example .env
# Edit .env: set OWNER_TOKEN to a random secret
#   openssl rand -hex 32
./deploy.sh
```

Whiteboard is then at `http://localhost:8787`.

See [docs/deployment.md](docs/deployment.md) for production deployment, reverse-proxy mounts, and TLS.

### Develop locally

See [docs/development.md](docs/development.md). TL;DR:

```bash
bun install
bun run install-hooks
docker compose -f docker-compose.dev.yml up
```

## Documentation

- [Spec](SPEC.md) — product spec v0.1.
- [Architecture](docs/architecture.md) — as-built system design.
- [Development](docs/development.md) — local setup and project layout.
- [Deployment](docs/deployment.md) — production deploy, env vars, ops.
- [Milestones](docs/milestones.md) — milestone plan and exit criteria.
- [Process](docs/process.md) — how reviews, doc maintenance, and releases work here.
- [Decisions](docs/decisions/) — ADRs (Architecture Decision Records).
- [Changelog](CHANGELOG.md).
- [Contributing](CONTRIBUTING.md).

## Layout

```
apps/web/        — frontend (Vite + TS, vanilla canvas)
apps/server/     — backend (Bun, WebSocket, SQLite)
packages/shared/ — shared types and protocol
docs/            — living documentation
```

## License

[MIT](LICENSE).

## Acknowledgments

- [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) — Steve Ruiz's stroke-geometry library; the math behind every brush stroke here.
- [Y.js](https://github.com/yjs/yjs) — CRDT used for live collaboration.
