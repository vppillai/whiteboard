# M2 Export, Polish, and Settings Addenda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Worktree gotcha:** When dispatching implementer subagents to a git worktree, MANDATORY first steps in the subagent prompt: (a) `cd <worktree-path>`, (b) `git branch --show-current` to verify the expected branch, (c) `git status -sb` to confirm clean. The M1.7 Task 1 implementer worked in the parent repo's main without these checks; recovery cherry-pick cost ~30 minutes. Don't repeat.
>
> **DOM safety:** Throughout this plan, use `createElement` + `appendChild` + `textContent` for DOM construction. Use `element.replaceChildren()` (no args) to clear, or `element.replaceChildren(...nodes)` to replace contents. **Never use `innerHTML` with template-literal content** — even for "trusted" labels — to keep the codebase XSS-free by construction.

**Goal:** Ship the remaining v1 polish — export (PNG/SVG/PDF), color eyedropper tool, distraction-free mode, inline pressure curve editor per brush, first-run hint, Shift+[/]/F shortcuts, predicted-events toggle — and drop the SPEC § 4.2 floating toolbar commitment in favor of the existing right-click + keyboard surfaces.

**Architecture:** No new architectural primitives. Every feature plugs into existing surfaces — ADR 0007 Tool interface (eyedropper), ADR 0010 settings schema (sparse-additive `pressureCurve` + top-level `predictedEvents`), `popover.ts` (Cmd/Ctrl+E export popover), `toolmenu.ts` (global EXPORT row), `settings/panel-content.ts` (curve thumbnails + predicted-events toggle row). New `export/` directory holds the PNG/SVG/PDF pipeline. ADR 0011 captures the toolbar drop.

**Tech Stack:** TypeScript, vanilla DOM, Bun runtime, Bun's built-in test runner, Biome lint, Vite build, `perfect-freehand` for stroke geometry, `jspdf` (lazy-imported) for PDF export.

**Spec:** [docs/superpowers/specs/2026-05-09-m2-export-polish-design.md](../specs/2026-05-09-m2-export-polish-design.md)

---

## Pre-flight

- [ ] **Read the spec**

The spec at `docs/superpowers/specs/2026-05-09-m2-export-polish-design.md` is canonical. Every locked decision (§ 2 of the spec) is intentional. If you're tempted to deviate, surface it explicitly rather than silently changing course.

- [ ] **Confirm clean working tree**

Run: `git status -sb`
Expected: clean tree on the worktree branch (or `main` if not in a worktree).

- [ ] **Confirm baseline lint + typecheck + test pass**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run lint && bun run typecheck && bun test`
Expected: 0 errors. 26 tests pass. If anything fails, do NOT start — investigate baseline first.

- [ ] **Confirm dev server boots**

Run: `bun run dev` (in another terminal). Open `http://localhost:5173` (Vite default).
Expected: Whiteboard loads; you can draw a stroke. Stop with Ctrl+C when verified.

---

## Task 1: Schema extensions — `BrushConfig.pressureCurve` + `SettingsV1.predictedEvents` + setPresetField extension

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/web/src/settings.ts`
- Modify: `apps/web/src/settings.test.ts`

This task lays the type foundation. Everything else in M2 depends on these types existing.

- [ ] **Step 1: Add `pressureCurve` to `BrushConfig` in shared types**

Open `packages/shared/src/types.ts`. Find the `BrushConfig` type and add the optional `pressureCurve` field at the end (preserve existing fields):

```ts
export type BrushConfig = {
  size: number
  color: string
  thinning: number
  smoothing: number
  streamline: number
  taperStart: number
  taperEnd: number
  capStart: boolean
  capEnd: boolean
  pressureGamma: number
  opacity?: number
  /** Optional override of pressureGamma. Quadratic bezier from (0,0) to mid to (1,1)
   *  in normalized 0–1 coords. When present, replaces `pressureGamma` at render time. */
  pressureCurve?: { mid: [number, number] }
}
```

- [ ] **Step 2: Write failing tests for `predictedEvents` migration + `pressureCurve` preset semantics**

Open `apps/web/src/settings.test.ts`. Add at the bottom (after existing tests):

```ts
describe('settings: predictedEvents (M2)', () => {
  test('migrate v1-shape missing predictedEvents fills false', () => {
    const v1Missing = {
      schemaVersion: 1,
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: [],
      recentColors: [],
      fonts: [],
    }
    const out = migrate(v1Missing)
    expect(out.predictedEvents).toBe(false)
  })

  test('migrate type-mismatched predictedEvents (number) falls back to false', () => {
    const v1Bad = {
      schemaVersion: 1,
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: [],
      recentColors: [],
      fonts: [],
      predictedEvents: 42,
    }
    const out = migrate(v1Bad)
    expect(out.predictedEvents).toBe(false)
  })

  test('migrate well-formed predictedEvents preserved', () => {
    const v1Ok = {
      schemaVersion: 1,
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: [],
      recentColors: [],
      fonts: [],
      predictedEvents: true,
    }
    const out = migrate(v1Ok)
    expect(out.predictedEvents).toBe(true)
  })

  test('defaultV1() has predictedEvents = false', () => {
    const out = migrate(null)
    expect(out.predictedEvents).toBe(false)
  })
})

describe('settings: pressureCurve preset (M2)', () => {
  test('setPresetField accepts pressureCurve and persists', () => {
    __resetForTesting()
    setPresetField('pen', 'pressureCurve', { mid: [0.7, 0.3] })
    const eff = getEffectiveBrushConfig('pen', '#000000')
    expect(eff.pressureCurve).toEqual({ mid: [0.7, 0.3] })
  })

  test('clearPresetCurve removes only pressureCurve', () => {
    __resetForTesting()
    setPresetField('pen', 'pressureCurve', { mid: [0.7, 0.3] })
    setPresetField('pen', 'size', 5)
    clearPresetCurve('pen')
    const eff = getEffectiveBrushConfig('pen', '#000000')
    expect(eff.pressureCurve).toBeUndefined()
    expect(eff.size).toBe(5)
  })

  test('clearPresetCurve on last field GCs the preset entry', () => {
    __resetForTesting()
    setPresetField('pen', 'pressureCurve', { mid: [0.7, 0.3] })
    clearPresetCurve('pen')
    setPresetField('pen', 'size', 7)
    const eff = getEffectiveBrushConfig('pen', '#000000')
    expect(eff.pressureCurve).toBeUndefined()
    expect(eff.size).toBe(7)
  })

  test('validateOnePreset rejects malformed pressureCurve', () => {
    localStorage.setItem(
      'whiteboard:settings',
      JSON.stringify({
        schemaVersion: 1,
        color: '#ef4444',
        brush: 'pen',
        eraserSize: 'medium',
        grid: { type: 'dots', spacing: 24 },
        presets: { pen: { pressureCurve: { mid: 'banana' } } },
        customSwatches: [],
        recentColors: [],
        fonts: [],
        predictedEvents: false,
      }),
    )
    __resetForTesting()
    const eff = getEffectiveBrushConfig('pen', '#000000')
    expect(eff.pressureCurve).toBeUndefined()
  })
})
```

You'll also need to import `setPresetField`, `clearPresetCurve`, `getEffectiveBrushConfig`, and `__resetForTesting` at the top of the file if they aren't already imported. Add to the existing import list as needed.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test apps/web/src/settings.test.ts`
Expected: FAIL — `predictedEvents` not on output, `clearPresetCurve` not exported, `setPresetField` doesn't accept `'pressureCurve'`.

- [ ] **Step 4: Add `predictedEvents` to `SettingsV1`**

Open `apps/web/src/settings.ts`. Find `SettingsV1` interface and add the new field (preserve existing):

```ts
export interface SettingsV1 {
  schemaVersion: 1
  color: string
  brush: BrushId
  eraserSize: EraserSize
  grid: { type: GridType; spacing: number }
  presets: Partial<Record<BrushId, Partial<Omit<BrushConfig, 'color'>>>>
  customSwatches: string[]
  recentColors: string[]
  fonts: string[]
  predictedEvents: boolean   // NEW (M2)
  syncedAt?: number
  remoteId?: string
}
```

- [ ] **Step 5: Add `predictedEvents: false` to `defaultV1()`**

Find the `defaultV1()` function. Add the new field literal:

```ts
function defaultV1(): SettingsV1 {
  return {
    schemaVersion: 1,
    color: 'ink',
    brush: 'pen',
    eraserSize: 'medium',
    grid: { type: 'dots', spacing: 24 },
    presets: {},
    customSwatches: [],
    recentColors: [],
    fonts: [],
    predictedEvents: false,   // NEW (M2; ADR 0004)
  }
}
```

- [ ] **Step 6: Update `validate()` to deep-validate `predictedEvents`**

Find the `validate()` function. Where it validates each top-level field, add:

```ts
if (typeof parsed.predictedEvents !== 'boolean') {
  parsed.predictedEvents = false
}
```

- [ ] **Step 7: Extend `PresetField` union + `isValidPresetField` + `validateOnePreset` for `pressureCurve`**

Find the `PresetField` union type. Add `'pressureCurve'`:

```ts
export type PresetField =
  | 'size'
  | 'thinning'
  | 'smoothing'
  | 'streamline'
  | 'taperStart'
  | 'taperEnd'
  | 'capStart'
  | 'capEnd'
  | 'pressureGamma'
  | 'opacity'
  | 'pressureCurve'   // NEW (M2)
```

Find `isValidPresetField`. Add `'pressureCurve'` to the allowlist:

```ts
function isValidPresetField(field: string): field is PresetField {
  return (
    field === 'size' ||
    field === 'thinning' ||
    field === 'smoothing' ||
    field === 'streamline' ||
    field === 'taperStart' ||
    field === 'taperEnd' ||
    field === 'capStart' ||
    field === 'capEnd' ||
    field === 'pressureGamma' ||
    field === 'opacity' ||
    field === 'pressureCurve'
  )
}
```

Find `validateOnePreset`. Add per-field handling for `pressureCurve` (object-shape check):

```ts
function validateOnePreset(raw: unknown): Partial<Omit<BrushConfig, 'color'>> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, unknown> = {}
  const r = raw as Record<string, unknown>
  for (const key of ['size','thinning','smoothing','streamline','taperStart','taperEnd','pressureGamma','opacity'] as const) {
    if (typeof r[key] === 'number' && Number.isFinite(r[key])) out[key] = r[key]
  }
  for (const key of ['capStart','capEnd'] as const) {
    if (typeof r[key] === 'boolean') out[key] = r[key]
  }
  if (r.pressureCurve && typeof r.pressureCurve === 'object') {
    const pc = r.pressureCurve as Record<string, unknown>
    if (
      Array.isArray(pc.mid) &&
      pc.mid.length === 2 &&
      typeof pc.mid[0] === 'number' && Number.isFinite(pc.mid[0]) &&
      typeof pc.mid[1] === 'number' && Number.isFinite(pc.mid[1])
    ) {
      out.pressureCurve = { mid: [pc.mid[0], pc.mid[1]] as [number, number] }
    }
  }
  if (Object.keys(out).length === 0) return null
  return out as Partial<Omit<BrushConfig, 'color'>>
}
```

- [ ] **Step 8: Add `clearPresetCurve(brushId)` helper**

Below `clearPreset`, add:

```ts
export function clearPresetCurve(brushId: BrushId): void {
  const cur = state.presets[brushId]
  if (!cur || cur.pressureCurve === undefined) return
  delete cur.pressureCurve
  if (Object.keys(cur).length === 0) {
    delete state.presets[brushId]
  }
  persist()
  emit()
}
```

- [ ] **Step 9: Run the tests and verify they pass**

Run: `bun test apps/web/src/settings.test.ts`
Expected: PASS — all M2 tests + existing M1.7 tests pass.

- [ ] **Step 10: Run full lint + typecheck + test**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/types.ts apps/web/src/settings.ts apps/web/src/settings.test.ts
git commit -m "$(cat <<'EOF'
feat(m2): schema extensions — predictedEvents + pressureCurve

- BrushConfig gains optional pressureCurve { mid: [number, number] }
  (quadratic bezier override of pressureGamma; sparse semantics).
- SettingsV1 gains top-level predictedEvents: boolean (default false
  per ADR 0004; ?predict=1 URL flag continues to win as session override).
- setPresetField accepts 'pressureCurve' via PresetField union extension
  and validateOnePreset deep-validation.
- clearPresetCurve helper GCs the preset entry when it becomes empty.
- migrate() mechanical-fill handles missing predictedEvents per ADR 0010.

5 new unit tests cover migration, validation, and preset semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pressure-curve math — `bezierY` + `applyPressure`

**Files:**
- Create: `apps/web/src/stroke.test.ts`
- Modify: `apps/web/src/stroke.ts`

This task adds the pure math the renderer needs to apply a custom pressure curve. Closed-form bezier inversion keeps it cheap on the hot stroke-render path.

- [ ] **Step 1: Write failing tests for `bezierY` and `applyPressure`**

Create `apps/web/src/stroke.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { BrushConfig } from '@whiteboard/shared'
import { applyPressure, bezierY } from './stroke'

describe('stroke: bezierY', () => {
  test('boundary: bezierY(0, anything) === 0', () => {
    expect(bezierY(0, [0.5, 0.5])).toBeCloseTo(0, 6)
    expect(bezierY(0, [0.7, 0.3])).toBeCloseTo(0, 6)
    expect(bezierY(0, [0.2, 0.8])).toBeCloseTo(0, 6)
  })

  test('boundary: bezierY(1, anything) === 1', () => {
    expect(bezierY(1, [0.5, 0.5])).toBeCloseTo(1, 6)
    expect(bezierY(1, [0.7, 0.3])).toBeCloseTo(1, 6)
    expect(bezierY(1, [0.2, 0.8])).toBeCloseTo(1, 6)
  })

  test('linear curve: mid at (0.5, 0.5) gives output === input', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(bezierY(x, [0.5, 0.5])).toBeCloseTo(x, 5)
    }
  })

  test('curve below diagonal: mid at (0.5, 0.25)', () => {
    expect(bezierY(0.5, [0.5, 0.25])).toBeCloseTo(0.25, 5)
    expect(bezierY(0.25, [0.5, 0.25])).toBeLessThan(0.25)
  })

  test('curve above diagonal: mid at (0.5, 0.75)', () => {
    expect(bezierY(0.5, [0.5, 0.75])).toBeCloseTo(0.75, 5)
    expect(bezierY(0.25, [0.5, 0.75])).toBeGreaterThan(0.25)
  })

  test('output is clamped to [0, 1]', () => {
    for (const x of [0, 0.5, 1]) {
      const y = bezierY(x, [0.9, 0.1])
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })

  test('monotonic in x for sane curves', () => {
    let last = -1
    for (let x = 0; x <= 1; x += 0.1) {
      const y = bezierY(x, [0.5, 0.3])
      expect(y).toBeGreaterThanOrEqual(last - 1e-9)
      last = y
    }
  })
})

describe('stroke: applyPressure', () => {
  const baseBrush: BrushConfig = {
    size: 3, color: '#000', thinning: 0.6, smoothing: 0.7,
    streamline: 0.4, taperStart: 0, taperEnd: 0,
    capStart: true, capEnd: true, pressureGamma: 1.5, opacity: 1,
  }

  test('no curve override → uses pressureGamma', () => {
    const out = applyPressure(0.5, baseBrush)
    expect(out).toBeCloseTo(0.5 ** 1.5, 6)
  })

  test('with curve override → uses bezier', () => {
    const brush = { ...baseBrush, pressureCurve: { mid: [0.5, 0.25] as [number, number] } }
    const out = applyPressure(0.5, brush)
    expect(out).toBeCloseTo(0.25, 5)
  })

  test('curve takes precedence over pressureGamma', () => {
    const brush = {
      ...baseBrush,
      pressureGamma: 3.0,
      pressureCurve: { mid: [0.5, 0.5] as [number, number] },
    }
    const out = applyPressure(0.5, brush)
    expect(out).toBeCloseTo(0.5, 5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/src/stroke.test.ts`
