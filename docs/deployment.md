# Deployment

How to deploy Whiteboard. **v1 is stateless** (live collaboration is post-v1 per [ADR 0012](decisions/0012-sharing-deferred.md)) — no volumes, no backups, no migrations, no runtime dependencies beyond a static file host. That gives you two deploy shapes:

1. **Docker** — single container, host you own (this is what `deploy.sh` does).
2. **Static host** — any service that serves files: GitHub Pages, Cloudflare Pages, Netlify, S3 + CloudFront, plain Nginx.

Pick whichever fits. They serve the same `apps/web/dist/` bundle.

## Quick deploy (Docker)

On the target host (Linux, with Docker and the Compose plugin installed):

```bash
git clone https://github.com/vppillai/whiteboard.git
cd whiteboard

cp .env.example .env
# Edit .env — at minimum, set PUBLIC_ORIGIN if you're using a public domain.

./deploy.sh
```

The script sources `.env`, builds the image, brings the stack up in detached mode, and prints the URL.

> **Note on sharing-related env vars.** Live collaboration (the original M3 milestone) is deferred from v1 per [ADR 0012](decisions/0012-sharing-deferred.md). The `OWNER_TOKEN`, `DATA_DIR`, `MAX_ROOMS`, and `MAX_BOARD_BLOB_MB` env vars return when sharing returns. The v1 container has no admin endpoints and no server-side state.

To stop:

```bash
docker compose down
```

To update to a newer revision:

```bash
git pull
./deploy.sh   # rebuilds and restarts
```

## GitHub Pages (zero-server deploy)

Because v1 has no runtime backend, the built SPA can be hosted on GitHub Pages directly from the repo. A workflow ([`.github/workflows/pages.yml`](../.github/workflows/pages.yml)) is included that:

1. Builds the web bundle with `BASE_PATH=/whiteboard/` (matches the default repo name; edit if you renamed the repo or want a user/org site rooted at `/`).
2. Disables Jekyll on the artifact (writes `.nojekyll`).
3. Publishes via the official `actions/deploy-pages` action.

**One-time setup in your fork:**

1. Go to *Settings → Pages*.
2. Under **Source**, choose **"GitHub Actions"** (not "Deploy from a branch").

Then push to `main`. The `pages` workflow runs on every push to main and on manual dispatch. The site is at `https://<your-username>.github.io/whiteboard/` after the first successful deploy.

**Custom domain:** add a `CNAME` record at your domain registrar pointing to `<your-username>.github.io`, then set the custom domain in *Settings → Pages*. Update the workflow's `BASE_PATH` env to `/` (the workflow is the place to keep this — the runtime knows nothing about the host).

**Caveats / what doesn't work on Pages:**

- No `/health` endpoint (it's served by `apps/server`, not by GitHub Pages). This is fine — `/health` exists for Docker healthchecks, which Pages doesn't run.
- No reverse-proxy `BASE_PATH` injection at runtime — the base is baked into the bundle at build time. Re-build to change it.
- No future sharing (obviously) — when live collaboration returns per ADR 0012, Pages deploys lose access to that feature; users who want sharing run the Docker container.

## Environment variables

Configured via `.env` (next to `docker-compose.yml`). All variables have defaults.

| Variable        | Default                  | Purpose                                                     |
|-----------------|--------------------------|-------------------------------------------------------------|
| `PORT`          | `8787`                   | Host port to publish. Container always listens on 8787.     |
| `PUBLIC_ORIGIN` | `http://localhost:8787`  | Public URL. Used for CORS, CSP.                             |
| `BASE_PATH`     | `/`                      | Sub-path for reverse-proxy mount (e.g. `/whiteboard`).      |
| `LOG_LEVEL`     | `info`                   | `trace` \| `debug` \| `info` \| `warn` \| `error`.          |

## Reverse-proxy setups

Mount Whiteboard behind your existing reverse proxy. At v1 the container serves only HTTP (no WebSocket); the proxy needs to forward HTTP only. (When sharing returns, the WebSocket `Upgrade` header forwarding shown in the Nginx snippet below is what's needed — left in place as a no-op for forward-compat.)

### Caddy

Root mount:

```caddyfile
draw.example.com {
    reverse_proxy localhost:8787
}
```

Sub-path mount (set `BASE_PATH=/whiteboard` in `.env`):

```caddyfile
example.com {
    handle_path /whiteboard/* {
        reverse_proxy localhost:8787
    }
}
```

### Nginx

```nginx
server {
    server_name draw.example.com;
    listen 443 ssl http2;
    # ... TLS config ...

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;       # WebSockets
    }
}
```

For sub-path mount, change the `location` block to your prefix (e.g. `location /whiteboard/`) and set `BASE_PATH=/whiteboard` in `.env`.

## TLS

This project does not terminate TLS. Run a reverse proxy (Caddy is the lowest-effort choice — it does Let's Encrypt automatically) in front and forward to the container's HTTP port.

## Persistence and backups

**v1 has no server-side state.** Each user's strokes live in their browser's IndexedDB; the container can be destroyed and recreated freely. There is nothing to back up.

When live collaboration returns per [ADR 0012](decisions/0012-sharing-deferred.md), the container will grow a SQLite volume and the backup/restore procedure preserved in the [M3 design archive](superpowers/specs/2026-05-10-m3-sync-design.md) (§ 11 deployment.md update) returns alongside it.

## Resource sizing

A single stateless container uses ~30–50 MiB RSS. There is no per-room overhead at v1. CPU is negligible — the server only serves static files.

A 256 MiB instance is more than enough.

## Updating

```bash
git pull
./deploy.sh
```

## Health and observability

- **Healthcheck**: `GET /health` returns `200 {"status":"ok",...}`. Wired into Docker's healthcheck and `docker compose ps`.
- **Logs**: `docker compose logs -f`.
- **Metrics**: not yet shipped. Likely a `/metrics` Prometheus endpoint in a future revision; not on the v1 critical path.

## Troubleshooting

- **Container won't start**: check `docker compose logs` for the error. Most issues at v1 are network or filesystem misconfigurations (port already in use, `.env` not present in working directory).
- **Strokes don't persist after browser restart**: per-browser IndexedDB persists strokes across reloads. If they're vanishing, check the browser hasn't cleared site data, or use the export-to-PNG/SVG/PDF surface (`Cmd/Ctrl+E`) to preserve a copy. (Cross-device persistence requires the deferred sharing layer.)
- **Slow boards**: drawing performance is client-side; server CPU on the host is not the cause. Open dev tools, look for layout thrash or 60-fps drops on the canvas layer.
