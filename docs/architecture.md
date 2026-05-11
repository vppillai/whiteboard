# Architecture

This document describes how Whiteboard is built. It has two halves:

- **§1–§5 — Designed architecture** describes the target system, including parts not yet implemented. It mirrors [SPEC.md](../SPEC.md) but in implementation terms.
- **§6 — As-built status** tracks which parts actually exist in the code right now.

When you change the system, update both.

---

## 1. System overview

Whiteboard is a single-process web application: a Bun-based HTTP + WebSocket server serves a static SPA and relays Y.js (CRDT) updates between browser peers. Persistence is local SQLite.

```
   Browser                                    Container
  ┌──────────────────────────┐              ┌──────────────────────────┐
  │  SPA (web)               │   HTTPS/WS   │  Bun server              │
  │  ┌───────────┐           │ ────────────►│  ┌──────────┐            │
  │  │ Drawing   │           │              │  │ Static   │            │
  │  │ canvas    │           │              │  │ files    │            │
  │  └───────────┘           │              │  └──────────┘            │
  │  ┌───────────┐           │              │  ┌──────────┐            │
  │  │ Y.Doc     │ ◄─────────┼──── y-ws ────┼─►│ y-ws     │            │
  │  └───────────┘           │              │  │ relay    │            │
  │  ┌───────────┐           │              │  └────┬─────┘            │
  │  │ IndexedDB │           │              │       ▼                  │
  │  │ (offline) │           │              │  ┌──────────┐            │
  │  └───────────┘           │              │  │ SQLite   │            │
  └──────────────────────────┘              │  └──────────┘            │
                                            └──────────────────────────┘
```

There are no other services. No queue, no Redis, no separate database, no separate static-file CDN. Scaling beyond one box is out of scope.

## 2. Components

### 2.1 Web (`apps/web`)

Vanilla TypeScript SPA built with Vite. Renders to `<canvas>` directly — no React, no Solid, no UI framework on the drawing surface. The toolbar UI uses a small reactive store; framework choice (vanilla vs Solid) is finalized at M2.

Key submodules:

| Module          | Status   | Responsibility                                           |
|-----------------|----------|----------------------------------------------------------|
| `pointer.ts`    | M1.4 ✅  | Pure event router; dispatches to active `Tool` (ADR 0005, extended in 0007). |
| `tools/types.ts`| M1 ✅    | `Tool` + `ToolContext` interfaces (cursor / menu / redraw owned by tools). |
| `tools/pen.ts`  | M1 ✅    | Drawing tool — strokes, hover preview per brush, COLOR + BRUSH menu section. |
| `tools/eraser.ts`| M1 ✅   | Eraser — pixel-mask wipe + object modes, cursor reticle, 4-pill ERASER menu, `getPendingStamps` for live preview. ADR 0009. |
| `tools/lasso.ts`| M1 ✅    | Lasso — polygon select + tap-select + drag-to-move + delete. Halo + dashed bbox visualization. `getDragState` for live offset preview during drag. |
| `eraserhold.ts` | M1 ✅    | `E` key spring-loaded eraser modifier; mirror of `pan.ts` pattern. Tap `Shift+E` for sticky. |
| `brushes.ts`    | M1 ✅    | Five brush presets (pen / marker / pencil / highlighter / brush). |
| `menu-ui.ts`    | M1 ✅    | Shared DOM helpers — sectionLabel / pill / swatch / fullItem / separator. |
| `ops.ts`        | M1 ✅    | Op-based undo (create / delete / move / eraseStamps). ADRs 0006 + 0009. |
| `stroke.ts`     | M0 ✅    | Stroke geometry via `perfect-freehand`; pressure curve; `erasedStamps` helpers. |
| `render.ts`     | M1 ✅    | Three-layer canvas: `committed` (grid + composited strokes) + `strokes` (offscreen, destination-out target) + `live` (in-flight + cursor). ADR 0009 § *Renderer*. |
| `camera.ts`     | M0 ✅    | Pan / zoom state; screen ↔ board coordinate math.        |
| `viewstate.ts`  | M1.5 ✅  | Per-device camera persistence (debounced localStorage).  |
| `grid.ts`       | M1.5 ✅  | Configurable grid (dots / lines / ruled / none + spacing). |
| `theme.ts`      | M0 ✅    | Light / dark / system themes; theme-aware "ink" color.   |
| `metrics.ts`    | M0 ✅    | Live FPS / events / samples / event→frame HUD.           |
| `perftest.ts`   | M0 ✅    | Synthetic stroke harness; reports JS-side latency. M1 added `?perftest=erase` + `?perftest=scale` modes (in `main.ts`) using a shared `perfRecording` flag instrumented in `frame()` for honest per-frame render-duration measurement. |
| `storage.ts`    | M0 ✅    | Local persistence via IndexedDB.                         |
| `settings.ts`   | M1.7 ✅  | M1.7 — v1 schema, sparse preset overrides, sync-ready reserved fields. ADR 0010. |
| `sidepanel.ts`  | M1.7 ✅  | Side panel primitive (slide-in from right, overlay). ADR 0010. |
| `settings/panel-content.ts` | M1.7 ✅ | M1.7 settings tree (7 sections). |
| `destructiveconfirm.ts` | M1.7 ✅ | Generalized priming-toast (shared by clear + reset). |
| `resetflow.ts`  | M1.7 ✅  | Reset-to-defaults flow.                                  |
| `swatchadd.ts`  | M1.7 ✅  | Hex + OS color picker UI shared between picker and panel. |
| `popover.ts`    | M1.5 ✅  | Anchored, viewport-clamped, pinnable popover primitive.  |
| `colorpicker.ts`| M1.5 ✅  | Color picker popover content (swatches).                 |
| `optionsmenu.ts`| M1.5 ✅  | Options popover content (grid type, spacing).            |
| `toolmenu.ts`   | M1.5 ✅  | Right-click tool menu (inline color swatches + tools).   |
| `pan.ts`        | M1.4 ✅  | Spacebar / middle-mouse pan handler.                     |
| `clearflow.ts`  | M1.4 ✅  | Clear-board confirmation flow + toast.                   |
| `keymap.ts`     | M1.4 ✅  | Keyboard shortcut registry + dispatcher.                 |
| `helpoverlay.ts`| M1.4 ✅  | `?` help overlay (shortcuts + repo link).                |
| `pill.ts`       | M1.4 ✅  | Bottom-left "? for help" pill.                           |
| `toolpill.ts`   | M1 ✅    | Bottom-right active-tool indicator + tap-to-cycle. Pen-friendly one-step activation alongside `S` / `B` / `P` / right-click TOOL menu. |
| `firstrun.ts`   | M2 ✅    | First-run hint mount + dismissal; localStorage flag.    |
| `distractionfree.ts` | M2 ✅ | F-toggle distraction-free mode; hides app chrome via body class. |
| `settings/curve-editor.ts` | M2 ✅ | SVG curve graph + draggable midpoint + test pad + thumbnail renderer. |
| `exportpopover.ts`| M2 ✅    | Cmd/Ctrl+E export popover (PNG / SVG / PDF pills).      |
| `export/bounds.ts`| M2 ✅    | Compute board bounds + 32 px margin from non-deleted strokes' AABBs. |
| `export/png.ts`   | M2 ✅    | PNG export — detached canvas + `drawStrokeOntoLayer` + `toBlob`. |
| `export/svg.ts`   | M2 ✅    | Custom SVG serializer; mask-based `erasedStamps` subtraction. |
| `export/pdf.ts`   | M2 ✅    | PDF export — lazy `jspdf`, PNG embed.                   |
| `export/index.ts` | M2 ✅    | Export dispatcher + filename + download trigger.         |
| `sync/`         | M3 ⬜    | Y.Doc binding; WebSocket transport; presence.            |
| `ui/`           | 🟡 Deferred | Floating toolbar dropped from v1 per ADR 0011 — right-click + keyboard + side panel cover discovery. |
| `ai/`           | v2 ⬜    | Shape recognition, HTR, math — `transformers.js`.        |

### 2.2 Server (`apps/server`)

Single Bun process. Responsibilities:

1. **M0 ✅** Serve static files from `apps/web/dist` with SPA fallback to `index.html`. Hashed assets get `Cache-Control: immutable`.
2. **M0 ✅** Expose `/health` for the container healthcheck.
3. **M3 ⬜** Handle WebSocket upgrades for `/yjs/<room-id>`; forward Y.js updates between peers in the same room.
4. **M3 ⬜** Snapshot each room's Y.Doc to SQLite on idle / disconnect.
5. **M3 ⬜** Validate `OWNER_TOKEN` for admin actions (rename, delete, export-all).

The server holds Y.Docs in-memory only as long as a room has active peers. Cold rooms are evicted and rehydrated from SQLite on the next connect.

### 2.3 Shared (`packages/shared`)

Types and protocol shared between web and server. Includes:

- `Stroke`, `Sample` types.
- WebSocket message envelope types (auth, presence, room-meta — outside of the Y.js protocol itself, which is binary).
- Constants: limits, format versions.

### 2.4 Persistence

#### Client (M0 ✅)

`apps/web/src/storage.ts` wraps IndexedDB. One database (`whiteboard-local`), one object store (`strokes`), keyed on stroke id. Strokes are written individually on `pointerup` so a power-loss event at most loses the in-flight stroke. Reads on app boot hydrate the committed canvas.

This is intentionally a thin wrapper, not a CRDT-aware persistence layer — that swaps in at M3 (`y-indexeddb`).

