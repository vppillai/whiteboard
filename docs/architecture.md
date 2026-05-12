# Architecture

This document describes how Whiteboard is built. It has two halves:

- **§1–§5 — Designed architecture** describes the target system, including parts not yet implemented. It mirrors [SPEC.md](../SPEC.md) but in implementation terms.
- **§6 — As-built status** tracks which parts actually exist in the code right now.

When you change the system, update both.

---

## 1. System overview

Whiteboard is a single-process web application: a Bun-based HTTP server serves a static SPA. Persistence is local IndexedDB in the browser. The v1 server is stateless.

```
   Browser                                    Container
  ┌──────────────────────────┐              ┌──────────────────────────┐
  │  SPA (web)               │   HTTPS      │  Bun server (stateless)  │
  │  ┌───────────┐           │ ────────────►│  ┌──────────┐            │
  │  │ Drawing   │           │              │  │ Static   │            │
  │  │ canvas    │           │              │  │ files +  │            │
  │  └───────────┘           │              │  │ /health  │            │
  │  ┌───────────┐           │              │  └──────────┘            │
  │  │ StrokeStore│  ← seam for future sync                            │
  │  │ (local IDB)│                                                    │
  │  └───────────┘                                                     │
  └──────────────────────────┘              └──────────────────────────┘
```

There are no other services. No queue, no Redis, no separate database, no separate static-file CDN. The server holds no state — restarts are free; backups are unnecessary; scaling beyond one box is out of scope.

