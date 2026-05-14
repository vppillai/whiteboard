# Whiteboard — Spec v0.1

A low-latency, browser-based whiteboard tuned for Wacom Intuos (indirect input). Offline-first, with single-Docker (or GitHub Pages) deployment. AI features (shape recognition, handwriting → text, math/LaTeX) are scoped to v2 after the drawing core is proven. Live collaboration is post-v1 — see § 5 and [ADR 0012](docs/decisions/0012-sharing-deferred.md).

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
- Fast offline-first: local IndexedDB persistence; PWA-installable at M4.5; no server-side state required at v1.
- Single-command Docker deploy, `.env`-configured. The v1 container is a stateless static file server.
- AI as v2: shape recognition, handwriting → text, math / LaTeX. v1 ships without AI.
- **Live collaboration is post-v1 (deferred per [ADR 0012](docs/decisions/0012-sharing-deferred.md)).** The design is preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md) and listed in § 10 Backlog. Schema and abstraction choices through M2.1 (CRDT-safe `Stroke.startedAt`, ULID IDs, op-pipeline-routed mutations, `StrokeStore` interface seam) keep the future-sharing door open.

### Non-goals

- Procreate / OneNote-grade *feel* — physically impossible on a screenless Intuos. We aim for "best-in-class indirect-input browser drawing."
- Mobile / touch-first design. Drawing on touchscreens works; not optimized for.
- Heavyweight feature set: no layers, no shape libraries, no slide decks, no presentations. This is a whiteboard.
- Per-user accounts, SSO, RBAC. (For the deferred sharing layer, trust is "owner token gates admin REST + URL is the room capability" — see [the M3 design archive](docs/superpowers/specs/2026-05-10-m3-sync-design.md). At v1 there are no accounts and no rooms.)

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                     │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Pointer        │→ │ Stroke engine    │→ │ Canvas       │ │
│  │ pipeline       │  │ (perfect-        │  │ render       │ │
│  │ (coalesced +   │  │  freehand)       │  │ (3-layer)    │ │
│  │  predicted)    │  └──────────────────┘  └──────────────┘ │
│  │                │           │                              │
│  │                │           ▼                              │
│  │                │  ┌──────────────────┐                    │
│  │                │  │ StrokeStore      │ ← interface seam   │
│  │                │  │ (local IDB)      │   for future sync  │
│  │                │  └──────────────────┘                    │
│  └────────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼ https
┌─────────────────────────────────────────────────────────────┐
│ Server (Bun, single process, stateless)                     │
│  ┌──────────────────┐                                       │
│  │ Static files +   │  /, /assets/*, /health                │
│  │ SPA fallback     │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

One container. One stateless process. Static files served from the same process. No server-side persistence; no auth; no WebSocket at v1. Live collaboration (the prior Y.js + WebSocket + SQLite layer) is deferred to post-v1 per [ADR 0012](docs/decisions/0012-sharing-deferred.md).

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
  id: string                       // ULID
  brush: BrushConfig               // snapshot at pointerdown — color may be 'ink' token
  samples: Sample[]
  startedAt: number                // Date.now() (wall-clock ms) — cross-peer sort key
  deleted?: boolean                // soft delete; flag flip, not row removal
  erasedStamps?: {                 // pixel-mask eraser stamps (ADR 0009)
    x: number; y: number; r: number
  }[]
}
```

Stored locally in IndexedDB as one row per stroke. The schema is CRDT-compatible (see § 6 Persistence), preserving the future option to wrap strokes as `Y.Map` when sharing returns per [ADR 0012](docs/decisions/0012-sharing-deferred.md).

## 4. Tools & UX

### 4.1 Tool set (v1)

Brush (Pen), Eraser (two modes — see below), Text, Select (universal selection — single + multi via marquee / Shift+click / Cmd+A; see [ADRs 0014](docs/decisions/0014-select-tool-selection-union.md) + [0016](docs/decisions/0016-lasso-into-select-absorption.md)), Laser, Pan. That's it. The original Lasso tool was absorbed into Select post-v1.2.

> **Eraser model:** the wipe-mode eraser is **segment-level** ("cuts through") — only the part of a stroke the eraser physically passes over disappears; disconnected parts of the original stroke survive as separate live runs. Implemented per [ADR 0008](docs/decisions/0008-segment-eraser.md) via a per-sample mask (`Stroke.erasedSamples`). The object-mode eraser (Shift-modifier or Item pill) is still whole-stroke deletion — surgical removal when you want a stroke gone entirely.

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
| `V` / `S`                      | Select tool (universal — image / text / stroke; single or multi) | ✅     |
| `Space` (hold) + drag          | Pan (any pointer device)                  | ✅     |
| Middle-mouse drag              | Pan                                       | ✅     |
| `1`–`5`                        | Switch to brush preset 1–5                | M1     |
| `[` / `]`                      | Decrease / increase size                  | M1     |
| `Shift+[` / `Shift+]`          | Cycle color palette                       | ✅     |
| `Cmd/Ctrl + E`                 | Export popover (PNG / SVG / PDF)          | ✅     |
| `Cmd/Ctrl + ,`                 | Toggle settings panel                     | ✅     |
| `Cmd/Ctrl + Z`                 | Undo                                      | ✅     |
| `Cmd/Ctrl + Shift + Z`         | Redo (also `Cmd/Ctrl + Y`)                | ✅     |
| `Cmd/Ctrl + 0`                 | Reset zoom                                | ✅     |
| `Cmd/Ctrl + =` / `-`           | Zoom in / out                             | ✅     |
| `Cmd/Ctrl + A`                 | Select all non-deleted objects (activates Select tool) | ✅     |
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

**Deferred to post-v1 per [ADR 0012](docs/decisions/0012-sharing-deferred.md).**

The v1 ship is single-user, single-device — no rooms, no shared URLs, no presence, no server-side state. The complete sharing design (custom y-protocols relay, Y.Doc schema with nested `Y.Array` for `erasedStamps`, server-issued identity hello message, join dialog, lazy-loaded sync chunk, snapshot persistence, owner-token gating) is preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md) as the starting point for a future implementation. The M2.1 schema and abstraction work (`Stroke.startedAt` wall-clock, ULID IDs, op-pipeline-routed mutations, `StrokeStore` interface seam) was made with future sharing in mind and carries forward. See § 10 Backlog for the entry.

## 6. Persistence

- **Client**: IndexedDB. One database (`whiteboard-local`), one object store (`strokes`), keyed on stroke id. Strokes are persisted on `pointerup` so a power-loss event at most loses the in-flight stroke. Reads on app boot hydrate the committed canvas. Wrapped behind the `StrokeStore` interface seam (M2.1) so the persistence backend can be swapped without touching the orchestrator.
- **Server**: None at v1. The Bun process is stateless — it serves static files and a `/health` endpoint. No SQLite, no `DATA_DIR` volume. (Server-side snapshot persistence is part of the deferred sharing design — see § 10 Backlog and [ADR 0012](docs/decisions/0012-sharing-deferred.md).)
- **Export**: PNG (detached canvas + `canvas.toBlob`), SVG (custom serializer with mask-based erasure for `erasedStamps`), PDF (`jsPDF` wrapping a rasterized PNG; SVG-vector PDF deferred). Triggered via right-click → EXPORT or `Cmd/Ctrl+E`. Filename: `whiteboard-YYYY-MM-DD-HHMM.{ext}`. Empty board no-ops with a console warn.
- **Import**: PNG/SVG drop onto canvas places it as a non-editable image layer (read-only in v1).

## 7. AI roadmap (v2)

All three run in-browser via `transformers.js` + WebGPU. Triggered explicitly by the user; never auto.

1. **Shape recognition** — small ONNX classifier on stroke-feature vectors. Select the strokes → press `R` → suggest clean primitive with accept/reject. ~5–10 MB.
2. **Handwriting → text** — runs over the current Select-tool selection. Output is an editable text node. ~30–60 MB. English first.
3. **Math / LaTeX** — separate model, scoped to the current selection. Outputs LaTeX, rendered via KaTeX. ~80–120 MB; lazy-loaded only when invoked.

All three: select → invoke → streamed result → accept/replace or reject. No always-on inference, no telemetry, no cloud fallback.

## 8. Deployment

```
whiteboard/
├── apps/
│   ├── web/            # Vite + TS, vanilla canvas
│   └── server/         # Bun, static file serving (stateless at v1)
├── packages/
│   └── shared/         # types, stroke serialization
├── Dockerfile          # multi-stage: build web → copy into server image
├── docker-compose.yml          # production
├── docker-compose.dev.yml      # dev (hot reload, bind mounts)
├── deploy.sh
└── .env.example
```

`.env.example` at v1:

```
PORT=8787
PUBLIC_ORIGIN=https://draw.example.com
BASE_PATH=/                   # set to /whiteboard for a sub-path mount
LOG_LEVEL=info
```

`deploy.sh` validates `.env`, then runs `docker compose up -d --build`.

The `BASE_PATH` env lets the app live behind a reverse proxy at e.g. `/whiteboard`.

The sharing-related env vars (`OWNER_TOKEN`, `DATA_DIR`, `MAX_ROOMS`, `MAX_BOARD_BLOB_MB`) are deferred along with the sharing feature itself; they return when sharing returns (see [ADR 0012](docs/decisions/0012-sharing-deferred.md) and § 10 Backlog).

## 9. Milestones

| Milestone | Scope                                                                 | Status |
|-----------|-----------------------------------------------------------------------|--------|
| M0        | Drawing core: canvas + perfect-freehand + coalesced events. Latency-validated on Intuos. | ✅ |
| M1        | Predicted events, three-layer render, pressure curve, 5 brushes, undo/redo, pan/zoom, eraser (pixel-mask + object), lasso | ✅ |
| M1.7      | Settings side panel + sync-ready schema (brush presets, custom swatches) | ✅ |
| M2        | Export (PNG/SVG/PDF), distraction-free, palette cycle, pressure-curve UI, first-run hint, predicted-events toggle | ✅ |
| M2.1      | Pre-sharing hardening; `StrokeStore` interface seam; CRDT-safe schema choices; identity scrub | ✅ |
| **v1.0.0** | First production release — offline-first, pen-optimized              | ✅ *(2026-05-11)* |
| M4        | Deployment polish: clean-host validation, reverse-proxy paths, release notes | ⬜ post-v1 |
| M4.5      | PWA install + offline (manifest, service worker, install affordance)  | ⬜ post-v1 |
| M5        | AI v2-a: shape recognition                                            | ⬜ v2 |
| M6        | AI v2-b: HTR                                                          | ⬜ v2 |
| M7        | AI v2-c: math/LaTeX                                                   | ⬜ v2 |

The original M3 (live collaboration) is deferred to the post-v1 backlog (§ 10) per [ADR 0012](docs/decisions/0012-sharing-deferred.md). The design archive is preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md).

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
- ~~**Anonymous user names**: server-issued vs client-generated~~: resolved in the deferred sharing archive — server-issued from an "Adjective-Animal" corpus via a pre-protocol hello frame, user-editable in the join dialog. Re-confirm when sharing returns. See [the M3 design archive](docs/superpowers/specs/2026-05-10-m3-sync-design.md) and [ADR 0012](docs/decisions/0012-sharing-deferred.md).

### Backlog (post-v1; tracked, not committed)

- **Live collaboration (the deferred M3).** Multi-user shared boards over WebSocket with CRDT semantics, link-based sharing, ephemeral presence (cursors + names), and SQLite snapshot persistence. Deferred from v1 per [ADR 0012](docs/decisions/0012-sharing-deferred.md). **Full design preserved** at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](docs/superpowers/specs/2026-05-10-m3-sync-design.md) — 17 locked decisions covering: custom y-protocols relay (vs y-websocket server util), Y.Doc schema (nested `Y.Array<Y.Map>` for `erasedStamps`), Y.Awareness presence on `/yjs/<room-id>` (single WS, no separate `/presence` channel), URL-as-capability auth with single global `OWNER_TOKEN` gating REST admin only, ULID room IDs (not UUIDv7), share-gated entry with lazy sync chunk (~75 KB gz), pre-protocol hello-frame for server-issued identity proposal, join dialog (name + color + "bring N strokes" toggle for room creator), server-side snapshots (30 s idle + last-disconnect; keep latest 3), `MAX_ROOMS=500` cap with 429 on overflow, hybrid undo (local Op-stack + `Y.UndoManager` in shared mode behind same `Op` interface), reconnect toasts, `whiteboard:share-pending` interrupt-safety flag, and a five-phase implementation plan (M3-A through M3-E). **v1 schema and abstraction choices already preserve the future-sharing door** — `Stroke.startedAt` is wall-clock (M2.1), `Stroke.id` is ULID (M0), object-erase routes through the op pipeline (M2.1), `erasedStamps` are append-only (ready to wrap as `Y.Array`), and the `StrokeStore` interface seam (M2.1) is the single integration point for the future Y.Doc-backed implementation. Trigger: real user demand for multi-user editing, or a contributor with the capacity to implement and operate the stateful server runtime.
- **In-flight stroke crash recovery.** Bundled into the deferred M3 design (Decision 9 in the archive): ~2 s autosave of the active stroke to a localStorage slot, with a restore-on-boot prompt. Tenet-aligned, ~50 LOC, works in both modes. Held back from v1 to keep the surface tight; ship as a small standalone milestone if a user-facing pain emerges. Implementation hook: `stroke.ts` + `tools/pen.ts` `pointerdown`/`pointerup` hooks.
- **Screen-tablet support.** Re-enable predicted events for direct-input devices (iPad Pencil, Wacom MobileStudio, Surface Pro pen) where prediction is a clear win. Likely shape: a per-device-class preference exposed via the M2 settings panel, defaulting to off for indirect input and on for direct input. Trigger: a user with a screen tablet asks.
- **Performance under stroke count.** The current 2D-canvas + perfect-freehand rasterizes each stroke on the CPU (~1 ms each). Pan / zoom redraws all committed strokes; at ~500+ strokes this is the WebGL trigger. Track in `?perftest=scale` (planned at M1).
- ~~**Paste image, draw on top.**~~ Shipped at v1.1.0 — `Cmd/Ctrl+V` (and drag-drop) places PNG / JPEG / WebP / GIF images below the strokes layer; Select tool (`V`) drives move / resize / rotate / delete. Blob persistence lives in a sibling `images-blob` IDB store. The discriminated-union framing did NOT happen — instead, `BoardObject` ships in `packages/shared/src/types.ts` as a structural base interface that `ImageObject` and `TextObject` extend; `Stroke` stays outside (sample-driven, not rect-driven). When sharing returns, the binary-sync story for image blobs is the outstanding piece (out-of-band via WebSocket rather than in-Y.Doc), tracked as the M5.1 image-binaries scope in [ADR 0012](docs/decisions/0012-sharing-deferred.md).
- ~~**First-class text.**~~ Shipped at v1.2.0 — `T` activates the Text tool, contenteditable DOM overlay handles input, `create-text` / `edit-text` / `transform-text` / `rotate-text` / `delete-text` ops on the standard undo pipeline, wrap-width per object, Cmd+B/I/U for object-level format. Text payloads persist inline in the new `texts` IDB store (DB v3). Select tool extended to the third variant in its discriminated union (`'image' | 'text'` → `'image' | 'text' | 'stroke'` in v1.2 post-release). See [ADRs 0013–0015](docs/decisions/) for the design.
- ~~**Whiteboard-native clipboard round-trip.**~~ Shipped post-v1.2 — strokes and texts paste back as live vectors inside the whiteboard via a dual-slot clipboard format (`image/png` for external apps + `text/html` carrying `data-whiteboard-v1` for whiteboard-internal paste). Relative layout preserved via a bundle-origin field; freshly id'd on paste so source + paste can coexist. Selections containing images fall back to PNG-only (image-bytes round-trip deferred — likely a separate blob slot or M3 server-side handoff). DoS caps at 5000 strokes / 5000 texts / 50000 samples per stroke. See [ADR 0017](docs/decisions/0017-whiteboard-native-clipboard-format.md).
- ~~**`transform-many` composite op.**~~ Shipped post-v1.2 — multi-object move drags now emit a single composite op carrying per-item before/after transforms (image / text rects + stroke dx/dy deltas) instead of N independent per-item ops. One undo step reverses the whole group move; M3 sync prep — one transaction + one wire update per peer per gesture instead of N. Resize / rotation intentionally stay single-object (heterogeneous-group resize lacks a coherent UX).
- **Backend sync of user settings.** M1.7 (see milestones) establishes a sync-ready settings schema (versioned, ID-keyed, with reserved `syncedAt` / `remoteId` fields) but no backend. After v1 ship, when there's a notion of "user login" and the server gains a settings store, the local settings layer gets a sync delegate that pushes / pulls without changing the schema. Conflict policy is out of scope until the feature is staffed.
- **iPad / Apple Pencil first-class.** Touch input works today via Pointer Events; pinch-zoom does too. A polished iPad experience — palm rejection, larger pen-friendly hit targets in popovers, prediction enabled for direct-input devices (per ADR 0004), Pencil-specific tilt and barrel-roll where supported — would be a meaningful audience expansion. Not on the v1 critical path; pick it up if there's user demand or iPad-specific quirks surface during v1 dogfooding.
- **Multi-board / boards list.** Currently the app holds a single board in IDB. Multiple named boards with switcher UI, rename, delete, last-modified timestamps — useful, but a real scope addition: new data model, new persistence boundary, future implications if the deferred sharing layer returns (each board would map to its own room). Defer until single-board usage proves the limit.
- **Mini-map.** A small overview of all strokes on the infinite canvas with a viewport indicator. Helps the "I scrolled and can't find my stuff" problem; partially mitigated by zoom-to-fit at M1. Reassess if zoom-to-fit doesn't cover the use case.
- **Mobile / touch UX.** Currently a non-goal. Touch *works* (pointer events handle it) but is not optimized. Reassess if a use case emerges or once the iPad / Apple Pencil item lands.
- **Accessibility.** Currently silent. Keyboard-only navigation is largely covered (every action has a shortcut), but ARIA / focus management for the eventual toolbar is not. Address as part of M2's UI work.
- **Wacom pen eraser-end auto-detect.** Many Wacom styluses (Pro Pen 2 / 3D, Art Pen, Grip Pen) have a physical eraser nub on the back; flipping the pen reports `pointerType === 'pen'` with `e.button === 5` / `(e.buttons & 32) !== 0`. The natural behavior: flipping → spring-loaded eraser tool, like hold-`E` but driven by hardware. Skipped from M1's critical path because the project owner's current Wacom model doesn't expose this signal. Likely shape when picked up: a small `eraserpen.ts` module mirroring `eraserhold.ts` / `pan.ts`, watching `pointerdown` for the eraser button bit and swapping `tool.current` while the eraser end is engaged. Composes with hold-`E` (whichever signal is active wins; both released → revert to underlying tool). Trigger: a user with the right hardware asks, or the project acquires a compatible pen.
