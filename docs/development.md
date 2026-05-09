# Development

This document is for people working on the codebase — installing locally, running the dev loop, understanding the layout, and following the code-quality conventions.

If you only want to *run* Whiteboard, see [deployment.md](deployment.md). If you want to understand *why* it's structured the way it is, see [architecture.md](architecture.md) and the [ADRs](decisions/).

## Prerequisites

The project's runtime is fully Dockerized. For local development you need a small toolchain:

| Tool             | Why                                          | Install                                                    |
|------------------|----------------------------------------------|------------------------------------------------------------|
| **Git**          | Source control.                              | `apt install git` / `brew install git`                     |
| **Docker** (with `compose` plugin) | Build and run the production stack. | https://docs.docker.com/engine/install/                |
| **Bun** ≥ 1.1    | Package manager + dev runtime + bundler.     | `curl -fsSL https://bun.sh/install \| bash`                |
| **gh** *(optional)*  | GitHub CLI; used for the PR / release flow. | `apt install gh` / `brew install gh`                  |

You do **not** need Node.js, npm, pnpm, yarn, SQLite, or any language toolchain beyond Bun installed locally — they all live in containers.

> If you don't want to install Bun on the host, you can run the dev loop entirely in Docker — see [§ Docker dev loop](#docker-dev-loop) below. Host-based Bun is recommended for fastest iteration.

## First-time setup

```bash
git clone https://github.com/vppillai/whiteboard.git
cd whiteboard

# Install dependencies (workspace-aware)
bun install

# Install the pre-commit hook (biome lint on staged files)
bun run install-hooks

# Sanity check
bun run lint
bun run typecheck
```

## Dev loop

### Host-based (recommended)

Runs the web (Vite) and server (Bun watch) processes in parallel on the host:

```bash
bun run dev
```

- Web: http://localhost:5173 (with hot module reload)
- Server: http://localhost:8787 (auto-restart on change)

To run them separately in different terminals:

```bash
bun run dev:web      # in terminal 1
bun run dev:server   # in terminal 2
```

### Docker dev loop

Same stack, running inside a Bun container with bind-mounted source. Useful when you don't want Bun on the host, or to validate that the Dockerized stack works:

```bash
bun run dev:docker
# or, equivalently:
docker compose -f docker-compose.dev.yml up
```

## Common tasks

| Command                      | Purpose                                           |
|------------------------------|---------------------------------------------------|
| `bun run dev`                | Run web + server in dev mode (host).              |
| `bun run build`              | Build the web app to `apps/web/dist`.             |
| `bun run typecheck`          | Type-check all workspaces.                        |
| `bun run lint`               | Lint and format-check (Biome).                    |
| `bun run lint:fix`           | Auto-fix lint and format issues.                  |
| `bun run format`             | Format-only (no linting).                         |
| `bun run docker:build`       | Build the production Docker image.                |
| `bun run docker:up`          | Start the production stack.                       |
| `bun run docker:down`        | Stop the production stack.                        |
| `bun run docker:logs`        | Tail production logs.                             |

## Project layout

```
whiteboard/
├── apps/
│   ├── web/                    # Frontend SPA (Vite + TS, vanilla canvas)
│   │   ├── index.html
│   │   ├── src/
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── server/                 # Backend (Bun, WebSocket, SQLite)
│       ├── src/
│       └── tsconfig.json
├── packages/
│   └── shared/                 # Types and protocol shared by web and server
│       ├── src/
│       └── tsconfig.json
├── docs/                       # Living documentation
│   ├── architecture.md
│   ├── deployment.md
│   ├── development.md
│   ├── milestones.md
│   ├── process.md
│   └── decisions/              # ADRs
├── scripts/                    # Build / dev helper scripts
│   ├── install-hooks.sh
│   └── pre-commit
├── .github/workflows/          # CI
├── Dockerfile                  # Production image
├── docker-compose.yml          # Production
├── docker-compose.dev.yml      # Dev (containerized)
├── deploy.sh                   # One-command deploy
├── .env.example
├── biome.json                  # Lint / format config
├── tsconfig.base.json          # TS shared base
├── package.json                # Root workspace config
├── SPEC.md                     # Product spec
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── LICENSE
```

## Code style

- **Lint and format**: enforced by [Biome](https://biomejs.dev). The pre-commit hook runs `biome check` on staged files. CI re-runs it on push.
- **TypeScript strict mode** is on, including `noUncheckedIndexedAccess`. New code is expected to type-check cleanly.
- **Imports**: type-only imports use `import type`. Node built-ins use the `node:` protocol.
- **Comments**: explain *why*, not *what*. Names should make the *what* obvious.
- **Files**: lowercase-with-dashes for source files, `PascalCase` for type names, `camelCase` for values.

## Editor

VS Code recommended. Install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) for in-editor lint and format-on-save. Other editors with LSP support work; configure them to format with `biome` on save.

## Testing

Tests are scaffolded but not yet present. Test framework choice (Vitest vs Bun's built-in test runner) is finalized at M2. Until then, `bun run test` is a no-op.

## Troubleshooting

- **`bun install` fails on first run**: ensure you're on Bun ≥ 1.1. Check with `bun --version`.
- **Pre-commit hook isn't firing**: re-run `bun run install-hooks`.
- **Docker build OOMs**: the multi-stage build is memory-hungry during `bun install`. Increase Docker's memory limit (Settings → Resources) to ≥ 4 GiB.
- **`docker compose up` says `OWNER_TOKEN is required`**: copy `.env.example` to `.env` and set `OWNER_TOKEN` to a real secret (`openssl rand -hex 32`).