The Y.js + WebSocket + SQLite layer that originally formed the M3 (live collaboration) plan is **deferred to post-v1** per [ADR 0012](decisions/0012-sharing-deferred.md). The design is preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](superpowers/specs/2026-05-10-m3-sync-design.md). v1 schema and abstraction choices (M2.1) keep the future-sharing door open without paying the cost today.

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
| `tools/select.ts`| v1.1 ✅ | Select tool (`V`) for floating image objects — first-hit pick (reverse-z), 8 resize handles + rotation handle, anchor-preserving resize math under rotation, double-click rotation reset, Shift = aspect-lock. Custom circular-arrow rotate cursor. |
| `eraserhold.ts` | M1 ✅    | `E` key spring-loaded eraser modifier; mirror of `pan.ts` pattern. Tap `Shift+E` for sticky. |
| `brushes.ts`    | M1 ✅    | Five brush presets (pen / marker / pencil / highlighter / brush). |
| `menu-ui.ts`    | M1 ✅    | Shared DOM helpers — sectionLabel / pill / swatch / fullItem / separator. |
| `ops.ts`        | M1 / v1.1 ✅ | Op-based undo. Stroke kinds: `create` / `delete` / `move` / `eraseStamps` (ADRs 0006 + 0009). Image kinds: `paste-image` / `delete-image` / `transform-image` / `rotate-image` (v1.1). |
| `stroke.ts`     | M0 ✅    | Stroke geometry via `perfect-freehand`; pressure curve; `erasedStamps` helpers. |
| `render.ts`     | M1 ✅    | Three-layer canvas: `committed` (grid + composited strokes) + `strokes` (offscreen, destination-out target) + `live` (in-flight + cursor). ADR 0009 § *Renderer*. |
| `camera.ts`     | M0 ✅    | Pan / zoom state; screen ↔ board coordinate math.        |
| `viewstate.ts`  | M1.5 ✅  | Per-device camera persistence (debounced localStorage).  |
| `grid.ts`       | M1.5 ✅  | Configurable grid (dots / lines / ruled / none + spacing). |
| `theme.ts`      | M0 ✅    | Light / dark / system themes; theme-aware "ink" color.   |
| `metrics.ts`    | M0 ✅    | Live FPS / events / samples / event→frame HUD.           |
| `perftest.ts`   | M0 ✅    | Synthetic stroke harness; reports JS-side latency. M1 added `?perftest=erase` + `?perftest=scale` modes (in `main.ts`) using a shared `perfRecording` flag instrumented in `frame()` for honest per-frame render-duration measurement. |
| `storage.ts`    | M0 / v1.1 ✅ | Local persistence via IndexedDB. v1.1 bumps `DB_VERSION` to 2 with `images` (metadata) + `images-blob` (Blob bytes) stores alongside the original `strokes`. Existing data is preserved on upgrade. |
| `imagestore.ts` | v1.1 ✅  | `ImageStore` interface seam (mirrors `StrokeStore`) — load / insert / updateMeta / hardDelete / clear + `onRemoteChange` no-op. Local IDB-backed impl. Image binaries deferred to M5.1 sync per ADR 0012. |
| `imagecache.ts` | v1.1 ✅  | Runtime cache of decoded `HTMLImageElement`s keyed by `blobRef`. Object-URL lifecycle (created in `loadImageElement`, revoked the moment `onload` fires); cancellation flag protects against evict-during-decode races. |
| `imagepaste.ts` | v1.1 ✅  | Paste pipeline — three input paths (synchronous `paste` event, async clipboard API fallback, drag-drop) converging on one `paste-image` op. MIME whitelist (PNG / JPEG / WebP / GIF), 25 MB blob cap with toast. |
| `imagegeom.ts`  | v1.1 ✅  | Single source of truth for rotation math: `imageCenter`, `rotateAroundPoint`, `rectCorners`, `imageAABB`, `pointInImage`. Explicit `ROTATION_EPSILON = 1e-9` for float-drift-safe fast-paths. |
| `renderimages.ts`| v1.1 ✅ | Per-frame image render pass — viewport cull via rotation-aware AABB, rotation transform, batch-delete dashed outline. Single `renderImages({ images, layer, camera, viewBBox, isMarkedForBatchDelete })` entry point. |
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
| `export/bounds.ts`| M2 / v1.1 ✅ | Compute board bounds + 32 px margin. v1.1 includes rotation-aware image AABBs alongside stroke AABBs. |
| `export/png.ts`   | M2 / v1.1 ✅ | PNG export — detached canvas + `drawStrokeOntoLayer` + `toBlob`. v1.1 decodes images via cache or `ImageStore.loadBlob` and draws them below strokes; `Promise.allSettled` isolates per-image decode failures. |
| `export/svg.ts`   | M2 / v1.1 ✅ | Custom SVG serializer; mask-based `erasedStamps` subtraction. v1.1 emits `<image href="data:…">` elements (z-sorted, rotation-aware AABB cull on visible-scope export, `transform="rotate(deg cx cy)"` for rotated entries). |
| `export/pdf.ts`   | M2 ✅    | PDF export — lazy `jspdf`, PNG embed (inherits image support from PNG path). |
| `export/index.ts` | M2 / v1.1 ✅ | Export dispatcher + filename + download trigger. v1.1 pre-resolves image data-URIs for the SVG path; filename gains seconds (`whiteboard-YYYY-MM-DD-HHMMSS.{ext}`); `onSuccess(format)` toast hook. |
| `sync/`         | 🟡 Deferred | Live collaboration (Y.Doc binding, WebSocket transport, presence) dropped from v1 per ADR 0012. Full design preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](superpowers/specs/2026-05-10-m3-sync-design.md). |
| `ui/`           | 🟡 Deferred | Floating toolbar dropped from v1 per ADR 0011 — right-click + keyboard + side panel cover discovery. |
| `ai/`           | v2 ⬜    | Shape recognition, HTR, math — `transformers.js`.        |

### 2.2 Server (`apps/server`)

Single Bun process. **Stateless at v1.** Two responsibilities:

1. **M0 ✅** Serve static files from `apps/web/dist` with SPA fallback to `index.html`. Hashed assets get `Cache-Control: immutable`.
2. **M0 ✅** Expose `/health` for the container healthcheck.

The originally-planned WebSocket relay, Y.Doc snapshot persistence, and `OWNER_TOKEN` admin gating are **deferred to post-v1** per [ADR 0012](decisions/0012-sharing-deferred.md). The full server-side design is preserved in the [M3 archive](superpowers/specs/2026-05-10-m3-sync-design.md). At v1, the server has no long-lived state — restarts are free, no data volume is required, and the same dist can also be served directly from a static host (e.g., GitHub Pages — see [deployment.md](deployment.md)).

### 2.3 Shared (`packages/shared`)

Types shared between web and server. Includes:

- `Stroke`, `Sample`, `BrushConfig` types.
- Constants: format versions.

