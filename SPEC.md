# Whiteboard — Spec v0.1

A low-latency, browser-based whiteboard tuned for Wacom Intuos (indirect input), with link-based live collaboration and a single-Docker deployment story. AI features (shape recognition, handwriting → text, math/LaTeX) are scoped to v2 after the drawing core is proven.

> This document is the **product spec**. For "as-built" architecture, see [docs/architecture.md](docs/architecture.md). For milestones and exit criteria, see [docs/milestones.md](docs/milestones.md).

## 1. Goals & non-goals

### Goals

- Lowest pen-to-photon latency achievable in a browser, tuned for Wacom Intuos (indirect input).
- Drawing-first UX: floating toolbar, instant tool/color/size changes, dense keyboard shortcuts.
- Live multi-user collaboration with link-based sharing, owner-token-gated admin actions.
- Single-command Docker deploy, `.env`-configured.
- AI as v2: shape recognition, handwriting → text, math / LaTeX. v1 ships without AI.

### Non-goals

- Procreate / OneNote-grade *feel* — physically impossible on a screenless Intuos. We aim for "best-in-class indirect-input browser drawing."
- Mobile / touch-first design. Drawing on touchscreens works; not optimized for.
- Heavyweight feature set: no layers, no shape libraries, no slide decks, no presentations. This is a whiteboard.
- Per-user accounts, SSO, RBAC. Trust = owner token + room URL.

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Pointer        │→ │ Stroke engine    │→ │ Canvas       │ │
│  │ pipeline       │  │ (perfect-        │  │ render       │ │
│  │ (coalesced +   │  │  freehand)       │  │ (2-layer)    │ │
│  │  predicted)    │  └──────────────────┘  └──────────────┘ │
│  │                │           │                              │
│  │                │           ▼                              │
│  │                │  ┌──────────────────┐                    │
│  │                │  │ Y.Doc (CRDT)     │                    │
│  │                │  └──────────────────┘                    │
│  │                │           │                              │
│  └────────────────┘           ▼ (stroke-commit boundary)     │
│                       ┌──────────────────┐                   │
│                       │ y-websocket      │                   │
│                       └──────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼ ws
┌─────────────────────────────────────────────────────────────┐
│ Server (Bun, single process)                                │
│  ┌──────────────────┐  ┌──────────────────────────────┐     │
│  │ y-websocket      │← │ Auth (owner token, room id)  │     │
│  │ relay            │  └──────────────────────────────┘     │
│  └──────────────────┘                                       │
│           │                                                 │
│           ▼ (snapshot every 30s idle / on disconnect)       │
│  ┌──────────────────┐                                       │
│  │ SQLite           │  rooms(id, name, created_at)          │
│  │ (bun:sqlite)     │  snapshots(room_id, ydoc_blob, ts)    │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

One container. One process. One SQLite file. Static files served from the same process.

## 3. Drawing core

### 3.1 Input pipeline

```ts
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'pen' && !allowMouse) return
  canvas.setPointerCapture(e.pointerId)
  beginStroke(sample(e))
})

canvas.addEventListener('pointermove', e => {
  // 1. Pull every Wacom sample between frames
  for (const c of e.getCoalescedEvents()) appendSample(sample(c))
  // 2. Get predicted samples for visual lookahead
  const predicted = e.getPredictedEvents().map(sample)
  scheduleRender(predicted) // drawn but not committed
})

canvas.addEventListener('pointerup', e => commitStroke())
```

`sample(e)` produces `{x, y, pressure: applyCurve(e.pressure), tiltX, tiltY, t}`.

`applyCurve` exposes a γ slider; default γ=2.0 for Intuos (linear curves feel "mushy" on Wacom pens).

### 3.2 Render pipeline

Two stacked `<canvas>` elements:

- **Committed layer**: all finalized strokes. Re-rasterized only on pan/zoom or stroke commit/erase. Optionally `OffscreenCanvas` + worker once stroke count > ~500.
- **Live layer**: cleared and redrawn each `requestAnimationFrame` — current stroke + predicted-points lookahead. This is the layer the user actually sees moving.

Stroke geometry: [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) with these defaults per brush preset:

| Preset       | size | thinning | smoothing | streamline | taperStart | taperEnd | capStart | capEnd |
|--------------|------|----------|-----------|------------|------------|----------|----------|--------|
| Fine pen     | 2    | 0.6      | 0.5       | 0.5        | 0          | 0        | true     | true   |
| Marker       | 8    | 0.0      | 0.5       | 0.4        | 0          | 0        | true     | true   |
| Pencil       | 3    | 0.7      | 0.5       | 0.6        | 5          | 5        | true     | true   |
| Highlighter  | 18   | 0.0      | 0.3       | 0.5        | 0          | 0        | false    | false  |
| Brush        | 12   | 0.65     | 0.6       | 0.7        | 8          | 12       | true     | true   |

Highlighter renders with `globalAlpha = 0.4` and `globalCompositeOperation = 'multiply'`.

