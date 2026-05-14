/**
 * Help overlay (toggled with `?`). Bottom-right corner; pointer-events:none
 * on the wrapper so it doesn't intercept drawing, but the GitHub repo link
 * opts back in via pointer-events:auto so it remains clickable.
 */

export interface HelpOverlay {
  el: HTMLElement
  toggle: () => void
}

const SHORTCUTS = [
  'right-click        tool menu (pen-friendly)',
  'B                  tool: draw  (current brush)',
  'P                  tool: draw + Pen preset',
  'E (hold)           spring-loaded eraser  (release reverts)',
  'Shift + E          sticky eraser',
  'Shift + erase      object mode (single stroke per click)',
  'V or S             tool: select  (universal pointer; click / marquee / Shift+click)',
  'L                  tool: laser  (fading pointer trail)',
  'T                  tool: text   (mono, 12px default — change in menu)',
  '⌘/Ctrl + B/I/U     bold / italic / underline (in text edit or on selected text)',
  'Esc Esc            toggle Draw ↔ Select',
  'Esc (text edit)    commit + return to previous tool',
  'Esc (select)       clear selection',
  '⌘/Ctrl + A         select all  (strokes + images + texts)',
  '⌘/Ctrl + C / X     copy / cut selection: single image → bytes · everything else → PNG',
  '⌘/Ctrl + V         paste image (PNG/JPG/WebP/GIF) or clipboard text → TextObject',
  'Delete             delete the active selection  (also Backspace)',
  '1 – 5              brush preset (pen / marker / pencil / hi / brush)',
  'C                  color picker (at pointer)',
  'O                  options (grid type, spacing)',
  '',
  '⌘/Ctrl + Z         undo',
  '⌘/Ctrl + Shift + Z redo   (also ⌘/Ctrl + Y)',
  '⌘/Ctrl + Shift + K clear board (confirm twice)',
  '',
  'M                  toggle metrics',
  'Shift + T          cycle theme',
  '?                  toggle this help',
  '',
  '⌘/Ctrl + 0         reset zoom',
  '⌘/Ctrl + 1         fit all strokes in view',
  '⌘/Ctrl + +/-       zoom in/out',
  'Shift (drawing)    constrain to straight line',
  'wheel / 2-finger   pan',
  '⌘/Ctrl + wheel     zoom',
  'pinch              zoom',
  'space + drag       pan (any device)',
  'middle-mouse drag  pan',
  'Esc                close popover / cancel',
].join('\n')

const REPO_URL = 'https://github.com/vppillai/whiteboard'

export function createHelpOverlay(): HelpOverlay {
  const el = document.createElement('div')
  el.id = 'whiteboard-help'
  el.style.display = 'none'

  const shortcuts = document.createElement('pre')
  shortcuts.className = 'whiteboard-help-shortcuts'
  shortcuts.textContent = SHORTCUTS
  el.appendChild(shortcuts)

  const footer = document.createElement('div')
  footer.className = 'whiteboard-help-footer'
  const link = document.createElement('a')
  link.href = REPO_URL
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.className = 'whiteboard-help-link'
  link.textContent = 'github.com/vppillai/whiteboard ↗'
  footer.appendChild(link)
  el.appendChild(footer)

  const toggle = (): void => {
    el.style.display = el.style.display === 'none' ? 'block' : 'none'
  }
  return { el, toggle }
}
