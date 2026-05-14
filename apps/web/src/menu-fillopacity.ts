/**
 * Shared fill-opacity slider widget for the Shape tool and the Select-
 * tool's shape contextual menu. Both menus need the same visual
 * (range input + percent readout) but have different commit semantics:
 *
 *   - Shape tool (sticky setter): the slider writes the
 *     `shapeFillOpacity` sticky setting, which becomes the default
 *     for the NEXT new shape. No preview is needed because the
 *     current canvas isn't affected.
 *
 *   - Select tool (per-shape edit op): the slider live-edits the
 *     currently-selected shape's `fillOpacity`. The host wants live
 *     visual feedback during the drag (input → mutate + save) and a
 *     SINGLE edit-shape op emitted at the end (change → push op
 *     with the pre-scrub value as `before`).
 *
 * The widget below abstracts the shared shape: range input config,
 * percent readout, scrub-start capture on pointerdown/keydown. The
 * host provides `onPreview` (input-phase, live) and `onCommit`
 * (change-phase, with the scrub-start value for op construction).
 *
 * Why two-phase: a slow slider drag fires ~20 `input` events per
 * second. Committing on every input would (a) pollute undo with N
 * edit-shape ops per drag and (b) under future M3 sync, multiply
 * Y.Doc transactions by N. The two-phase model collapses each drag
 * into exactly one undoable / syncable commit.
 */

/** Slider range in [OPACITY_MIN, OPACITY_MAX], clamped at the same
 *  bounds the settings module enforces. Step is fine enough for a
 *  smooth scrub but coarse enough that the readout reads as a clean
 *  integer percent. */
const OPACITY_MIN = 0.05
const OPACITY_MAX = 1.0
const OPACITY_STEP = 0.05

export interface OpacitySliderDeps {
  /** Initial value at build time. Read once; the widget doesn't poll. */
  get(): number
  /** Disabled visual + interaction state. Use when the surrounding
   *  context makes fill irrelevant (e.g. line / arrow sub-modes). */
  disabled: boolean
  /** Called on every `input` event (live, during drag). Use for
   *  live preview (mutate the shape + re-render). Optional — the
   *  Shape tool doesn't need a live preview because its sticky
   *  setter has no current-canvas effect. */
  onPreview?: (v: number) => void
  /** Called once on commit (`change` event = pointerup / keyboard
   *  release). `scrubStart` is the value the slider held at the
   *  start of the current drag — null when the change fired without
   *  a preceding pointerdown / keydown (assistive-tech setValue or
   *  the slider being clicked in one spot). */
  onCommit(v: number, scrubStart: number | null): void
}

export function buildFillOpacitySlider(deps: OpacitySliderDeps): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'whiteboard-tools-row whiteboard-fillopacity-row'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = String(OPACITY_MIN)
  slider.max = String(OPACITY_MAX)
  slider.step = String(OPACITY_STEP)
  slider.value = String(deps.get())
  slider.className = 'whiteboard-fillopacity-slider'
  slider.disabled = deps.disabled
  slider.setAttribute('aria-label', 'Fill opacity')

  const readout = document.createElement('span')
  readout.className = 'whiteboard-fillopacity-readout'
  const renderValue = (v: number): string => `${Math.round(v * 100)}%`
  readout.textContent = renderValue(deps.get())

  // Track the start-of-scrub value so onCommit can supply it. Captured
  // on pointerdown / keydown; cleared after each commit. Hosts use
  // this to construct an edit-shape op's `before` payload.
  let scrubStart: number | null = null
  const beginScrub = (): void => {
    if (scrubStart === null) scrubStart = Number(slider.value)
  }
  slider.addEventListener('pointerdown', beginScrub)
  slider.addEventListener('keydown', beginScrub)

  slider.addEventListener('input', () => {
    const v = Number(slider.value)
    readout.textContent = renderValue(v)
    if (scrubStart === null) scrubStart = v
    deps.onPreview?.(v)
  })
  slider.addEventListener('change', () => {
    const v = Number(slider.value)
    deps.onCommit(v, scrubStart)
    scrubStart = null
  })

  row.appendChild(slider)
  row.appendChild(readout)
  return row
}