(WebSocket message envelope types for the deferred sharing layer are not shipped in v1; they're part of the M3 archive design.)

### 2.4 Persistence

#### Client (M0 ✅)

`apps/web/src/storage.ts` wraps IndexedDB. One database (`whiteboard-local`), one object store (`strokes`), keyed on stroke id. Strokes are written individually on `pointerup` so a power-loss event at most loses the in-flight stroke. Reads on app boot hydrate the committed canvas.

Wrapped behind the `StrokeStore` interface seam (M2.1, `apps/web/src/strokestore.ts`) so the persistence backend can be swapped without touching the orchestrator — preserving the option to attach a future Y.Doc-backed implementation when sharing returns.

#### Server (deferred)

No server-side persistence at v1. The SQLite schema designed for the (deferred) sharing layer — `rooms(id, name, created_at, updated_at)` + `snapshots(room_id, ydoc_blob, ts)` keyed PK with `(room_id, ts DESC)` index — is preserved in the [M3 design archive](superpowers/specs/2026-05-10-m3-sync-design.md) and returns when sharing returns per [ADR 0012](decisions/0012-sharing-deferred.md).

## 3. Network protocol

### 3.1 Static + REST

| Path             | Method | Purpose                          |
|------------------|--------|----------------------------------|
| `/`, `/assets/*` | GET    | Static SPA assets.               |
| `/health`        | GET    | Liveness probe (returns 200).    |

### 3.2 WebSocket

No WebSocket endpoints at v1. The `/yjs/<room-id>` (Y.js sync) and `/presence/<room-id>` (cursor presence) endpoints are part of the deferred sharing design — see the [M3 archive](superpowers/specs/2026-05-10-m3-sync-design.md) and [ADR 0012](decisions/0012-sharing-deferred.md).

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
  startedAt: number          // Date.now() (wall-clock ms) — cross-peer sort key (M2.1)
  deleted?: boolean          // whole-stroke soft-delete (lasso, object-mode eraser)
  erasedStamps?: { x: number; y: number; r: number }[]
                              // pixel-mask eraser (ADR 0009): cursor disks subtracted
                              // from rendered ink at draw time. Sparse — omitted when
                              // the stroke has not been wiped.
}
```

Stored locally as one IDB row per stroke. The schema is CRDT-friendly by design — `deleted` is an append-only flip (M2.1: routed exclusively through the op pipeline), and `erasedStamps` is an append-only list. Both shapes are ready to wrap as `Y.Map` + nested `Y.Array<Y.Map>` if and when sharing returns per [ADR 0012](decisions/0012-sharing-deferred.md).

Coordinates are in **board space** (infinite, unitless), translated to screen space at render time via the camera transform. `erasedStamps` are in board coords too; they re-rasterize correctly through pan / zoom / theme changes alongside the stroke they belong to.

## 5. Deployment topology

One container, one **stateless** process. No volume required at v1. The server listens on `${PORT}` (default 8787) and serves static files.

Sub-path mounting (`BASE_PATH=/whiteboard`) is supported for reverse-proxy deployments. The SPA honors this. See [deployment.md](deployment.md).

There is no horizontal-scale story. A single container is the unit; restarts are free; backups are unnecessary (no server-side state). When sharing returns post-v1, the container gains a SQLite volume and the WebSocket-through-proxy story per the [M3 archive](superpowers/specs/2026-05-10-m3-sync-design.md).

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
| **`StrokeStore` interface seam**  | ✅ Complete    | M2.1; abstracts stroke persistence behind `load/save/delete/clear/onRemoteChange`. Local IDB is the only concrete implementation at v1; preserved as the integration point for a future Y.Doc-backed implementation. |
| **IDB compaction on load**        | ✅ Complete    | M2.1; hard-deletes orphaned tombstones on app boot so deleted strokes don't accumulate. |
| Live collaboration                | 🟡 Deferred    | Dropped from v1 per [ADR 0012](decisions/0012-sharing-deferred.md); full design preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](superpowers/specs/2026-05-10-m3-sync-design.md). |
| Room URLs / owner token           | 🟡 Deferred    | Part of the deferred sharing scope per ADR 0012.        |
| Server-side SQLite snapshots      | 🟡 Deferred    | Part of the deferred sharing scope per ADR 0012.        |
| In-flight stroke crash recovery   | 🟡 Deferred    | Bundled with the deferred sharing scope (M3 archive Decision 9); ships as a small post-v1 milestone if user demand emerges. |
| AI features                       | ❌ Not started | v2 (M5–M7).                                              |
