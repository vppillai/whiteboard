/**
 * Bottom-right tool indicator pill. Two-zone surface:
 *
 *   [⚙ gear]  [Active tool name]
 *
 * The gear opens the settings side panel (matches Cmd/Ctrl+, and the
 * right-click → Settings… menu row). Tapping the tool-name zone cycles
 * through the enabled tools — pen-friendly one-step activation that
 * complements `S` (lasso), `B` / `P` (draw), `Shift+E` (sticky eraser),
 * and the right-click → TOOL menu.
 *
 * Cycle order is the same as the right-click TOOL row's enabled tools:
 * pen → eraser → lasso → pen. Both zones are real `<button>`s so they get
 * native focus / keyboard activation; main.ts re-focuses `#app` after a
 * click so subsequent keystrokes don't go through the pill.
 */

import type { ToolId } from './tools/types'

const TOOL_LABELS: Record<ToolId, string> = {
  pen: 'Draw',
  eraser: 'Eraser',
  lasso: 'Lasso',
  select: 'Select',
  laser: 'Laser',
  text: 'Text',
}

/** Enabled tools, in cycle order. Mirror of `toolmenu.ts` TOOLS-with-enabled. */
const CYCLE: readonly ToolId[] = ['pen', 'eraser', 'lasso', 'select', 'laser', 'text']

export interface ToolPillOptions {
  initial: ToolId
  /** Called when the user taps the cycle zone. Receives the next tool in the cycle. */
  onCycle: (next: ToolId) => void
  /** Called when the user taps the gear zone. Wired in main.ts to toggle
   *  the settings side panel. */
  onSettingsClick: () => void
}

export interface ToolPill {
  el: HTMLElement
  /** Update the pill's display when the active tool changes externally
   *  (keyboard shortcut, right-click menu, etc.). Idempotent. */
  setActiveTool(id: ToolId): void
}

export function createToolPill(opts: ToolPillOptions): ToolPill {
  const wrap = document.createElement('div')
  // Keep the historical `#whiteboard-tool-pill` id on the wrapper so
  // existing positioning + `var(--pill-bg)` styles continue to apply
  // without churn — the new gear / cycle zones inherit the background.
  wrap.id = 'whiteboard-tool-pill'
  wrap.className = 'whiteboard-toolpill'

  const gear = document.createElement('button')
  gear.type = 'button'
  gear.className = 'whiteboard-toolpill-gear'
  gear.textContent = '⚙'
  gear.title = 'Open settings'
  gear.setAttribute('aria-label', 'Open settings')
  gear.addEventListener('click', () => opts.onSettingsClick())

  const cycle = document.createElement('button')
  cycle.type = 'button'
  cycle.className = 'whiteboard-toolpill-cycle'
  cycle.title = 'Active tool — tap to cycle'
  cycle.setAttribute('aria-label', 'Active tool — tap to cycle')

  const update = (id: ToolId): void => {
    cycle.textContent = TOOL_LABELS[id] ?? id
    cycle.dataset.tool = id
  }

  update(opts.initial)

  cycle.addEventListener('click', () => {
    const cur = cycle.dataset.tool as ToolId | undefined
    const idx = cur ? CYCLE.indexOf(cur) : 0
    const nextIdx = idx < 0 ? 0 : (idx + 1) % CYCLE.length
    const next = CYCLE[nextIdx]
    if (next) opts.onCycle(next)
  })

  wrap.append(gear, cycle)
  return { el: wrap, setActiveTool: update }
}
