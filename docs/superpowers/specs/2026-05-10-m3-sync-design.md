# M3 — Server, sync, room URLs

> **🟡 STATUS: DEFERRED FROM v1**
>
> This spec was brainstormed and written on 2026-05-10 to close all 16 open decisions from the M3 prep doc plus a 17th (undo scope) raised at brainstorm time. Hours later, the project owner reassessed the sharing scope against the SPEC § 0 tenet ("snappy, sleek, user-friendly are paramount") and chose to **defer the entire sharing feature from v1**. The decision is captured in [ADR 0012 — Sharing deferred from v1](../../decisions/0012-sharing-deferred.md).
>
> This document is preserved as the **design archive** for a future sharing implementation. When sharing eventually returns, this is the starting point — not a fresh brainstorm. The 17 locked decisions, the Y.Doc schema, the protocol design, the UX flows, the implementation phasing, and the risk register all carry forward. ADR numbers (0012–0015) referenced below are the originally-anticipated assignments; the actual ADR 0012 is now the deferral decision, so the future un-deferral ADR set will use whatever numbers are next available at that time.
>
> The v1 path is M2.1 → M4 (deployment polish) → M4.5 (PWA install) → tag `v1.0.0`. See [milestones.md](../../milestones.md) for the current state.

---

**Date:** 2026-05-10 (deferred same day)
**Status:** Design archive — preserved for future implementation; **not** the current direction.
**Milestone:** M3 (deferred — see [ADR 0012](../../decisions/0012-sharing-deferred.md))
**Pre-brainstorm input:** [2026-05-10-m3-prep.md](2026-05-10-m3-prep.md) — 16 open decisions enumerated; this spec closes them and adds Decision 17 (undo scope) raised at brainstorm time.
**Originally-anticipated ADRs** (to be re-numbered when sharing returns):
- ADR — Custom y-protocols relay (server)
- ADR — Y.Doc schema (nested Y.Array for erasedStamps; CRDT correctness)
- ADR — Y.Awareness presence on `/yjs/<room-id>` (revises architecture.md § 3.2)
- ADR — Hybrid undo: Op-stack in local mode, Y.UndoManager in shared mode

## 1. Goal

Ship the collaboration layer **without compromising the lightweight local experience**. Local mode (`/`) stays exactly as today — no Y.js bundle, no WebSocket, no awareness, no extra IDB stores. Sharing is opt-in: a right-click `SHARE` action (or `Cmd/Ctrl+Shift+S`) generates a room URL, lazy-imports the sync bundle, and transitions the active document into a Y.Doc-backed shared room. A small "join" dialog lets the user pick their name and color before broadcasting awareness. Late joiners hydrate from a SQLite snapshot then merge live updates. Tab-crash recovery saves in-flight strokes to localStorage every ~2 s. Total bundle in local mode stays under ~35 KB gz; shared-mode bundle (lazy chunk) adds ~75 KB gz on first share.

## 2. Locked decisions

Captured during brainstorming (2026-05-10):