### 3.3 Latency budget

| Stage                                      | Target  |
|--------------------------------------------|---------|
| Pen-down → first ink visible               | <16 ms (1 frame) |
| Pen-to-photon during drag, with prediction | <33 ms  |
| Stroke commit → peer visible (LAN / WAN)   | <100 / <300 ms |
| Bundle initial load                        | <150 KB gz, <300 ms TTI on M1 |

Measured, not vibes. A `?perftest=1` mode runs an automated synthetic-stroke harness and reports numbers in-band.

### 3.4 Stroke data model

```ts
type Sample = { x: number; y: number; p: number; tx?: number; ty?: number; t: number }

type Stroke = {
  id: string                // ULID
  brushId: 'pen' | 'marker' | 'pencil' | 'highlighter' | 'brush'
  color: string             // #rrggbb or #rrggbbaa
  size: number              // base px at zoom 1
  samples: Sample[]
  deleted?: boolean         // soft delete for CRDT-friendly undo
  authorId: string          // ephemeral peer id
  createdAt: number
}
```

Stored in Y.js as `Y.Array<Y.Map>`. Soft-deletes (not removals) so undo across collaborators is sane.

## 4. Tools & UX

### 4.1 Tool set (v1)

Brush, Eraser (stroke-hit erase, not pixel), Lasso-select, Pan, Color-eyedropper. That's it.

### 4.2 Toolbar

Floating, draggable, dockable to any edge. Compact (icon-only) with hover labels. Pen presets 1–5 always visible. Recent colors (last 8) inline. Long-press / right-click on a preset opens its config (size, curve, taper).

### 4.3 Keyboard shortcuts

✅ marks shortcuts wired in M0; the rest land in M1 / M2 alongside their tools.

| Key                            | Action                                    | Status |
|--------------------------------|-------------------------------------------|--------|
| `B`                            | Brush                                     | M1     |
| `E`                            | Eraser                                    | M1     |
| `S`                            | Select (lasso)                            | M1     |
| `Space` (hold) + drag          | Pan (any pointer device)                  | ✅     |
| Middle-mouse drag              | Pan                                       | ✅     |
| `1`–`5`                        | Switch to brush preset 1–5                | M1     |
| `[` / `]`                      | Decrease / increase size                  | M1     |
| `Shift+[` / `Shift+]`          | Cycle color palette                       | M2     |
| `Cmd/Ctrl + Z`                 | Undo                                      | ✅     |
| `Cmd/Ctrl + Shift + Z`         | Redo (also `Cmd/Ctrl + Y`)                | ✅     |
| `Cmd/Ctrl + 0`                 | Reset zoom                                | ✅     |
| `Cmd/Ctrl + =` / `-`           | Zoom in / out                             | ✅     |
| `Cmd/Ctrl + A`                 | Select all                                | M1     |
| `Delete` / `Backspace`         | Delete selected                           | M1     |
| `Cmd/Ctrl + Shift + K`         | Clear board (confirm twice within 3 s)    | ✅     |
| `M`                            | Toggle metrics HUD                        | ✅     |
| `T`                            | Cycle theme (system → light → dark)       | ✅     |
| `F`                            | Toggle fullscreen / hide UI               | M2     |
| `?`                            | Toggle shortcut help overlay              | ✅     |
| `Esc`                          | Cancel pending action (e.g. clear-confirm)| ✅     |

### 4.4 Pressure curve UI

In settings: a small graph with draggable midpoint, plus a γ slider, plus a "test stroke" pad. Saved per-brush.

## 5. Collaboration

- **Room URL**: `/b/<uuid-base32>`. UUIDv7 → unguessable, sortable.
- **Trust**: anyone with the URL can draw + view. `?token=<OWNER_TOKEN>` (constant-time-compared on the server) unlocks: rename, delete, export-all, settings.
- **Sync**: Y.js doc per room. Per-sample updates stay local; a stroke is added to the Y.Array on `pointerup` only.
- **Presence**: ephemeral — peer cursors, name, color. Not persisted. Names: random "Adjective-Animal" by default, editable.
- **Capacity target**: 16 concurrent peers per room. Beyond, perf likely fine but UX (cursor crowd) degrades.

## 6. Persistence

- **Server**: SQLite. Snapshot the Y.doc to a blob column every 30 s of idle or on last-disconnect. On room load, hydrate from latest snapshot, then apply ws updates.
- **Client**: IndexedDB caches the Y.doc via `y-indexeddb`. Offline = keep drawing; reconnect = CRDT merges.
- **Export**: PNG (`canvas.toBlob`), SVG (custom serializer), PDF (`jspdf` wrapping the SVG). Single-click from toolbar.
- **Import**: PNG/SVG drop onto canvas places it as a non-editable image layer (read-only in v1).

## 7. AI roadmap (v2)

All three run in-browser via `transformers.js` + WebGPU. Triggered explicitly by the user; never auto.

