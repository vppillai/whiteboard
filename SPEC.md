# Whiteboard — Spec v0.1

A low-latency, browser-based whiteboard tuned for Wacom Intuos (indirect input), with link-based live collaboration and a single-Docker deployment story. AI features (shape recognition, handwriting → text, math/LaTeX) are scoped to v2 after the drawing core is proven.

> This document is the **product spec**. For "as-built" architecture, see [docs/architecture.md](docs/architecture.md). For milestones and exit criteria, see [docs/milestones.md](docs/milestones.md).

## 0. Tenets

> **Snappy, sleek, user-friendly are paramount.**

When a feature trades latency, visual minimalism, or pen-friendliness for capability, it loses. This is the ground truth that overrides everything below it:

- **Latency wins.** The drawing pipeline gets first-class engineering attention; everything else fits around it. A milestone that ships features but degrades feel is a regression, not progress — feel-test on target hardware (Wacom Intuos) is a milestone-close gate.
- **Visual minimalism is functional.** Less chrome = less cognitive load = faster to think on the canvas. Things that don't help drawing don't ship at all, or ship hidden by default.
- **Pen-friendly takes precedence** over mouse / keyboard convenience. If the pen path is awkward, fix it even if it makes the keyboard path slightly less direct.
- **Cleanups are part of the deliverable.** Architectural debt that produces sluggishness, glitches, or muddled state is treated as a milestone-critical bug, not a "later" item.
- **Discovery via shortcuts and tooltips, not tutorials.** New users figure things out by trying, not by reading. The right-click tool menu, the `?` help overlay, the keyboard shortcuts, and the settings panel (`Cmd/Ctrl + ,`) are first-class onboarding surfaces. Walkthroughs and intro modals are not.
- **The architecture enforces the tenet.** "Snappy" isn't asserted in a checklist — it's a structural property of the build: pointer dispatch is sync; the live layer renders inside the input handler (not RAF); each tool owns its render so cross-tool concerns can't accumulate latency; perfect-freehand math is cached per stroke; the committed layer culls off-viewport strokes; every contextual menu section is owned by the surface that needs it (so menus can't grow into walls of pills). When a regression appears, the fix lives in the layer that owns it — not as a special-case in main.

These aren't aspirational bullets. They are the test every design decision in this project is held against.

## 1. Goals & non-goals

### Goals

- Lowest pen-to-photon latency achievable in a browser, tuned for Wacom Intuos (indirect input).
- Drawing-first UX: instant tool/color/size changes via right-click menu + dense keyboard shortcuts. No persistent chrome above the canvas (per [ADR 0011](docs/decisions/0011-toolbar-deferred.md)).
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

Brush, Eraser (two modes — see below), Lasso-select, Pan, Color-eyedropper. That's it.

> **Eraser model:** the wipe-mode eraser is **segment-level** ("cuts through") — only the part of a stroke the eraser physically passes over disappears; disconnected parts of the original stroke survive as separate live runs. Implemented per [ADR 0008](docs/decisions/0008-segment-eraser.md) via a per-sample mask (`Stroke.erasedSamples`). The object-mode eraser (Shift-modifier or Item pill) is still whole-stroke deletion — surgical removal when you want a stroke gone entirely.

> **Color eyedropper** activated via `I` (modal tool, ADR 0007 conformance). Samples color from the strokes offscreen layer at the cursor pixel; on pointerdown commits to the active brush color and reverts to the previous tool. Grid pixels live on the committed layer and never sample (clean by construction). Implemented at M2.

### 4.2 Discovery surfaces

No persistent toolbar above the canvas. Per-action discovery is covered by:

- **Right-click context menu** (M1.5 → M1): COLOR · BRUSH · TOOL · VIEW · EXPORT · SETTINGS sections. Per-tool sections own themselves (ADR 0007).
- **Keyboard shortcuts** (§ 4.3): every action has a single-keystroke or chord path.
- **Color picker popover** (M1.5): `C` opens at cursor with curated + custom + recent colors.
- **Settings side panel** (M1.7 + M2): brush preset tuning, custom swatches, theme, grid, advanced knobs, pressure curves, predicted-events toggle.
- **First-run hint** (M2): empty-board guidance "Right-click for tools · ? for help" fades on first stroke; never shown again.