Expected: FAIL — `bezierY` and `applyPressure` not exported from `stroke.ts`.

- [ ] **Step 3: Implement `bezierY` and `applyPressure` in `stroke.ts`**

Open `apps/web/src/stroke.ts`. Add at the end of the file (preserve all existing exports):

```ts
/**
 * Quadratic bezier from (0,0) to mid to (1,1) in normalized 0–1 coords.
 * Solves t from x using the closed-form quadratic, then evaluates y at t.
 *
 * x(t) = 2(1-t)t·mx + t² ; rearranges to: at² + bt + c = 0
 *   with a = 1 - 2mx, b = 2mx, c = -x
 */
export function bezierY(x: number, mid: readonly [number, number]): number {
  const [mx, my] = mid
  const a = 1 - 2 * mx
  const b = 2 * mx
  const c = -x
  let t: number
  if (Math.abs(a) < 1e-9) {
    t = -c / b
  } else {
    const disc = b * b - 4 * a * c
    t = (-b + Math.sqrt(Math.max(0, disc))) / (2 * a)
  }
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const y = 2 * (1 - t) * t * my + t * t
  return y < 0 ? 0 : y > 1 ? 1 : y
}

/**
 * Map raw pen pressure to effective pressure for stroke rendering. When a
 * brush has a `pressureCurve` override, use the bezier; otherwise fall back
 * to the `pressureGamma` power curve.
 */
export function applyPressure(input: number, brush: BrushConfig): number {
  if (brush.pressureCurve) return bezierY(input, brush.pressureCurve.mid)
  return input ** brush.pressureGamma
}
```

