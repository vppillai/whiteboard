# Security Policy

## Reporting a vulnerability

If you find something with security impact, please use GitHub's [private security advisory](https://github.com/vppillai/whiteboard/security/advisories/new) flow rather than filing a public issue.

You'll get an acknowledgement within a few days. Confirmed issues will be triaged and patched; you'll be credited in the advisory unless you ask to stay anonymous.

## Supported versions

Only the latest release on `main` is supported. The project is single-developer; security fixes go out as a patch release tagged on `main`.

## Scope

In scope:

- The web client (`apps/web`) — including pasted clipboard / drag-drop handling, IndexedDB / localStorage trust boundaries, and any URL-query-param-driven behavior.
- The static-file server (`apps/server`) — path-traversal, response headers, the `/health` endpoint.
- The build / CI pipeline (`.github/workflows`, `Dockerfile`).

Out of scope:

- Vulnerabilities that require physical access to an unlocked device the user has already trusted with browser storage.
- Bugs in third-party dependencies (please report those upstream); we'll bump our pin once a fix is published.
- The deferred sharing/collaboration design (`docs/superpowers/specs/2026-05-10-m3-sync-design.md`) — it's not shipped at v1.