The original toolbar commitment was retired during M2 brainstorming on tenet grounds (less chrome = less cognitive load). See [ADR 0011](docs/decisions/0011-toolbar-deferred.md) for the full rationale and considered alternatives.

### 4.3 Keyboard shortcuts

✅ marks shortcuts wired in M0; the rest land in M1 / M2 alongside their tools.

| Key                            | Action                                    | Status |
|--------------------------------|-------------------------------------------|--------|
| `B`                            | Draw tool (keep current brush preset)     | ✅     |
| `P`                            | Draw tool + Pen brush preset              | ✅     |
| `E` (hold)                     | Spring-loaded eraser — release reverts    | ✅     |
| `Shift + E`                    | Sticky eraser (toggle to eraser tool)     | ✅     |
| `S`                            | Select (lasso)                            | ✅     |
| `Space` (hold) + drag          | Pan (any pointer device)                  | ✅     |
| Middle-mouse drag              | Pan                                       | ✅     |
| `1`–`5`                        | Switch to brush preset 1–5                | M1     |
| `[` / `]`                      | Decrease / increase size                  | M1     |
| `Shift+[` / `Shift+]`          | Cycle color palette                       | ✅     |
| `I`                            | Color eyedropper                          | ✅     |
| `Cmd/Ctrl + E`                 | Export popover (PNG / SVG / PDF)          | ✅     |
| `Cmd/Ctrl + ,`                 | Toggle settings panel                     | ✅     |
| `Cmd/Ctrl + Z`                 | Undo                                      | ✅     |
| `Cmd/Ctrl + Shift + Z`         | Redo (also `Cmd/Ctrl + Y`)                | ✅     |
| `Cmd/Ctrl + 0`                 | Reset zoom                                | ✅     |
| `Cmd/Ctrl + =` / `-`           | Zoom in / out                             | ✅     |
| `Cmd/Ctrl + A`                 | Select all (activates lasso)              | ✅     |
| `Delete` / `Backspace`         | Delete selected                           | ✅     |
| `Cmd/Ctrl + Shift + K`         | Clear board (confirm twice within 3 s)    | ✅     |
| `M`                            | Toggle metrics HUD                        | ✅     |
| `T`                            | Cycle theme (system → light → dark)       | ✅     |
| `F`                            | Toggle distraction-free (hide app chrome) | ✅     |
| `?`                            | Toggle shortcut help overlay              | ✅     |
| `Esc`                          | Cancel pending action (e.g. clear-confirm)| ✅     |

### 4.4 Pressure curve UI

In the settings panel's Brush presets section, each brush card shows a 30 × 18 px curve thumbnail next to its title. Click expands the card with a 200 × 120 px draggable-midpoint graph + 120 × 80 px test-stroke pad. Saved per-brush via `presets[brushId].pressureCurve?: { mid: [number, number] }` — sparse override of `pressureGamma`. The bezier representation (quadratic through-point at `mid` in normalized 0–1 coords) subsumes γ as a specific shape; γ continues to apply when no override exists.

The thumbnail itself is the override-presence indicator: γ-shape vs bent. Changing brush presets between sessions is glance-readable in the panel.

## 5. Collaboration

- **Room URL**: `/b/<uuid-base32>`. UUIDv7 → unguessable, sortable.
- **Trust**: anyone with the URL can draw + view. `?token=<OWNER_TOKEN>` (constant-time-compared on the server) unlocks: rename, delete, export-all, settings.
- **Sync**: Y.js doc per room. Per-sample updates stay local; a stroke is added to the Y.Array on `pointerup` only.
- **Presence**: ephemeral — peer cursors, name, color. Not persisted. Names: random "Adjective-Animal" by default, editable.
- **Capacity target**: 16 concurrent peers per room. Beyond, perf likely fine but UX (cursor crowd) degrades.

## 6. Persistence

- **Server**: SQLite. Snapshot the Y.doc to a blob column every 30 s of idle or on last-disconnect. On room load, hydrate from latest snapshot, then apply ws updates.
- **Client**: IndexedDB caches the Y.doc via `y-indexeddb`. Offline = keep drawing; reconnect = CRDT merges.
- **Export**: PNG (detached canvas + `canvas.toBlob`), SVG (custom serializer with mask-based erasure for `erasedStamps`), PDF (`jsPDF` wrapping a rasterized PNG; SVG-vector PDF deferred). Triggered via right-click → EXPORT or `Cmd/Ctrl+E`. Filename: `whiteboard-YYYY-MM-DD-HHMM.{ext}`. Empty board no-ops with a console warn (M2 future-work: surface "Nothing to export" toast).
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