#### Server (M3 ⬜)

SQLite via `bun:sqlite`. Schema (planned):

```sql
CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,        -- UUIDv7 base32
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE snapshots (
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  ydoc_blob   BLOB NOT NULL,
  ts          INTEGER NOT NULL,
  PRIMARY KEY (room_id, ts)
);

CREATE INDEX snapshots_room_ts ON snapshots(room_id, ts DESC);
```

Snapshots are full doc states (`Y.encodeStateAsUpdate`). Old snapshots are pruned on a schedule (keep latest N, delete older).

## 3. Network protocol

### 3.1 Static + REST

| Path                       | Method | Purpose                          |
|----------------------------|--------|----------------------------------|
| `/`, `/b/<id>`, `/assets/*`| GET    | Static SPA assets.               |
| `/health`                  | GET    | Liveness probe (returns 200).    |
| `/api/rooms`               | POST   | Create room (returns id).        |
| `/api/rooms/:id`           | DELETE | Delete room. Owner-token required. |

### 3.2 WebSocket

| Path                | Purpose                                              |
|---------------------|------------------------------------------------------|
| `/yjs/<room-id>`    | Y.js sync; binary protocol (`y-protocols/sync`).     |
| `/presence/<room-id>`| Cursor / selection presence; JSON.                   |

The Y.js binary protocol is consumed unchanged. Owner-token, if present in the query string, gates admin operations server-side.

## 4. Stroke data model

```ts
type Sample = { x: number; y: number; p: number; tx?: number; ty?: number; t: number }

type BrushConfig = {
  size: number; color: string;
  thinning: number; smoothing: number; streamline: number
  taperStart: number; taperEnd: number; capStart: boolean; capEnd: boolean
  pressureGamma: number; opacity?: number
}

type Stroke = {
  id: string                // ULID
  brush: BrushConfig         // snapshot at pointerdown — color may be the 'ink' token
  samples: Sample[]
  startedAt: number          // performance.now() at pointerdown
  deleted?: boolean          // whole-stroke soft-delete (lasso, object-mode eraser)
  erasedStamps?: { x: number; y: number; r: number }[]
                              // pixel-mask eraser (ADR 0009): cursor disks subtracted
                              // from rendered ink at draw time. Sparse — omitted when
                              // the stroke has not been wiped.
}
```

Stored locally as one IDB row per stroke. M3+ also represents this in Y.js as `Y.Array<Y.Map>` for sync. Both `deleted` and `erasedStamps` are append-only-friendly (a flag flip and a list extension, respectively) — CRDT-friendly when sync lands.

Coordinates are in **board space** (infinite, unitless), translated to screen space at render time via the camera transform. `erasedStamps` are in board coords too; they re-rasterize correctly through pan / zoom / theme changes alongside the stroke they belong to.

## 5. Deployment topology

One container, one process, one SQLite file mounted on a Docker volume. The server listens on `${PORT}` (default 8787) and serves both static and WebSocket from the same port.

Sub-path mounting (`BASE_PATH=/whiteboard`) is supported for reverse-proxy deployments. Both the SPA and the WebSocket endpoints honor this. See [deployment.md](deployment.md).

There is no horizontal-scale story. A single container is the unit; if you need more, run more (one per tenancy) behind a router.

---

## 6. As-built status

This section reflects what is *actually in the code right now*. It is updated at each milestone close.