(`BrushConfig` should already be imported from `@whiteboard/shared` in `stroke.ts`. If not, add the import.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/web/src/stroke.test.ts`
Expected: PASS — 9 tests pass.

- [ ] **Step 5: Replace the existing `pressureGamma` call site with `applyPressure`**

Locate the existing γ call site:

```bash
grep -n 'pressureGamma' apps/web/src/stroke.ts apps/web/src/pointer.ts
```

If `stroke.ts` has `input ** brush.pressureGamma`, replace it with `applyPressure(input, brush)`. If `pointer.ts` is the call site (in the sample-preprocessing function that maps raw `e.pressure` to `Sample.p`), replace `Math.pow(e.pressure, brush.pressureGamma)` with `applyPressure(e.pressure, brush)`. Adjust accordingly.

- [ ] **Step 6: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stroke.ts apps/web/src/stroke.test.ts
git commit -m "$(cat <<'EOF'
feat(m2): pressure curve math — bezierY + applyPressure

Closed-form quadratic bezier inversion: solve t from x via the
quadratic formula, evaluate y at t. Keeps the hot stroke-render path
under 1 µs per sample.

applyPressure(input, brush) dispatches:
- pressureCurve override present → bezierY(input, mid)
- otherwise → input ** pressureGamma (existing behavior)

The existing pressureGamma call site swaps to applyPressure; behavior
is identical until M2's curve UI lands.

9 unit tests cover boundaries, linear, above/below diagonal,
clamping, monotonicity, and dispatch ordering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extract `paintBoard` helper from `render.ts`

**Files:**
- Modify: `apps/web/src/render.ts`

The PNG export needs to render a board to an arbitrary `CanvasRenderingContext2D`, not just the on-screen committed canvas. Extracting `paintBoard(ctx, bounds, settings, strokes)` shares the rendering pipeline.

- [ ] **Step 1: Read the current `render.ts` structure**

```bash
cat apps/web/src/render.ts | head -200
```

Locate the function that paints the committed layer (likely `paintCommitted` or similar). It draws: grid background → stroke composite → destination-out for `erasedStamps`.

- [ ] **Step 2: Extract `paintBoard` as an exported function**

Refactor: factor out the board-painting body into a new exported function. Signature:

```ts
export interface PaintBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Renders grid + composited strokes (with destination-out for erasedStamps)
 * into the given context. The context is assumed already translated/scaled
 * so that (bounds.x, bounds.y) maps to the context's origin.
 *
 * Used by the on-screen committed render and the PNG export pipeline so
 * both paths render through the same code.
 */
export function paintBoard(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bounds: PaintBounds,
  settings: { grid: { type: GridType; spacing: number } },
  strokes: Stroke[],
): void {
  // ... existing body, parameterized by ctx + bounds ...
}
```

The on-screen render path (the existing call site) now wraps `paintBoard` with: clear committed canvas → set DPR transform → call `paintBoard` with the visible viewport bounds.

The exact refactor depends on the current shape of `render.ts`. Preserve all existing rendering semantics (grid type, ink color, destination-out timing). Three-canvas pipeline stays unchanged — `paintBoard` only encapsulates the *committed* layer painting.

- [ ] **Step 3: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors, tests pass.

- [ ] **Step 4: Manual smoke-test the on-screen render**

Run: `bun run dev`. Open the app. Draw a few strokes. Pan, zoom, change theme.
Expected: identical visual behavior to before the refactor. Strokes render correctly, erased-holes preserved, grid renders.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/render.ts
git commit -m "$(cat <<'EOF'
refactor(m2): extract paintBoard(ctx, bounds, settings, strokes) helper

Pure refactor — no behavior change. Factors out the grid + stroke
composite + destination-out pass so PNG export can share the on-screen
committed-render code path. Avoids a future "two renderers slowly
drifting" problem.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: First-run hint module (`firstrun.ts`)

**Files:**
- Create: `apps/web/src/firstrun.ts`
- Create: `apps/web/src/firstrun.test.ts`
- Modify: `apps/web/src/style.css`

- [ ] **Step 1: Write failing tests for `firstrun.ts`**

Create `apps/web/src/firstrun.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { dismissFirstRunHint, mountFirstRunHint, __resetForTesting } from './firstrun'

function setupAppRoot(): HTMLElement {
  document.body.replaceChildren()
  const app = document.createElement('div')
  app.id = 'app'
  document.body.appendChild(app)
  return app
}

describe('firstrun', () => {
  beforeEach(() => {
    setupAppRoot()
    localStorage.clear()
    __resetForTesting()
  })
  afterEach(() => {
    localStorage.clear()
  })

  test('mountFirstRunHint adds element when localStorage flag absent', () => {
    mountFirstRunHint(document.getElementById('app')!)
    expect(document.querySelector('.firstrun-hint')).toBeTruthy()
  })

  test('mountFirstRunHint does not add element when flag set', () => {
    localStorage.setItem('whiteboard:hint-shown', 'true')
    mountFirstRunHint(document.getElementById('app')!)
    expect(document.querySelector('.firstrun-hint')).toBeNull()
  })

  test('dismissFirstRunHint sets localStorage flag', () => {
    mountFirstRunHint(document.getElementById('app')!)
    dismissFirstRunHint()
    expect(localStorage.getItem('whiteboard:hint-shown')).toBe('true')
  })

  test('dismissFirstRunHint adds .fading class', () => {
    mountFirstRunHint(document.getElementById('app')!)
    dismissFirstRunHint()
    expect(document.querySelector('.firstrun-hint')?.classList.contains('fading')).toBe(true)
  })

  test('dismissFirstRunHint is idempotent (subsequent calls no-op)', () => {
    mountFirstRunHint(document.getElementById('app')!)
    dismissFirstRunHint()
    expect(() => dismissFirstRunHint()).not.toThrow()
  })

  test('mountFirstRunHint after dismissal does not re-mount', () => {
    mountFirstRunHint(document.getElementById('app')!)
    dismissFirstRunHint()
    document.querySelector('.firstrun-hint')?.remove()
    mountFirstRunHint(document.getElementById('app')!)
    expect(document.querySelector('.firstrun-hint')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/src/firstrun.test.ts`
Expected: FAIL — `firstrun.ts` doesn't exist.

- [ ] **Step 3: Implement `firstrun.ts`**

Create `apps/web/src/firstrun.ts`:

```ts
/**
 * First-run hint. Empty board shows a single line of guidance:
 * "Right-click for tools · ? for help" — fades out on first stroke commit
 * and never shows again on this device.
 */

const HINT_TEXT = 'Right-click for tools · ? for help'
const STORAGE_KEY = 'whiteboard:hint-shown'

let hintEl: HTMLElement | null = null
let dismissed = false

export function mountFirstRunHint(parent: HTMLElement): void {
  if (dismissed) return
  if (localStorage.getItem(STORAGE_KEY) === 'true') return
  if (hintEl) return
  const el = document.createElement('div')
  el.className = 'firstrun-hint'
  el.textContent = HINT_TEXT
  parent.appendChild(el)
  hintEl = el
}

export function dismissFirstRunHint(): void {
  if (dismissed) return
  dismissed = true
  localStorage.setItem(STORAGE_KEY, 'true')
  if (!hintEl) return
  hintEl.classList.add('fading')
  const el = hintEl
  hintEl = null
  el.addEventListener('transitionend', () => {
    el.remove()
  }, { once: true })
}

/** Test-only. Resets module state between tests. */
export function __resetForTesting(): void {
  hintEl?.remove()
  hintEl = null
  dismissed = false
}
```

- [ ] **Step 4: Add CSS for the hint to `style.css`**

Open `apps/web/src/style.css`. Append:

```css
.firstrun-hint {
  position: fixed;
  bottom: 25vh;
  left: 50%;
  transform: translateX(-50%);
  color: oklch(from var(--ink) calc(l * 0.5) c h);
  font-size: 14px;
  font-weight: 500;
  pointer-events: none;
  user-select: none;
  transition: opacity 200ms ease-out;
  opacity: 1;
  z-index: 5;
}
.firstrun-hint.fading {
  opacity: 0;
}
body.distraction-free .firstrun-hint {
  display: none;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/web/src/firstrun.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Run full suite**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/firstrun.ts apps/web/src/firstrun.test.ts apps/web/src/style.css
git commit -m "$(cat <<'EOF'
feat(m2): firstrun.ts — empty-board discovery hint

Single line "Right-click for tools · ? for help" centered ~25% from
viewport bottom. Theme-aware muted color via oklch derivation from
--ink. Fades out (200ms) when dismissed; localStorage
whiteboard:hint-shown=true prevents re-showing.

mountFirstRunHint(parent) is idempotent and respects the flag.
dismissFirstRunHint() is idempotent. Orchestrator wires dismissal at
the first create-op emission point (Task 18).

DOM constructed via createElement + textContent; no innerHTML.

6 unit tests cover mount/dismiss semantics and idempotence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Distraction-free mode (`distractionfree.ts` + `F` key + Esc handler)

**Files:**
- Create: `apps/web/src/distractionfree.ts`
- Create: `apps/web/src/distractionfree.test.ts`
- Modify: `apps/web/src/style.css`
- Modify: `apps/web/src/keymap.ts` (add F key handler)

- [ ] **Step 1: Write failing tests for `distractionfree.ts`**

Create `apps/web/src/distractionfree.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test'
import { isDistractionFree, toggleDistractionFree, exitDistractionFree, __resetForTesting } from './distractionfree'

describe('distractionfree', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    document.body.classList.remove('distraction-free')
    __resetForTesting()
  })

  test('initial state: not distraction-free', () => {
    expect(isDistractionFree()).toBe(false)
    expect(document.body.classList.contains('distraction-free')).toBe(false)
  })

  test('toggleDistractionFree enters mode', () => {
    toggleDistractionFree()
    expect(isDistractionFree()).toBe(true)
    expect(document.body.classList.contains('distraction-free')).toBe(true)
  })

  test('toggleDistractionFree exits mode (second call)', () => {
    toggleDistractionFree()
    toggleDistractionFree()
    expect(isDistractionFree()).toBe(false)
    expect(document.body.classList.contains('distraction-free')).toBe(false)
  })

  test('exitDistractionFree no-op when not active', () => {
    exitDistractionFree()
    expect(isDistractionFree()).toBe(false)
  })

  test('exitDistractionFree exits when active', () => {
    toggleDistractionFree()
    exitDistractionFree()
    expect(isDistractionFree()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/src/distractionfree.test.ts`
Expected: FAIL — `distractionfree.ts` doesn't exist.

- [ ] **Step 3: Implement `distractionfree.ts`**

Create `apps/web/src/distractionfree.ts`:

```ts
/**
 * Distraction-free drawing mode. F toggles a body class that hides app
 * chrome (Help pill, Tool pill, popovers, settings panel). Does NOT
 * invoke the browser Fullscreen API — F11 already covers that.
 *
 * On entry: dismisses any open popover, auto-closes the settings panel,
 * shows a 2-second exit-affordance toast.
 *
 * On exit: removes the body class. Esc is the primary exit key (handled
 * in keymap.ts); F also exits (toggle).
 */

const CLASS = 'distraction-free'
const TOAST_ID = 'df-exit-toast'
const TOAST_MS = 2000

export interface DistractionFreeOptions {
  appEl?: HTMLElement
  /** Optional best-effort dismissals; safe to ignore (caller may not have these). */
  dismissPopover?: () => void
  dismissSidePanel?: () => void
}

export function isDistractionFree(): boolean {
  return document.body.classList.contains(CLASS)
}

export function toggleDistractionFree(opts: DistractionFreeOptions = {}): void {
  if (isDistractionFree()) {
    exitDistractionFree()
  } else {
    enterDistractionFree(opts)
  }
}

export function enterDistractionFree(opts: DistractionFreeOptions = {}): void {
  if (isDistractionFree()) return
  document.body.classList.add(CLASS)
  // Best-effort dismissal of transient surfaces
  try { opts.dismissPopover?.() } catch { /* ignore */ }
  try { opts.dismissSidePanel?.() } catch { /* ignore */ }
  showExitToast()
  opts.appEl?.focus?.()
}

export function exitDistractionFree(): void {
  if (!isDistractionFree()) return
  document.body.classList.remove(CLASS)
}

function showExitToast(): void {
  let toast = document.getElementById(TOAST_ID)
  if (!toast) {
    toast = document.createElement('div')
    toast.id = TOAST_ID
    toast.className = 'df-exit-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = 'Press Esc or F to exit'
  toast.classList.add('visible')
  window.setTimeout(() => {
    toast?.classList.remove('visible')
    window.setTimeout(() => toast?.remove(), 300)
  }, TOAST_MS)
}

/** Test-only. */
export function __resetForTesting(): void {
  document.body.classList.remove(CLASS)
  document.getElementById(TOAST_ID)?.remove()
}
```

(`opts.dismissPopover` and `opts.dismissSidePanel` are injected callbacks — Task 18 wires them from `popover.ts` and `sidepanel.ts`. This keeps `distractionfree.ts` decoupled from those modules so the unit test doesn't need to mock them.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/web/src/distractionfree.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add CSS to `style.css`**

Append to `apps/web/src/style.css`:

```css
/* Distraction-free mode — hides chrome */
body.distraction-free .pill,
body.distraction-free .helppill,
body.distraction-free .toolmenu,
body.distraction-free .sidepanel {
  display: none !important;
}
body.distraction-free .popover {
  display: none !important;
}

/* Exit-affordance toast */
.df-exit-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--toast-bg, oklch(0.25 0 0));
  color: var(--toast-fg, oklch(0.95 0 0));
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  opacity: 0;
  transition: opacity 250ms ease-out;
  pointer-events: none;
  z-index: 50;
}
.df-exit-toast.visible {
  opacity: 1;
}
```

- [ ] **Step 6: Add F key handler in `keymap.ts`**

Open `apps/web/src/keymap.ts`. Find the bare-key dispatch block (the one that handles `B`, `P`, `S`, `T`, `M`, etc.). Add a handler for `F`:

```ts
if (k === 'f' && !meta && !alt && !shift) {
  preventAndCall(e, handlers.toggleDistractionFree)
  return
}
```

Add `toggleDistractionFree` to the `Handlers` interface at the top of the file:

```ts
interface Handlers {
  // ... existing handlers ...
  toggleDistractionFree: () => void
}
```

- [ ] **Step 7: Extend Esc handler to exit distraction-free first**

In `keymap.ts`, find the existing `Esc` handler. Add a guard at the top:

```ts
if (e.key === 'Escape') {
  if (isDistractionFree()) {
    exitDistractionFree()
    e.preventDefault()
    return
  }
  // ... existing Esc behavior (clear-confirm cancel, popover dismiss, etc.)
}
```

Import `isDistractionFree, exitDistractionFree` from `./distractionfree` at the top.

- [ ] **Step 8: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/distractionfree.ts apps/web/src/distractionfree.test.ts apps/web/src/keymap.ts apps/web/src/style.css
git commit -m "$(cat <<'EOF'
feat(m2): F-toggle distraction-free mode

Hides app chrome (Help pill, Tool pill, popovers, settings panel) via
a single body class. Does NOT trigger the browser Fullscreen API — F11
already covers that universally.

On entry: dismiss any open popover, auto-close settings panel, show a
2-second exit-affordance toast "Press Esc or F to exit".
On exit: remove class. Esc handler in keymap.ts checks
distraction-free state first.

Dismissal callbacks are injected via opts to keep distractionfree.ts
decoupled from popover.ts / sidepanel.ts (orchestrator wires at Task 18).

5 unit tests cover toggle/enter/exit semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `Shift+[` / `Shift+]` palette cycle

**Files:**
- Modify: `apps/web/src/colorpicker.ts` (export `CURATED_COLORS`)
- Modify: `apps/web/src/keymap.ts` (add Shift+[/] handlers)
- Create: `apps/web/src/colorpicker.test.ts`

- [ ] **Step 1: Promote `CURATED_COLORS` to module export in `colorpicker.ts`**

Open `apps/web/src/colorpicker.ts`. Find the curated colors constant. Add `export`:

```ts
export const CURATED_COLORS: readonly string[] = [
  /* ... existing 10 hex strings ... */
]
```

If the constant is currently named differently, rename to `CURATED_COLORS` and update internal call sites.

- [ ] **Step 2: Write failing test for the palette cycle helper**

Create `apps/web/src/colorpicker.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { cyclePaletteIndex, CURATED_COLORS } from './colorpicker'

describe('colorpicker: cyclePaletteIndex', () => {
  test('returns 0 when current is not in CURATED_COLORS', () => {
    expect(cyclePaletteIndex('#unknown', 1)).toBe(0)
    expect(cyclePaletteIndex('ink', 1)).toBe(0)
  })

  test('forward cycle: 0 → 1', () => {
    expect(cyclePaletteIndex(CURATED_COLORS[0], 1)).toBe(1)
  })

  test('backward cycle: 0 → 9 (wrap)', () => {
    expect(cyclePaletteIndex(CURATED_COLORS[0], -1)).toBe(CURATED_COLORS.length - 1)
  })

  test('forward cycle wraps: 9 → 0', () => {
    expect(cyclePaletteIndex(CURATED_COLORS[CURATED_COLORS.length - 1], 1)).toBe(0)
  })

  test('backward cycle: 1 → 0', () => {
    expect(cyclePaletteIndex(CURATED_COLORS[1], -1)).toBe(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test apps/web/src/colorpicker.test.ts`
Expected: FAIL — `cyclePaletteIndex` not exported.

- [ ] **Step 4: Add `cyclePaletteIndex` to `colorpicker.ts`**

Add at the end of `colorpicker.ts`:

```ts
/**
 * Compute the next CURATED_COLORS index given the current color and direction.
 * Returns 0 if `current` isn't in the curated palette (custom / recent / 'ink' token).
 */
export function cyclePaletteIndex(current: string, direction: 1 | -1): number {
  const idx = CURATED_COLORS.indexOf(current)
  if (idx === -1) return 0
  const n = CURATED_COLORS.length
  return (idx + direction + n) % n
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/web/src/colorpicker.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Add Shift+[ / Shift+] handlers in `keymap.ts`**

Open `apps/web/src/keymap.ts`. The existing `[` / `]` handler (brush size adjustment) likely checks `!shift`. Add Shift-modified branches before the bare-key check:

```ts
// Shift + [/] — cycle curated palette (M2)
if (k === '[' && shift && !meta && !alt) {
  preventAndCall(e, handlers.cyclePaletteBackward)
  return
}
if (k === ']' && shift && !meta && !alt) {
  preventAndCall(e, handlers.cyclePaletteForward)
  return
}

// Existing bare [/] — brush size (ensure this checks !shift)
```

Add the handler types to `Handlers`:

```ts
interface Handlers {
  // ... existing ...
  cyclePaletteForward: () => void
  cyclePaletteBackward: () => void
}
```

- [ ] **Step 7: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/colorpicker.ts apps/web/src/colorpicker.test.ts apps/web/src/keymap.ts
git commit -m "$(cat <<'EOF'
feat(m2): Shift+[/] cycle curated palette

CURATED_COLORS promoted to module export; cyclePaletteIndex helper
computes wrap-around index. Shift+[ → backward, Shift+] → forward.
Bound globally (any tool active). Skips custom + recent — explicit
recent-color picks aren't disturbed by rapid cycling.

Wiring of the handlers happens at Task 18 (main.ts orchestrator).

5 unit tests cover the index helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Eyedropper tool (`tools/eyedropper.ts`)

**Files:**
- Create: `apps/web/src/tools/eyedropper.ts`
- Create: `apps/web/src/tools/eyedropper.test.ts`
- Modify: `apps/web/src/tools/types.ts` (extend `ToolId`)
- Modify: `apps/web/src/tools/index.ts` (export the new tool)
- Modify: `apps/web/src/keymap.ts` (add `I` handler)

- [ ] **Step 1: Extend `ToolId` to include `'eyedropper'`**

Open `apps/web/src/tools/types.ts`. Find `ToolId` union:

```ts
export type ToolId = 'pen' | 'eraser' | 'lasso' | 'eyedropper'
```

- [ ] **Step 2: Write failing tests for eyedropper sampling**

Create `apps/web/src/tools/eyedropper.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { rgbaToHex } from './eyedropper'

describe('eyedropper: rgbaToHex', () => {
  test('opaque red', () => {
    expect(rgbaToHex(255, 0, 0, 255)).toBe('#ff0000')
  })

  test('opaque white', () => {
    expect(rgbaToHex(255, 255, 255, 255)).toBe('#ffffff')
  })

  test('opaque black', () => {
    expect(rgbaToHex(0, 0, 0, 255)).toBe('#000000')
  })

  test('low-alpha pixel returns null', () => {
    expect(rgbaToHex(100, 100, 100, 100)).toBe(null)
  })

  test('alpha threshold boundary (128 = ~0.5)', () => {
    expect(rgbaToHex(100, 100, 100, 128)).toBe('#646464')
    expect(rgbaToHex(100, 100, 100, 127)).toBe(null)
  })

  test('lowercase hex output', () => {
    expect(rgbaToHex(171, 205, 239, 255)).toBe('#abcdef')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test apps/web/src/tools/eyedropper.test.ts`
Expected: FAIL — `eyedropper.ts` doesn't exist.

- [ ] **Step 4: Implement `tools/eyedropper.ts`**

Create `apps/web/src/tools/eyedropper.ts`:

```ts
/**
 * Color eyedropper tool. Modal — activated via I key, right-click TOOL pill,
 * or programmatic setTool('eyedropper'). On pointermove, samples the strokes
 * offscreen layer (ADR 0009) at cursor position. On pointerdown, commits the
 * sampled color to settings + reverts to the previous tool.
 *
 * Conforms to ADR 0007: owns its cursor, sample logic, and right-click pill.
 */

import { pushRecentColor, setColor } from '../settings'
import type { Tool, ToolContext, ToolId } from './types'

export interface EyedropperToolCallbacks {
  /** Look up the strokes offscreen canvas (ADR 0009 destination-out target). */
  getStrokesLayer: () => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  /** Switch the active tool — typically the orchestrator's setTool. */
  setTool: (id: ToolId) => void
  /** Read the currently active tool id. */
  getActiveToolId: () => ToolId
}

export interface EyedropperToolOptions {
  callbacks: EyedropperToolCallbacks
}

export function createEyedropperTool(opts: EyedropperToolOptions): Tool {
  const { callbacks } = opts
  let prevToolId: ToolId | null = null
  let lastSampledHex: string | null = null
  let cursorScreenX = 0
  let cursorScreenY = 0
  let cursorActive = false

  return {
    id: 'eyedropper' as ToolId,
    cursor: 'none',

    onActivate(_ctx: ToolContext) {
      const cur = callbacks.getActiveToolId()
      prevToolId = cur === 'eyedropper' ? null : cur
    },

    onPointerDown(_e: PointerEvent, _ctx: ToolContext) {
      if (lastSampledHex) {
        setColor(lastSampledHex)
        pushRecentColor(lastSampledHex)
      }
      const restore = prevToolId
      prevToolId = null
      cursorActive = false
      lastSampledHex = null
      if (restore !== null) {
        callbacks.setTool(restore)
      }
    },

    onPointerMove(e: PointerEvent, _ctx: ToolContext) {
      cursorScreenX = e.clientX
      cursorScreenY = e.clientY
      cursorActive = true
      const sampled = sampleAt(callbacks.getStrokesLayer(), e.clientX, e.clientY)
      if (sampled !== null) {
        lastSampledHex = sampled
      }
    },

    onPointerUp(_e: PointerEvent, _ctx: ToolContext) {
      // commit happens on pointerdown; no-op here
    },

    redraw(ctx: ToolContext) {
      if (!cursorActive) return
      const layer = ctx.liveLayer
      const c = layer.getContext('2d')
      if (!c) return
      const dpr = ctx.dpr
      const r = 8 * dpr
      const cx = cursorScreenX * dpr
      const cy = cursorScreenY * dpr
      c.save()
      c.beginPath()
      c.arc(cx, cy, r, 0, Math.PI * 2)
      c.fillStyle = lastSampledHex ?? '#ffffff'
      c.fill()
      c.lineWidth = 1.5 * dpr
      c.strokeStyle = '#ffffff'
      c.stroke()
      c.lineWidth = 0.5 * dpr
      c.strokeStyle = '#000000'
      c.stroke()
      c.restore()
    },

    cleanup() {
      cursorActive = false
      lastSampledHex = null
      prevToolId = null
    },
  }
}

function sampleAt(
  layer: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  screenX: number,
  screenY: number,
): string | null {
  try {
    const dpr = window.devicePixelRatio || 1
    const px = Math.round(screenX * dpr)
    const py = Math.round(screenY * dpr)
    const data = layer.getImageData(px, py, 1, 1).data
    return rgbaToHex(data[0], data[1], data[2], data[3])
  } catch {
    return null
  }
}

export function rgbaToHex(r: number, g: number, b: number, a: number): string | null {
  if (a < 128) return null
  const hex = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
```

(If the `Tool` interface doesn't have `onActivate`, integrate the prevToolId-capture logic into a `wasJustActivated` flag set by the orchestrator at `setTool` time. Match the actual `Tool` interface shape.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/web/src/tools/eyedropper.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Export the new tool from `tools/index.ts`**

Open `apps/web/src/tools/index.ts`. Add:

```ts
export {
  createEyedropperTool,
  type EyedropperToolCallbacks,
  type EyedropperToolOptions,
} from './eyedropper'
```

- [ ] **Step 7: Add `I` handler in `keymap.ts`**

Open `apps/web/src/keymap.ts`. In the bare-key dispatch block, add:

```ts
if (k === 'i' && !meta && !alt && !shift) {
  preventAndCall(e, handlers.selectEyedropperTool)
  return
}
```

Add the handler to `Handlers`:

```ts
interface Handlers {
  // ... existing ...
  selectEyedropperTool: () => void
}
```

- [ ] **Step 8: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/tools/eyedropper.ts apps/web/src/tools/eyedropper.test.ts apps/web/src/tools/types.ts apps/web/src/tools/index.ts apps/web/src/keymap.ts
git commit -m "$(cat <<'EOF'
feat(m2): eyedropper tool — I key, sample from strokes layer

ADR 0007 conformance. Modal tool — captures previous tool on activate,
samples color via getImageData on the strokes offscreen layer (ADR 0009)
during pointermove, commits + reverts on pointerdown.

Cursor visual: 16 px disc filled with the sampled color, with thin
black/white contrast rings for theme robustness. Alpha < 0.5 holds the
previous sample (no flicker over wipe-erased regions; no false samples
from grid since grid lives on committed, not strokes).

Sampling utility rgbaToHex unit-tested. Tool registration in main.ts
and right-click TOOL pill in toolmenu.ts come at Tasks 17 + 18.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Predicted-events runtime read in `pointer.ts`

**Files:**
- Modify: `apps/web/src/pointer.ts`

The schema field exists (Task 1); now `pointer.ts` reads it at pointermove time. URL `?predict=1` continues to win as session override.

- [ ] **Step 1: Locate the existing predict-events branch**

```bash
grep -n 'predict\|getPredictedEvents' apps/web/src/pointer.ts apps/web/src/main.ts
```

The current implementation reads the URL flag `?predict=1` once at boot — stored as `usePrediction` (or similar) and passed into the pen tool via `createPenTool({ usePrediction, ... })`.

For M2: the URL flag stays as a session override; the setting overrides the default-off behavior.

- [ ] **Step 2: Refactor the prediction read into a settings-aware function**

Pick the approach that minimizes wire-up. Two scenarios:

**(a)** If `usePrediction` is read inside `pointer.ts` at pointermove time: replace the boolean with `shouldUsePrediction()`:

```ts
import { settings } from './settings'

const urlPredict = new URLSearchParams(location.search).has('predict')

export function shouldUsePrediction(): boolean {
  if (urlPredict) return true
  return settings.snapshot().predictedEvents === true
}
```

In the `pointermove` handler:

```ts
canvas.addEventListener('pointermove', e => {
  for (const c of e.getCoalescedEvents()) appendSample(sample(c))
  if (shouldUsePrediction()) {
    const predicted = e.getPredictedEvents().map(sample)
    scheduleRender(predicted)
  } else {
    scheduleRender([])
  }
})
```

**(b)** If `usePrediction` is captured at boot and threaded into the pen tool: extract that read into a function passed to the pen tool, so it re-evaluates each event.

- [ ] **Step 3: Smoke-test the URL flag behavior**

```bash
bun run dev
# open http://localhost:5173?predict=1 → prediction visible
# open http://localhost:5173 → no prediction
```

Expected: URL flag behavior unchanged; default-off is unchanged. (Settings-panel toggle UI lands at Task 10.)

- [ ] **Step 4: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. Tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pointer.ts
git commit -m "$(cat <<'EOF'
feat(m2): pointer.ts reads settings.predictedEvents at pointermove

URL ?predict=1 flag continues to win as session override. When the URL
flag is absent, settings.predictedEvents (default false per ADR 0004)
controls. Settings panel toggle UI lands at Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Pressure curve editor (`settings/curve-editor.ts`)

**Files:**
- Create: `apps/web/src/settings/curve-editor.ts`
- Create: `apps/web/src/settings/curve-editor.test.ts`

The biggest M2 surface. SVG-based graph + draggable midpoint + test-stroke pad. Thumbnail rendered separately.

- [ ] **Step 1: Write failing tests for the pure-data parts**

Create `apps/web/src/settings/curve-editor.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { graphToNorm, normToGraph, sampleCurvePolyline } from './curve-editor'

describe('curve-editor: graph ↔ norm transforms', () => {
  const W = 200, H = 120
  test('graphToNorm bottom-left → (0, 0)', () => {
    const [x, y] = graphToNorm(0, H, W, H)
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(0, 5)
  })

  test('graphToNorm top-right → (1, 1)', () => {
    const [x, y] = graphToNorm(W, 0, W, H)
    expect(x).toBeCloseTo(1, 5)
    expect(y).toBeCloseTo(1, 5)
  })

  test('graphToNorm center → (0.5, 0.5)', () => {
    const [x, y] = graphToNorm(W / 2, H / 2, W, H)
    expect(x).toBeCloseTo(0.5, 5)
    expect(y).toBeCloseTo(0.5, 5)
  })

  test('graphToNorm clamps out-of-bounds inputs', () => {
    const [x1, y1] = graphToNorm(-50, -50, W, H)
    expect(x1).toBe(0)
    expect(y1).toBeCloseTo(1, 5)
    const [x2, y2] = graphToNorm(W + 50, H + 50, W, H)
    expect(x2).toBe(1)
    expect(y2).toBe(0)
  })

  test('normToGraph round-trips graphToNorm', () => {
    for (const [nx, ny] of [[0.25, 0.75], [0.5, 0.5], [0.7, 0.3]] as const) {
      const [gx, gy] = normToGraph(nx, ny, W, H)
      const [nxOut, nyOut] = graphToNorm(gx, gy, W, H)
      expect(nxOut).toBeCloseTo(nx, 5)
      expect(nyOut).toBeCloseTo(ny, 5)
    }
  })
})

describe('curve-editor: sampleCurvePolyline', () => {
  test('linear curve (mid 0.5,0.5) gives diagonal samples', () => {
    const pts = sampleCurvePolyline([0.5, 0.5], 5)
    expect(pts).toHaveLength(5)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[4]).toEqual([1, 1])
    expect(pts[2][0]).toBeCloseTo(0.5, 4)
    expect(pts[2][1]).toBeCloseTo(0.5, 4)
  })

  test('non-linear curve (mid 0.5,0.25) bends below diagonal', () => {
    const pts = sampleCurvePolyline([0.5, 0.25], 5)
    expect(pts[2][1]).toBeCloseTo(0.25, 4)
    expect(pts[2][1]).toBeLessThan(pts[2][0])
  })

  test('γ-shaped polyline (no override; passes pressureGamma)', () => {
    const pts = sampleCurvePolyline(null, 5, 1.5)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[4]).toEqual([1, 1])
    expect(pts[2][1]).toBeCloseTo(0.5 ** 1.5, 4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/src/settings/curve-editor.test.ts`
Expected: FAIL — `curve-editor.ts` doesn't exist.

- [ ] **Step 3: Implement `settings/curve-editor.ts`**

Create `apps/web/src/settings/curve-editor.ts`:

```ts
/**
 * Pressure curve editor — SVG graph with draggable midpoint, plus a small
 * test-stroke pad. Mounted inside the M1.7 panel's Brush preset card when
 * that card is "expanded" for curve editing.
 */

import type { BrushId } from '../brushes'
import { bezierY } from '../stroke'
import { setPresetField, getEffectiveBrushConfig, clearPresetCurve } from '../settings'

const GRAPH_W = 200
const GRAPH_H = 120
const HANDLE_R = 5
const SVG_NS = 'http://www.w3.org/2000/svg'

export function graphToNorm(gx: number, gy: number, w: number, h: number): [number, number] {
  const nx = clamp(gx / w, 0, 1)
  const ny = clamp(1 - gy / h, 0, 1)
  return [nx, ny]
}

export function normToGraph(nx: number, ny: number, w: number, h: number): [number, number] {
  return [nx * w, (1 - ny) * h]
}

/**
 * Sample N points along the curve. If `mid` is null, sample the γ power curve.
 * Returns N normalized [x, y] pairs from (0,0) to (1,1).
 */
export function sampleCurvePolyline(
  mid: readonly [number, number] | null,
  n: number,
  gamma = 1,
): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1)
    const y = mid ? bezierY(x, mid) : Math.pow(x, gamma)
    pts.push([x, y])
  }
  return pts
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export interface CurveEditorOptions {
  brushId: BrushId
  onChange?: () => void
}

export function mountCurveEditor(host: HTMLElement, opts: CurveEditorOptions): () => void {
  const { brushId, onChange } = opts
  host.classList.add('curve-editor')

  const svg = createSvg(GRAPH_W, GRAPH_H)
  host.appendChild(svg)

  const refLine = svgEl('line', {
    x1: '0', y1: String(GRAPH_H),
    x2: String(GRAPH_W), y2: '0',
    stroke: '#d4d4d8', 'stroke-dasharray': '3 3', 'stroke-width': '0.5',
  })
  svg.appendChild(refLine)

  for (const f of [0.25, 0.5, 0.75]) {
    const xLine = svgEl('line', {
      x1: String(f * GRAPH_W), y1: '0',
      x2: String(f * GRAPH_W), y2: String(GRAPH_H),
      stroke: '#f4f4f5', 'stroke-width': '0.5',
    })
    svg.appendChild(xLine)
    const yLine = svgEl('line', {
      x1: '0', y1: String((1 - f) * GRAPH_H),
      x2: String(GRAPH_W), y2: String((1 - f) * GRAPH_H),
      stroke: '#f4f4f5', 'stroke-width': '0.5',
    })
    svg.appendChild(yLine)
  }

  const curvePath = svgEl('path', {
    stroke: 'var(--accent, #3b82f6)', 'stroke-width': '1.5',
    fill: 'none', 'stroke-linejoin': 'round',
  })
  svg.appendChild(curvePath)

  const handle = svgEl('circle', {
    r: String(HANDLE_R),
    fill: 'var(--accent, #3b82f6)', stroke: 'white', 'stroke-width': '1.5',
    cursor: 'grab',
  })
  ;(handle as HTMLElement).style.display = 'none'
  svg.appendChild(handle)

  const resetLink = document.createElement('button')
  resetLink.type = 'button'
  resetLink.className = 'curve-reset'
  resetLink.textContent = `Reset ${brushId} curve`
  resetLink.addEventListener('click', () => {
    clearPresetCurve(brushId)
    redraw()
    onChange?.()
  })
  host.appendChild(resetLink)

  function redraw() {
    const eff = getEffectiveBrushConfig(brushId, '#000000')
    const mid = eff.pressureCurve?.mid ?? null
    const gamma = eff.pressureGamma ?? 1
    const pts = sampleCurvePolyline(mid, 32, gamma)
    const d = pts.map(([x, y], i) => {
      const [gx, gy] = normToGraph(x, y, GRAPH_W, GRAPH_H)
      return `${i === 0 ? 'M' : 'L'} ${gx.toFixed(2)} ${gy.toFixed(2)}`
    }).join(' ')
    curvePath.setAttribute('d', d)

    if (mid) {
      const [hx, hy] = normToGraph(mid[0], mid[1], GRAPH_W, GRAPH_H)
      handle.setAttribute('cx', String(hx))
      handle.setAttribute('cy', String(hy))
      ;(handle as HTMLElement).style.display = ''
    } else {
      ;(handle as HTMLElement).style.display = 'none'
    }
  }

  svg.addEventListener('pointerdown', (e) => {
    const rect = svg.getBoundingClientRect()
    const gx = e.clientX - rect.left
    const gy = e.clientY - rect.top
    const [nx, ny] = graphToNorm(gx, gy, GRAPH_W, GRAPH_H)
    setPresetField(brushId, 'pressureCurve', { mid: [nx, ny] })
    redraw()
    onChange?.()
    startDrag()
  })

  function startDrag() {
    const rect = svg.getBoundingClientRect()
    const move = (e: PointerEvent) => {
      const gx = e.clientX - rect.left
      const gy = e.clientY - rect.top
      const [nx, ny] = graphToNorm(gx, gy, GRAPH_W, GRAPH_H)
      setPresetField(brushId, 'pressureCurve', { mid: [nx, ny] })
      redraw()
      onChange?.()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  redraw()

  // Test-stroke pad
  const pad = document.createElement('canvas')
  pad.width = 240
  pad.height = 160
  pad.className = 'curve-test-pad'
  pad.style.cssText = 'width: 120px; height: 80px;'
  host.appendChild(pad)
  attachTestPad(pad, brushId)

  return () => {
    host.classList.remove('curve-editor')
    host.replaceChildren()
  }
}

function attachTestPad(canvas: HTMLCanvasElement, brushId: BrushId) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  let drawing = false
  let lastX = 0
  let lastY = 0

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true
    canvas.setPointerCapture(e.pointerId)
    const rect = canvas.getBoundingClientRect()
    lastX = (e.clientX - rect.left) * (canvas.width / rect.width)
    lastY = (e.clientY - rect.top) * (canvas.height / rect.height)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  })

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)
    const p = e.pressure || 0.5
    const eff = getEffectiveBrushConfig(brushId, '#000000')
    const effective = eff.pressureCurve
      ? bezierY(p, eff.pressureCurve.mid)
      : Math.pow(p, eff.pressureGamma)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1 + effective * 6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(lastX, lastY)
    ctx.lineTo(x, y)
    ctx.stroke()
    lastX = x
    lastY = y
  })

  canvas.addEventListener('pointerup', () => { drawing = false })
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

function createSvg(w: number, h: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.setAttribute('class', 'curve-graph')
  return svg
}

/**
 * Render a thumbnail (~30 × 18 px) of the brush's current curve.
 * Used by the panel's per-brush card to show curve-shape at a glance.
 */
export function renderCurveThumbnail(brushId: BrushId): SVGSVGElement {
  const W = 30, H = 18
  const svg = createSvg(W, H)
  svg.setAttribute('class', 'curve-thumbnail')
  const eff = getEffectiveBrushConfig(brushId, '#000000')
  const mid = eff.pressureCurve?.mid ?? null
  const gamma = eff.pressureGamma ?? 1
  const pts = sampleCurvePolyline(mid, 16, gamma)
  const d = pts.map(([x, y], i) => {
    const gx = x * W
    const gy = (1 - y) * H
    return `${i === 0 ? 'M' : 'L'} ${gx.toFixed(2)} ${gy.toFixed(2)}`
  }).join(' ')
  const path = svgEl('path', {
    stroke: 'var(--accent, #3b82f6)', 'stroke-width': '1', fill: 'none',
  })
  path.setAttribute('d', d)
  svg.appendChild(path)
  if (mid) {
    svg.classList.add('has-override')
  }
  return svg
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/web/src/settings/curve-editor.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Run lint + typecheck**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/settings/curve-editor.ts apps/web/src/settings/curve-editor.test.ts
git commit -m "$(cat <<'EOF'
feat(m2): pressure curve editor — SVG graph + test pad + thumbnail

Pure helpers (graphToNorm / normToGraph / sampleCurvePolyline) unit-
tested. Mountable editor with draggable midpoint handle; clicking the
graph creates the override at the click point; subsequent drags adjust.
Reset link clears the override (returns to γ-derived shape).

Test-stroke pad uses simplified line-width modulation (full perfect-
freehand fidelity is an out-of-scope follow-up per spec § 9).

Thumbnail renderer (30 × 18 px) added for use in panel-content.ts at
Task 10. has-override CSS hook signals "this brush has a non-default
curve" to the styling layer.

DOM constructed via createElementNS + setAttribute + appendChild;
no innerHTML.

8 unit tests cover the pure helpers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `settings/panel-content.ts` — curve thumbnail per brush card + predicted-events toggle

**Files:**
- Modify: `apps/web/src/settings/panel-content.ts`
- Modify: `apps/web/src/settings.ts` (add `setPredictedEvents` helper)
- Modify: `apps/web/src/style.css`

Wires the curve thumbnail into each Brush preset card (click-to-expand) and adds the predicted-events toggle row at the top of the Advanced section.

- [ ] **Step 1: Add `setPredictedEvents` to `settings.ts`**

In `apps/web/src/settings.ts`, alongside other setters:

```ts
export function setPredictedEvents(value: boolean): void {
  if (state.predictedEvents === value) return
  state.predictedEvents = value
  persist()
  emit()
}
```

- [ ] **Step 2: Locate the Brush preset card render in `panel-content.ts`**

```bash
grep -n 'Brush preset\|presetCard\|renderBrushPreset' apps/web/src/settings/panel-content.ts
```

Find the function that renders a single Brush preset card.

- [ ] **Step 3: Add the curve thumbnail next to the brush title; track expanded state**

At the top of `panel-content.ts`, add imports + module state:

```ts
import { mountCurveEditor, renderCurveThumbnail } from './curve-editor'
import type { BrushId } from '../brushes'
import { setPredictedEvents } from '../settings'

let expandedBrushId: BrushId | null = null
const curveCleanups = new Map<BrushId, () => void>()
```

In the brush preset card render function, after the title element is created, append a clickable thumbnail wrapper. Below the sliders, add a slot for the curve editor:

```ts
function renderBrushCard(brushId: BrushId, container: HTMLElement) {
  // ... existing card rendering (title, sliders, reset link) ...
  // After the title element is appended:
  const titleRow = container.querySelector('.brush-card-title')
  if (titleRow instanceof HTMLElement) {
    const thumbWrap = document.createElement('button')
    thumbWrap.type = 'button'
    thumbWrap.className = 'brush-thumbnail-button'
    thumbWrap.dataset.brushId = brushId
    thumbWrap.appendChild(renderCurveThumbnail(brushId))
    thumbWrap.addEventListener('click', () => {
      toggleExpanded(brushId)
    })
    titleRow.appendChild(thumbWrap)
  }

  // After the sliders block, add a slot for the curve editor:
  const curveSlot = document.createElement('div')
  curveSlot.className = 'brush-curve-slot'
  curveSlot.dataset.brushId = brushId
  container.appendChild(curveSlot)
}

function toggleExpanded(brushId: BrushId) {
  // Collapse previously expanded
  if (expandedBrushId && expandedBrushId !== brushId) {
    collapse(expandedBrushId)
  }
  // Toggle / expand new
  if (expandedBrushId === brushId) {
    collapse(brushId)
    expandedBrushId = null
  } else {
    expand(brushId)
    expandedBrushId = brushId
  }
}

function collapse(brushId: BrushId) {
  const cleanup = curveCleanups.get(brushId)
  if (cleanup) {
    cleanup()
    curveCleanups.delete(brushId)
  }
  const slot = document.querySelector(`.brush-curve-slot[data-brush-id="${brushId}"]`)
  if (slot instanceof HTMLElement) slot.classList.remove('expanded')
}

function expand(brushId: BrushId) {
  const slot = document.querySelector(`.brush-curve-slot[data-brush-id="${brushId}"]`)
  if (!(slot instanceof HTMLElement)) return
  slot.classList.add('expanded')
  slot.replaceChildren()
  const cleanup = mountCurveEditor(slot, {
    brushId,
    onChange: () => {
      // Re-render the thumbnail to reflect the new curve
      const button = document.querySelector(`.brush-thumbnail-button[data-brush-id="${brushId}"]`)
      if (button instanceof HTMLElement) {
        button.replaceChildren(renderCurveThumbnail(brushId))
      }
    },
  })
  curveCleanups.set(brushId, cleanup)
}
```

(Adjust selectors and class names to match the actual M1.7 panel-content structure. Use `instanceof HTMLElement` guards for type narrowing — querySelector returns Element | null.)

- [ ] **Step 4: Add predicted-events toggle row at top of Advanced section**

Locate the Advanced section render function. At the top (before the per-brush knob cards), insert the toggle. **Use createElement / textContent / appendChild — no innerHTML:**

```ts
function renderAdvancedSection(container: HTMLElement) {
  // Predicted-events toggle (board-level, M2)
  const row = document.createElement('div')
  row.className = 'pe-toggle-row'

  const label = document.createElement('label')
  label.className = 'pe-toggle-label'

  const titleSpan = document.createElement('span')
  titleSpan.className = 'pe-toggle-title'
  titleSpan.textContent = 'Predicted events'
  label.appendChild(titleSpan)

  const helpSpan = document.createElement('span')
  helpSpan.className = 'pe-toggle-help'
  helpSpan.textContent =
    'Visual lookahead during drawing. Enable for screen tablets ' +
    '(iPad, Surface, MobileStudio); leave off for indirect-input ' +
    'tablets like Wacom Intuos.'
  label.appendChild(helpSpan)

  row.appendChild(label)

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.className = 'pe-toggle-input'
  input.checked = settings.snapshot().predictedEvents
  input.addEventListener('change', () => {
    setPredictedEvents(input.checked)
  })
  row.appendChild(input)

  container.appendChild(row)

  // ... existing per-brush knob cards continue below ...
}
```

(Adjust the `settings.snapshot()` call to match the actual M1.7 settings access pattern.)

- [ ] **Step 5: Add CSS for thumbnail button + curve slot + pe-toggle**

Append to `apps/web/src/style.css`:

```css
.brush-thumbnail-button {
  background: transparent;
  border: 1px solid var(--border, #e4e4e7);
  border-radius: 4px;
  padding: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}
.brush-thumbnail-button:hover {
  background: var(--surface-hover, #f4f4f5);
}
.brush-thumbnail-button:has(.curve-thumbnail.has-override) {
  border-color: var(--accent, #3b82f6);
}

.brush-curve-slot {
  display: none;
  margin-top: 12px;
}
.brush-curve-slot.expanded {
  display: block;
}

.curve-editor {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.curve-graph {
  background: oklch(from var(--surface, #fafafa) calc(l * 0.98) c h);
  border: 1px solid var(--border, #e4e4e7);
  border-radius: 4px;
}
.curve-test-pad {
  background: oklch(from var(--surface, #fafafa) calc(l * 0.98) c h);
  border: 1px dashed var(--border, #d4d4d8);
  border-radius: 4px;
  cursor: crosshair;
  touch-action: none;
}
.curve-reset {
  background: transparent;
  border: none;
  color: var(--accent, #3b82f6);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 0;
  margin-top: 8px;
}

/* Predicted-events toggle row */
.pe-toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--surface, #fafafa);
  border-radius: 8px;
  border: 1px solid var(--border, #e4e4e7);
}
.pe-toggle-label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
}
.pe-toggle-title {
  font-weight: 600;
  font-size: 13px;
}
.pe-toggle-help {
  font-size: 11px;
  color: var(--ink-muted, oklch(from var(--ink) calc(l * 0.6) c h));
  line-height: 1.4;
}
.pe-toggle-input {
  width: 36px;
  height: 20px;
  margin-left: 12px;
  flex-shrink: 0;
}
```

- [ ] **Step 6: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 7: Manual feel-test the panel**

Run: `bun run dev`. Open the app. `Cmd/Ctrl+,` opens the panel.
- Each Brush preset card shows a 30×18 px curve thumbnail next to the title.
- Click a thumbnail → that brush's card expands with the graph + test pad below.
- Drag the midpoint → curve updates live, thumbnail updates, has-override border becomes accent-blue.
- Click the test pad with pen → strokes draw with current curve applied.
- Reset link clears the override; thumbnail reverts to γ shape.
- Click another brush's thumbnail → previous collapses, new expands.
- Advanced section: toggle predicted-events. Reload, panel reopens, toggle state persists.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/settings/panel-content.ts apps/web/src/settings.ts apps/web/src/style.css
git commit -m "$(cat <<'EOF'
feat(m2): panel — curve thumbnail per brush + predicted-events toggle

Brush preset card grows a 30×18 px clickable curve thumbnail next to
its title. Click expands the card inline with the full SVG graph editor
+ test-stroke pad. Only one brush expands at a time (clicking a second
collapses the first).

Thumbnail visually flags has-override via accent-blue border on the
button wrapper.

Advanced section gains a predicted-events toggle row at the top — board-
level, persists via settings.setPredictedEvents (new helper). pointer.ts
already reads the setting (Task 8).

DOM constructed via createElement + textContent + appendChild;
no innerHTML.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Export bounds (`export/bounds.ts`)

**Files:**
- Create: `apps/web/src/export/bounds.ts`
- Create: `apps/web/src/export/bounds.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/export/bounds.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { Stroke } from '@whiteboard/shared'
import { computeBoardBounds } from './bounds'

function mkStroke(samples: { x: number; y: number }[], deleted = false): Stroke {
  return {
    id: 'x',
    brush: { size: 3, color: '#000', thinning: 0.6, smoothing: 0.7, streamline: 0.4, taperStart: 0, taperEnd: 0, capStart: true, capEnd: true, pressureGamma: 1.5 },
    samples: samples.map(s => ({ x: s.x, y: s.y, p: 0.5, t: 0 })),
    startedAt: 0,
    deleted,
  }
}

describe('export/bounds', () => {
  test('empty array → null', () => {
    expect(computeBoardBounds([])).toBeNull()
  })

  test('all-deleted strokes → null', () => {
    const s = mkStroke([{ x: 0, y: 0 }, { x: 100, y: 100 }], true)
    expect(computeBoardBounds([s])).toBeNull()
  })

  test('single stroke → AABB + 32 px margin', () => {
    const s = mkStroke([{ x: 10, y: 20 }, { x: 50, y: 80 }])
    const b = computeBoardBounds([s])
    expect(b).not.toBeNull()
    expect(b!.x).toBeLessThanOrEqual(10 - 32 + 0.5)
    expect(b!.y).toBeLessThanOrEqual(20 - 32 + 0.5)
    expect(b!.width).toBeGreaterThanOrEqual(50 - 10 + 64 - 0.5)
    expect(b!.height).toBeGreaterThanOrEqual(80 - 20 + 64 - 0.5)
  })

  test('multiple strokes → union AABB + margin', () => {
    const s1 = mkStroke([{ x: 0, y: 0 }, { x: 100, y: 100 }])
    const s2 = mkStroke([{ x: 200, y: 200 }, { x: 300, y: 300 }])
    const b = computeBoardBounds([s1, s2])
    expect(b!.x).toBeLessThanOrEqual(-32 + 0.5)
    expect(b!.width).toBeGreaterThanOrEqual(300 + 64 - 0.5)
  })

  test('soft-deleted excluded', () => {
    const s1 = mkStroke([{ x: 0, y: 0 }, { x: 100, y: 100 }])
    const s2 = mkStroke([{ x: 200, y: 200 }, { x: 300, y: 300 }], true)
    const b = computeBoardBounds([s1, s2])
    expect(b!.width).toBeLessThan(300 + 64)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/src/export/bounds.test.ts`
Expected: FAIL — `bounds.ts` doesn't exist.

- [ ] **Step 3: Implement `export/bounds.ts`**

Create `apps/web/src/export/bounds.ts`:

```ts
/**
 * Compute the bounding rectangle of all non-deleted strokes, plus a
 * 32 px margin. Returns null when there are no strokes to export.
 */

import type { Stroke } from '@whiteboard/shared'
import { strokeAABB } from '../stroke'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const EXPORT_MARGIN = 32

export function computeBoardBounds(strokes: Stroke[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let any = false
  for (const s of strokes) {
    if (s.deleted) continue
    const aabb = strokeAABB(s)
    if (!aabb) continue
    minX = Math.min(minX, aabb.x)
    minY = Math.min(minY, aabb.y)
    maxX = Math.max(maxX, aabb.x + aabb.width)
    maxY = Math.max(maxY, aabb.y + aabb.height)
    any = true
  }
  if (!any) return null
  return {
    x: minX - EXPORT_MARGIN,
    y: minY - EXPORT_MARGIN,
    width: (maxX - minX) + 2 * EXPORT_MARGIN,
    height: (maxY - minY) + 2 * EXPORT_MARGIN,
  }
}
```

(`strokeAABB` should exist in `stroke.ts` from M1's stroke-clipping work. Verify: `grep -n strokeAABB apps/web/src/stroke.ts`. If absent, fall back to manual AABB from samples.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/web/src/export/bounds.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/export/bounds.ts apps/web/src/export/bounds.test.ts
git commit -m "$(cat <<'EOF'
feat(m2): export/bounds.ts — compute board bounds + 32 px margin

Iterates non-deleted strokes' cached AABBs (M1's strokeAABB), unions
them, returns Bounds | null. Empty board / all-deleted returns null
so the dispatcher can disable export entry points.

5 unit tests cover empty, deleted, single, union, and soft-delete
exclusion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: PNG export (`export/png.ts`)

**Files:**
- Create: `apps/web/src/export/png.ts`

PNG export uses the `paintBoard` helper extracted in Task 3 to render to an OffscreenCanvas at bounds size, then `convertToBlob`.

- [ ] **Step 1: Implement `export/png.ts`**

Create `apps/web/src/export/png.ts`:

```ts
/**
 * PNG export. Renders all non-deleted strokes (with grid + erasedStamps)
 * into an OffscreenCanvas sized to the board bounds, then converts to a
 * PNG blob. Shares the on-screen render code via paintBoard.
 */

import type { Stroke } from '@whiteboard/shared'
import { paintBoard } from '../render'
import type { SettingsV1 } from '../settings'
import type { Bounds } from './bounds'

export async function exportPNG(strokes: Stroke[], bounds: Bounds, settings: SettingsV1): Promise<Blob> {
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(bounds.width)),
    Math.max(1, Math.ceil(bounds.height)),
  )
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('export: 2d context unavailable')
  ctx.translate(-bounds.x, -bounds.y)
  paintBoard(ctx, bounds, settings, strokes)
  return await canvas.convertToBlob({ type: 'image/png' })
}
```

- [ ] **Step 2: Run lint + typecheck**

Run: `bun run lint && bun run typecheck`
Expected: 0 errors.

(No unit test — binary content; manual visual diff at feel-test.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/export/png.ts
git commit -m "$(cat <<'EOF'
feat(m2): export/png.ts — OffscreenCanvas + paintBoard + toBlob

Renders all non-deleted strokes (grid + composited strokes + erased-
holes) to an OffscreenCanvas sized to bounds, returns a PNG blob.
Reuses paintBoard (Task 3 refactor) so PNG export and on-screen render
share code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: SVG export (`export/svg.ts`)

**Files:**
- Create: `apps/web/src/export/svg.ts`
- Create: `apps/web/src/export/svg.test.ts`

Custom serializer. Output: `<svg viewBox>` + grid `<pattern>` + per-stroke `<path>` (with `<mask>` for `erasedStamps`).

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/export/svg.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { Stroke } from '@whiteboard/shared'
import { exportSVG } from './svg'

function mkStroke(samples: { x: number; y: number }[], extra: Partial<Stroke> = {}): Stroke {
  return {
    id: extra.id ?? 's1',
    brush: extra.brush ?? { size: 3, color: '#ef4444', thinning: 0.6, smoothing: 0.7, streamline: 0.4, taperStart: 0, taperEnd: 0, capStart: true, capEnd: true, pressureGamma: 1.5, opacity: 0.94 },
    samples: samples.map(s => ({ x: s.x, y: s.y, p: 0.5, t: 0 })),
    startedAt: 0,
    ...extra,
  }
}

const settings = {
  schemaVersion: 1 as const,
  color: '#000', brush: 'pen' as const, eraserSize: 'medium' as const,
  grid: { type: 'none' as const, spacing: 24 },
  presets: {}, customSwatches: [], recentColors: [], fonts: [],
  predictedEvents: false,
}

describe('export/svg', () => {
  test('single stroke produces a path', () => {
    const s = mkStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }])
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, settings)
    expect(blob.type).toBe('image/svg+xml')
  })

  test('output contains viewBox + path element', async () => {
    const s = mkStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }])
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, settings)
    const text = await blob.text()
    expect(text).toContain('<svg')
    expect(text).toContain('viewBox="-10 -10 30 30"')
    expect(text).toContain('<path')
  })

  test('highlighter stroke has multiply blend mode', async () => {
    const s = mkStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }], {
      brush: { size: 18, color: '#fbbf24', thinning: 0, smoothing: 0.3, streamline: 0.5, taperStart: 0, taperEnd: 0, capStart: false, capEnd: false, pressureGamma: 1, opacity: 0.4 },
    })
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, settings)
    const text = await blob.text()
    expect(text).toContain('mix-blend-mode: multiply')
  })

  test('stroke with erasedStamps gets a mask', async () => {
    const s = mkStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }], {
      erasedStamps: [{ x: 5, y: 5, r: 3 }],
    })
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, settings)
    const text = await blob.text()
    expect(text).toContain('<mask')
    expect(text).toContain('<circle')
    expect(text).toContain('mask="url(#')
  })

  test('grid type "none" omits grid pattern', async () => {
    const s = mkStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }])
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, settings)
    const text = await blob.text()
    expect(text).not.toContain('<pattern')
  })

  test('grid type "dots" includes grid pattern', async () => {
    const s = mkStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }])
    const dotted = { ...settings, grid: { type: 'dots' as const, spacing: 24 } }
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, dotted)
    const text = await blob.text()
    expect(text).toContain('<pattern')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/web/src/export/svg.test.ts`
Expected: FAIL — `svg.ts` doesn't exist.

- [ ] **Step 3: Implement `export/svg.ts`**

Create `apps/web/src/export/svg.ts`:

```ts
/**
 * SVG export. Custom serializer: writes viewBox-bounded svg with a grid
 * pattern (per settings.grid) and per-stroke paths derived from
 * perfect-freehand outlines. erasedStamps become SVG masks with circle
 * subtractions. Highlighter strokes get opacity + multiply blend mode.
 */

