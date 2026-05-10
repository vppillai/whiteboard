# Process

How work is organized, reviewed, and shipped on this project.

This is a small, opinionated process — not a corporate playbook. The aim is to keep the codebase honest and the documentation truthful. None of this is bureaucracy for its own sake; each rule exists because skipping it produces a measurable problem.

## Documentation is part of the deliverable

Documentation is not a separate phase that happens after coding. It is part of every change.

If a change adds a new module, the architecture doc gets a section. If a change introduces a new env var, the deployment doc gains a row. If a change makes a non-obvious decision, an ADR gets written. If a change is user-visible, the changelog gets an entry.

A PR that ships code without the corresponding doc updates is incomplete. The pre-commit hook does not enforce this — the reviewer does.

## Tool changes: build a feel-test scenario before claiming code-complete

Pointer-handler / render changes (eraser, lasso, brush tuning, anything that produces visible ink under user gesture) **must be feel-tested against an explicit scenario before the change is declared done**. The scenario can be informal — "draw a horizontal line, sweep eraser perpendicular through it, verify the cut matches the cursor disk" — but it has to be performed, not assumed.

**Why this exists.** The M1 segment-eraser ate four iterations of code changes before the architecture (per-sample mask) was identified as the root problem. Each iteration patched the symptom; the underlying mismatch ("erased samples remove their full ink contribution, which is wider than what was under the cursor") was invisible from typecheck output. A 30-second feel-test on iteration 1 — drawing one line, wiping through it, looking — would have surfaced the architectural issue immediately.

**How to apply.** Before reporting any tool-affecting change as ready: run the dev server, perform the most direct gesture the change is meant to support, screenshot or describe what happens. If the result diverges from intent, that's the bug — diagnose at the architecture layer, not the arithmetic.

## Milestones are review gates

The work is partitioned into milestones (see [milestones.md](milestones.md)). A milestone is a unit of work with explicit exit criteria, not a date.

A milestone closes only after a structured review. The review applies even when the author and the reviewer are the same person — the act of running through the checklist forces honesty about what was actually completed vs what was waved-at.

The milestone-close checklist:

- All exit criteria met (the criteria are written down for the milestone — see milestones.md).
- `bun run lint` clean.
- `bun run typecheck` clean.
- **Feel-test on the target hardware passes.** Subjective; the user signs off that the milestone "feels" right when used as intended. M0 surfaced the value of this — the synthetic perftest passed but real-pen feel uncovered the blocky terminus, the prediction flicker, and the cross-device pan gap. None of those would have been caught by lint and typecheck.
- **Perf-at-scale gate (M1+).** From M1 onward, `?perftest=scale&n=500` (or the milestone's own scale benchmark) holds within the 16 ms frame budget. A miss is data, not vibes — it's the trigger for revisiting the WebGL deferral or other rendering work, and it warrants an ADR.
- The "as-built" section of `docs/architecture.md` reflects reality.
- Other docs updated if the milestone changed how to develop or deploy.
- `CHANGELOG.md` has an entry under `[Unreleased]`.
- An ADR exists for any non-obvious architectural choice made during the milestone.
- `docs/milestones.md` status updated.
- Tagged commit created (e.g. `m1-eraser-lasso`).

## ADRs (Architecture Decision Records)

When a non-obvious architectural choice is made, write an ADR.

What counts as "non-obvious":

- A choice between options where the loser is also reasonable (e.g. greenfield vs fork tldraw).
- A choice that future-you (or future-someone-else) will be tempted to undo without understanding the trade-off.
- A choice that touches multiple components or constrains future work.

What does *not* count:

- "I chose `for` over `while`."
- "I named this function `applyCurve`."
- Routine library selection (use any HTTP server library — no ADR needed unless the choice has architectural consequences).

ADRs live in [`docs/decisions/`](decisions/). Format is the [Michael Nygard template](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions). Numbered sequentially (`0001-…`, `0002-…`). They are immutable once accepted; supersede rather than edit.

## Pull requests

For any non-trivial change:

1. **Open an issue first** if the change isn't already scoped by a milestone. The issue is where the design conversation happens.
2. **Branch** from `main` (`feat/foo`, `fix/bar`, `docs/baz`).
3. **PR** with:
   - The change.
   - Updated docs.
   - A `CHANGELOG.md` entry under `[Unreleased]`.
   - The PR description should state which milestone exit criteria this advances, if any.
4. **Review.**
5. **Merge** by squash if the PR is < 5 commits and trivially linear; otherwise rebase to keep history clean.

PRs that touch the public spec, an existing ADR, or change deployment behavior get extra review attention.

## Releases

After a milestone closes:

- If the milestone is a "ship" milestone (currently: only the v1 line at the close of M4), tag a SemVer release: `v1.0.0`, etc.
- Otherwise, tag a milestone marker: `m1-stroke-engine`, etc. These are not SemVer tags; they exist to anchor history.

## Working with AI-assisted contributions

This project is itself AI-generated under human direction (see [CONTRIBUTING.md](../CONTRIBUTING.md)). Contributions are evaluated on the same basis regardless of whether the author is human, AI-assisted, or fully AI: does the code work, does it match the project's style and architecture, are the docs current.

## What this process does *not* do

- It doesn't enforce a code review *headcount*. One reviewer is fine.
- It doesn't require tests for everything (some things are hard to test cheaply — UI feel, especially). Tests are required for `packages/shared` logic and `apps/server` non-trivial code paths.
- It doesn't impose commit-message conventions (no required Conventional Commits). Just write clear messages.

This is a one-person-or-small-team project. Process exists where it pays for itself.
