# Debt Hardening and Refactor Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove critical interaction-layer defects and high-risk debt without diluting the app's core goal: a fast, reliable, low-friction whiteboard.

**Architecture:** Keep the current interaction model and UX unchanged while hardening correctness boundaries (clipboard, undo grouping, persistence timing, and regression tests). Do not attempt broad rewrites of `main.ts` or `tools/select.ts` in this pass; instead, isolate and stabilize high-risk seams with targeted extraction and test coverage.

**Tech Stack:** TypeScript, Bun test runner, vanilla DOM/canvas architecture, Biome, Vite.

---

## Scope and Guardrails

- [ ] Preserve user-visible behavior for drawing, selecting, erasing, and copy/paste.
- [ ] Prioritize correctness and regression prevention over broad structural churn.
- [ ] Keep latency-sensitive paths fast (no extra per-move heavy work).
- [ ] Prefer additive test coverage for high-risk paths before changing logic.

---

## Issue Inventory (Fresh + Prior Review)

1. **Critical:** Mixed selection cut/copy data-loss path in `selectionclipboard.ts`.
2. **Important:** Eraser whole-object batch currently pushes many undo entries for one gesture.
3. **Important:** Select drag writes persistence on every pointer move (write amplification).
4. **Important:** Missing tests for `selectionclipboard` and high-risk interaction invariants.
5. **Medium (deferred to next pass):** `main.ts` and `tools/select.ts` are oversized and should be split incrementally once behavior seams are covered with tests.
6. **Medium (deferred):** Persistence failures are warn-only and not surfaced to users.

---

## Task 1: Reproduce and Lock the Clipboard Regression

**Files:**
- Create: `apps/web/src/selectionclipboard.test.ts`
- Modify: `apps/web/src/selectionclipboard.ts`

- [ ] **Step 1: Add failing regression tests**
  - Add tests for copy path decisions:
    - single image only -> image-bytes fast path
    - single image + shape -> must NOT use fast path
    - no images + vector objects -> native bundle path
    - mixed images + vectors -> PNG-only fallback

- [ ] **Step 2: Run targeted test and verify RED**
  - Run: `bun test apps/web/src/selectionclipboard.test.ts`
  - Expected before fix: failure for "single image + shape" branch behavior.

- [ ] **Step 3: Implement minimal fix**
  - Add a single helper predicate in `selectionclipboard.ts` for "only single image selected".
  - Ensure the fast path is gated by zero strokes, texts, and shapes.

- [ ] **Step 4: Run targeted tests and verify GREEN**
  - Run: `bun test apps/web/src/selectionclipboard.test.ts`
  - Expected: all new tests pass.

---

## Task 2: Make Eraser Whole-Object Gesture Undo Atomic

**Files:**
- Modify: `apps/web/src/ops.ts`
- Modify: `apps/web/src/ops.test.ts`
- Modify: `apps/web/src/main.ts`

- [ ] **Step 1: Add failing op-level tests**
  - Add tests that a new batch delete op:
    - applies all shape/text/image deletes as one logical op
    - unapplies all deletions symmetrically
    - is no-op safe for unknown ids

- [ ] **Step 2: Verify RED**
  - Run: `bun test apps/web/src/ops.test.ts`
  - Expected before implementation: tests fail due to missing op kind/behavior.

- [ ] **Step 3: Implement minimal composite delete op**
  - Add a new op kind (e.g., `delete-many`) for shape/text/image ids.
  - Route eraser `onWholeObjectErase` in `main.ts` to emit one composite op per gesture.
  - Preserve existing single-object select delete behavior.

- [ ] **Step 4: Verify GREEN**
  - Run: `bun test apps/web/src/ops.test.ts`
  - Expected: new + existing ops tests pass.

---

## Task 3: Remove Per-Move Persistence Writes in Select Drags

**Files:**
- Modify: `apps/web/src/tools/select.ts`
- Create: `apps/web/src/tools/select.persistence.test.ts` (or equivalent targeted test file)

- [ ] **Step 1: Add failing tests for persistence cadence**
  - Test that single-drag move does not call save on every move event.
  - Test that final committed state is persisted once on drag commit.
  - Test same invariant for multi-drag where practical (or cover via helper-level unit tests).

- [ ] **Step 2: Verify RED**
  - Run: `bun test apps/web/src/tools/select.persistence.test.ts`
  - Expected before implementation: fails because saves happen on pointer-move.

- [ ] **Step 3: Implement minimal persistence cadence change**
  - Keep in-memory visual updates per move.
  - Move persistence responsibility to commit paths (`commitDrag` / `commitMultiDrag`) only.
  - Ensure canceled/no-op drags do not write.

- [ ] **Step 4: Verify GREEN**
  - Run: `bun test apps/web/src/tools/select.persistence.test.ts`
  - Expected: save-cadence tests pass.

---

## Task 4: Full Verification and Risk Sweep

**Files:**
- Modify (if needed): `CHANGELOG.md` (only if behavior/bugfix note is warranted)

- [ ] **Step 1: Run targeted suites**
  - `bun test apps/web/src/selectionclipboard.test.ts`
  - `bun test apps/web/src/ops.test.ts`
  - `bun test apps/web/src/tools/select.persistence.test.ts`

- [ ] **Step 2: Run full project checks**
  - `bun run lint`
  - `bun run typecheck`
  - `bun test`

- [ ] **Step 3: Manual interaction sanity pass**
  - Verify: draw/erase/select/copy/cut/paste flows still feel unchanged.
  - Verify: mixed image+shape cut no longer loses non-image objects.
  - Verify: one undo reverses one eraser whole-object gesture.

---

## Deferred Follow-Up Plan (After This PR)

- [ ] Extract `selection`/`clipboard`/`undo bridge` seams from `main.ts` into modules after new tests provide safety net.
- [ ] Split `tools/select.ts` by concern (hit-test, drag math, menu actions, persistence bridge) in behavior-preserving steps.
- [ ] Introduce user-visible persistence failure policy (toast + retry strategy) with explicit UX decision.