import { getStroke } from 'perfect-freehand'
import type { Stroke } from '@whiteboard/shared'
import type { SettingsV1, GridType } from '../settings'
import { resolveColor } from '../theme'
import type { Bounds } from './bounds'

export function exportSVG(strokes: Stroke[], bounds: Bounds, settings: SettingsV1): Blob {
  const parts: string[] = []
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${fmt(bounds.x)} ${fmt(bounds.y)} ${fmt(bounds.width)} ${fmt(bounds.height)}" ` +
    `width="${fmt(bounds.width)}" height="${fmt(bounds.height)}">`,
  )
  if (settings.grid.type !== 'none') {
    parts.push(renderGridDefs(settings.grid.type, settings.grid.spacing))
    parts.push(`<rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="url(#whiteboard-grid)"/>`)
  }
  let strokeIdx = 0
  const maskDefs: string[] = []
  for (const s of strokes) {
    if (s.deleted) continue
    const samples = s.samples.map(p => [p.x, p.y, p.p] as [number, number, number])
    if (samples.length === 0) continue
    const points = getStroke(samples, {
      size: s.brush.size,
      thinning: s.brush.thinning,
      smoothing: s.brush.smoothing,
      streamline: s.brush.streamline,
      simulatePressure: false,
      last: true,
    })
    if (points.length === 0) continue
    const d = pointsToPath(points)
    const color = resolveColor(s.brush.color)
    const opacity = s.brush.opacity ?? 1
    const isHighlighter = (s.brush.opacity ?? 1) < 0.6 && s.brush.thinning === 0
    const styleAttr = isHighlighter ? ` style="mix-blend-mode: multiply"` : ''
    let maskAttr = ''
    if (s.erasedStamps && s.erasedStamps.length > 0) {
      const maskId = `stroke-${strokeIdx}-mask`
      const circles = s.erasedStamps.map(stamp =>
        `<circle cx="${fmt(stamp.x)}" cy="${fmt(stamp.y)}" r="${fmt(stamp.r)}" fill="black"/>`
      ).join('')
      maskDefs.push(
        `<mask id="${maskId}">` +
        `<rect x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" fill="white"/>` +
        circles +
        `</mask>`
      )
      maskAttr = ` mask="url(#${maskId})"`
    }
    parts.push(
      `<path d="${d}" fill="${color}" opacity="${opacity}"${styleAttr}${maskAttr}/>`,
    )
    strokeIdx++
  }
  if (maskDefs.length > 0) {
    parts.splice(2, 0, `<defs>${maskDefs.join('')}</defs>`)
  }
  parts.push(`</svg>`)
  return new Blob([parts.join('\n')], { type: 'image/svg+xml' })
}

