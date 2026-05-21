# Contributing

Thanks for considering a contribution.

## A note on origins

This project is **AI-generated under human direction**. The code, documentation, and design decisions are produced primarily by an AI coding assistant working from a human-authored spec; acceptance gates and direction are human. Contributions from anyone — human, AI-assisted, or fully AI — are welcome on the same terms: clear PR, working code, updated docs.

## Before you write code

1. **Open an issue first** for anything non-trivial. Bug reports and feature ideas are welcome; "I'd like to add X" PRs without prior discussion are likely to be redirected.
2. Read [SPEC.md](SPEC.md) to understand the product scope and what is intentionally out of scope.
3. Read the relevant ADR(s) under [docs/decisions/](docs/decisions/) before proposing changes that touch architectural choices.
4. For architectural changes, add a new ADR under [docs/decisions/](docs/decisions/) using the next available number (the existing files follow `NNNN-kebab-title.md`); reference it from [docs/architecture.md](docs/architecture.md) and the [docs/process.md](docs/process.md) doc-update checklist.

## Local development

See [docs/development.md](docs/development.md). The short version: `bun install`, then `docker compose -f docker-compose.dev.yml up`.

## Style and quality gates

- Lint and format are enforced via [Biome](https://biomejs.dev). Run `bun run lint` before committing; the pre-commit hook will block obviously bad commits.
- TypeScript strict mode is on. New code is expected to type-check cleanly (`bun run typecheck`).
- Comments explain *why*, not *what*. Names should make the *what* obvious.
- Tests are required for non-trivial logic in `packages/shared` and `apps/server`. UI test coverage is best-effort. Run the suite with `bun test`; tests live alongside the modules they cover (`foo.test.ts` next to `foo.ts`).

## Pull requests

PRs that change behavior should include:

- The change itself.
- Updated documentation (architecture / development / deployment as relevant — see [docs/process.md](docs/process.md) for the doc-update checklist).
- A `CHANGELOG.md` entry under `[Unreleased]`.

## Reviews

Each milestone closes with a structured review — see [docs/process.md](docs/process.md). Substantial PRs are held to the same checklist.

## Reporting security issues

If you find something with security impact, please use GitHub's [private security advisory](https://github.com/vppillai/whiteboard/security/advisories/new) flow rather than filing a public issue.
