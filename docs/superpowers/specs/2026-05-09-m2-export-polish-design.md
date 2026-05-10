# M2 — Export, polish, and settings addenda

**Date:** 2026-05-09
**Status:** Spec — pending implementation plan
**Milestone:** M2 (see [docs/milestones.md](../../milestones.md))
**Related ADR:** [0011-toolbar-deferred](../../decisions/0011-toolbar-deferred.md) (to be written during implementation)

## 1. Goal

Ship the remaining v1 polish: file export (PNG / SVG / PDF), a color eyedropper tool, a distraction-free drawing mode, an inline pressure-curve editor per brush, a one-time first-run discovery hint, two new keyboard shortcuts (`Shift+[` / `Shift+]`, `F`), and a predicted-events toggle for screen-tablet users. Drop the toolbar UI commitment from SPEC § 4.2 in favor of the existing right-click menu + keyboard shortcuts + side panel surfaces, which feel-tested through M0 / M1 / M1.7 already cover the discovery and one-action paths a toolbar would have served.

## 2. Locked decisions

Captured during brainstorming (2026-05-09):

| Decision | Lock |
|---|---|
| **Toolbar UI** | **Dropped** — the SPEC § 4.2 floating-toolbar commitment is dropped. Right-click menu (M1.5 → M1) + keyboard shortcuts + first-run hint (M2) cover discovery and one-keystroke access. Tenet citation: "Visual minimalism is functional" + "Things that don't help drawing don't ship at all, or ship hidden by default." Captured in ADR 0011. |
| **UI framework** | Vanilla TS + nanostores. The toolbar removal makes the framework decision lighter — only a small set of reactive bits inside settings + sidepanel + popovers. nanostore patterns already match `settings.ts` subscribers; no new framework adopted. |
| **Image-import scope** | Deferred to M5.1. Architectural surface (BoardObject discriminated union, image render layer, Blob persistence, sync question) doesn't fit M2's "export + polish" theme. |
| **Spec decomposition** | Single spec — this document. Mirrors M1.7's pattern: scaled sections per complexity, one milestone-tag, one CHANGELOG entry. |
| **Eyedropper tool** | Modal tool conforming to ADR 0007. Key `I` (Photoshop / Krita / Procreate convention). Right-click TOOL section pill alongside Draw / Eraser / Lasso. No Alt-click in-flow modifier in v1 (yagni). |
| **Eyedropper sample source** | Read from the *strokes offscreen layer* (ADR 0009 destination-out-applied layer) via `getImageData(1, 1)`. Grid pixels live on the committed layer and never sample — clean by construction. |
| **First-run hint** | Single line *"Right-click for tools · ? for help"* centered ~25% from bottom. Fade-out (200 ms) on first stroke commit; localStorage flag `whiteboard:hint-shown=true` set at fade-start. Never shown again on this device. |
| **`Shift+[` / `Shift+]`** | Cycles 10 curated colors in grid order (left-to-right, top-to-bottom). Bound globally (no tool filter). Skips custom + recent. Does not push to `recentColors` (rapid cycling shouldn't flood). |
| **`F` (distraction-free)** | Hides app UI only — Help pill, Tool pill, popovers, settings panel. **Does not** invoke browser Fullscreen API (F11 already covers that). 2-second exit-affordance toast on entry: *"Press Esc or F to exit."* Re-entry re-shows toast. |
| **Pressure curve UI placement** | Inline collapsed thumbnail (30×18 px) in each Brush preset card, expanding inline on click. One brush expands at a time; click another brush's thumbnail to switch. The thumbnail itself is the override-presence indicator (γ-shape vs bent). |
| **Pressure curve representation** | Quadratic bezier from `(0,0)` to `mid` to `(1,1)` in normalized 0–1 coords. `presets[brushId].pressureCurve?: { mid: [number, number] }`. Sparse override of `pressureGamma` — absent = γ scalar applies. |
| **Predicted-events toggle** | Settings panel Advanced section, *above* the per-brush knobs (it's a board-level setting, not per-brush). Schema field `predictedEvents: boolean` at top-level `SettingsV1`, default `false` (ADR 0004 indirect-input rationale). `?predict=1` URL flag continues to win as session override. |
| **Cursor preview enhancement** | **Dropped** from M2 scope — the M1 "Pen hover preview" already meets the SPEC § M2 exit criterion ("a small circle at the cursor showing the brush's effective size + color before any stroke; disappears during contact"). User feel-test confirmed at brainstorm: "what we have now works well." |
| **Export defaults** | All non-deleted strokes, fit to bounding box + 32 px margin. PNG at 1× DPR, SVG via custom serializer (perfect-freehand outlines + mask-based erasure), PDF via `jspdf` (lazy-imported) wrapping a PNG embed. Filename `whiteboard-YYYY-MM-DD-HHMM.{ext}`. No options dialog in v1. |
| **Export entry points** | Right-click toolmenu → global EXPORT row (sibling to TOOL / VIEW / SETTINGS) with three pills (PNG / SVG / PDF) **and** `Cmd/Ctrl+E` opens a small `popover.ts`-based picker at cursor with the same three pills. Both paths converge on `exportBoard(format)`. |
| **Schema bump** | None. All schema additions are sparse-additive within `SettingsV1`. `migrate()` mechanical-fill handles missing fields on load (ADR 0010 principle). |

## 3. Non-goals

Out of scope for M2; tracked in § 9:

- **Floating toolbar UI.** Removed from SPEC commitments by this milestone (ADR 0011).
- **Image paste / `Cmd/Ctrl+V`.** Confirmed M5.1 — own milestone given BoardObject discriminated-union architectural surface.
- **Eyedropper Alt-click in-flow modifier.** Modal tool only in v1; in-flow Photoshop pattern deferred until requested.
- **Viewport-mode export.** v1 exports all strokes; "what's on screen" mode deferred.
- **DPI / resolution selector for PNG.** v1 ships at 1× DPR; 2× / 4× selector deferred.
- **SVG-native PDF embedding.** v1 PDF embeds a rasterized PNG. Vector-fidelity PDF deferred (jspdf SVG support is uneven).
- **Multi-control-point spline curve editor.** v1 ships single midpoint; 4-point Procreate-style spline deferred.
- **Custom hotkey rebinding UI.** `keymap.ts` stays hardcoded.
- **Per-brush color override.** Brushes continue to share `settings.color`.
- **Pressure-curve test pad with full perfect-freehand fidelity.** v1 test pad uses the same render path as the live layer; the test pad shows the *curve* effect, not arbitrary brush dynamics. Brushes that compose with size + opacity show those alongside the curve.

## 4. Architecture

### 4.1 No new primitives

M2 introduces no new architectural primitives. Every feature plugs into surfaces M1.4 / M1 / M1.5 / M1.7 already built:

| Feature | Existing surface |
|---|---|
| Eyedropper tool | ADR 0007 `Tool` interface — new `tools/eyedropper.ts`, registered in tool registry. |
| First-run hint | Bare DOM element on `#app`; orchestrator dispatches dismissal on first stroke-commit (one-line addition at the existing `create`-op emission point in `main.ts`). |
| `Shift+[/]` palette cycle | `keymap.ts` registry; reads `CURATED_COLORS` from `colorpicker.ts`. |
| `F` distraction-free | `keymap.ts` + a single CSS class on `body`. Existing `clearflow.ts` toast host shows the exit hint. |
| Pressure curve UI | `settings/panel-content.ts` extension; sub-component `settings/curve-editor.ts`. |
| Predicted-events toggle | `settings/panel-content.ts` Advanced section + one read site in `pointer.ts`. |
| Export | `toolmenu.ts` global row + `popover.ts`-hosted `exportpopover.ts` + `keymap.ts` for `Cmd/Ctrl+E`. New `export/` directory: `bounds.ts`, `png.ts`, `svg.ts`, `pdf.ts`, `index.ts`. |

This is the deliberate consequence of dropping the toolbar: M2 is *additions to existing files* + a small focused `tools/eyedropper.ts` + a focused `export/` directory + a `settings/curve-editor.ts` sub-component.

### 4.2 Module graph delta

```
keymap.ts ──→ eyedropper tool (new)
          ──→ palette-cycle handler (new, in colorpicker.ts)
          ──→ distractionfree.ts (new)
          ──→ exportpopover.ts (new)

toolmenu.ts ─→ EXPORT global row (new render path)
            ─→ Eyedropper TOOL pill (additive to TOOL row)

settings/panel-content.ts ─→ curve-editor.ts (new)
                            ─→ predicted-events toggle row (additive to Advanced)

export/index.ts ─→ export/bounds.ts
                ─→ export/png.ts
                ─→ export/svg.ts
                ─→ export/pdf.ts (lazy import of jspdf)

main.ts ─→ firstrun.ts (mount/dismiss)
        ─→ distractionfree.ts (initial wiring)

stroke.ts ─→ applyPressure(input, brush) + bezierY(x, mid) (new)
render.ts ─→ paintBoard(ctx, bounds, settings) — extracted from existing render path
```

`render.ts` factors out a shared `paintBoard(ctx, bounds, settings)` function so the on-screen committed pass and the PNG export path render through the same code. This avoids a "two renderers, slowly drifting" problem.

## 5. Schema design

Single additive update to `SettingsV1`. **No `schemaVersion` bump** — `migrate()`'s mechanical-fill principle (ADR 0010) handles missing fields on load.

### 5.1 `SettingsV1` extensions

```ts
// apps/web/src/settings.ts
export interface SettingsV1 {
  // ... existing M1.7 fields unchanged ...
  predictedEvents: boolean    // NEW; default false (ADR 0004)
  // existing presets field already accommodates pressureCurve via Partial<Omit<BrushConfig, 'color'>>
}
```

### 5.2 `BrushConfig` extension

```ts
// packages/shared/src/types.ts
export type BrushConfig = {
  // ... existing fields unchanged ...
  pressureCurve?: { mid: [number, number] }
}
```

Sparse semantics: when `pressureCurve` is present, it overrides `pressureGamma`. When absent, `pressureGamma` applies as today. Empty `presets[brushId].pressureCurve` (the default state) yields exactly today's behavior — SPEC defaults always recoverable.

### 5.3 Migration

`migrate(input)` extends to fill `predictedEvents` with `false` when missing. The existing v0 → v1 path also fills it (by virtue of constructing a fresh `SettingsV1` literal via `defaultV1()`).

`migrate()` continues to validate field types (`predictedEvents` must be boolean; otherwise default). The deep-validation pass added in M1.7.1 covers this for free — `predictedEvents` is one new key in the known-keys list.

### 5.4 Rendering math

```ts
// apps/web/src/stroke.ts
export function applyPressure(input: number, brush: BrushConfig): number {
  if (brush.pressureCurve) return bezierY(input, brush.pressureCurve.mid)
  return input ** brush.pressureGamma
}

export function bezierY(x: number, mid: [number, number]): number {
  // quadratic bezier (0,0) → mid → (1,1) in normalized 0–1 coords
  // x(t) = 2(1-t)t·mx + t² ; solve for t given x, then y(t) = 2(1-t)t·my + t²
  // closed-form via quadratic: at² + bt + c = 0 with a = 1 - 2mx, b = 2mx, c = -x
  const [mx, my] = mid
  const a = 1 - 2 * mx
  const b = 2 * mx
  const c = -x
  let t: number
  if (Math.abs(a) < 1e-9) {
    // degenerate: linear in t — mx = 0.5
    t = -c / b
  } else {
    const disc = b * b - 4 * a * c
    t = (-b + Math.sqrt(Math.max(0, disc))) / (2 * a)
  }
  // clamp to [0, 1] for safety; analytical solution should already lie there
  t = Math.max(0, Math.min(1, t))
  return 2 * (1 - t) * t * my + t * t
}
```

Closed-form keeps `applyPressure` cheap on the hot stroke-render path — no iterative solver.

## 6. Per-feature design

### 6.1 Eyedropper tool (`tools/eyedropper.ts`)

Conforms to ADR 0007. Activation via `I` (keymap), right-click TOOL → Eyedropper pill, or `setTool('eyedropper')` from the orchestrator (`main.ts` exports the dispatcher; mirrors `eraserhold.ts` lines 19–42). The eyedropper captures the previous tool id at activation time so it can revert on commit.

**Cursor visual** — small filled disc (16 px) at cursor showing the live-sampled color, with a thin black/white contrast ring (matches theme). No crosshair — the disc itself communicates "I'm picking color." Implemented in `redraw(ctx)` per ADR 0007.

**Sampling on `pointermove`**:
1. Read pixel from the strokes offscreen layer (ADR 0009 layer; `RenderTarget.strokes`) at cursor screen position via `getImageData(1, 1)`.
2. RGBA → hex via standard `rgba2hex` helper.
3. If alpha < 0.5, hold the previous sample (no flicker); cursor disc keeps last hex.
4. If alpha ≥ 0.5, update cursor disc color to sampled hex; cache as last sample.

**Commit on `pointerdown`**:
```ts
settings.color = sampledHex
pushRecentColor(sampledHex)
setTool(prevToolId)   // injected via tool-context (eraserhold.ts pattern)
```

No op emitted (eyedropper doesn't mutate the board). The previous tool resumes; the user's next stroke uses the picked color.

**Edge cases**:
- Cursor over a wipe-erased region: pixel reads alpha-zero → hold previous.
- Cursor over highlighter (alpha 0.4): reads composited color (matches what user sees).
- Cursor outside the canvas (over chrome): not applicable — pointer-capture during the tool keeps events on the canvas; pointer can leave canvas, but `getImageData` still reads at the cursor screen-relative position; clamp to canvas bounds.

**Right-click TOOL section** — add Eyedropper pill:
```
─── TOOL ───
  [ Draw ]  [ Eraser ]  [ Lasso ]  [ Eyedropper ]
```

**Keymap** — `I` activates eyedropper; `Esc` (existing handling) reverts to previous tool.

### 6.2 First-run hint (`firstrun.ts`)

DOM element appended to `#app` on app boot iff `localStorage.getItem('whiteboard:hint-shown') !== 'true'`.

**Element**:
```html
<div id="firstrun-hint" class="firstrun-hint">
  Right-click for tools · ? for help
</div>
```

**Position** — centered horizontally, ~25% from bottom of viewport. CSS:
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
}
.firstrun-hint.fading { opacity: 0; }
```

**Fade trigger** — `firstrun.ts` exports `dismissFirstRunHint()`. The orchestrator (`main.ts`) calls it once at the existing `create`-op emission point in the stroke-commit flow. `dismissFirstRunHint` adds `.fading`, listens for `transitionend`, removes the element, and sets `localStorage.setItem('whiteboard:hint-shown', 'true')`. Subsequent calls are no-ops (idempotent).

**Doesn't fade on**: popover open / close, panel toggle, theme cycle, zoom — only on stroke-commit. Reason: a user who explores chrome before drawing should still see the hint until they actually draw. Stroke-commit is the unambiguous "I've started using the app" signal.

**Theme awareness** — uses `oklch` with `from var(--ink)` to derive a muted variant in both light and dark themes without separate rules.

### 6.3 `Shift+[` / `Shift+]` palette cycle

`keymap.ts` handler. `colorpicker.ts` exports `CURATED_COLORS: readonly string[]` (10 entries, currently internal — promote to module export).

```ts
function cyclePalette(direction: 1 | -1) {
  const current = settings.color
  const idx = CURATED_COLORS.indexOf(current)
  // -1 (custom / recent / 'ink' token): treat as -1 so first cycle lands on 0 or last
  const next = (idx + direction + 10) % 10
  settings.color = CURATED_COLORS[next]
  // explicitly do NOT pushRecentColor — rapid cycling shouldn't pollute recent
}
```

**Bindings** — `Shift+]` → `cyclePalette(1)`, `Shift+[` → `cyclePalette(-1)`. Globally bound (no tool filter). Doesn't conflict with existing `[` / `]` (decrease / increase brush size) — those are bare bracket without Shift; `Shift+[/]` are produced as `{` / `}` characters on most layouts but we key off `e.shiftKey + e.key === '[' / ']'`.

### 6.4 `F` distraction-free mode (`distractionfree.ts`)

`keymap.ts` handler on `F`: toggle `body.classList.toggle('distraction-free')`.

**On entry**:
1. Add class `distraction-free` to `body`.
2. Dismiss any open popover via existing `dismissPopover()`.
3. Auto-close settings panel via existing `dismissSidePanel()`.
4. Show a 2-second toast: *"Press Esc or F to exit."* Reuses `clearflow.ts` toast host with a new sentinel ID `df-exit-hint` so it doesn't collide with clear-board priming.

**On exit** (Esc or F again):
1. Remove class.
2. Clear toast if still visible.

**CSS**:
```css
body.distraction-free .pill,
body.distraction-free .helppill,
body.distraction-free .toolmenu,
body.distraction-free .firstrun-hint {
  display: none;
}
body.distraction-free .sidepanel {
  display: none;
}
```

**Esc handler** — extended to check distraction-free first:
```ts
function onEsc(e: KeyboardEvent) {
  if (document.body.classList.contains('distraction-free')) {
    exitDistractionFree()
    e.preventDefault()
    return
  }
  // ... existing Esc behavior (clear-confirm cancel, popover dismiss, etc.)
}
```

**Re-entry** — F again re-shows the toast (consistent UX; no special "you've seen this" suppression).

### 6.5 Pressure curve UI (`settings/curve-editor.ts`)

The biggest M2 surface. Every Brush preset card grows a clickable curve thumbnail; expanded mode lives inline beneath the card's sliders.

#### 6.5.1 Thumbnail (30×18 px SVG)

Rendered inline next to the brush title, replacing nothing (γ slider stays). Draws:
- When `presets[brushId].pressureCurve` is defined: bezier from (0,0) to mid to (1,1).
- Otherwise: γ-derived curve (sample N=20 points using `input ** pressureGamma` and draw as polyline).

Click handler toggles `expandedBrushId`; only one brush is expanded at a time. Switching to another brush's thumbnail collapses the previous and expands the new one.

Visual cue: when a `pressureCurve` override exists, thumbnail border becomes accent-blue (vs default border). User can spot at a glance which brushes have non-default curves.

#### 6.5.2 Expanded editor

Lives in the brush card, below the slider rows when `expandedBrushId === brushId`. Layout:

```
[ 200×120 px graph canvas ]  [ 120×80 px test-stroke pad ]
                              [ "Reset Pen curve" link ]
```

**Graph canvas** — SVG (better than canvas for this at 200×120 — drag handles benefit from SVG hit-testing):
- Background grid: lines at x ∈ {0, 0.25, 0.5, 0.75, 1} and y ∈ same. Light gray.
- Diagonal reference: dashed line from (0, 1) to (1, 0) (input low → output low, input high → output high; SVG y-axis is inverted).
- Current curve: solid accent-blue 1.5 px stroke. Bezier (override) or γ-polyline.
- Draggable midpoint handle: 10 px circle, accent-blue fill, white border. Only rendered when override exists; absent for γ-derived.
- "Activate curve" affordance — when no override, the user clicks anywhere on the graph to *create* the override at that point. The clicked point becomes the initial midpoint; subsequent drags adjust it.

**Drag interaction**:
1. `pointerdown` on handle → set `dragging = true`.
2. `pointermove` → translate cursor position to graph coords (0–1 each axis), clamp to bounds, update `presets[brushId].pressureCurve.mid` via `setPresetField(brushId, 'pressureCurve', { mid: [x, y] })`. (Note: this requires extending the `PresetField` union and `isValidPresetField` allowlist in `settings.ts` to include `'pressureCurve'`.)
3. `pointerup` → `dragging = false`. The setter has already fired persistence + change notifications.

**Test-stroke pad** — a small dedicated `<canvas>` (120×80 px). Pen events on the pad render strokes using the brush's *current effective config* (size scaled to fit, opacity preserved, current curve applied). Cleared on each pen-up. Used to *feel* the curve before committing it to the brush. Implementation: a mini render loop independent of the main canvas; uses the same perfect-freehand math via `applyPressure`.

**Reset link**:
```ts
function resetCurve(brushId: BrushId) {
  delete state.presets[brushId]?.pressureCurve
  if (Object.keys(state.presets[brushId] ?? {}).length === 0) {
    delete state.presets[brushId]   // GC empty entries
  }
  persist()
  emit()
}
```

#### 6.5.3 Renderer integration

`stroke.ts` already exposes `applyPressure(input, brush)` (§ 5.4). The existing perfect-freehand integration that called `input ** brush.pressureGamma` swaps to `applyPressure(input, brush)`. Single call site, single change.

Existing committed strokes are unaffected: `Stroke.brush` is a snapshot at pointerdown (per `architecture.md` § 4). Changing a preset's curve only affects future strokes.

### 6.6 Predicted-events toggle

Settings panel Advanced section, **above** the per-brush knobs (board-level setting). Layout:

```
─── Advanced ───
   ▶ Show advanced       [collapsed by default]

   [Expanded:]
   ┌───────────────────────────────────────────┐
   │ Predicted events                  [ ◯ ]   │
   │ Visual lookahead during drawing.          │
   │ Enable for screen tablets (iPad, Surface, │
   │ MobileStudio); leave off for indirect-    │
   │ input tablets like Wacom Intuos.          │
   └───────────────────────────────────────────┘
   [ Per-brush advanced knobs continue below ]
```

**Schema** — `predictedEvents: boolean` at top-level `SettingsV1`, default `false` (ADR 0004 indirect-input rationale).

**`pointer.ts` integration**:
```ts
canvas.addEventListener('pointermove', e => {
  for (const c of e.getCoalescedEvents()) appendSample(sample(c))
  // URL flag wins; otherwise read setting
  const predict = urlPredictFlag ?? settings.predictedEvents
  if (predict) {
    const predicted = e.getPredictedEvents().map(sample)
    scheduleRender(predicted)
  } else {
    scheduleRender([])
  }
})
```

URL `?predict=1` continues to win as session override (matches ADR 0004). The `urlPredictFlag` is read once at boot.

### 6.7 Export pipeline (`apps/web/src/export/`)

Five files. Total ~400 LOC excluding `jspdf` import.

#### 6.7.1 `bounds.ts`

```ts
export function computeBoardBounds(strokes: Stroke[]): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let any = false
  for (const s of strokes) {
    if (s.deleted) continue
    const aabb = strokeAABB(s)   // existing cached AABB helper from M1
    if (!aabb) continue
    minX = Math.min(minX, aabb.x)
    minY = Math.min(minY, aabb.y)
    maxX = Math.max(maxX, aabb.x + aabb.width)
    maxY = Math.max(maxY, aabb.y + aabb.height)
    any = true
  }
  if (!any) return null
  const margin = 32
  return { x: minX - margin, y: minY - margin, width: maxX - minX + 2*margin, height: maxY - minY + 2*margin }
}
```

#### 6.7.2 `png.ts`

```ts
export async function exportPNG(strokes: Stroke[], bounds: Bounds, settings: SettingsV1): Promise<Blob> {
  const canvas = new OffscreenCanvas(bounds.width, bounds.height)
  const ctx = canvas.getContext('2d')!
  // Translate so bounds.x maps to canvas origin
  ctx.translate(-bounds.x, -bounds.y)
  // Use the shared paintBoard so PNG export and on-screen render agree
  paintBoard(ctx, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, settings, strokes)
  return await canvas.convertToBlob({ type: 'image/png' })
}
```

`paintBoard(ctx, bounds, settings, strokes)` is extracted from `render.ts` and renders: grid background per `settings.grid` + stroke composite + destination-out for `erasedStamps`. Same code path as on-screen.

#### 6.7.3 `svg.ts`

Custom serializer. Output structure:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="x y w h" width="w" height="h">
  <!-- grid background (if grid type !== 'none') -->
  <defs>
    <pattern id="grid" ...>
      <!-- dots / lines / ruled per settings.grid.type -->
    </pattern>
  </defs>
  <rect x="x" y="y" width="w" height="h" fill="url(#grid)"/>

  <!-- per stroke -->
  <defs>
    <mask id="stroke-N-mask">
      <rect x="..." y="..." width="..." height="..." fill="white"/>
      <!-- one circle per erasedStamp -->
      <circle cx="..." cy="..." r="..." fill="black"/>
    </mask>
  </defs>
  <path d="..." fill="..." mask="url(#stroke-N-mask)"
        opacity="..." style="mix-blend-mode: ..."/>
</svg>
```

Stroke `<path>` `d` attribute: the perfect-freehand outline polygon (same as on-screen render, but as path commands). Highlighter: `opacity="0.4"` + `style="mix-blend-mode: multiply"`. Mask is omitted for strokes with empty `erasedStamps`.

Output: `new Blob([svgString], { type: 'image/svg+xml' })`.

#### 6.7.4 `pdf.ts`

```ts
export async function exportPDF(strokes: Stroke[], bounds: Bounds, settings: SettingsV1): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')   // lazy
  const png = await exportPNG(strokes, bounds, settings)
  const dataUrl = await blobToDataURL(png)
  const pdf = new jsPDF({
    orientation: bounds.width > bounds.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [bounds.width, bounds.height],
    compress: true,
  })
  pdf.addImage(dataUrl, 'PNG', 0, 0, bounds.width, bounds.height)
  return pdf.output('blob')
}
```

v1 embeds rasterized PNG. SVG-vector PDF is a fidelity follow-up (jspdf's SVG plugin support varies).

#### 6.7.5 `index.ts`

```ts
export type ExportFormat = 'png' | 'svg' | 'pdf'

export async function exportBoard(format: ExportFormat): Promise<void> {
  const strokes = getAllStrokes()
  const bounds = computeBoardBounds(strokes)
  if (!bounds) {
    showToast('Nothing to export')
    return
  }
  const blob =
    format === 'png' ? await exportPNG(strokes, bounds, settings.snapshot()) :
    format === 'svg' ? exportSVG(strokes, bounds, settings.snapshot()) :
    await exportPDF(strokes, bounds, settings.snapshot())
  const ts = new Date()
  const stamp = `${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`
  triggerDownload(blob, `whiteboard-${stamp}.${format}`)
}
```

`triggerDownload` creates an `<a>` with `download` attribute, programmatically clicks, revokes the object URL. Standard pattern.

#### 6.7.6 Right-click menu integration

`toolmenu.ts` adds a global EXPORT row, sibling to TOOL / VIEW / SETTINGS:

```
─── (per-tool sections) ───
─── TOOL ───  (existing)
─── VIEW ───  (existing)
─── EXPORT ───  (NEW)
   [ PNG ] [ SVG ] [ PDF ]
─── SETTINGS ───  (existing)
─── (clear) ───
```

Each pill click → `exportBoard(format)` → menu dismisses.

#### 6.7.7 `Cmd/Ctrl+E` popover

`exportpopover.ts` builds content for `popover.ts` to host:

```
┌──────────────────────────┐
│  EXPORT     [pin] [×]     │
│                            │
│  [ PNG ] [ SVG ] [ PDF ]  │
└──────────────────────────┘
```

`Cmd/Ctrl+E` opens at cursor; click → export + dismiss; `Esc` cancels. Single-instance arbitration (existing behavior) — opening this dismisses other popovers.

**Empty board** — when `computeBoardBounds(strokes) === null`, both entry paths show a toast *"Nothing to export"* and don't proceed. Right-click pills are visually disabled (50% opacity, no hover); popover pills are disabled.

### 6.8 Bundle size

Initial bundle target (SPEC § 3.3): <150 KB gz.

| Module | Size impact |
|---|---|
| `tools/eyedropper.ts` | ~1 KB gz |
| `firstrun.ts`, `distractionfree.ts` | ~0.5 KB gz combined |
| `settings/curve-editor.ts` | ~3 KB gz |
| `export/bounds.ts`, `png.ts`, `svg.ts`, `index.ts` | ~3 KB gz combined |
| `export/pdf.ts` (lazy) | not in initial bundle |
| `jspdf` (lazy import on first PDF export) | ~70 KB gz; one-time download cost |

Total static: ~7.5 KB gz added to initial. Stays comfortably under budget.

## 7. File-by-file plan

### 7.1 New files

| File | Responsibility |
|---|---|
| `apps/web/src/tools/eyedropper.ts` | Eyedropper Tool. ADR 0007 conformance. ~80 LOC. |
| `apps/web/src/firstrun.ts` | First-run hint mount, fade trigger, localStorage flag. ~40 LOC. |
| `apps/web/src/distractionfree.ts` | `F`-toggle, body-class management, exit toast. ~50 LOC. |
| `apps/web/src/export/bounds.ts` | Compute board bounds + margin. |
| `apps/web/src/export/png.ts` | PNG export via offscreen canvas. |
| `apps/web/src/export/svg.ts` | Custom SVG serializer; mask-based erasure. |
| `apps/web/src/export/pdf.ts` | PDF export; lazy `jspdf`; PNG embed in v1. |
| `apps/web/src/export/index.ts` | `exportBoard(format)` dispatcher + filename + download trigger. |
| `apps/web/src/settings/curve-editor.ts` | Bezier graph + draggable midpoint + test-stroke pad. |
| `apps/web/src/exportpopover.ts` | `Cmd/Ctrl+E` popover content (three format pills). |
| `apps/web/src/export/svg.test.ts` | SVG fidelity unit tests. |
| `apps/web/src/export/bounds.test.ts` | Bounds-computation unit tests. |
| `apps/web/src/stroke.test.ts` (new) | `bezierY` + `applyPressure` math tests. |
| `docs/decisions/0011-toolbar-deferred.md` | ADR — toolbar dropped from M2 in favor of right-click + keyboard surfaces; tenet citation; M1/M1.5/M1.7 evidence. |

### 7.2 Extended files

| File | Change |
|---|---|
| `apps/web/src/settings.ts` | Add `predictedEvents: boolean` to `SettingsV1`, `defaultV1()`, `validate()` (deep-validates the new field). Extend `PresetField` union + `isValidPresetField` allowlist to include `'pressureCurve'`. Extend `validateOnePreset` known-keys list with `pressureCurve` (object-shape check: `{ mid: [number, number] }`). New helper `clearPresetCurve(id)`. |
| `apps/web/src/settings/panel-content.ts` | Brush card: thumbnail render + click-to-expand + curve-editor mount. Advanced section: predicted-events toggle row above per-brush knobs. |
| `apps/web/src/stroke.ts` | New `applyPressure(input, brush)` + `bezierY(x, mid)` helpers. Existing perfect-freehand call site swaps to `applyPressure`. |
| `apps/web/src/render.ts` | Factor out `paintBoard(ctx, bounds, settings, strokes)`. On-screen render and PNG export both go through it. |
| `apps/web/src/pointer.ts` | Read `settings.predictedEvents` (URL `?predict=1` overrides) inside `pointermove`. |
| `apps/web/src/colorpicker.ts` | Promote `CURATED_COLORS` from internal to module export. |
| `apps/web/src/keymap.ts` | Register `I`, `Shift+[`, `Shift+]`, `F`, `Cmd/Ctrl+E` handlers. Extend `Esc` handler (distraction-free first). |
| `apps/web/src/toolmenu.ts` | Add Eyedropper TOOL pill. Add global EXPORT row with PNG / SVG / PDF pills. |
| `apps/web/src/main.ts` | Wire firstrun.ts mount, distractionfree.ts wiring, exportpopover.ts hookup. Register eyedropper in tool registry. |
| `apps/web/src/style.css` | `body.distraction-free` rules. Curve editor + thumbnail styles. First-run hint styles. |
| `packages/shared/src/types.ts` | Add `pressureCurve?: { mid: [number, number] }` to `BrushConfig`. |
| `apps/web/src/settings.test.ts` | Add tests for `predictedEvents` migration, `pressureCurve` override, `clearPresetCurve`. |

### 7.3 Doc updates

| File | Update |
|---|---|
| `SPEC.md` § 1 Goals | Drop "floating toolbar" from drawing-first UX bullet. |
| `SPEC.md` § 4.1 | Add eyedropper details (key `I`, sampling source). |
| `SPEC.md` § 4.2 | Replace toolbar paragraph with "Right-click menu + keyboard shortcuts cover per-action discovery." Cite ADR 0011. |
| `SPEC.md` § 4.3 | Flip `Shift+[/]`, `F` to ✅. Add `I` (Eyedropper) and `Cmd/Ctrl+E` (Export) rows. |
| `SPEC.md` § 4.4 | Document the bezier-midpoint curve representation; clarify γ → bezier override semantics. |
| `SPEC.md` § 6 | Note PNG / SVG / PDF export shipped. |
| `SPEC.md` § 10 | Remove "Toolbar UI framework" from open decisions; add ADR 0011 reference. |
| `docs/architecture.md` § 2.1 | Add new module rows (eyedropper, firstrun, distractionfree, export/*, settings/curve-editor, exportpopover). |
| `docs/architecture.md` § 6 | Flip M2 rows ✅. |
| `docs/decisions/0011-toolbar-deferred.md` | New ADR. |
| `docs/milestones.md` | Retitle M2 from "Toolbar UI, keyboard shortcuts, export" to "Export, settings polish, eyedropper, distraction-free". Flip ✅ at close; tag `m2-export-polish`. |
| `CHANGELOG.md` | New section under `[Unreleased]`: "Milestone M2 — export, eyedropper, distraction-free, pressure curve, predicted-events toggle." |

## 8. Testing approach

### 8.1 Unit tests (extend `apps/web/src/settings.test.ts` + new test files)

#### `settings.test.ts` additions

| Surface | Tests |
|---|---|
| `migrate()` with v1-shape missing `predictedEvents` | Returns v1 with `predictedEvents: false`; writes back; idempotent on re-load. |
| `migrate()` with type-mismatched `predictedEvents` (e.g. `42`) | Field-level fallback to `false`. |
| `getEffectiveBrushConfig` with `pressureCurve` override | Composed config carries the override; `pressureGamma` unchanged in stored state. |
| `clearPresetCurve(id)` | Removes only `pressureCurve`; other preset overrides survive. Empty-presets entry GC'd. |

#### `stroke.test.ts` (new)

| Surface | Tests |
|---|---|
| `bezierY(0, mid)` | Always 0 (boundary). |
| `bezierY(1, mid)` | Always 1 (boundary). |
| `bezierY(x, [0.5, 0.5])` | Linear: equals x for x ∈ {0, 0.25, 0.5, 0.75, 1}. |
| `bezierY(0.5, [0.5, 0.25])` | 0.25 (curve below diagonal). |
| `bezierY(0.5, [0.5, 0.75])` | 0.75 (curve above diagonal). |
| `applyPressure(input, brush)` | When `pressureCurve` set, returns `bezierY` result. When not, returns `input ** pressureGamma`. |
| `applyPressure` numerical stability | Tested at boundary values (input = 0, 1) and degenerate mid (mx = 0.5) with various my. |

#### `export/bounds.test.ts` (new)

| Surface | Tests |
|---|---|
| `computeBoardBounds(strokes)` single stroke | AABB + 32 px margin. |
| Multiple strokes | Union of AABBs + margin. |
| All deleted | Returns `null`. |
| Empty array | Returns `null`. |
| Soft-deleted excluded | Stroke with `deleted: true` doesn't contribute. |

#### `export/svg.test.ts` (new)

| Surface | Tests |
|---|---|
| Single non-erased stroke | Output contains expected `<path d="...">`; no `<mask>`. |
| Highlighter stroke | Output `<path>` has `opacity="0.4"` and `mix-blend-mode: multiply` style. |
| Stroke with erasedStamps | Output contains `<mask>` with one `<circle>` per stamp; mask referenced via `mask="url(#stroke-N-mask)"`. |
| Grid type 'none' | No `<pattern>` or background `<rect>`. |
| Grid type 'dots' / 'lines' / 'ruled' | Pattern element present with correct primitives. |
| Empty strokes (called with bounds + no strokes — defensive) | Valid SVG with viewBox + grid (or empty). |

PNG and PDF outputs are binary — manual visual diff at feel-test, not unit-tested.

### 8.2 Manual feel-test on Wacom Intuos

Per `docs/process.md` rule (tool / pointer / render changes need a feel-test scenario):

**Eyedropper**:
- Open via `I` and via right-click TOOL → Eyedropper pill.
- Sample over various stroke colors (pen, marker, highlighter, pencil, brush). Composited color matches what's visible.
- Sample over wipe-erased region: cursor disc holds previous color, no flicker.
- Sample over an empty area: cursor disc holds last sample.
- Pointerdown commits → previous tool resumes; next stroke uses sampled color.

**First-run hint**:
- Clear `localStorage.whiteboard:hint-shown`, reload → hint visible centered ~25% from bottom.
- First stroke commit → hint fades over 200 ms.
- Reload → hint is gone (localStorage flag set).
- Open popover / cycle theme / pan canvas — none of those fade the hint pre-stroke.

**`Shift+[/]`**:
- Cycles through 10 curated colors with wraparound, in both directions.
- Doesn't push to `recentColors`.
- Works with each tool active (draw, eraser, lasso, eyedropper).
- Bare `[` / `]` continue to adjust brush size (no collision).

**`F` distraction-free**:
- Enters: chrome hidden (Help pill, Tool pill, popovers, settings panel).
- 2-second toast appears, fades. Mode persists.
- `Esc` exits. `F` again exits.
- Re-entry re-shows toast.

**Pressure curve**:
- Thumbnail visible per brush; γ-shape when no override; bent shape with accent border when override.
- Click thumbnail → card expands; only one expanded at a time.
- Drag midpoint → curve updates live; thumbnail updates; test-stroke pad reflects with new curve.
- Reset link → override cleared; thumbnail reverts to γ shape.
- Existing committed strokes unchanged (their brush snapshot at pointerdown was different).

**Predicted-events toggle**:
- Default off → on Intuos, no visible prediction (matches today).
- Toggle on → predicted lookahead visible on Intuos (will likely flicker — verifies the ADR 0004 default).
- `?predict=1` URL flag overrides the off setting (prediction visible).

**Export**:
- Right-click → EXPORT → PNG / SVG / PDF: each downloads a file matching the board (grid + strokes + erased holes).
- `Cmd/Ctrl+E` → popover opens at cursor; same three pills; same flows.
- Empty board: pills show disabled + tooltip *"Nothing to export"*.
- Multiple strokes spanning a wide area: bounds + margin correct; export captures all of them.
- Highlighter strokes export with correct alpha (PNG) and blend mode (SVG).

### 8.3 Perf gates

`?perftest=erase&n=500` and `?perftest=scale&n=500` stay within 16 ms frame budget.

`applyPressure` is on the hot path — verify the bezier branch doesn't measurably increase `?perftest=1` numbers vs the γ branch. Closed-form math should keep this <1 µs per sample. Set up a per-sample benchmark in `stroke.test.ts` if regressions are suspected.

New `?perftest=export&n=500` (optional — can defer if time pressed):
- Populates N=500 synthetic strokes.
- Times `exportBoard('png')` and `exportBoard('svg')` (skip PDF — `jspdf` import dwarfs the actual export time and is one-time).
- Target: <500 ms wall-clock for both at N=500. Flag if regressed.

## 9. Out-of-scope follow-ups

Tracked for later milestones:

- **Floating toolbar UI** — explicitly deferred (ADR 0011). Reconsider only if user feel-testing surfaces a discoverability gap that the right-click menu + first-run hint don't fix.
- **Eyedropper Alt-click in-flow modifier** — Photoshop pattern. Adds keystroke-while-drawing path; deferred until requested.
- **Viewport-mode export** — `export(format, mode: 'all' | 'viewport')`. v1 always exports all strokes.
- **DPI / resolution selector for PNG** — v1 ships at 1× DPR. 2× / 4× selector deferred.
- **SVG-native PDF embedding** — v1 PDF embeds rasterized PNG. Vector-fidelity PDF deferred.
- **Multi-control-point spline curve editor** — v1 ships single midpoint. Procreate-style 4-point spline if the single midpoint feels limiting.
- **Custom hotkey rebinding UI** — `keymap.ts` stays hardcoded.
- **Image paste / `Cmd/Ctrl+V`** — confirmed M5.1.
- **Per-brush color override** — currently brushes share `settings.color`. Each brush carrying its own color would require a UI decision about which color "wins" when switching.
- **Pressure-curve test pad with full perfect-freehand fidelity** — v1 uses the same render path as the live layer; full brush dynamics in the test pad is a follow-up if the simplified version doesn't communicate the curve effect well enough.
- **First-run hint per-board (vs per-device)** — v1 uses a single localStorage flag per device. If multi-board lands (SPEC § 10 backlog), per-board hints become an option.
- **Distraction-free mode persistence** — v1 always boots with chrome visible. Persistence (last mode survives reload) is a follow-up if usage shows users live in distraction-free.
