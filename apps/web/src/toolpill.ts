/**
 * Bottom-right tool indicator pill. Shows the currently active tool and
 * cycles to the next on tap — a pen-friendly one-step activation surface
 * that complements `S` (lasso), `B` / `P` (draw), `Shift+E` (sticky
 * eraser), and the right-click → TOOL menu.
 *
 * Cycle order is the same as the right-click TOOL row's enabled tools:
 * pen → eraser → lasso → pen. The pill is a real `<button>` so it gets
 * native focus / keyboard activation for free; main.ts re-focuses `#app`
 * after a click so subsequent keystrokes don't go through the pill.
 */

import type { ToolId } from './tools/types'

const TOOL_LABELS: Record<ToolId, string> = {
  pen: 'Draw',
  eraser: 'Eraser',
  lasso: 'Lasso',
  laser: 'Laser',
  text: 'Text',
}

/** Enabled tools, in cycle order. Mirror of `toolmenu.ts` TOOLS-with-enabled. */
const CYCLE: readonly ToolId[] = ['pen', 'eraser', 'lasso']

export interface ToolPillOptions {
  initial: ToolId
  /** Called when the user taps the pill. Receives the next tool in the cycle. */
  onCycle: (next: ToolId) => void
}

export interface ToolPill {
  el: HTMLElement
  /** Update the pill's display when the active tool changes externally
   *  (keyboard shortcut, right-click menu, etc.). Idempotent. */
  setActiveTool(id: ToolId): void
}

export function createToolPill(opts: ToolPillOptions): ToolPill {
  const el = document.createElement('button')
  el.id = 'whiteboard-tool-pill'
  el.type = 'button'
  el.title = 'Active tool — tap to cycle'

  const update = (id: ToolId): void => {
    el.textContent = TOOL_LABELS[id] ?? id
    el.dataset.tool = id
  }

  update(opts.initial)

  el.addEventListener('click', () => {
    const cur = el.dataset.tool as ToolId | undefined
    const idx = cur ? CYCLE.indexOf(cur) : 0
    const nextIdx = idx < 0 ? 0 : (idx + 1) % CYCLE.length
    const next = CYCLE[nextIdx]
    if (next) opts.onCycle(next)
  })

  return { el, setActiveTool: update }
}
