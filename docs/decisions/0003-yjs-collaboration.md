# 0003. Y.js for live collaboration

Date: 2026-05-09

## Status

Accepted — **implementation deferred from v1 per [ADR 0012](0012-sharing-deferred.md)** (sharing deferred). The technology choice itself stands when sharing returns: Y.js + custom relay + `y-indexeddb` is the design-of-record, captured in the M3 design archive at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](../superpowers/specs/2026-05-10-m3-sync-design.md). Revisit *this* decision only if Y.js or the CRDT-over-relay shape itself proves unsuitable when sharing returns.

## Context

The whiteboard supports live collaboration: multiple peers in the same room see each other's strokes and cursors with sub-second latency. The collaboration layer needs to handle:

- Concurrent edits (two peers drawing simultaneously) without lost work.
- Disconnects and rejoins (a peer goes offline, draws locally, then reconnects).
- Late joiners (peer C joins a room A and B have been editing for ten minutes).
- Persistence (server-side snapshots so a board survives all-peers-offline).
- Single-Docker deployment (no external infrastructure: no STUN, no TURN, no managed CRDT-as-a-service).

Candidate approaches:

1. **WebRTC P2P** with browser-to-browser data channels.
2. **Operational Transformation (OT)** with a custom server.
3. **CRDTs over a relay**: clients hold full doc state; server is a dumb relay; CRDT semantics resolve conflicts.

WebRTC is ruled out by the deployment requirement: it needs STUN and (for symmetric NATs) TURN. Hosting a TURN server is a meaningful operational burden that breaks the "single Docker" story.

OT is rejected as a build-vs-buy decision: we are not staffed to maintain a correct OT implementation.

CRDTs over a relay is the remaining shape. The two production-grade libraries are **Y.js** and **Automerge**.

- **Y.js**: small (~50 KiB), mature, used by tldraw / Hocuspocus / many production tools, has a battle-tested WebSocket protocol (`y-websocket`), efficient binary wire format, IndexedDB persistence (`y-indexeddb`).
- **Automerge**: also mature, also small, but smaller ecosystem of off-the-shelf transports and persistence adapters; performance on large arrays (which is what a whiteboard is) is weaker than Y.js historically.

## Decision

Use Y.js as the CRDT, `y-websocket` as the transport (with our own server implementation rather than the upstream demo server), and `y-indexeddb` as the offline cache.

The wire protocol stays Y.js-binary unchanged. Auth (the owner-token check) and room membership are handled outside the Y.js channel — by the server's WebSocket-upgrade handler.

## Consequences

**Easier.**

- Offline-first comes "for free" (`y-indexeddb` mirrors the doc).
- Late joiners get the full doc state via Y.js sync; we don't write that protocol.
- The server is a small relay (~500 LOC) plus a snapshotter; no application-level merge logic needed.
- Per-stroke updates are cheap; whole-doc snapshots are easy (`Y.encodeStateAsUpdate`).

**Harder.**

- We commit to Y.js's data model. If we want to switch CRDT libraries later, migration is a one-time export / import, not a swap.
- Y.js binary updates are not directly inspectable. Debugging requires understanding Y.js internals or using `y-protocols`-aware tooling.
- We have to be careful never to send raw stroke samples through the CRDT — only commit at `pointerup`. The spec is explicit about this; the architecture has to enforce it.

**Risks.**

- A bug in our use of Y.js silently corrupts a board's state (e.g. we update a Y.Map while iterating). Mitigation: schema lives in `packages/shared` as typed wrappers; direct Y.js access is encapsulated.
- Y.js's wire protocol changes incompatibly between major versions. Mitigation: pin a version; test against it; upgrade is an explicit ADR.