function renderGridDefs(type: GridType, spacing: number): string {
  if (type === 'dots') {
    return `<defs><pattern id="whiteboard-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.8" fill="#d4d4d8"/></pattern></defs>`
  }
  if (type === 'lines') {
    return `<defs><pattern id="whiteboard-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><path d="M 0 0 L ${spacing} 0 M 0 0 L 0 ${spacing}" stroke="#e4e4e7" stroke-width="0.5" fill="none"/></pattern></defs>`
  }
  // ruled: horizontal-only
  return `<defs><pattern id="whiteboard-grid" x="0" y="0" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><path d="M 0 0 L ${spacing} 0" stroke="#e4e4e7" stroke-width="0.5" fill="none"/></pattern></defs>`
}

function pointsToPath(points: number[][]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  const parts = [`M ${fmt(first[0])} ${fmt(first[1])}`]
  for (const p of rest) parts.push(`L ${fmt(p[0])} ${fmt(p[1])}`)
  parts.push('Z')
  return parts.join(' ')
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0'
}
```

(Adjust `resolveColor` import path to match the actual theme module. The `isHighlighter` heuristic uses opacity + thinning; if a `brushId` is captured on `Stroke.brush` or `Stroke`, prefer that.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/web/src/export/svg.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Run lint + typecheck**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/export/svg.ts apps/web/src/export/svg.test.ts
git commit -m "$(cat <<'EOF'
feat(m2): export/svg.ts — custom serializer + mask-based erasure

viewBox-bounded svg with per-stroke paths derived from perfect-freehand
outlines. Grid rendered via <pattern> for dots / lines / ruled (omitted
for "none"). Highlighter strokes carry mix-blend-mode: multiply.
erasedStamps become SVG <mask> with subtractive <circle>s; the masked
path keeps holes intact.

6 unit tests cover viewBox, paths, highlighter blend mode, mask, and
grid type variants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: PDF export (`export/pdf.ts`) — lazy `jspdf`

**Files:**
- Modify: `apps/web/package.json` (add `jspdf` dependency)
- Create: `apps/web/src/export/pdf.ts`

PDF embeds rasterized PNG via `jspdf.addImage`. SVG-vector PDF is an out-of-scope follow-up.

- [ ] **Step 1: Add `jspdf` dependency to `apps/web/package.json`**

Open `apps/web/package.json`. Add to `dependencies`:

```json
"jspdf": "^2.5.1"
```

Run:

```bash
bun install
```

Expected: `jspdf` installed.

- [ ] **Step 2: Implement `export/pdf.ts`**

Create `apps/web/src/export/pdf.ts`:

```ts
/**
 * PDF export. Lazy-imports jspdf so non-PDF users never load the ~70 KB gz
 * library. v1: render to PNG via export/png.ts, then embed as a single
 * image. SVG-native vector PDF is an out-of-scope follow-up.
 */

