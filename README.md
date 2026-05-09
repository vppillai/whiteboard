# Whiteboard

Low-latency, browser-based whiteboard tuned for Wacom Intuos and other indirect-input pen tablets. Live collaboration via shareable room links. Single-command Docker deployment.

> **About this project** — This tool was built to solve a specific problem: getting Procreate / OneNote-quality drawing in a browser-based whiteboard while using a screenless Wacom Intuos. Existing tools (tldraw, excalidraw) didn't hit the latency and pen-feel target.
>
> This codebase is **AI-generated under human direction** — produced primarily by an AI coding assistant working from a human-authored spec, with design decisions and acceptance gates by a human. It's published as open source in case someone else has the same problem and would benefit from a starting point: fork it, modify it, ship something better.
>
> **No warranty, no support commitment, no roadmap promise.**

## Status

Pre-alpha. Repository scaffold and product spec only — the drawing core (milestone M0) has not been implemented yet. See [docs/milestones.md](docs/milestones.md) for the milestone plan.

## Why this exists

Browser whiteboards built on tldraw or excalidraw work but feel imprecise on a screenless Wacom Intuos. The likely reasons:

- They don't use `PointerEvent.getCoalescedEvents()`, so ~75% of the tablet's 200 Hz sample rate is dropped at a 60 Hz display.
- They don't use `getPredictedEvents()` for visual lookahead.
- SVG-based stroke rendering can't sub-frame-update.
- Default pressure curves aren't tuned for the Intuos pressure profile.

This project rebuilds the input and render pipeline from scratch around those constraints. See [SPEC.md](SPEC.md) for the full design.

## Features (planned)

- Sub-33 ms pen-to-photon latency target on a Wacom Intuos.
- 5 brush presets (pen, marker, pencil, highlighter, brush) with per-brush pressure curves.
- Floating, dockable toolbar with comprehensive keyboard shortcuts.
- Stroke-hit eraser, lasso select, pan / zoom on infinite canvas.
- Live multi-user collaboration via shareable room URLs (CRDT, offline-capable).
- PNG / SVG / PDF export.
- **v2 (post-v1):** AI assists for rough-shape → clean primitive, handwriting → text, math → LaTeX. All in-browser via WebGPU; no telemetry, no cloud.

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
