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

Key submodules (planned):

| Module          | Responsibility                                           |
|-----------------|----------------------------------------------------------|
| `pointer/`      | Pointer pipeline; coalesced + predicted event handling.  |
| `stroke/`       | Stroke geometry via `perfect-freehand`; pressure curve.  |
| `render/`       | Two-canvas render loop; pan / zoom; HUD.                 |
| `tools/`        | Brush, eraser, lasso, pan tool implementations.          |
| `ui/`           | Floating toolbar, palette, settings, shortcut help.      |
| `sync/`         | Y.Doc binding; ws transport; presence.                   |
| `storage/`      | IndexedDB persistence via `y-indexeddb`.                 |
| `export/`       | PNG / SVG / PDF serialization.                           |
| `ai/`           | (v2) shape recognition, HTR, math — `transformers.js`.   |

### 2.2 Server (`apps/server`)

Single Bun process. Responsibilities:

1. Serve static files from `apps/web/dist`.
2. Handle WebSocket upgrades for `/yjs/<room-id>`; forward Y.js updates between peers in the same room.
3. Snapshot each room's Y.Doc to SQLite on idle / disconnect.
4. Validate `OWNER_TOKEN` for admin actions (rename, delete, export-all).
5. Expose `/health` for the container healthcheck.

The server holds Y.Docs in-memory only as long as a room has active peers. Cold rooms are evicted and rehydrated from SQLite on the next connect.

### 2.3 Shared (`packages/shared`)

Types and protocol shared between web and server. Includes:

- `Stroke`, `Sample` types.
- WebSocket message envelope types (auth, presence, room-meta — outside of the Y.js protocol itself, which is binary).
- Constants: limits, format versions.

### 2.4 Persistence

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

type Stroke = {
  id: string                // ULID
  brushId: 'pen' | 'marker' | 'pencil' | 'highlighter' | 'brush'
  color: string             // #rrggbb or #rrggbbaa
  size: number              // base px at zoom 1
  samples: Sample[]
  deleted?: boolean         // soft delete; CRDT-friendly undo
  authorId: string          // ephemeral peer id
  createdAt: number
}
```

Stored in Y.js as `Y.Array<Y.Map>`. Append-only; erase and undo set `deleted: true` rather than removing.

Coordinates are in **board space** (infinite, unitless), translated to screen space at render time via the camera transform.

## 5. Deployment topology

One container, one process, one SQLite file mounted on a Docker volume. The server listens on `${PORT}` (default 8787) and serves both static and WebSocket from the same port.

Sub-path mounting (`BASE_PATH=/whiteboard`) is supported for reverse-proxy deployments. Both the SPA and the WebSocket endpoints honor this. See [deployment.md](deployment.md).

There is no horizontal-scale story. A single container is the unit; if you need more, run more (one per tenancy) behind a router.

---

## 6. As-built status

This section reflects what is *actually in the code right now*. It is updated at each milestone close.

| Component              | Status         | Notes                                              |
|------------------------|----------------|----------------------------------------------------|
| Workspace layout       | ✅ Complete    | Bun workspaces; web / server / shared.             |
| Build pipeline         | ✅ Complete    | Vite (web) + Bun direct (server). `bun run build`. |
| Lint / format          | ✅ Complete    | Biome.                                             |
| Docker (production)    | ✅ Complete    | Multi-stage Dockerfile + compose; healthcheck.     |
| Docker (dev)           | ✅ Complete    | Bind-mount + watch dev compose.                    |
| CI                     | ✅ Complete    | GitHub Actions: lint + typecheck on push / PR.     |
| Pre-commit hooks       | ✅ Complete    | Biome check on staged files.                       |
| Static file serving    | ❌ Not started | Server is a placeholder. Lands at M3 / M4.         |
| Drawing core           | ❌ Not started | M0.                                                |
| Brushes / tools        | ❌ Not started | M1 / M2.                                           |
| Toolbar / shortcuts    | ❌ Not started | M2.                                                |
| Local persistence      | ❌ Not started | M2.                                                |
| Live collaboration     | ❌ Not started | M3.                                                |
| Room URLs / auth       | ❌ Not started | M3.                                                |
| Export                 | ❌ Not started | M2.                                                |
| AI features            | ❌ Not started | v2 (M5–M7).                                        |
