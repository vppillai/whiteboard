/**
 * E key — pure spring-loaded eraser modifier.
 *
 * Mirrors `pan.ts`'s split keydown / keyup pattern. Press E to switch to
 * the eraser tool; release E to revert to whichever tool was active before.
 * Always reverts — no tap-to-stick. For sticky eraser use Shift+E (handled
 * in `keymap.ts`) or right-click → ERASER.
 *
 * Spring-loaded modifier keys are the pen-tablet-native idiom for "borrow
 * this tool for a moment" (Photoshop, Krita, etc.). Separating spring-load
 * from sticky-toggle into two keys avoids a fragile time- or stroke-based
 * discriminator on the same key.
 */

import type { ToolId } from './tools/types'

export interface EraserHoldOptions {
  getActiveToolId: () => ToolId
  setTool: (id: ToolId) => void
}

export function attachEraserHold(opts: EraserHoldOptions): () => void {
  const { getActiveToolId, setTool } = opts
  let held = false
  let prevTool: ToolId | null = null

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || held) return
    if (e.key.toLowerCase() !== 'e') return
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    held = true
    const current = getActiveToolId()
    prevTool = current === 'eraser' ? null : current
    if (prevTool !== null) setTool('eraser')
  }

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() !== 'e' || !held) return
    held = false
    const restore = prevTool
    prevTool = null
    if (restore !== null) setTool(restore)
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)

  return () => {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
  }
}