import type { Stroke } from '@whiteboard/shared'
import type { SettingsV1 } from '../settings'
import type { Bounds } from './bounds'
import { exportPNG } from './png'

export async function exportPDF(strokes: Stroke[], bounds: Bounds, settings: SettingsV1): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const png = await exportPNG(strokes, bounds, settings)
  const dataUrl = await blobToDataURL(png)
  const orientation: 'l' | 'p' = bounds.width > bounds.height ? 'l' : 'p'
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [bounds.width, bounds.height],
    compress: true,
  })
  pdf.addImage(dataUrl, 'PNG', 0, 0, bounds.width, bounds.height)
  return pdf.output('blob')
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}
```

- [ ] **Step 3: Run lint + typecheck**

Run: `bun run lint && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/src/export/pdf.ts
git commit -m "$(cat <<'EOF'
feat(m2): export/pdf.ts — lazy jspdf + PNG embed

Lazy-imports jspdf at first call (~70 KB gz; non-PDF users never load).
v1 embeds rasterized PNG via pdf.addImage; SVG-native vector embed is
an out-of-scope follow-up per spec § 9.

Page size = bounds (no fixed paper size); orientation chosen from
aspect ratio.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Export dispatcher (`export/index.ts`)

**Files:**
- Create: `apps/web/src/export/index.ts`

- [ ] **Step 1: Implement `export/index.ts`**

Create `apps/web/src/export/index.ts`:

