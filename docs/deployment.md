# Deployment

How to deploy Whiteboard to a server you own. The target is a single Docker container running on a single host. There is no horizontal-scale story.

## Quick deploy

On the target host (Linux, with Docker and the Compose plugin installed):

```bash
git clone https://github.com/vppillai/whiteboard.git
cd whiteboard

cp .env.example .env
# Edit .env — at minimum, set OWNER_TOKEN and PUBLIC_ORIGIN

./deploy.sh
```

The script validates `.env`, builds the image, brings the stack up in detached mode, and prints the URL.

To stop:

```bash
docker compose down
```

To update to a newer revision:

```bash
git pull
./deploy.sh   # rebuilds and restarts
```

## Environment variables

Configured via `.env` (next to `docker-compose.yml`). All variables have defaults except `OWNER_TOKEN`, which is required.

| Variable             | Default                  | Purpose                                                     |
|----------------------|--------------------------|-------------------------------------------------------------|
| `PORT`               | `8787`                   | Host port to publish. Container always listens on 8787.     |
| `PUBLIC_ORIGIN`      | `http://localhost:8787`  | Public URL. Used for share-link generation, CORS, CSP.      |
| `OWNER_TOKEN`        | *(required)*             | Bearer token for admin actions. `openssl rand -hex 32`.     |
| `BASE_PATH`          | `/`                      | Sub-path for reverse-proxy mount (e.g. `/whiteboard`).      |
| `DATA_DIR`           | `/data`                  | Inside container; mapped to a Docker volume.                |
| `MAX_ROOMS`          | `500`                    | Soft cap on total rooms.                                    |
| `MAX_BOARD_BLOB_MB`  | `50`                     | Soft cap on snapshot blob size per room.                    |
| `LOG_LEVEL`          | `info`                   | `trace` \| `debug` \| `info` \| `warn` \| `error`.          |

## Reverse-proxy setups

Mount Whiteboard behind your existing reverse proxy. Both the SPA and the WebSocket endpoint live on the same port; the proxy needs to forward both HTTP and WebSocket upgrades.

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

All durable state lives in a single SQLite database inside the `whiteboard-data` Docker volume.

Inspect:

```bash
docker volume inspect whiteboard-data
```

### Backup

```bash
docker run --rm \
  -v whiteboard-data:/data:ro \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/whiteboard-$(date +%Y%m%d-%H%M%S).tgz -C /data .
```

For a hot backup (consistent SQLite snapshot while the server is running):

```bash
docker exec whiteboard sqlite3 /data/whiteboard.db ".backup /data/whiteboard-backup.db"
docker cp whiteboard:/data/whiteboard-backup.db ./whiteboard-$(date +%Y%m%d).db
docker exec whiteboard rm /data/whiteboard-backup.db
```

### Restore

```bash
docker compose down
docker run --rm \
  -v whiteboard-data:/data \
  -v "$PWD":/backup \
  alpine \
  sh -c "cd /data && tar xzf /backup/whiteboard-YYYYMMDD-HHMMSS.tgz"
docker compose up -d
```

## Resource sizing

A single container with no active boards uses ~50 MiB RSS. Each active room with peers connected adds ~10–50 MiB depending on board size. For typical personal / small-team use a 512 MiB instance is sufficient.

CPU is dominated by Y.js merge work during high-rate concurrent edits and by SQLite snapshot writes. A single shared core suffices for ≤ 16 concurrent peers per room.

Disk: SQLite file scales with total stroke count across all boards. ~1 KiB per stroke is a reasonable upper-bound estimate.

## Updating

```bash
git pull
./deploy.sh
```

The volume persists across rebuilds. Database migrations (when introduced) run automatically on server start.

## Health and observability

- **Healthcheck**: `GET /health` returns `200 {"status":"ok",...}`. Wired into Docker's healthcheck and `docker compose ps`.
- **Logs**: `docker compose logs -f`.
- **Metrics**: not yet shipped. Likely a `/metrics` Prometheus endpoint in a future revision; not on the v1 critical path.

## Troubleshooting

- **Container won't start, "OWNER_TOKEN is required"**: set it in `.env`.
- **404 on WebSocket upgrade behind Nginx**: ensure `proxy_set_header Upgrade` and `Connection "upgrade"` are present.
- **Strokes don't persist after container restart**: confirm the `whiteboard-data` volume is mounted (`docker volume ls`).
- **Slow boards**: drawing performance is client-side; server CPU on the host is likely not the cause. Open dev tools, look for layout thrash or 60-fps drops on the canvas layer.