| Component                         | Status         | Notes                                                    |
|-----------------------------------|----------------|----------------------------------------------------------|
| Workspace layout                  | ✅ Complete    | Bun workspaces; web / server / shared.                   |
| Build pipeline                    | ✅ Complete    | Vite (web) + Bun direct (server). `bun run build`.       |
| Lint / format                     | ✅ Complete    | Biome.                                                   |
| Docker (production)               | ✅ Complete    | Multi-stage Dockerfile + compose; healthcheck.           |
| Docker (dev)                      | ✅ Complete    | Bind-mount + watch dev compose.                          |
| CI                                | ✅ Complete    | GitHub Actions: lint + typecheck + Docker smoke.         |
| Pre-commit hooks                  | ✅ Complete    | Biome check on staged files.                             |
| **Drawing core (M0)**             | ✅ In code     | `pointer.ts` + `stroke.ts` + `render.ts`; coalesced + predicted; perfect-freehand math. Latency feel-tested on Wacom Intuos. |
| Pen brush preset                  | ✅ Complete    | Single "Fine pen" preset; γ=2 pressure curve.            |
| Pan / zoom (infinite canvas)      | ✅ Complete    | Wheel-pan, Cmd/Ctrl+wheel/pinch zoom; Cmd+0 reset.       |
| Light / dark / system theme       | ✅ Complete    | CSS variables; "ink" token re-resolves on theme change.  |
| Local persistence (M0+)           | ✅ Complete    | IndexedDB; auto-save on stroke commit; hydrate on load. `erasedStamps` persisted alongside the stroke (no schema bump). |
| Static file serving               | ✅ Complete    | Server serves built SPA with SPA fallback + immutable cache for `/assets/*`. |
| Metrics HUD + perftest            | ✅ Complete    | `M` to toggle; `?perftest=1` (drawing latency) and `?perftest=erase` (wipe-render budget, ADR 0009). |
| **Undo / redo**                   | ✅ Complete    | Pulled forward from M1; M1.4 rewrote as op-based (ADR 0006); M1 added `eraseStamps` op (ADR 0009). |
| **Tool abstraction**              | ✅ Complete    | M1.4 + M1; ADRs 0005 + 0007. Tools own cursor / stroke / menu rendering. |
| **Soft-delete strokes**           | ✅ Complete    | M1.4; `Stroke.deleted` flag, render filter, op-driven flips. |
| **Brushes (pen / marker / pencil / highlighter / brush)** | ✅ Complete | M1; 1–5 keys or `P` + right-click menu BRUSH section. |
| **Eraser (pixel-mask wipe + object)** | ✅ Complete | M1; `E` (spring-loaded), `Shift+E` (sticky), 4-pill ERASER section, sizes 6/12/24 px wipe + Item single-stroke. ADR 0009. |
| **Stroke clipping (off-viewport cull)** | ✅ Complete | M1; AABB cache, viewport intersection check in render loop. |
| **Shift-constrained drawing**     | ✅ Complete    | M1; pen tool snaps to straight line while Shift held. |
| **`Cmd/Ctrl+1` zoom-to-fit**      | ✅ Complete    | M1; bounding-box of non-deleted strokes. |
| **Brush-aware hover cursor**      | ✅ Complete    | M1; per-brush cursor shape (pen circle / marker bold / pencil light / highlighter chisel / brush halo). |
| **Three-canvas render pipeline**  | ✅ Complete    | M1 (ADR 0009): committed (grid + composited strokes) + offscreen strokes layer (destination-out target) + live (in-flight + cursor). |
| **Spring-loaded `E` key**         | ✅ Complete    | M1; `eraserhold.ts` mirrors `pan.ts` spacebar pattern. `Shift+E` is sticky.   |
| **`P` = Draw + Pen preset**       | ✅ Complete    | M1; one-keystroke "go to my default drawing setup."     |
| **Color picker** (popover at pointer) | ✅ Complete | M1.5; swatches + recent colors; pin to keep open.        |
| **Options menu** (popover)        | ✅ Complete    | M1.5; grid type + spacing.                               |
| **Configurable grid**             | ✅ Complete    | M1.5; dots / lines / ruled / none.                       |
| **Lasso (select / move / delete)** | ✅ Complete    | M1; `S` activates, polygon-or-tap select, halo + dashed bbox, drag-to-move emits `move` op, `Delete`/`Backspace` deletes, `⌘/Ctrl+A` select all. |
| **Floating toolbar / palette**    | 🟡 Deferred    | M2 — dropped per [ADR 0011](decisions/0011-toolbar-deferred.md); right-click + keyboard + side panel cover discovery. |
| **Pressure curve UI**             | ✅ Complete    | M2; inline collapsed thumbnail per Brush preset card; bezier-midpoint (through-point) editor + test pad. |
| **Predicted-events toggle**       | ✅ Complete    | M2; settings panel Advanced section; URL `?predict=1` continues to override. |
| **Color eyedropper tool**         | 🟡 Descoped    | M2 — descoped at feel-test on tenet grounds; right-click + color picker (`C`) cover the use case. |
| **First-run hint**                | ✅ Complete    | M2; localStorage `whiteboard:hint-shown`; fades on first stroke commit. |
| **Distraction-free mode (`F`)**   | ✅ Complete    | M2; `body.distraction-free` hides chrome; Esc/F exits. |
| **Palette cycle (`Shift+[/]`)**   | ✅ Complete    | M2; cycles 10 curated colors with wraparound. |
| **Export PNG / SVG / PDF**        | ✅ Complete    | M2; right-click EXPORT row + `Cmd/Ctrl+E` popover; mask-based SVG erasure; lazy `jspdf`. |
| **Bounded undo / redo + listener cleanup** | ✅ Complete    | M2 (Option C); undoStack capped at 500 with FIFO eviction; modules return cleanup functions; HMR dispose + beforeunload run all teardowns. |
| Live collaboration                | ❌ Not started | M3.                                                      |
| Room URLs / owner token           | ❌ Not started | M3.                                                      |
| Server-side SQLite snapshots      | ❌ Not started | M3.                                                      |
| AI features                       | ❌ Not started | v2 (M5–M7).                                              |