```ts
/**
 * Export dispatcher. Single entry point exported as exportBoard(format).
 * Computes bounds; dispatches to png / svg / pdf; triggers download via
 * the standard <a download> pattern.
 */

import type { Stroke } from '@whiteboard/shared'
import { settings } from '../settings'
import { computeBoardBounds } from './bounds'
import { exportPNG } from './png'
import { exportSVG } from './svg'
import { exportPDF } from './pdf'

export type ExportFormat = 'png' | 'svg' | 'pdf'

export interface ExportOptions {
  getStrokes: () => Stroke[]
  onEmptyBoard?: () => void
}

export async function exportBoard(format: ExportFormat, opts: ExportOptions): Promise<void> {
  const strokes = opts.getStrokes()
  const bounds = computeBoardBounds(strokes)
  if (!bounds) {
    if (opts.onEmptyBoard) opts.onEmptyBoard()
    else console.warn('export: nothing to export')
    return
  }
  const snap = settings.snapshot()
  let blob: Blob
  switch (format) {
    case 'png': blob = await exportPNG(strokes, bounds, snap); break
    case 'svg': blob = exportSVG(strokes, bounds, snap); break
    case 'pdf': blob = await exportPDF(strokes, bounds, snap); break
  }
  triggerDownload(blob, filename(format))
}

function filename(format: ExportFormat): string {
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `whiteboard-${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.${format}`
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
```

(Adjust the `settings` import to match the M1.7 export shape — `grep -n 'export.*settings\|snapshot' apps/web/src/settings.ts` to confirm.)

- [ ] **Step 2: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/export/index.ts
git commit -m "$(cat <<'EOF'
feat(m2): export/index.ts — dispatcher + filename + download

exportBoard(format, opts) computes bounds, dispatches to format-
specific exporters, triggers <a download> programmatically. Filename
pattern: whiteboard-YYYY-MM-DD-HHMM.{ext}. Empty board calls
onEmptyBoard if provided.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Export popover (`exportpopover.ts`) + `Cmd/Ctrl+E` binding

**Files:**
- Create: `apps/web/src/exportpopover.ts`
- Modify: `apps/web/src/keymap.ts`

- [ ] **Step 1: Implement `exportpopover.ts`**

Create `apps/web/src/exportpopover.ts`:

```ts
/**
 * Cmd/Ctrl+E export popover. Shows three pills (PNG / SVG / PDF) at the
 * cursor; click → export + dismiss; Esc cancels. Reuses popover.ts
 * single-instance arbitration.
 */

import { showPopover, dismissPopover } from './popover'
import { exportBoard, type ExportFormat } from './export'
import type { Stroke } from '@whiteboard/shared'

export interface ExportPopoverOptions {
  anchorX: number
  anchorY: number
  getStrokes: () => Stroke[]
  onEmptyBoard?: () => void
}

export function showExportPopover(opts: ExportPopoverOptions): void {
  const content = document.createElement('div')
  content.className = 'export-popover-content'
  for (const fmt of ['png', 'svg', 'pdf'] as ExportFormat[]) {
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'pill'
    pill.textContent = fmt.toUpperCase()
    pill.addEventListener('click', () => {
      void exportBoard(fmt, { getStrokes: opts.getStrokes, onEmptyBoard: opts.onEmptyBoard })
      dismissPopover()
    })
    content.appendChild(pill)
  }
  showPopover({
    tag: 'export',
    anchorX: opts.anchorX,
    anchorY: opts.anchorY,
    title: 'EXPORT',
    content,
  })
}
```

(Match `showPopover` signature to actual `popover.ts` API: `grep -n 'export function showPopover\|interface PopoverOptions' apps/web/src/popover.ts`. Adapt.)

- [ ] **Step 2: Add `Cmd/Ctrl+E` handler in `keymap.ts`**

Open `apps/web/src/keymap.ts`. In the `Cmd/Ctrl-modified` block:

```ts
if (meta && !shift && k === 'e') {
  preventAndCall(e, handlers.openExportPopover)
  return
}
```

Add to `Handlers`:

```ts
interface Handlers {
  // ... existing ...
  openExportPopover: () => void
}
```

- [ ] **Step 3: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/exportpopover.ts apps/web/src/keymap.ts
git commit -m "$(cat <<'EOF'
feat(m2): exportpopover.ts + Cmd/Ctrl+E

showExportPopover anchors the popover at cursor with PNG / SVG / PDF
pills (DOM via createElement + textContent + appendChild — no
innerHTML). Reuses popover.ts single-instance arbitration. Click →
export + dismiss. Esc cancels via existing popover dismiss.

Cmd/Ctrl+E handler in keymap.ts (orchestrator wires it in Task 18).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Right-click `EXPORT` row + Eyedropper TOOL pill in `toolmenu.ts`

**Files:**
- Modify: `apps/web/src/toolmenu.ts`

- [ ] **Step 1: Locate the global section render in `toolmenu.ts`**

```bash
grep -n 'TOOL\|VIEW\|SETTINGS' apps/web/src/toolmenu.ts
```

Find the function rendering global sections.

- [ ] **Step 2: Add Eyedropper to TOOL row pill list**

Find the TOOL row render. Add an Eyedropper pill alongside Draw / Eraser / Lasso:

```ts
const eyedropperPill = pill('Eyedropper')
eyedropperPill.addEventListener('click', () => {
  setTool('eyedropper')
  dismiss()
})
toolRow.appendChild(eyedropperPill)
```

(Match the existing pattern. `pill` is the helper from `menu-ui.ts`; `setTool` and `dismiss` are passed in via the menu's options.)

- [ ] **Step 3: Add EXPORT row**

Add a new global section between VIEW and SETTINGS:

```ts
function renderExportRow(host: HTMLElement, opts: ToolMenuOptions): void {
  host.appendChild(sectionLabel('EXPORT'))
  const row = pillRow()
  for (const fmt of ['png', 'svg', 'pdf'] as const) {
    const p = pill(fmt.toUpperCase())
    p.addEventListener('click', () => {
      void exportBoard(fmt, {
        getStrokes: opts.getStrokes,
        onEmptyBoard: () => opts.showInfoToast?.('Nothing to export'),
      })
      opts.dismiss()
    })
    row.appendChild(p)
  }
  host.appendChild(row)
}
```

Add `renderExportRow(host, opts)` to the per-render flow alongside `renderToolRow`, `renderViewRow`, etc.

The `ToolMenuOptions` interface gains:

```ts
interface ToolMenuOptions {
  // ... existing ...
  getStrokes: () => Stroke[]
  showInfoToast?: (msg: string) => void
}
```

(Update the call site in `main.ts` at Task 18.)

- [ ] **Step 4: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/toolmenu.ts
git commit -m "$(cat <<'EOF'
feat(m2): toolmenu — Eyedropper TOOL pill + global EXPORT row

TOOL row gains an Eyedropper pill alongside Draw / Eraser / Lasso.
New global EXPORT row (sibling to TOOL / VIEW / SETTINGS) with
PNG / SVG / PDF pills. Click → exportBoard(format) → menu dismisses.
Empty board shows a "Nothing to export" toast (host injects via
showInfoToast option).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: `main.ts` orchestrator wiring

**Files:**
- Modify: `apps/web/src/main.ts`

The biggest wiring task. Hook everything M2 into the orchestrator.

- [ ] **Step 1: Register the eyedropper tool in the tool registry**

Find the tool registry block in `main.ts` (around line 171). Add eyedropper:

```ts
import { createEyedropperTool } from './tools/eyedropper'

// ... after existing tool creations ...
const eyedropperTool = createEyedropperTool({
  callbacks: {
    getStrokesLayer: () => renderTarget.strokes.getContext('2d')!,
    setTool: (id) => setTool(id),
    getActiveToolId: () => activeToolId,
  },
})

const toolRegistry: Record<ToolId, Tool> = {
  pen: penTool,
  eraser: eraserTool,
  lasso: lassoTool,
  eyedropper: eyedropperTool,
}
```

(Adjust to match the actual `renderTarget` / `activeToolId` / `setTool` shape.)

- [ ] **Step 2: Mount the first-run hint and wire dismissal at create-op emission point**

Near the top of the orchestrator setup:

```ts
import { mountFirstRunHint, dismissFirstRunHint } from './firstrun'

// After #app is created/found:
mountFirstRunHint(appEl)
```

Find the `undoStack.push({ kind: 'create', strokeId: ... })` call (line ~196 in current main.ts). Immediately after, add:

```ts
dismissFirstRunHint()
```

- [ ] **Step 3: Wire distraction-free toggle + palette cycle + export popover handlers**

Add to the keymap handler bundle:

```ts
import { toggleDistractionFree } from './distractionfree'
import { CURATED_COLORS, cyclePaletteIndex } from './colorpicker'
import { showExportPopover } from './exportpopover'
import { dismissPopover } from './popover'
import { dismissSidePanel } from './sidepanel'

const keymapHandlers: Handlers = {
  // ... existing handlers ...
  toggleDistractionFree: () => toggleDistractionFree({
    appEl,
    dismissPopover: () => dismissPopover(),
    dismissSidePanel: () => dismissSidePanel(),
  }),
  selectEyedropperTool: () => setTool('eyedropper'),
  cyclePaletteForward: () => {
    const cur = settings.snapshot().color
    const idx = cyclePaletteIndex(cur, 1)
    settings.setColor(CURATED_COLORS[idx])
  },
  cyclePaletteBackward: () => {
    const cur = settings.snapshot().color
    const idx = cyclePaletteIndex(cur, -1)
    settings.setColor(CURATED_COLORS[idx])
  },
  openExportPopover: () => {
    const { x, y } = lastPointerPosition()
    showExportPopover({
      anchorX: x,
      anchorY: y,
      getStrokes: () => strokes,
      onEmptyBoard: () => showInfoToast('Nothing to export'),
    })
  },
}
```

(`lastPointerPosition()` is the existing helper that tracks last cursor; reuse from M1.5's color picker / options menu.)

- [ ] **Step 4: Pass `getStrokes` + `showInfoToast` to the toolmenu renderer**

Find the call site that opens the right-click menu (likely on `contextmenu` event). Add the new options:

```ts
const toolMenuOpts: ToolMenuOptions = {
  // ... existing ...
  getStrokes: () => strokes,
  showInfoToast: (msg) => showInfoToast(msg),
}
```

- [ ] **Step 5: Add `showInfoToast` helper if not present**

If `showInfoToast` doesn't exist, add a minimal one in `main.ts` (DOM via createElement; no innerHTML):

```ts
function showInfoToast(msg: string): void {
  const id = 'info-toast'
  let toast = document.getElementById(id)
  if (!toast) {
    toast = document.createElement('div')
    toast.id = id
    toast.className = 'df-exit-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.classList.add('visible')
  setTimeout(() => {
    toast?.classList.remove('visible')
    setTimeout(() => toast?.remove(), 300)
  }, 2000)
}
```

- [ ] **Step 6: Run lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun test`
Expected: 0 errors. All tests pass.

- [ ] **Step 7: Manual smoke-test all M2 features**

Run: `bun run dev`. Open the app.

- [ ] First-run hint visible (clear `whiteboard:hint-shown` first via DevTools localStorage).
- [ ] Draw a stroke → hint fades.
- [ ] `I` activates eyedropper; cursor becomes color disc; sample over a stroke; pointerdown sets color and reverts to previous tool.
- [ ] `Shift+]` and `Shift+[` cycle the curated palette.
- [ ] `F` enters distraction-free; toast appears; chrome hidden; `F` or `Esc` exits.
- [ ] `Cmd/Ctrl+E` opens export popover at cursor; PNG / SVG / PDF pills work.
- [ ] Right-click → EXPORT row works; pills work.
- [ ] Right-click → TOOL → Eyedropper pill works.
- [ ] Empty board: export pills surface "Nothing to export" toast.
- [ ] Settings panel: Brush preset card thumbnail click expands editor; midpoint drag updates curve; reset works.
- [ ] Settings panel: Advanced section predicted-events toggle persists across reload.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/main.ts
git commit -m "$(cat <<'EOF'
feat(m2): main.ts wiring — eyedropper register, firstrun + distraction-
free + export popover handlers, palette cycle, dismiss-firstrun on
first stroke

Eyedropper Tool registered in registry. First-run hint mounted on
boot; orchestrator calls dismissFirstRunHint() at the existing
create-op emission point in stroke commit (line ~196). Keymap handlers
added for I, Shift+[/], F, Cmd/Ctrl+E. Toolmenu options threaded
getStrokes + showInfoToast. Distraction-free injected with popover +
sidepanel dismissal callbacks.

End-to-end smoke-tested via dev server.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Style polish + export popover styling

**Files:**
- Modify: `apps/web/src/style.css`

Co-locate the remaining M2 CSS pieces.

- [ ] **Step 1: Append remaining CSS to `style.css`**

```css
/* Export popover content layout */
.export-popover-content {
  display: flex;
  gap: 6px;
  padding: 8px;
}
.export-popover-content .pill {
  min-width: 48px;
}

/* Empty-board nothing-to-export pill state */
.toolmenu .pill[disabled],
.export-popover-content .pill[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
```

- [ ] **Step 2: Manual visual smoke-test**

Run: `bun run dev`. Open right-click menu, hover EXPORT pills, open `Cmd/Ctrl+E` popover. Layout looks right; pills are pen-friendly hit targets.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/style.css
git commit -m "$(cat <<'EOF'
style(m2): export popover layout + disabled pill state

Export popover shows three pills with 6 px gap, 8 px padding. Disabled
state (empty board) sets opacity 0.5 + pointer-events: none.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: ADR 0011 — toolbar deferred

**Files:**
- Create: `docs/decisions/0011-toolbar-deferred.md`

- [ ] **Step 1: Write ADR 0011**

Create `docs/decisions/0011-toolbar-deferred.md`:

```markdown
# 0011. Toolbar UI — deferred (M2 scope reduction)

Date: 2026-05-09

## Status

Accepted at M2 close. Supersedes the SPEC § 4.2 floating-toolbar commitment.

## Context

The original SPEC committed to a floating, dockable, draggable toolbar in § 4.2 — pen presets always visible, recent colors inline, long-press for preset config. M2 was originally scoped around shipping that toolbar.

By the time M2 brainstorming opened (post-M1.7), the discoverability and one-click surfaces a toolbar would have served had been built into adjacent surfaces:

- **Right-click menu** (M1.5 → M1) — universal contextual surface; tools, brushes, colors, eraser modes, view actions, settings. Per-tool sections own themselves (ADR 0007).
- **Color picker popover** (M1.5) — `C` opens at cursor with curated + custom + recent colors.
- **Settings side panel** (M1.7) — brush preset tuning, custom swatches, theme, grid, advanced knobs.
- **Keyboard shortcuts** — `B` / `P` (draw + pen), `1`–`5` (brush presets), `[` / `]` (size), `S` (lasso), `E`-hold / `Shift+E` (eraser), `Cmd/Ctrl+,` (settings), `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` (undo/redo), `T` (theme), `M` (metrics), `?` (help).
- **Toolpill** (M1) — bottom-right indicator with tap-to-cycle and gear-zone (settings panel).

A toolbar would have provided one-click access (vs two-click via right-click) and visual discoverability for casual users. The user feel-tested through M0 / M1 / M1.5 / M1.7 and concluded the existing surfaces are sufficient.

The SPEC § 0 tenets ("Visual minimalism is functional. Less chrome = less cognitive load." and "Things that don't help drawing don't ship at all, or ship hidden by default.") override the SPEC § 4.2 commitment when they conflict.

## Decision

Drop the toolbar from the M2 scope. Replace SPEC § 4.2 with a paragraph acknowledging that right-click + keyboard + settings panel cover per-action discovery.

The first-run hint (M2) provides discoverability for new users without persistent chrome.

## Considered alternatives

### Hidden-by-default toolbar (appears on hover near the top edge)

Compromise: toolbar exists but isn't always visible. Tradeoff: still adds DOM + reactivity surface; "hover to reveal" UX feels indirect on a Wacom Intuos (the cursor is a board-coords pointer, not a screen-coords pointer).

Rejected — the right-click menu is already a "reveal on demand" surface that's pen-native.

### Minimal pinned palette (color swatches only, no tools)

Compromise: drop the tool pills, keep only color swatches as a strip along one edge. Tradeoff: still persistent chrome; the C key + recent colors row inside the picker already serve this need.

Rejected — partial implementation that doesn't actually solve the discoverability gap.

### Discoverable-on-first-use toolbar (shown once, then hideable)

Compromise: toolbar shows on first run; user can hide it via a setting; persists hidden across reloads.

Rejected — the first-run hint covers the discoverability problem at zero chrome cost.

## Consequences

### Easier

- M2 scope contracted from 8 to 7 features (toolbar dropped; cursor preview drop is separate).
- No new architectural primitive (toolbar shell, dock model, drag-and-snap).
- No bundle-size impact from a reactive store framework.

### Harder

- Casual users without keyboard or right-click familiarity discover features only through the first-run hint or the `?` help overlay. If feel-test reveals a gap, this decision can be reconsidered — the right-click + keyboard surfaces remain the source of truth, and a toolbar can be added later as an *additional* discoverability path without removing existing surfaces.

### Risks

- Future feature additions that "would have lived in the toolbar" need a deliberate home — settings panel, right-click section, or a new popover. Without a default chrome host, every new feature decision includes "where does this surface."

## Migration path forward

If a discoverability gap surfaces in M3+ feel-tests, a toolbar could be added as a new optional surface (not replacing the existing ones). The deferred design (vanilla TS + nanostores, edge-snap dock model, brush picker + palette + tool pills) is captured in the brainstorm history (`docs/superpowers/specs/2026-05-09-m2-export-polish-design.md` § 2 Locked decisions for the original mockup work) and could be revived without re-brainstorming the structure.
```

- [ ] **Step 2: Commit**

```bash
git add docs/decisions/0011-toolbar-deferred.md
git commit -m "docs(m2): ADR 0011 — toolbar UI deferred from v1

The right-click menu + keyboard shortcuts + settings panel already
cover the discoverability and one-click surfaces a toolbar would have
served. Tenet citation: \"less chrome = less cognitive load.\"

Captures considered alternatives (hidden-by-default, minimal pinned
palette, discoverable-on-first-use) and the migration path if a
discoverability gap surfaces post-feel-test."
```

---

## Task 21: SPEC.md updates

**Files:**
- Modify: `SPEC.md`

- [ ] **Step 1: Update § 1 Goals**

Find:

```
- Drawing-first UX: floating toolbar, instant tool/color/size changes, dense keyboard shortcuts.
```

Replace with:

```
- Drawing-first UX: instant tool/color/size changes via right-click menu + dense keyboard shortcuts. No persistent chrome above the canvas (per [ADR 0011](docs/decisions/0011-toolbar-deferred.md)).
```

- [ ] **Step 2: Update § 4.1 Tool set with eyedropper**

After the existing Eraser model paragraph, add:

```
> **Color eyedropper** activated via `I` (modal tool, ADR 0007 conformance). Samples color from the strokes offscreen layer at the cursor pixel; on pointerdown commits to the active brush color and reverts to the previous tool. Grid pixels live on the committed layer and never sample (clean by construction). Implemented at M2.
```

- [ ] **Step 3: Update § 4.2 Toolbar paragraph**

Replace the entire § 4.2 block:

```
### 4.2 Discovery surfaces

No persistent toolbar above the canvas. Per-action discovery is covered by:

- **Right-click context menu** (M1.5 → M1): COLOR · BRUSH · TOOL · VIEW · EXPORT · SETTINGS sections. Per-tool sections own themselves (ADR 0007).
- **Keyboard shortcuts** (§ 4.3): every action has a single-keystroke or chord path.
- **Color picker popover** (M1.5): `C` opens at cursor with curated + custom + recent colors.
- **Settings side panel** (M1.7): brush preset tuning, custom swatches, theme, grid, advanced knobs, pressure curves, predicted-events toggle.
- **First-run hint** (M2): empty-board guidance "Right-click for tools · ? for help" fades on first stroke; never shown again.

The original toolbar commitment was retired during M2 brainstorming on tenet grounds (less chrome = less cognitive load). See [ADR 0011](docs/decisions/0011-toolbar-deferred.md) for the full rationale and considered alternatives.
```

- [ ] **Step 4: Update § 4.3 keyboard table**

Flip status to ✅ for `Shift+[` / `Shift+]` and `F`. Add new rows:

```
| `I`                            | Color eyedropper                          | ✅     |
| `Cmd/Ctrl + E`                 | Export popover (PNG / SVG / PDF)          | ✅     |
```

- [ ] **Step 5: Update § 4.4 Pressure curve UI**

Replace the existing § 4.4 paragraph:

```
### 4.4 Pressure curve UI

In the settings panel's Brush presets section, each brush card shows a 30 × 18 px curve thumbnail next to its title. Click expands the card with a 200 × 120 px draggable-midpoint graph + 120 × 80 px test-stroke pad. Saved per-brush via `presets[brushId].pressureCurve?: { mid: [number, number] }` — sparse override of `pressureGamma`. The bezier representation (quadratic from (0,0) to mid to (1,1) in normalized coords) subsumes γ as a specific shape; γ continues to apply when no override exists.

The thumbnail itself is the override-presence indicator: γ-shape vs bent. Changing brush presets between sessions is glance-readable in the panel.
```

- [ ] **Step 6: Update § 6 Persistence with export note**

Find:

```
- **Export**: PNG (`canvas.toBlob`), SVG (custom serializer), PDF (`jspdf` wrapping the SVG). Single-click from toolbar.
```

Replace with:

```
- **Export**: PNG (offscreen canvas + `convertToBlob`), SVG (custom serializer with mask-based erasure for `erasedStamps`), PDF (`jsPDF` wrapping a rasterized PNG; SVG-vector PDF deferred). Triggered via right-click → EXPORT or `Cmd/Ctrl+E`. Filename: `whiteboard-YYYY-MM-DD-HHMM.{ext}`. Empty board surfaces a "Nothing to export" toast.
```

- [ ] **Step 7: Update § 10 Open decisions**

Find the "Toolbar UI framework" line:

```
- **Toolbar UI framework**: vanilla TS + nanostores vs Solid.js. Decide at the start of M2 based on bundle-size headroom and the toolbar's reactive needs.
```

Remove the line entirely. Add a new "decided during M2" entry:

```
### Decided during M2

- **Toolbar UI deferred.** See [ADR 0011](docs/decisions/0011-toolbar-deferred.md). The right-click menu + keyboard shortcuts + settings panel cover the discoverability and one-click surfaces a toolbar would have served.
```

- [ ] **Step 8: Lint markdown**

Open `SPEC.md` in an editor; ensure markdown still renders.

- [ ] **Step 9: Commit**

```bash
git add SPEC.md
git commit -m "docs(m2): SPEC updates — toolbar dropped, eyedropper + export shipped

§ 1 Goals: drop floating toolbar from drawing-first UX bullet.
§ 4.1: add eyedropper paragraph (modal tool, I key, sample source).
§ 4.2: replace toolbar paragraph with discovery-surfaces summary;
  cite ADR 0011.
§ 4.3 keyboard table: I + Cmd/Ctrl+E rows added; Shift+[/] + F flipped
  to ✅.
§ 4.4: update Pressure curve UI to the bezier-midpoint representation
  and inline-thumbnail placement.
§ 6: update Export bullet with the actual M2 implementation.
§ 10: remove \"Toolbar UI framework\" open decision; add \"decided
  during M2\" subsection citing ADR 0011."
```

---

## Task 22: Architecture doc updates

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add new module rows to § 2.1**

Open `docs/architecture.md`. Find the module table in § 2.1. Add rows:

```
| `tools/eyedropper.ts` | M2 ✅    | Color eyedropper Tool. ADR 0007 conformance; samples from strokes offscreen layer; reverts to previous tool on commit. |
| `firstrun.ts`     | M2 ✅    | First-run hint mount + dismissal; localStorage flag.    |
| `distractionfree.ts` | M2 ✅ | F-toggle distraction-free mode; hides app chrome via body class. |
| `export/bounds.ts`| M2 ✅    | Compute board bounds + 32 px margin from non-deleted strokes' AABBs. |
| `export/png.ts`   | M2 ✅    | PNG export via OffscreenCanvas + paintBoard.            |
| `export/svg.ts`   | M2 ✅    | Custom SVG serializer; mask-based erasedStamps subtraction. |
| `export/pdf.ts`   | M2 ✅    | PDF export — lazy jspdf, PNG embed.                     |
| `export/index.ts` | M2 ✅    | Export dispatcher + filename + download trigger.         |
| `exportpopover.ts`| M2 ✅    | Cmd/Ctrl+E export popover content (three format pills). |
| `settings/curve-editor.ts` | M2 ✅ | SVG curve graph + draggable midpoint + test-stroke pad + thumbnail renderer. |
```

Update existing rows for refactors:

```
| `render.ts`       | M2 ✅    | Three-layer canvas; M2 extracted `paintBoard(ctx, bounds, settings, strokes)` so on-screen render and PNG export share code. ADR 0009 § Renderer. |
| `stroke.ts`       | M2 ✅    | Stroke geometry + perfect-freehand; M2 added `applyPressure(input, brush)` + `bezierY(x, mid)` for curve-aware pressure mapping. |
| `settings.ts`     | M2 ✅    | M1.7 v1 schema extended at M2 with `predictedEvents: boolean` (top-level) and `pressureCurve?: { mid: [number, number] }` (per-brush sparse override). ADR 0010. |
| `pointer.ts`      | M2 ✅    | Reads `settings.predictedEvents` at pointermove (URL `?predict=1` overrides). |
```

- [ ] **Step 2: Update § 6 As-built table**

Find the M2 placeholder rows. Replace with:

```
| **Floating toolbar / palette**    | 🟡 Deferred    | M2 — dropped per ADR 0011; right-click menu + keyboard cover discovery. |
| **Pressure curve UI**             | ✅ Complete    | M2; inline collapsed thumbnail per brush card; bezier-midpoint editor + test pad. |
| **Predicted-events toggle**       | ✅ Complete    | M2; Settings panel Advanced section; URL `?predict=1` continues to override. |
| **Color eyedropper tool**         | ✅ Complete    | M2; `I` key, samples strokes offscreen layer, reverts to prev tool. |
| **First-run hint**                | ✅ Complete    | M2; localStorage `whiteboard:hint-shown`; fades on first stroke. |
| **Distraction-free mode (`F`)**   | ✅ Complete    | M2; `body.distraction-free` hides chrome; Esc/F exits. |
| **Palette cycle (`Shift+[/]`)**   | ✅ Complete    | M2; cycles 10 curated colors with wraparound. |
| **Export PNG / SVG / PDF**        | ✅ Complete    | M2; right-click EXPORT row + `Cmd/Ctrl+E` popover; mask-based SVG erasure. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(m2): architecture as-built — flip M2 rows ✅

§ 2.1: 10 new module rows for M2 surfaces. Existing rows updated for
paintBoard extraction (render.ts), pressure math (stroke.ts), schema
additions (settings.ts), and predicted-events read (pointer.ts).

§ 6: M2 rows flipped to ✅ except toolbar (🟡 deferred per ADR 0011)."
```

---

## Task 23: milestones.md update + tag prep

**Files:**
- Modify: `docs/milestones.md`

- [ ] **Step 1: Update the status table**

Find:

```
| M2 | Toolbar UI, keyboard shortcuts, export                                   | ⬜     |
```

Replace with:

```
| M2 | Export, settings polish, eyedropper, distraction-free                    | ✅ *(closed 2026-05-09; tagged `m2-export-polish`)* |
```

- [ ] **Step 2: Update the M2 milestone definition**

Find the `### M2 — Toolbar UI, settings, export ⬜` heading. Replace heading + body:

```
### M2 — Export, settings polish, eyedropper, distraction-free ✅

> **Closed 2026-05-09.** Tagged `m2-export-polish`. Toolbar UI dropped per [ADR 0011](decisions/0011-toolbar-deferred.md).

**Scope (post-brainstorm).** Color eyedropper tool, first-run hint, `Shift+[/]` palette cycle, `F` distraction-free, pressure curve UI per brush (inline collapsed thumbnail + bezier-midpoint editor + test pad), predicted-events toggle in settings, PNG/SVG/PDF export via right-click EXPORT row + `Cmd/Ctrl+E` popover.

The toolbar UI commitment from SPEC § 4.2 was dropped during brainstorm on tenet grounds (less chrome = less cognitive load); existing surfaces (right-click menu, keyboard shortcuts, settings panel) cover the discovery and one-click paths the toolbar would have served.

**Exit criteria.**

- [x] All seven feature surfaces ship and pass unit tests.
- [x] PNG / SVG / PDF exports visually match the on-screen board (grid, strokes, erased holes preserved).
- [x] Pressure curve UI: midpoint drag updates curve live; reset clears override; thumbnail glance-reads the per-brush state.
- [x] Predicted-events toggle persists; URL `?predict=1` continues to win as session override.
- [x] Distraction-free mode hides app chrome; Esc / F exits.
- [x] First-run hint fades on first stroke; never shown again on this device.
- [x] Eyedropper samples strokes offscreen layer (not committed; grid pixels never sampled).
- [x] **Feel-test gate** on Wacom Intuos: all M2 surfaces feel right.
- [x] `docs/architecture.md` updated; ADR 0011 written; CHANGELOG entry; SPEC § 1/4/6/10 updated.
```

- [ ] **Step 3: Commit**

```bash
git add docs/milestones.md
git commit -m "docs(m2): milestones — close M2; tag prep

Status table flipped to ✅ closed 2026-05-09 with tag m2-export-polish.
M2 heading + body retitled to \"Export, settings polish, eyedropper,
distraction-free\". Toolbar drop captured with ADR 0011 reference.
Exit criteria all checked."
```

---

## Task 24: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add new section under `[Unreleased]`**

Open `CHANGELOG.md`. Add at the top of `[Unreleased]` (above existing M1.7 / M1.7.1 entries):

```markdown
### Added (M2 — export, polish, settings addenda)

- **Export PNG / SVG / PDF.** Right-click → EXPORT row (sibling to TOOL / VIEW / SETTINGS) with PNG / SVG / PDF pills, and `Cmd/Ctrl+E` opens a popover at cursor with the same three pills. Both paths converge on `exportBoard(format)`. Filename: `whiteboard-YYYY-MM-DD-HHMM.{ext}`. Defaults: all non-deleted strokes, fit to bounding box + 32 px margin, PNG at 1× DPR. PDF embeds a rasterized PNG (SVG-vector PDF deferred — `jspdf` SVG support is uneven). SVG export uses `<mask>` with subtractive `<circle>` per `erasedStamp` so partial-erased strokes export with their holes intact. Highlighter strokes export with `mix-blend-mode: multiply`. `jspdf` (~70 KB gz) is dynamically imported on first PDF export so non-PDF users never load it. Empty board: pills disabled with "Nothing to export" toast.
- **Color eyedropper tool.** New `I` key + right-click TOOL section pill. Modal tool conforming to ADR 0007. Samples color from the strokes offscreen layer (not committed — grid pixels never sample, clean by construction); on pointerdown commits to active brush color and reverts to previous tool. Cursor visual: 16 px disc filled with the live-sampled color, with a thin black/white contrast ring (theme-robust). Alpha < 0.5 holds the previous sample (no flicker over wipe-erased regions).
- **Pressure curve UI** in the settings panel. Each Brush preset card grows a 30 × 18 px clickable thumbnail next to the title. Click expands the card with a 200 × 120 px SVG graph editor (draggable midpoint handle, dashed reference diagonal, light grid lines at 0.25/0.5/0.75) + a 120 × 80 px test-stroke pad. Drag the midpoint or click anywhere on the graph to create / adjust the override. "Reset *<Brush>* curve" link clears it. Schema: `presets[brushId].pressureCurve?: { mid: [number, number] }` — quadratic bezier from (0,0) to mid to (1,1) in normalized 0–1 coords. Sparse override of `pressureGamma` — absent = γ scalar applies. The bezier inversion is closed-form (quadratic formula) so `applyPressure` stays under 1 µs per sample on the hot stroke-render path.
- **Predicted-events toggle.** Settings panel Advanced section gains a board-level toggle "Predicted events" with help text explaining indirect-input (Wacom Intuos) vs direct-input (iPad / Surface / MobileStudio) tradeoffs. Schema: `predictedEvents: boolean` at top-level `SettingsV1`, default `false` (ADR 0004). URL `?predict=1` continues to win as session override.
- **First-run discovery hint.** Empty-board overlay: *"Right-click for tools · ? for help"* centered ~25% from viewport bottom, theme-aware muted color. Fades over 200 ms on first stroke commit; localStorage `whiteboard:hint-shown=true` set at fade-start. Never shown again on this device.
- **`Shift+[` / `Shift+]` palette cycle.** Cycles the 10 curated colors in grid order with wrap-around. Bound globally (works regardless of active tool — pre-selects color for next stroke). Skips custom + recent — explicit recent picks aren't disturbed by rapid cycling.
- **`F` distraction-free mode.** Hides app chrome (Help pill, Tool pill, popovers, settings panel) via a single `body.distraction-free` CSS class. Does *not* invoke the browser Fullscreen API — F11 already covers that. On entry: dismisses any open popover, auto-closes settings panel, shows a 2-second toast "Press Esc or F to exit". `Esc` or `F` again exits.

### Changed (M2)

- **Toolbar UI dropped** from v1 scope per [ADR 0011](docs/decisions/0011-toolbar-deferred.md). The right-click context menu (M1.5 → M1), keyboard shortcuts, color picker popover, settings side panel (M1.7), and toolpill (M1) cover the discovery and one-click surfaces a toolbar would have served. SPEC § 4.2 retired; § 1 Goals updated; § 10 open decisions sweep done.
- **`render.ts` extracts `paintBoard(ctx, bounds, settings, strokes)`** — pure refactor, no on-screen behavior change. PNG export and the on-screen committed render now share this code path; avoids a "two renderers slowly drifting" problem.
- **`stroke.ts` adds `applyPressure(input, brush)`** that dispatches to `bezierY(x, mid)` when the brush has a `pressureCurve` override; otherwise falls through to `input ** pressureGamma`. Existing perfect-freehand integration's pressure call site swaps to `applyPressure`. Behavior identical until M2's curve UI lands.
- **Settings schema** gains `predictedEvents: boolean` (top-level) and `pressureCurve?: { mid: [number, number] }` (per-brush via `Partial<Omit<BrushConfig, 'color'>>`). No `schemaVersion` bump — `migrate()`'s mechanical-fill (ADR 0010) handles missing fields on load. `validateOnePreset` deep-validates the new field type. `PresetField` union + `isValidPresetField` allowlist extended.
- **`pointer.ts` reads `settings.predictedEvents`** at pointermove time (was URL flag only). URL `?predict=1` still wins.

### Fixed (M2)

- **`migrate()` deep-validates `predictedEvents`** (boolean check; falls back to `false` if a tampered localStorage carries a non-boolean — same defensive pattern as M1.7.1's `validatePresets`).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(m2): CHANGELOG — M2 added/changed/fixed entries

7 features under Added (export, eyedropper, pressure curve UI,
predicted-events toggle, first-run hint, Shift+[/], F distraction-
free).

Changed: toolbar drop (ADR 0011), render.ts paintBoard extraction,
stroke.ts applyPressure dispatch, schema additions, pointer.ts
predictedEvents read.

Fixed: migrate() deep-validates predictedEvents (M1.7.1-style defense
in depth)."
```

---

## Task 25: Final pass — lint, typecheck, test, dev-server feel-test, perf gate

**Files:**
- (none — verification only)

This task verifies M2 is ready to tag.

- [ ] **Step 1: Run full lint + typecheck + test pipeline**

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run lint && bun run typecheck && bun test
```

Expected: 0 errors, all tests pass. Test count should be ~50+ (26 baseline + new tests from Tasks 1, 2, 4, 5, 6, 7, 9, 11, 13).

- [ ] **Step 2: Run perf gates**

```bash
bun run dev
```

In another terminal / browser, open the synthetic harnesses:

```
http://localhost:5173?perftest=erase&n=500
http://localhost:5173?perftest=scale&n=500
http://localhost:5173?perftest=1
```

Expected per-frame render duration:
- erase: mean < 5 ms, p95 < 10 ms, max < 16 ms (M1.7 baseline: 4.92 / 6.8 / 16.1).
- scale: mean < 5 ms, p95 < 10 ms, max < 16 ms (M1.7 baseline: 3.83 / 6.9 / 15.6).
- standard `?perftest=1`: input-to-render latency p95 < 10 ms.

Any regression flag for investigation. The `applyPressure` change is the most likely suspect — verify the bezier branch isn't hot when no override exists (closed-form math should keep the unchanged-default path identical).

- [ ] **Step 3: Wacom Intuos feel-test (per `docs/process.md` rule)**

Run through every M2 feature on real hardware. Don't tag the milestone until the user signs off:

- [ ] Eyedropper: I key + right-click pill; sample over various strokes; cursor disc shows live sampled color; pointerdown commits + reverts.
- [ ] First-run hint: clear localStorage flag, reload, hint visible, draw a stroke, hint fades, reload, hint absent.
- [ ] Shift+[/]: cycles curated palette in both directions with wraparound; doesn't pollute recent.
- [ ] F distraction-free: chrome hidden, toast appears 2s, Esc / F exits, re-entry re-shows toast.
- [ ] Pressure curve: thumbnail per brush; click expands; drag midpoint updates curve + thumbnail; test pad reflects current curve; reset clears override.
- [ ] Predicted-events: default off (no on-screen prediction on Intuos); toggle on → prediction visible (and likely flickers per ADR 0004); URL `?predict=1` overrides.
- [ ] Export PNG: file matches board (grid, strokes, erased holes).
- [ ] Export SVG: open in browser; visually correct; mask-based erasure intact.
- [ ] Export PDF: open in PDF viewer; page sized to bounds; image preserves grid + strokes.
- [ ] Cmd/Ctrl+E popover and right-click EXPORT row both work.
- [ ] Empty board: export pills + popover pills disabled with "Nothing to export" toast.

- [ ] **Step 4: If any feel-test regression, file follow-up tasks before tagging**

Add tasks + an `m2.x` hardening commit in the spirit of M1.7.1.

- [ ] **Step 5: Tag the milestone (after user feel-test signoff)**

```bash
git tag -a m2-export-polish -m "M2 — export, settings polish, eyedropper, distraction-free

Features:
- Color eyedropper tool (I key)
- First-run discovery hint (one-time)
- Shift+[/] palette cycle
- F distraction-free mode
- Pressure curve UI (per-brush, bezier-midpoint editor)
- Predicted-events toggle (settings panel)
- PNG/SVG/PDF export (right-click EXPORT row + Cmd/Ctrl+E popover)

Toolbar dropped per ADR 0011.

Perf gates verified: erase / scale / latency within budget.
Wacom Intuos feel-test signoff."
```

(Push only with user approval — milestone tags affect public repo state.)

---

## Self-Review

**1. Spec coverage:**

- § 1 Goal — covered by Tasks 1–18 (all 7 features) + Task 21 (SPEC update).
- § 2 Locked decisions — every row maps to a task.
- § 3 Non-goals — every item explicitly out-of-scope with no task. Confirmed.
- § 4 Architecture — Tasks 1–18 implement the module graph delta; Task 22 documents.
- § 5 Schema design — Task 1.
- § 6 Per-feature design — Tasks 4, 5, 6, 7, 9, 10, 11–15.
- § 7 File-by-file plan — every new file has a task; every extended file has a task; doc updates in Tasks 20–24.
- § 8 Testing — unit tests in Tasks 1, 2, 4, 5, 6, 7, 9, 11, 13. Manual feel-test in Task 25. Perf gate in Task 25.
- § 9 Out-of-scope follow-ups — no tasks (correct).

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later" / "add appropriate error handling" / "similar to Task N". Every code step has actual code.

**3. Type consistency:**

- `setPresetField(brushId, field, value)` — used consistently across Tasks 1, 9 ✅
- `cyclePaletteIndex(current, direction)` — defined Task 6, called Task 18 ✅
- `mountFirstRunHint(parent)` + `dismissFirstRunHint()` — defined Task 4, called Task 18 ✅
- `toggleDistractionFree(opts?)` with `opts.dismissPopover?: () => void` and `opts.dismissSidePanel?: () => void` — defined Task 5, called Task 18 with injected callbacks ✅
- `createEyedropperTool(opts)` returning `Tool` — defined Task 7, registered Task 18 ✅
- `exportBoard(format, opts)` — defined Task 15, called Tasks 16, 17 ✅
- `computeBoardBounds(strokes)` — defined Task 11, called Tasks 12, 13, 14, 15 ✅
- `paintBoard(ctx, bounds, settings, strokes)` — defined Task 3, called Task 12 ✅
- `applyPressure(input, brush)` + `bezierY(x, mid)` — defined Task 2, called Task 9 ✅
- `clearPresetCurve(brushId)` — defined Task 1, called Task 9 ✅
- `setPredictedEvents(value)` — defined Task 10 step 1, called Task 10 step 4 ✅
- `showExportPopover(opts)` — defined Task 16, called Task 18 ✅
- `renderCurveThumbnail(brushId)` — defined Task 9, called Task 10 ✅

All type / signature references are consistent.

**4. Ambiguity check:** No further ambiguities to fix.

---

## Summary

25 tasks. Fits the M2 scope of 7 features + 5 doc updates + 1 ADR + 1 final-pass verification. TDD cadence on every code task with unit tests where the surface is testable; manual feel-test gate at Task 25. Closed-form pressure-curve math; sparse-additive schema; lazy-imported `jspdf`; mask-based SVG erasure. Toolbar drop captured in ADR 0011.

**DOM construction throughout uses `createElement` + `appendChild` + `textContent` / `replaceChildren` — never `innerHTML` with template-literal content.** This keeps the codebase XSS-free by construction.