- ~~**Toolbar UI framework**~~: dropped — toolbar deferred from v1 per [ADR 0011](docs/decisions/0011-toolbar-deferred.md). The settings panel + right-click + keyboard surfaces cover the discovery and one-click paths.
- **Anonymous user names**: server-issued vs client-generated. Decide at M3.

### Backlog (post-v1; tracked, not committed)

- **Screen-tablet support.** Re-enable predicted events for direct-input devices (iPad Pencil, Wacom MobileStudio, Surface Pro pen) where prediction is a clear win. Likely shape: a per-device-class preference exposed via the M2 settings panel, defaulting to off for indirect input and on for direct input. Trigger: a user with a screen tablet asks.
- **Performance under stroke count.** The current 2D-canvas + perfect-freehand rasterizes each stroke on the CPU (~1 ms each). Pan / zoom redraws all committed strokes; at ~500+ strokes this is the WebGL trigger. Track in `?perftest=scale` (planned at M1).
- **Paste image, draw on top.** User intent: `Cmd/Ctrl+V` a screenshot or image into the board; image appears as a non-editable layer; pen strokes draw on top. Implications: a new object kind in the data model (image vs stroke), an image rendering layer between the grid and the strokes, Blob persistence in IndexedDB, and at M3 a binary-data sync story (likely out-of-band via the WebSocket relay rather than encoded into the Y.Doc to avoid bloating CRDT updates). Likely lands as a discrete milestone post-v1 ship; placeholder name **M5.1: image-paste**. The current `Stroke` type doesn't accommodate this — when we get here, an ADR formalizes a `BoardObject = Stroke | ImageObject` discriminated union and rerouting through that.
- **Backend sync of user settings.** M1.7 (see milestones) establishes a sync-ready settings schema (versioned, ID-keyed, with reserved `syncedAt` / `remoteId` fields) but no backend. After v1 ship, when there's a notion of "user login" and the server gains a settings store, the local settings layer gets a sync delegate that pushes / pulls without changing the schema. Conflict policy is out of scope until the feature is staffed.
- **iPad / Apple Pencil first-class.** Touch input works today via Pointer Events; pinch-zoom does too. A polished iPad experience — palm rejection, larger pen-friendly hit targets in popovers, prediction enabled for direct-input devices (per ADR 0004), Pencil-specific tilt and barrel-roll where supported — would be a meaningful audience expansion. Not on the v1 critical path; pick it up if there's user demand or iPad-specific quirks surface during v1 dogfooding.
- **Multi-board / boards list.** Currently the app holds a single board in IDB. Multiple named boards with switcher UI, rename, delete, last-modified timestamps — useful, but a real scope addition: new data model, new persistence boundary, future sync implications at M3. Defer until single-board usage proves the limit.
- **Mini-map.** A small overview of all strokes on the infinite canvas with a viewport indicator. Helps the "I scrolled and can't find my stuff" problem; partially mitigated by zoom-to-fit at M1. Reassess if zoom-to-fit doesn't cover the use case.
- **Mobile / touch UX.** Currently a non-goal. Touch *works* (pointer events handle it) but is not optimized. Reassess if a use case emerges or once the iPad / Apple Pencil item lands.
- **Accessibility.** Currently silent. Keyboard-only navigation is largely covered (every action has a shortcut), but ARIA / focus management for the eventual toolbar is not. Address as part of M2's UI work.
- **Wacom pen eraser-end auto-detect.** Many Wacom styluses (Pro Pen 2 / 3D, Art Pen, Grip Pen) have a physical eraser nub on the back; flipping the pen reports `pointerType === 'pen'` with `e.button === 5` / `(e.buttons & 32) !== 0`. The natural behavior: flipping → spring-loaded eraser tool, like hold-`E` but driven by hardware. Skipped from M1's critical path because the project owner's current Wacom model doesn't expose this signal. Likely shape when picked up: a small `eraserpen.ts` module mirroring `eraserhold.ts` / `pan.ts`, watching `pointerdown` for the eraser button bit and swapping `tool.current` while the eraser end is engaged. Composes with hold-`E` (whichever signal is active wins; both released → revert to underlying tool). Trigger: a user with the right hardware asks, or the project acquires a compatible pen.