| Decision | Lock |
|---|---|
| **(1) Server relay implementation** | **Custom y-protocols relay** (ADR 0012). ~400–500 LOC in `apps/server`. Pure JS dep on `y-protocols`; no `y-websocket` server utility (Node `ws` API mismatch with Bun's `ServerWebSocket` callback model). Full control of room lifecycle, snapshot triggers, peer eviction, `MAX_ROOMS` enforcement. |
| **(2) Auth model** | **URL = draw+view; token = admin only.** WebSocket upgrade is open (UUID/ULID is the capability; ~80 bits of entropy is unguessable). `POST` / `PATCH` / `DELETE /api/rooms/:id` require `?token=<OWNER_TOKEN>` in query string, constant-time compared. SPEC § 5 as-written. |
| **(3) Room creation flow** | **Client-generated ID → navigate → server auto-creates on first WS connect.** No round-trip on share click. The `POST /api/rooms` REST endpoint exists for programmatic/admin use but is **not** on the UX path. |
| **(3b) Share action UI** | **Right-click context menu, new SHARE row** (sibling of COLOR / BRUSH / TOOL / VIEW / EXPORT / SETTINGS). Keyboard shortcut `Cmd/Ctrl+Shift+S`. Discoverable via right-click + `?`-help overlay. No persistent chrome (tenet). When already in shared mode, SHARE copies the current URL to the clipboard with a 2 s toast. |
| **(4) Room rename in M3** | **Deferred.** M3 ships only `DELETE /api/rooms/:id` as the admin REST mutation. Room name set at creation (default `"Untitled — <date>"`). `PATCH` is documented as M4 scope. |
| **(5) Y.Doc init race** | **Synchronous SQLite load + Map.set before handshake**, relying on Bun's single-threaded event loop. Explicit code comment documents the assumption — any future multi-threaded evolution (Bun Workers etc.) triggers a review (Decision 5 upgrade path: per-room `Promise<YDoc>`). |
| **(6) `erasedStamps` CRDT representation** | **Nested `Y.Array<Y.Map>` inside the stroke's `Y.Map`** (ADR 0013). Concurrent stamp appends merge correctly under CRDT semantics. `packages/shared` typed wrappers structurally prevent accidental plain-array storage. Zero runtime overhead. |
| **(7) Presence channel** | **Minimal presence on Y.Awareness** (ADR 0014). Y.Awareness travels on the same `/yjs/<room-id>` WebSocket. Eliminates the architecture.md § 3.2 `/presence/<room-id>` JSON channel. UI surface: cursor dot + name label rendered immediately below the dot, **shown whenever the peer's cursor is on-canvas** (the label tracks the dot, not "always shown even when peer pointer left the canvas" — when `cursor: null`, both dot and label hide together). No persistent avatar pills. |
| **(7b) Identity proposal** | **Server-issued via pre-protocol hello message; user confirms in join dialog.** Server holds the "Adjective-Animal" corpus + a fixed 16-color presence palette. On WS upgrade, server sends a JSON `hello` text frame with `{proposedName, proposedColor, takenColors[], isFirstPeer}`. Client shows a small join dialog pre-filled with the proposals; user accepts or edits. On confirm, client sends a `hello-ack` JSON text frame; server begins relaying y-protocols binary frames. |
| **(8) Reconnect UX** | **Transient informational toast on state change.** ~3 s toast on disconnect: *"Offline — drawing locally."* ~2 s toast on reconnect: *"Reconnected."* Drawing never blocked. Uses the existing `clearflow.ts` toast host in informational mode. |
| **(9) In-flight stroke crash recovery** | **localStorage slot, restore-on-boot prompt.** During an active stroke, every ~2 s write `{strokeId, samples, brush, startedAt}` to `whiteboard:stroke-wip`. Clear on `pointerup`. On boot, if non-empty: show small prompt *"Restore unfinished stroke?"* with Restore / Discard actions. Works in **both** local and shared mode (in-flight samples never reach Y.Doc). |
| **(10) Share with existing canvas** | **Join dialog adds a "Bring N strokes" toggle for the room creator only** (default ON when local IDB is non-empty). Joiners (clicking a peer's URL) don't see this row. Flat-IDB at `/` is **not** destroyed — the local board persists for `/` use after the share. |
| **(10b) Interrupted copy safety** | **`whiteboard:share-pending: { roomId }` localStorage flag.** Set before strokes are written into the Y.Doc; cleared on success. On boot, if flag exists for the current `/b/<id>`: wipe that room's y-indexeddb store and redo the copy from flat-IDB. Flat-IDB is the source of truth; copy is idempotent. |
| **(11) Anonymous user names** | **Folded into (7b).** Server-issued from a "Adjective-Animal" corpus held in `apps/server/src/identitycorpus.ts`. User can edit at join. localStorage `whiteboard:peer-name` remembers across sessions; on reconnect the remembered name is sent in `hello-ack` instead of accepting the server's proposal. |
| **(12) Snapshot pruning** | **Keep latest 3, synchronous prune on snapshot write.** ~90 s recovery window at 30 s cadence. `DELETE FROM snapshots WHERE room_id=? AND ts NOT IN (SELECT ts FROM snapshots WHERE room_id=? ORDER BY ts DESC LIMIT 3)` — sub-millisecond in `bun:sqlite`. |
| **(13) Y.js version + encoding** | **Pin `yjs@13.6.x`**; `Y.encodeStateAsUpdate` V1 encoding for snapshots (per architecture.md). Snapshot blob size is not a constraint at M3; revisit V2 only if monitoring shows real need. Versions recorded in ADR 0003 as a dated addendum at M3 close. |
| **(14) Room ID format** | **ULID** (relaxes SPEC § 5 "UUIDv7" wording). ULID is already in the repo (used for `Stroke.id`); same useful properties — sortable, unguessable, base32-encoded. Zero new dependency. SPEC § 5 wording updated as part of the M3 closing docs pass. |
| **(15) MAX_ROOMS enforcement** | **Manual delete only; `POST /api/rooms` returns 429 when MAX_ROOMS hit.** Admin uses `DELETE /api/rooms/:id` with the owner token to free space. `ROOM_TTL_DAYS` env var deferred to M4 polish if needed. Documented in deployment.md. |
| **(16) Client routing** | **URL-based branching in `apps/web/src/sync/index.ts`.** `main.ts` reads `location.pathname` on boot; if it starts with `/b/`, **dynamically imports** `./sync/index.ts` (separate Vite chunk) and enters shared mode. Otherwise enters local mode (today's behavior unchanged). No router library. The sync chunk contains yjs + y-protocols + y-indexeddb + the Y.UndoManager seam + awareness handlers. |
| **(17) Undo scope in shared mode** | **Two undo systems behind the existing `Op` interface (ADR 0015).** Local mode: current `undoStack: Op[]` (ADR 0006) unchanged. Shared mode: each `Op.apply()` wraps its body in `Y.Doc.transact(fn, origin=myClientId)`; `Y.UndoManager` (yjs core, no extra bundle) observes by origin and provides correct CRDT-aware undo for that client's transactions only. `Cmd+Z` dispatches to whichever undo backend is active for the mode. |
| **(NEW) Local-by-default** | **Sharing is opt-in.** The local `/` route loads no sync code — no yjs, no y-websocket, no y-indexeddb, no awareness, no join dialog. The lightweight local feel is preserved. This is the controlling constraint behind (3), (10), and (16). |

## 3. Non-goals

Out of scope for M3; tracked in § 11:

- **Room rename UI** — deferred (Decision 4).
- **Image paste / binary sync** — confirmed M5.1 (SPEC § 10 Backlog).
- **Multi-board switcher UI / "boards list"** — SPEC § 10 Backlog.
- **User accounts / SSO / RBAC** — SPEC § 1 Non-goals (permanent).
- **PWA install + service worker** — M4.5.
- **Room idle TTL / auto-delete** — M4 polish or later (Decision 15 upgrade).
- **Persistent avatar pills / connected-peer chrome** — explicitly out (tenet); cursor + name label is the entire UI surface.
- **Per-peer write/read access control** — URL is the capability (Decision 2A); finer-grained roles are deferred.
- **Server-issued shareable owner-token URLs** — single global `OWNER_TOKEN` env var stays (SPEC § 8).
- **WebSocket-level rate limiting / DDoS protection** — out for self-hosted v1; reverse-proxy concern.
- **`MAX_BOARD_BLOB_MB` enforcement beyond a log warning at 80% + skip-write at 100%** — same defensive minimum as the prep doc R4 risk; full quota UX deferred.
- **Eyedropper-style peer-cursor color sampling** — not a thing.

## 4. Architecture

### 4.1 New primitives

M3 introduces three architectural primitives:

1. **Custom y-protocols relay** (server-side `apps/server/src/sync/`) — a small (~500 LOC) WebSocket relay over `Bun.serve` + `bun:sqlite`. Holds in-memory `Map<roomId, RoomState>` where `RoomState = { ydoc, awareness, peers, lastSnapshotAt, dirty }`. Snapshots on 30 s idle or last-disconnect. Evicts cold rooms (no active peers) from memory; rehydrates from SQLite on next connect.
2. **Sync-mode SPA chunk** (client-side `apps/web/src/sync/`) — dynamically imported by `main.ts` when `location.pathname.startsWith('/b/')`. Bundles `yjs`, `y-protocols/sync`, `y-protocols/awareness`, `y-indexeddb`, the `RemoteStrokeStore` implementing the `StrokeStore` interface from M2.1, the `Y.UndoManager` undo backend, the join dialog UI, and the cursor/label render code.
3. **Hello message envelope** (text WebSocket frame, JSON) — a single-message pre-protocol handshake carrying the server's name+color proposal and the room's currently-taken colors. Travels on the same WS as the Y.js binary frames; distinguished by WebSocket's native text-vs-binary frame type. Documented in ADR 0012.

### 4.2 Module additions

```
apps/server/src/sync/                   (NEW — relay implementation)
  index.ts                              entrypoint; wires Bun.serve websocket hooks
  room.ts                               RoomState; load/persist; peer mgmt
  hello.ts                              pre-protocol hello + hello-ack handling
  protocol.ts                           y-protocols/sync + awareness handlers
  snapshotter.ts                        30s idle + last-disconnect snapshot logic
  identitycorpus.ts                     Adjective-Animal corpus + presence palette
  limits.ts                             MAX_ROOMS, MAX_BOARD_BLOB_MB enforcement

apps/server/src/db/                     (NEW — bun:sqlite)
  schema.ts                             rooms + snapshots tables; migrations
  rooms.ts                              CRUD helpers
  snapshots.ts                          insert + prune-on-write

apps/server/src/api/                    (NEW — REST endpoints)
  rooms.ts                              POST/DELETE /api/rooms; owner-token guard

apps/web/src/sync/                      (NEW — lazy chunk)
  index.ts                              shared-mode bootstrap; called by main.ts
  remotestore.ts                        RemoteStrokeStore : StrokeStore (ydoc-backed)
  provider.ts                           thin WS provider; hello dance + y-protocols
  awareness.ts                          name/color/cursor; peer cursor render
  joindialog.ts                         small modal: name + color + 'bring strokes'
  undobackend.ts                        Y.UndoManager wrapped in Op-interface seam
  reconnect.ts                          state machine; toast trigger
  sharedstoragebridge.ts                y-indexeddb wiring; share-pending flag

apps/web/src/                           (MODIFIED)
  main.ts                               URL branch + lazy import; share gate hook
  toolmenu.ts                           new SHARE row
  keymap.ts                             Cmd/Ctrl+Shift+S → share action
  storage.ts                            new helper: copyAllStrokes(intoYDoc)
  stroke.ts                             in-flight WIP autosave hook (every ~2s)
  strokestore.ts                        unchanged interface; main.ts factory swap

packages/shared/src/                    (MODIFIED)
  types.ts                              Stroke ↔ Y.Map mappers; HelloFrame types
  ydoc-schema.ts                        (NEW) typed wrappers for the Y.Doc layout
```

### 4.3 Component diagram

```
                        Local mode (/)                           Shared mode (/b/<id>)
                       ─────────────────                          ─────────────────────
  main.ts                                                                    │
    │ pathname branch                                                        │
    ├─→ createLocalStrokeStore()         (M2.1, unchanged)                   │
    │      └→ storage.ts (flat IDB)                                          │
    └────────────────────────────────────────────────────────────────────────┘
                                                                             │
                                                                             ▼
                                                              await import('./sync/index.ts')
                                                              (separate Vite chunk, ~75 KB gz)
                                                                             │
                                                                             ▼
                                                              SyncProvider — opens WS
                                                                ┌────────────┴────────────┐
                                                                │ hello frame in          │
                                                                │ joinDialog.show()       │
                                                                │ hello-ack frame out     │
                                                                └────────────┬────────────┘
                                                                             │
                                                              y-protocols/sync + awareness binary
                                                                             │
                                                              RemoteStrokeStore { Y.Doc + y-indexeddb }
                                                                             │
                                                              Y.UndoManager  (origin=myClientId)
                                                                             │
                                                              cursors + name labels rendered
                                                              on the existing live layer

                                                              ┌──── server (Bun) ────┐
                                                                                    │
                                                              Bun.serve websocket  ─→ relay/room.ts
                                                                                    │
                                                                                    ├─→ hello.ts (server proposes)
                                                                                    ├─→ protocol.ts (y-protocols/sync + awareness)
                                                                                    ├─→ snapshotter.ts (30s idle + last-disconnect)
                                                                                    └─→ db/snapshots.ts (prune + insert)
```

The drawing pipeline (`pointer.ts` → `tools/*` → `render.ts`) is completely unchanged across modes. Only the persistence backend, the undo backend, and the live-layer overlay differ.

## 5. Schema design

### 5.1 Y.Doc layout

```ts
// packages/shared/src/ydoc-schema.ts — typed wrappers; the relay never reads this

YDoc {
  strokes: Y.Array<StrokeYMap>      // keyed under doc.getArray('strokes')
}

StrokeYMap = Y.Map<{
  id:          string                // ULID; immutable
  brush:       BrushConfigJSON       // immutable JSON snapshot at pointerdown
  samples:     SampleJSON[]          // immutable plain JS array; set once at pointerup
  startedAt:   number                // wall-clock Date.now() — CRDT-safe (no perf.now)
  deleted:     boolean               // optional; LWW — concurrent flip → last writer wins (acceptable)
  erasedStamps: Y.Array<Y.Map<{      // optional; created lazily on first wipe
    x: number, y: number, r: number, ts: number, by: number  // 'by' = clientId of eraser
  }>>
}>
```

Notes:
- `samples` is a plain JS array (immutable after pointerup) — LWW on the Y.Map key is fine because nobody writes it twice.
- `brush` is similarly immutable.
- `deleted` boolean LWW is acceptable: if two peers concurrently delete then undelete, last-write-wins gives a deterministic result that matches one of the user's intents.
- `erasedStamps` is the **only** field that takes concurrent writes from different peers; it MUST be a `Y.Array` (Decision 6 / ADR 0013).
- `by: clientId` on each stamp gives `Y.UndoManager` the origin info it needs to undo a peer's own erase without touching another peer's stamps.

### 5.2 SQLite schema

Unchanged from architecture.md § 2.4:

```sql
CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,        -- ULID base32
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

`rooms.name` default at insert: `"Untitled — YYYY-MM-DD"`. `updated_at` bumps on every snapshot write.

### 5.3 Hello message envelopes

Server → client, immediately on WS upgrade complete, as a **text frame**:

```ts
type HelloFrame = {
  v: 1                                  // protocol version; reject anything else
  proposedName: string                  // e.g. "Clever Fox"
  proposedColor: string                 // e.g. "#3b82f6"
  takenColors: string[]                 // colors currently assigned to other peers
  isFirstPeer: boolean                  // true if this peer is creating the room
  roomName: string                      // for display in dialog title
}
```

Client → server, after the user confirms the dialog, as a **text frame**:

```ts
type HelloAckFrame = {
  v: 1
  name: string                          // chosen (may equal proposedName)
  color: string                         // chosen (may equal proposedColor)
  carriedStrokeCount?: number           // declared count of strokes being copied
                                        // from flat IDB into this Y.Doc; 0 or omitted = empty start
}
```

After `hello-ack`, all further frames on this WS are **binary** y-protocols frames (sync + awareness). The server begins forwarding sync state-vector exchange. The client, after confirming the dialog and (if applicable) copying flat-IDB strokes into the Y.Doc, sends its sync step 1.

Frame-type discrimination is via WebSocket's native text-vs-binary distinction — no custom envelope byte. Any binary frame received before `hello-ack` is dropped with a server-side warning; any text frame after `hello-ack` is dropped silently (forward-compat for future protocol extensions).

### 5.4 Awareness state

Each peer's awareness state is a small JSON object:

```ts
type PeerAwareness = {
  name: string                          // chosen at join
  color: string                         // chosen at join
  cursor: { x: number, y: number } | null   // null when off-canvas
}
```

Awareness updates fire on `pointermove` (throttled to 60 Hz via `requestAnimationFrame`; skip-update if cursor delta < 1px in board coords). On `pointerleave`, set `cursor: null` — both dot and name label hide. On disconnect, Y.Awareness auto-removes the entry after the default 30 s timeout — the server explicitly removes it sooner via `awareness.removeAwarenessStates(...)` on the WS close handler.

The `Y.UndoManager` shared-mode backend (Decision 17 / ADR 0015) is configured `{ captureTimeout: 500, trackedOrigins: new Set([myClientId]) }` and capped at 500 entries to mirror the local Op-stack cap (M2 hardening). The `trackedOrigins` filter is what guarantees `Cmd+Z` undoes *your* ops only, never a peer's.

## 6. UX flows

### 6.1 Local mode (`/`) — unchanged

Behavior is byte-identical to M2.1. No new code in the hot path. The only change: `main.ts` checks `location.pathname` before calling `createLocalStrokeStore()`. Sync chunk is not fetched, not parsed.

### 6.2 Share click → shared mode

1. User triggers SHARE (right-click → SHARE row, or `Cmd/Ctrl+Shift+S`).
2. If currently at `/`:
   a. Generate `ULID()` → `roomId`.
   b. Write `whiteboard:share-pending: { roomId }` to localStorage.
   c. `history.pushState({}, '', '/b/' + roomId)`.
   d. `await import('./sync/index.ts')` triggers the lazy chunk fetch.
   e. Sync module bootstraps: open WS to `/yjs/<roomId>` (with optional `?token=<...>` if the operator has it).
3. If currently at `/b/<id>`:
   a. Copy `location.href` to clipboard.
   b. Show 2 s toast: *"Link copied — share to invite."*
   c. Done.

### 6.3 Join dialog

Triggered by receipt of the server's `HelloFrame`. Modal, ~360px wide, centered. Sections:

```
┌──────────────────────────────────────────────────┐
│  Join "Untitled — 2026-05-10"                    │
│  ─────────────────────────────────────────       │
│                                                  │
│  Name:    [ Clever Fox                  ]        │
│                                                  │
│  Color:   ●  ●  ●  ●  ●  ●  ●  ●                 │
│           ●  ●  ●  ●  ●  ●  ●  ●                 │
│           (taken colors shown disabled)          │
│                                                  │
│  ☑ Bring 47 strokes from your local board        │   <- creator only
│                                                  │
│  [   Cancel   ]            [   Join   ]          │
└──────────────────────────────────────────────────┘
```

- Name field is text input pre-filled with `proposedName` (or `localStorage.whiteboard:peer-name` if present and not in the room's used names).
- Color grid is the fixed 16-color presence palette. Colors in `takenColors[]` render at 30% opacity and are non-clickable.
- "Bring N strokes" row only renders when `isFirstPeer && N > 0`. Default ON.
- **Cancel**: closes dialog; `history.back()`; the share is abandoned; `whiteboard:share-pending` is cleared; user is returned to `/`.
- **Join**: send `hello-ack`; if "bring strokes" checked, run the flat→Y.Doc copy *before* sending the first sync step; then await y-protocols sync; on first awareness, render cursors.

The dialog is the only persistent modal in the app. It is dismissed on Join (or Cancel) and never reappears in the same session unless the user explicitly re-shares.

### 6.4 Reconnect toast

The y-websocket-like reconnect logic is implemented in `sync/reconnect.ts` as a small state machine:

```
disconnected ──onopen──▶ connecting ──onsync──▶ live
       ▲                                          │
       └────────onclose / onerror─────────────────┘
```

Transitions trigger toasts:
- `live → disconnected`: *"Offline — drawing locally."* (3 s, info)
- `disconnected → live`: *"Reconnected."* (2 s, info)

While `disconnected`, the user keeps drawing; ops apply locally (Y.Doc updates queued by y-indexeddb), and re-sync on reconnect.

### 6.5 In-flight crash recovery

Implemented at the `tools/pen.ts` stroke-active path:

```ts
// stroke.ts (additive)
let wipTimer: number | undefined
export function startWipAutosave(getStroke: () => Stroke | null) {
  if (wipTimer != null) return
  wipTimer = window.setInterval(() => {
    const s = getStroke()
    if (!s) return
    localStorage.setItem('whiteboard:stroke-wip', JSON.stringify(s))
  }, 2000) as unknown as number
}
export function clearWip() {
  if (wipTimer != null) { clearInterval(wipTimer); wipTimer = undefined }
  localStorage.removeItem('whiteboard:stroke-wip')
}
```

`pen.ts` calls `startWipAutosave()` on `pointerdown`, `clearWip()` on `pointerup`. Works in both modes.

### 6.6 Restore-on-boot prompt

`main.ts` boot, before the first stroke render:

```
if (localStorage.getItem('whiteboard:stroke-wip')) {
  showToast({
    text: 'Restore unfinished stroke?',
    actions: [
      { label: 'Restore', do: restoreWipAsCommittedStroke },
      { label: 'Discard', do: clearWip },
    ],
    autoclose: false,
  })
}
```

Restored strokes appear as committed strokes attributed to the current peer (the previous tab's identity is lost — there's no need to preserve it).

## 7. Protocol details

### 7.1 REST endpoints

| Path | Method | Auth | Body | Response |
|---|---|---|---|---|
| `/api/rooms` | POST | `?token=<OWNER_TOKEN>` | `{ name?: string }` | `{ id: string, name: string, created_at: number }` or `429` if `MAX_ROOMS` |
| `/api/rooms/:id` | DELETE | `?token=<OWNER_TOKEN>` | — | `204` on success; `404` if unknown |

`PATCH /api/rooms/:id` is **not** implemented in M3 (Decision 4).

### 7.2 WebSocket endpoint

`GET /yjs/<roomId>` with `Upgrade: websocket`. Query string optional: `?token=<OWNER_TOKEN>` is accepted and logged but does not change relay behavior in M3 (Decision 2A; "owner" presence is a future M3.5 nicety if it surfaces).

Upgrade handler in `apps/server/src/sync/index.ts`:

1. Parse roomId from URL.
2. Validate format (ULID base32, length 26). Reject 400 otherwise.
3. Check `MAX_ROOMS` if creating fresh.
4. `roomMap.has(roomId)` ? reuse : `roomMap.set(roomId, loadOrCreateRoom(roomId))` — sync `bun:sqlite` op (Decision 5).
5. `ws.send(JSON.stringify(helloFrame))` — server proposes name+color from corpus, fetches takenColors from current room peers.
6. Register `ws` on the room as `peer = { ws, name: null, color: null, awarenessState: undefined }`.
7. Wait for `hello-ack` text frame (with 30 s timeout — connection drop if not received).
8. On `hello-ack`: store chosen `name`+`color`; begin processing binary frames via `protocol.ts`.

### 7.3 y-protocols handlers

Standard `y-protocols/sync` and `y-protocols/awareness` server-side handlers, adapted to Bun's `ServerWebSocket` callback API (vs Node `ws` EventEmitter). The relay receives binary frames, parses the message type, applies sync updates to the room's in-memory Y.Doc, and broadcasts to other peers in the same room. Awareness updates are similarly relayed to all peers except sender.

### 7.4 Snapshotter

`apps/server/src/sync/snapshotter.ts` runs a per-room debounced timer:
- On every Y.Doc update from a peer, `room.dirty = true`; reset a 30 s timer.
- On timer fire: if `dirty`, write `Y.encodeStateAsUpdate(doc)` to `snapshots`, prune older than top-3, clear `dirty`, bump `rooms.updated_at`.
- On last-peer-disconnect: synchronous final write (regardless of `dirty`); evict room from in-memory `Map`.

## 8. Implementation phasing

To make implementation tractable and reviewable, M3 lands in five PR-sized phases. Each phase is independently testable and leaves `main` working.

| Phase | Scope | Mergeable result |
|---|---|---|
| **M3-A** Server bones | `apps/server/src/sync/` skeleton; relay + room mgmt + bun:sqlite + REST. No client wiring. Smoke test via `wscat` + a node test. | Server passes integration tests; client side is unchanged. |
| **M3-B** Client sync chunk | `apps/web/src/sync/` lazy chunk; URL routing; hello dance; y-protocols binding; RemoteStrokeStore. No presence yet. | Two browsers in `/b/<id>` see each other's strokes after commit. |
| **M3-C** Presence | Y.Awareness wiring; cursor render; join dialog name/color picker. | Two browsers see each other's cursors with names. |
| **M3-D** Migration + recovery | "Bring N strokes" toggle; share-pending flag handling; in-flight WIP localStorage autosave; restore-on-boot prompt. | Share from a populated local board carries strokes; tab crash recovers in-flight strokes. |
| **M3-E** Undo + polish | Y.UndoManager backend behind Op interface; reconnect toasts; 16-peer load test; doc updates; ADRs 0012–0015. | M3 exit criteria met; tag `m3-sync`. |

Each phase merges to main with passing tests and a CHANGELOG entry. ADRs land with the relevant phase (relay ADR with M3-A, schema ADR with M3-B, awareness ADR with M3-C, undo ADR with M3-E).

## 9. Risks (carried forward from prep doc, updated)

- **R1 — Bun single-threaded event-loop assumption** (Decision 5). Mitigation: explicit comment in the upgrade handler citing the assumption; Decision 5B is the documented upgrade path.
- **R2 — Interrupted share-copy** (Decision 10b). Mitigation: status flag in localStorage; flat-IDB stays intact; copy is idempotent on retry.
- **R3 — `erasedStamps` CRDT correctness** (Decision 6 / ADR 0013). Mitigation: `packages/shared/src/ydoc-schema.ts` typed wrappers; integration test explicitly has two peers wipe the same stroke concurrently.
- **R4 — `MAX_BOARD_BLOB_MB` unspecified behavior**. Mitigation (this M3): log warning at 80% of limit; on snapshot write that would exceed 100%, skip the write and log error (keeps previous snapshot intact). Full quota UX deferred.
- **R5 — Hello-dance race on rapid reconnect**. If client sends `hello-ack` then the connection drops before server processes it, the new connection starts with a fresh hello. Mitigation: server idempotent on `hello-ack` (only sets fields if peer's name/color are null); client persists chosen name+color across reconnect via localStorage.
- **R6 — Web bundle size**. Current bundle ~30 KB gz. Sync chunk adds ~75 KB gz, lazy. Total served on `/b/<id>` ~105 KB gz — under the 150 KB gz SPEC § 3.3 limit. Verified at M3 close.
- **R7 — Offline-to-online reconciliation**. Mitigation: integration test — peer A goes offline, draws strokes 1–3; peer B draws strokes 4–6; A reconnects; both peers have strokes 1–6 in the same order (by `startedAt`, which is wall-clock and CRDT-safe).
- **R8 — 16-peer presence load**. Mitigation: throttle awareness cursor updates to 60 Hz at the client; skip-update if delta < 1px; load test at exit criterion.
- **R9 (NEW) — Y.UndoManager memory growth on long sessions**. UndoManager retains transaction state for the configured stack depth. Mitigation: cap UndoManager `captureTimeout=500ms` (group ops into logical units) and `maxStack=500` to mirror the local Op-stack cap (M2 hardening).
- **R10 (NEW) — Tab restored after crash mid-share-pending**. If `whiteboard:share-pending` is set when the tab restarts, the user lands on `/b/<id>` with the lazy sync chunk + a fresh y-indexeddb state. The share-pending check detects this; wipes y-indexeddb for that room and redoes the copy.

## 10. Testing strategy

**Unit tests** (Bun's test runner, no DOM):
- Y.Doc schema helpers: stroke serialization round-trip; concurrent stamp append correctness; `deleted` flag LWW determinism.
- Hello/hello-ack frame parsing + validation; rejection of bad frames.
- Snapshot prune-keep-3 logic with synthetic snapshot tables.
- ULID generation + room ID validation regex.
- Identity corpus uniqueness query (`takenColors[]` exclusion).
- Reconnect state machine transitions.

**Integration tests** (Bun + ephemeral test server):
- Server boot → POST /api/rooms → DELETE /api/rooms with valid/invalid token (200/204/401/403).
- Open WS → receive hello → send hello-ack → exchange y-protocols sync → close → snapshot persisted.
- Two-client concurrent edit: both insert stroke; both peers see both strokes.
- Two-client concurrent erase on same stroke: both stamps survive (Decision 6 CRDT correctness).
- Offline → reconnect: peer A goes offline; B writes; A reconnects; A sees B's writes; B sees A's pending writes.
- Late join hydration: peer joins existing room; first sync delivers full state.
- Stale snapshot prune: write 10 snapshots → table has 3.
- MAX_ROOMS=2 with two rooms → third POST returns 429.

**Browser feel-test (Wacom Intuos, manual)**:
- Local mode at `/` — no perceived latency regression vs M2.1.
- Share → join dialog → enter shared mode — smooth, no jank during chunk fetch.
- Two browsers (same machine, separate tabs): stroke commit visible across in <300 ms LAN.
- Cursor labels track other peer; readable; non-distracting.
- Reconnect toast appears on simulated network drop; gone on reconnect.
- Tab kill mid-stroke → reopen → restore prompt → restored stroke renders correctly.
- 16-peer load test: 16 tabs (or 1 tab + 15 headless puppeteer pages) drawing concurrently for 5 minutes; no dropped updates, no >300 ms commit latency.

## 11. Exit criteria

Mirroring milestones.md M3 — all must pass before tag `m3-sync`:

- [ ] Two browsers in `/b/<id>` see each other's strokes and cursors.
- [ ] Disconnect / reconnect: late peer hydrates from SQLite, then merges live updates.
- [ ] `OWNER_TOKEN` gates `DELETE /api/rooms/:id` (and the unused `POST` admin path).
- [ ] Snapshots written every 30 s idle + on last-disconnect; pruned to top-3 per room.
- [ ] 16 concurrent peers in one room, no dropped updates over 5 minutes of mixed editing.
- [ ] In-flight stroke crash recovery: tab kill mid-stroke loses ≤ 2 s of pen movement.
- [ ] Share-pending flag handles interrupted copies idempotently.
- [ ] Local mode at `/` byte-identical-feeling to M2.1 (Wacom Intuos feel-test).
- [ ] Bundle: `/` chunk ≤ 35 KB gz; `/b/<id>` total ≤ 110 KB gz.
- [ ] Lint, typecheck, tests all clean.
- [ ] `docs/architecture.md` § 6 updated (mark M3 rows ✅; add relay module map, Y.Doc schema, presence model, migration flow, client routing).
- [ ] SPEC § 5 updated: presence channel revision (architecture.md `/presence/<room-id>` row removed/revised); ULID-not-UUIDv7 wording; sharing-opt-in language.
- [ ] SPEC § 8 updated if any env var added (none currently planned at M3).
- [ ] `CHANGELOG.md` `[Unreleased]` entry covering all M3 deliverables.
- [ ] `docs/deployment.md` updated: backup/restore via `bun:sqlite` `.backup(filename)`; MAX_ROOMS 429 behavior; admin DELETE flow.
- [ ] ADRs 0012, 0013, 0014, 0015 written, accepted, linked from index.
- [ ] `milestones.md` M3 marked ✅ with close date and tag.

## 12. Open follow-ups (post-M3, not blocking)

- **Where the "edit my name/color after join" UI lives.** Likely a "Me" section in the settings side panel (single name input + color swatch + "leave room" link). Defer to M3.5 unless a feel-test pain surfaces during M3.
- **Persistent peer list / "who's here" surface.** Tenet-violating chrome; deferred. If requested post-v1, lives as a popover triggered by hovering near the bottom-right tool pill area.
- **Room name customization at creation.** Default `"Untitled — <date>"` is fine for M3; rename UI is M4.
- **Multi-room "boards list" / switcher.** SPEC § 10 Backlog.
- **Per-room owner tokens** (Decision 2 Option C). Re-evaluate if multi-tenant use surfaces; current global token is sufficient for self-hosted personal/team.
- **Server-side rate limiting / abuse detection.** Reverse-proxy concern for self-hosted v1.
- **Y.Doc snapshot V2 encoding.** Revisit if board size monitoring shows a real need.

---

*End of M3 design spec. 17 decisions locked. 5-phase implementation plan to be written by `superpowers:writing-plans` after user review.*
