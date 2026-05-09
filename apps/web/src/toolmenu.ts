/**
 * Tool menu popover — opens on right-click (or pen barrel-button mapped to
 * right-click). The point is pen-only operation: no keyboard, no leaving the
 * pen for the mouse. Items reach into the same actions exposed via keyboard
 * shortcuts elsewhere (Color, Options, Undo, Redo, Theme, Clear).
 */

import { openColorPicker } from './colorpicker'
import { openOptionsMenu } from './optionsmenu'
import { type Popover, showPopover } from './popover'
import { cycleMode } from './theme'

export interface ToolMenuOptions {
  at: { x: number; y: number }
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
}

interface Item {
  label: string
  action: () => void
}

const SEP = Symbol('sep')
type Entry = Item | typeof SEP

export function openToolMenu(opts: ToolMenuOptions): Popover {
  const root = document.createElement('div')
  root.className = 'whiteboard-tools'

  // Boxed reference so item handlers can dismiss the menu before invoking the
  // action (so e.g. `Color` doesn't leave the tool menu sitting behind the
  // newly-opened color picker — single-instance arbitration would handle it
  // either way, but explicit dismiss reads more cleanly).
  const popoverRef: { current?: Popover } = {}

  const entries: Entry[] = [
    { label: 'Color', action: () => openColorPicker(opts.at) },
    { label: 'Grid options', action: () => openOptionsMenu(opts.at) },
    SEP,
    { label: 'Undo', action: opts.onUndo },
    { label: 'Redo', action: opts.onRedo },
    SEP,
    { label: 'Cycle theme', action: cycleMode },
    SEP,
    { label: 'Clear board…', action: opts.onClear },
  ]

  for (const entry of entries) {
    if (entry === SEP) {
      const sep = document.createElement('div')
      sep.className = 'whiteboard-tool-sep'
      root.appendChild(sep)
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'whiteboard-tool-item'
    btn.textContent = entry.label
    btn.addEventListener('click', () => {
      popoverRef.current?.dismiss()
      entry.action()
    })
    root.appendChild(btn)
  }

  popoverRef.current = showPopover({
    anchor: opts.at,
    title: 'tools',
    content: root,
    tag: 'tools',
  })
  return popoverRef.current
}
