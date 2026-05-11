# Whiteboard

Low-latency, browser-based whiteboard tuned for Wacom Intuos and other indirect-input pen tablets. Offline-first, single-command Docker deployment.

> **About this project** — This tool was built to solve a specific problem: getting Procreate / OneNote-quality drawing in a browser-based whiteboard while using a screenless Wacom Intuos. Existing tools (tldraw, excalidraw) didn't hit the latency and pen-feel target.
>
> This codebase is **AI-generated under human direction** — produced primarily by an AI coding assistant working from a human-authored spec, with design decisions and acceptance gates by a human. It's published as open source in case someone else has the same problem and would benefit from a starting point: fork it, modify it, ship something better.
>
> **No warranty, no support commitment, no roadmap promise.**

## Status

Pre-v1. Milestones M0 → M2.1 are shipped: drawing core (`perfect-freehand`, coalesced + predicted events, latency-validated on Wacom Intuos), 5 brush presets, pixel-mask + object eraser, lasso, undo/redo, op-based mutation pipeline, infinite-canvas pan/zoom, light/dark/system themes, settings side panel, PNG / SVG / PDF export, distraction-free mode, first-run hint, pressure-curve UI, `StrokeStore` interface seam for future sync.

**Remaining for v1:** M4 (deployment polish) → M4.5 (PWA install + offline) → tag `v1.0.0`.

**Live collaboration is deferred from v1** per [ADR 0012](docs/decisions/0012-sharing-deferred.md); the full design is preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md) for a future implementation.

See [docs/milestones.md](docs/milestones.md) for the full plan and current state.

## Why this exists

Browser whiteboards built on tldraw or excalidraw work but feel imprecise on a screenless Wacom Intuos. The likely reasons:

- They don't use `PointerEvent.getCoalescedEvents()`, so ~75% of the tablet's 200 Hz sample rate is dropped at a 60 Hz display.
- They don't use `getPredictedEvents()` for visual lookahead.
- SVG-based stroke rendering can't sub-frame-update.
- Default pressure curves aren't tuned for the Intuos pressure profile.

This project rebuilds the input and render pipeline from scratch around those constraints. See [SPEC.md](SPEC.md) for the full design.

## Features

**Today (M2.1 shipped):**

- Drawing with `perfect-freehand` stroke geometry; 5 brush presets (pen / marker / pencil / highlighter / brush) with per-brush pressure curves.
- Pixel-mask wipe eraser (cuts through strokes) + object-mode eraser.
- Lasso select, move, delete; op-based undo/redo across all mutations.
- Infinite canvas; wheel to pan, Cmd/Ctrl+wheel or trackpad pinch to zoom around the cursor; `Cmd/Ctrl+1` zoom-to-fit; `Cmd/Ctrl+0` reset.
- Light / dark / system themes (`T` to cycle); brush "ink" color follows the theme.
- Color picker (`C`), curated palette + custom swatches + recent colors.
- Settings side panel (`Cmd/Ctrl+,`): brush preset tuning, pressure-curve editor, theme, grid, advanced knobs.
- PNG / SVG / PDF export (right-click EXPORT or `Cmd/Ctrl+E`).
- Distraction-free mode (`F`), first-run hint, help overlay (`?`), metrics HUD (`M`).
- Local persistence via IndexedDB: pick up where you left off after reload — no account required.
- Sub-33 ms pen-to-photon latency on Wacom Intuos (validated via `?perftest=1` and real-pen tests).

**Coming up (pre-v1):**

- Deployment polish: clean-host validation, reverse-proxy paths — M4.
- PWA install + offline (manifest, service worker) — M4.5.
- Tag `v1.0.0`.

**Post-v1 / backlog:**

- Live multi-user collaboration via shareable room URLs (CRDT, offline-capable). Originally scoped as M3 and fully designed; deferred from v1 per [ADR 0012](docs/decisions/0012-sharing-deferred.md). The design archive is at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md).
- **v2:** in-browser AI for rough-shape → clean primitive, handwriting → text, math → LaTeX. WebGPU only; no telemetry, no cloud.

## Quick start

### Run with Docker

```bash
git clone https://github.com/vppillai/whiteboard.git
cd whiteboard
cp .env.example .env
# Defaults work for localhost; edit PUBLIC_ORIGIN and BASE_PATH for non-local.
./deploy.sh
```

Whiteboard is then at `http://localhost:8787`.

### Or: Deploy to GitHub Pages (no server)

Because v1 is stateless (live collaboration is post-v1 per [ADR 0012](docs/decisions/0012-sharing-deferred.md)), the built SPA can be hosted on any static-file host — including **GitHub Pages**. The repo ships a [`.github/workflows/pages.yml`](.github/workflows/pages.yml) workflow that builds and deploys automatically on every push to `main`.

**One-time setup:** In your fork's *Settings → Pages*, set **Source** to **"GitHub Actions"**. The next push to `main` deploys to `https://<your-username>.github.io/whiteboard/` (the workflow sets `BASE_PATH=/whiteboard/` to match the default repo name — edit the workflow if you renamed it).

See [docs/deployment.md](docs/deployment.md) for production deployment options (Docker, GitHub Pages, reverse-proxy mounts, TLS).

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
apps/server/     — backend (Bun, static file serving; stateless at v1)
packages/shared/ — shared types
docs/            — living documentation
```

## License

[MIT](LICENSE).

## Acknowledgments

- [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) — Steve Ruiz's stroke-geometry library; the math behind every brush stroke here.
