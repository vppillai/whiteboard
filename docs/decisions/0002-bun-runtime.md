# 0002. Bun as the server runtime

Date: 2026-05-09

## Status

Accepted

## Context

The server is a single process responsible for static-file serving, WebSocket relay (Y.js), and SQLite-backed snapshot persistence. The runtime needs:

- Fast startup (container restart latency).
- Low memory footprint.
- A WebSocket implementation that doesn't require external native deps.
- A SQLite binding that doesn't require external native deps.
- Good ergonomics for TypeScript without a separate transpile step.

Candidates:

- **Node.js 20+**: most ubiquitous, mature ecosystem, but TypeScript needs a separate build step or `tsx`/`ts-node`. SQLite via `better-sqlite3` (native, well-maintained). WebSockets via `ws` or `bun-websocket`.
- **Bun ≥ 1.1**: native TS, native SQLite (`bun:sqlite`), native WebSocket (`Bun.serve`), single binary. Younger; not all npm packages work, though most do.
- **Deno**: similar to Bun in goals but with a different module resolution model. Less compatible with the npm ecosystem than Bun.

The dependency footprint of this server is small (Y.js, y-websocket, ULID — all pure JS), so npm-incompatibility risk is low.

## Decision

Use Bun as the runtime. Pin to ≥ 1.1 in `package.json` engines. Use `Bun.serve` for HTTP / WebSocket and `bun:sqlite` for persistence.

## Consequences

**Easier.**

- Single binary; no build step for the server (run `.ts` files directly).
- Fast startup (~50 ms cold) and low base memory (~30 MiB).
- Zero native deps; the production image is a single layer over `oven/bun:slim`.
- WebSocket and SQLite are first-party; no `node-gyp`, no native compilation in CI.

**Harder.**

- A subset of npm packages don't work cleanly on Bun. We mitigate by keeping deps small and well-known. If we hit a blocker, fallback is Node 22 with `tsx`.
- Smaller community / fewer Stack Overflow answers compared to Node. Mitigation: Bun's docs are good; the dependency surface is small.

**Risks.**

- Bun is a younger runtime; bugs in the runtime itself are possible. Mitigation: pin to a tested version; run integration tests against the actual runtime.
- If we ever need a Node-only library, we have to either find a Bun-compatible alternative or migrate. The migration cost is low (most code is plain TS).