1. **Shape recognition** — small ONNX classifier on stroke-feature vectors. Lasso → press `R` → suggest clean primitive with accept/reject. ~5–10 MB.
2. **Handwriting → text** — runs over selected lasso region. Output is an editable text node. ~30–60 MB. English first.
3. **Math / LaTeX** — separate model, lasso-scoped. Outputs LaTeX, rendered via KaTeX. ~80–120 MB; lazy-loaded only when invoked.

All three: lasso → invoke → streamed result → accept/replace or reject. No always-on inference, no telemetry, no cloud fallback.

## 8. Deployment

```
whiteboard/
├── apps/
│   ├── web/            # Vite + TS, vanilla canvas
│   └── server/         # Bun, y-websocket, SQLite
├── packages/
│   └── shared/         # types, stroke serialization
├── Dockerfile          # multi-stage: build web → copy into server image
├── docker-compose.yml          # production
├── docker-compose.dev.yml      # dev (hot reload, bind mounts)
├── deploy.sh
└── .env.example
```

`.env.example`:

```
PORT=8787
PUBLIC_ORIGIN=https://draw.example.com
OWNER_TOKEN=replace-me-with-openssl-rand-hex-32
DATA_DIR=/data
BASE_PATH=/                   # set to /whiteboard for a sub-path mount
MAX_ROOMS=500
MAX_BOARD_BLOB_MB=50
LOG_LEVEL=info
```

`deploy.sh` validates `.env`, then runs `docker compose up -d --build`.

The `BASE_PATH` env lets the app live behind a reverse proxy at e.g. `/whiteboard`. Web app and ws endpoint both honor it.

## 9. Milestones

| M  | Scope                                                                 | Days |
|----|-----------------------------------------------------------------------|------|
| M0 | Skeleton; canvas + perfect-freehand + coalesced events. **Latency-validate on Intuos before doing anything else.** | 1 |
| M1 | Predicted events, two-canvas split, pressure curve, 5 brushes, undo/redo, pan/zoom, eraser, lasso | 3 |
| M2 | Toolbar UI, keyboard shortcuts, palette, presets, IndexedDB local persistence, PNG/SVG/PDF export | 3 |
| M3 | Bun server, y-websocket, room URLs, owner token, SQLite snapshots | 3 |
| M4 | Dockerfile + compose + deploy.sh + sub-path mount | 1 |
| **v1 ship** | | **~11 days focused** |
| M5 | AI v2-a: shape recognition | 2 |
| M6 | AI v2-b: HTR | 3 |
| M7 | AI v2-c: math/LaTeX | 2 |

Each milestone closes only after: feature complete, doc-update reviewed, lint + typecheck clean, perf budget verified where applicable, and a tagged commit.

## 10. Open decisions and backlog (won't block v1)

### Decided during M0

- **Greenfield canvas (not a tldraw / excalidraw fork).** See [ADR 0001](docs/decisions/0001-greenfield-canvas.md).
- **Bun runtime.** See [ADR 0002](docs/decisions/0002-bun-runtime.md).
- **Y.js for collaboration.** See [ADR 0003](docs/decisions/0003-yjs-collaboration.md).
- **Predicted events disabled by default; sync-render in pointer handler.** See [ADR 0004](docs/decisions/0004-input-pipeline-tuning.md).
- **`OffscreenCanvas` worker — deferred.** Not measured to be a bottleneck at M0; revisit if main-thread work becomes the limit. ADR 0004 covers the latency-sensitive parts of the pipeline that *would* have benefited.
- **Theme-aware "ink" color token in stroke storage.** Strokes carry `color: 'ink'` rather than a literal hex value; the renderer resolves to the current theme's `--ink` CSS variable. Documented in `docs/architecture.md` § 4.

### Still open

- **Toolbar UI framework**: vanilla TS + nanostores vs Solid.js. Decide at the start of M2 based on bundle-size headroom and the toolbar's reactive needs.
- **Anonymous user names**: server-issued vs client-generated. Decide at M3.
- **Image import / paste in v1**: still leaning against. Reassess at the start of M2.

### Backlog (post-v1; tracked, not committed)

- **Screen-tablet support.** Re-enable predicted events for direct-input devices (iPad Pencil, Wacom MobileStudio, Surface Pro pen) where prediction is a clear win. Likely shape: a per-device-class preference exposed via the M2 settings panel, defaulting to off for indirect input and on for direct input. Trigger: a user with a screen tablet asks.
- **Performance under stroke count.** The current 2D-canvas + perfect-freehand rasterizes each stroke on the CPU (~1 ms each). Pan / zoom redraws all committed strokes; at ~500+ strokes this is the WebGL trigger. Track in `?perftest=scale` (planned at M1).
- **Mobile / touch UX.** Currently a non-goal. Touch *works* (pointer events handle it) but is not optimized. Reassess if a use case emerges.
- **Accessibility.** Currently silent. Keyboard-only navigation is largely covered (every action has a shortcut), but ARIA / focus management for the eventual toolbar is not. Address as part of M2's UI work.
