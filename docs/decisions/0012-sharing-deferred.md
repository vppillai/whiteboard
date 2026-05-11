# 0012. Sharing / live collaboration — deferred from v1

Date: 2026-05-10

## Status

Accepted. Supersedes the original v1 SPEC § 1 Goal of "Live multi-user collaboration with link-based sharing"; sharing moves to the post-v1 backlog with a preserved design archive (see *Migration path forward*).

## Context

The M3 milestone — "server, sync, room URLs" — was scoped to ship the collaboration layer: a Bun WebSocket relay over `y-protocols`, Y.Doc-backed shared rooms, Y.Awareness presence with cursor labels, SQLite snapshot persistence, owner-token-gated admin REST endpoints, the flat-IDB-to-Y.Doc migration path, in-flight stroke crash recovery, and a "Share" gate UX that lazily loads the sync bundle. A full M3 design spec closed all 16 open prep-doc decisions plus a 17th raised at brainstorm time (undo-manager scope); the spec is preserved at [`docs/superpowers/specs/2026-05-10-m3-sync-design.md`](../superpowers/specs/2026-05-10-m3-sync-design.md).

At the close of M3 brainstorming, the user reassessed the feature against the SPEC § 0 tenets:

- **Snappy, sleek, user-friendly are paramount.** Sharing is by far the heaviest feature on the v1 roadmap. The shared-mode bundle adds ~75 KB gz of client code (yjs + y-websocket + y-indexeddb + y-protocols-awareness) on top of the ~30 KB gz local mode bundle. The server gains a long-lived stateful service surface (in-memory Y.Doc map, SQLite snapshot writer, ~500 LOC custom relay) replacing what is otherwise a static file server.
- **Visual minimalism is functional.** Sharing introduces the join dialog (the first persistent modal in the app), cursor labels under peer pointers, reconnect toasts, and a SHARE entry in the right-click menu. Each addition is small in isolation; together they add a meaningful slice of cognitive load.
- **Things that don't help drawing don't ship at all, or ship hidden by default.** Sharing does not improve the drawing experience for the primary single-user case. For the *only* user that exists today (the project owner, drawing on a Wacom Intuos), the cost is paid every session for a feature used in narrow circumstances.

This is the same shape as the ADR 0011 toolbar deferral: a SPEC-committed feature is weighed against the tenets and dropped when the tenets win. The toolbar drop saved a UI primitive and a reactive store framework decision; the sharing drop saves a runtime service surface, a WebSocket protocol, a CRDT data model commitment, and the operational responsibility of a stateful self-hosted server.

## Decision

**Defer sharing from v1.** Specifically:

1. **M3 (server, sync, room URLs) is removed from the v1 critical path.** The milestone moves to the post-v1 backlog (see SPEC § 10).
2. **The full M3 design (17 locked decisions; protocol; schema; UX flows; ADR list) is preserved as a design archive** at `docs/superpowers/specs/2026-05-10-m3-sync-design.md` with a `DEFERRED` status header. When sharing returns post-v1, the spec is the starting point — not a fresh brainstorm.
3. **The M2.1 `StrokeStore` interface seam (`apps/web/src/strokestore.ts`) stays in place.** It is a zero-cost abstraction: one interface, one concrete implementation. Keeping it preserves the future-sharing factory-swap option without any current overhead. The forward-looking comments are reworded from "M3 will add..." to "future sync work will add..." to remove timeline implications.
4. **The CRDT-friendly schema decisions made in M2.1 stay**: wall-clock `Stroke.startedAt`, ULID `Stroke.id`, op-pipeline-routed erasure (no direct `stroke.deleted` mutation), IDB compaction. These are good designs on their own merits and preserve the option to wrap strokes as `Y.Map` later without a schema break.
5. **Future v1 design decisions must continue to be made with potential future sharing in mind.** New schema additions stay CRDT-compatible (no auto-increment IDs, no fields requiring serializable transactional semantics). New mutations route through the op pipeline. New persistence reads/writes go through `StrokeStore`, never directly to `storage.ts`.
6. **The v1 ship path becomes M2.1 → M4 (deployment polish) → M4.5 (PWA install + offline) → tag `v1.0.0`.** v1 ships as "a fast offline whiteboard with installable PWA," sized for the single-user, single-device Wacom Intuos case the project was built for.

The crash-recovery item (M3 Decision 9: localStorage WIP autosave) was tenet-aligned and could have shipped standalone. It is deferred with the rest of the sharing scope to keep v1's surface tight — `pointerup` is the persistence boundary today, and tab crashes are rare on the project owner's primary use case. If a user-facing pain emerges, crash recovery can be added as a small post-v1 milestone in the same shape.

## Considered alternatives

### Ship M3 as designed

Closes the SPEC § 0 collaboration goal at v1. Costs: ~3 days additional development, ~75 KB lazy chunk, custom WebSocket protocol with a pre-protocol hello-frame dance, runtime service surface for self-hosters, four new ADRs (0012–0015 in the original M3 brainstorm), the join dialog modal, cursor-label render code, awareness wiring, undo-system fork, share-pending state machine, snapshot pruner, owner-token guard.

Rejected — the user is the only user, and the tenet weighs heavier than the SPEC-stated goal. ADR 0011 set the precedent: a SPEC commitment loses to a tenet conflict.

### Ship a minimal M3 (URL-shared but no presence)

Cut presence, cursor labels, join dialog, awareness — ship only Y.Doc sync + snapshots. Removes the most visible UI surface but keeps the server runtime, the bundle cost, the protocol, the migration path, the undo fork, and the share-pending handling. Saves maybe ~10 KB gz and the join dialog.

Rejected — the irreducible cost of sharing is the *server* and the *bundle*, not the UI surface. A "minimal sharing" version pays nearly the same cost as a full one.

### Strip sharing entirely from the project (delete SPEC § 5, delete the M3 archive)

Treat sharing as never-planned. Recover all SPEC ink, delete the design archive, simplify the project pitch to "offline-only whiteboard." Costs: future re-introduction requires a fresh brainstorm; the M2.1 hardening decisions made for CRDT-friendliness lose their stated rationale.

Rejected — the user explicitly asked for "design decisions down the road must be with potential future sharing implementation in mind." That requires the archive to remain referenceable.

## Consequences

### Easier

- v1 ship surface shrinks dramatically. No server-side state. No long-lived in-memory Y.Doc map. No SQLite write path. No custom relay code. No pre-protocol handshake. No awareness wiring. No undo-system fork. No migration prompt. No reconnect state machine. No bundle-budget pressure on the lazy chunk.
- The `apps/server` surface area collapses back to the M0 shape: serve static files with SPA fallback + immutable cache for `/assets/*` + a `/health` endpoint. The Dockerfile, compose, and `deploy.sh` are unchanged in shape — a self-hoster deploys a stateless container with no `OWNER_TOKEN`, no `MAX_ROOMS`, no `DATA_DIR` volume requirement.
- M4 (deployment polish) trivializes: validate `BASE_PATH` behind reverse proxies, exercise `deploy.sh` on a clean host, write release notes. No WebSocket-through-proxy validation needed (no WebSocket in v1).
- M4.5 (PWA install) becomes the clear next milestone — offline-first is the actual product story now, and PWA install makes that story native.

### Harder

- The "collaborative whiteboard" pitch is no longer true at v1. The README and SPEC must reword the product story to "fast offline whiteboard" without overpromising future sharing. The acknowledgements section drops the Y.js mention (we are not using it).
- The `.env.example` loses `OWNER_TOKEN`, `MAX_ROOMS`, `MAX_BOARD_BLOB_MB`, and `DATA_DIR`. These re-appear when sharing returns.
- Future sharing implementation has to redo the integration work (the design is preserved; the wiring is not). The cost is implementation time, not design time.

### Risks

- **A future contributor sees the M3 spec archive and assumes it's the current direction.** Mitigation: the spec doc carries a `DEFERRED` status header at the top with a pointer to this ADR. SPEC § 5 ("Collaboration") is rewritten as a stub pointing to the backlog. The README "Coming up" list does not mention sharing.
- **A schema or mutation decision made in v1 closes the future sharing door.** Mitigation: the "design with future sharing in mind" tenet is now explicit in this ADR. Reviewers cite this ADR when sharing-incompatible decisions surface — e.g., a proposal to use IDB auto-increment IDs would be rejected here; a proposal to bypass the op pipeline for a mutation would be rejected here.
- **User demand for sharing emerges before v1 ships, and we re-open the decision.** Mitigation: this is fine. The archive is intact; the seams are intact. Re-opening costs a re-evaluation against the tenet, not a fresh brainstorm. The decision to defer is reversible.

## Migration path forward

When sharing returns (post-v1, on demand):

1. **Start from the design archive** at `docs/superpowers/specs/2026-05-10-m3-sync-design.md`. Revisit each of the 17 locked decisions to verify they still hold against the codebase as it stands at that future date. Re-brainstorm only the decisions that have drifted.
2. **The `StrokeStore` interface is the wiring point** at `apps/web/src/strokestore.ts`. Add a `createRemoteStrokeStore(roomId)` factory that wraps a Y.Doc + provider. Swap the factory in `main.ts` based on `location.pathname`. The drawing pipeline does not change.
3. **The op pipeline is the CRDT seam on the application side**. Wrap `Op.apply()` bodies in `Y.Doc.transact(fn, origin=myClientId)` in shared mode; `Y.UndoManager` observes by origin.
4. **The schema choices made in M2.1 carry forward**: `Stroke.id` is already a CRDT-safe ULID, `Stroke.startedAt` is already wall-clock for cross-peer chronological ordering, `erasedStamps` already flow through the op pipeline (ready to map to a nested `Y.Array`).
5. **The full ADR set anticipated for M3 (0012–0015 in the archive numbering) is to-be-written when implementation begins.** This ADR (0012) takes that number; the others — relay implementation, Y.Doc schema, presence channel, undo backend — are renumbered to whatever is next available at that time.

The future ADR documenting the un-deferral cites this one and explains what changed.
