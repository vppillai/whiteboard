/**
 * Side panel primitive — slides in from the right edge as an overlay
 * (canvas keeps full width, panel hovers above). Single-instance:
 * opening another side panel replaces the current one. Esc + close
 * button dismiss; click-outside is a no-op (panel is deliberate).
 *
 * Decoupled from M1.7 content — just a primitive shell. Settings tree
 * lives in settings/panel-content.ts.
 */

export interface SidePanel {
  el: HTMLElement
  dismiss(): void
}

export interface SidePanelOptions {
  title: string
  content: HTMLElement
  refocusOnClose?: HTMLElement
  onDismiss?: () => void
  /** Identity tag — re-opening with the same tag is a toggle (close). */
  tag?: string
}

let active: { panel: SidePanel; tag?: string } | null = null

export function showSidePanel(opts: SidePanelOptions): SidePanel {
  // Toggle if same tag is already open.
  if (active?.tag !== undefined && active.tag === opts.tag) {
    active.panel.dismiss()
    return active.panel
  }
  active?.panel.dismiss()

  const el = document.createElement('aside')
  el.className = 'whiteboard-sidepanel'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', opts.title)

  const header = document.createElement('div')
  header.className = 'whiteboard-sidepanel-header'

  const title = document.createElement('div')
  title.className = 'whiteboard-sidepanel-title'
  title.textContent = opts.title
  header.appendChild(title)

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'whiteboard-sidepanel-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.textContent = '×'
  header.appendChild(closeBtn)

  const body = document.createElement('div')
  body.className = 'whiteboard-sidepanel-body'
  body.appendChild(opts.content)

  el.append(header, body)
  document.body.appendChild(el)

  // Trigger slide-in animation on next frame.
  requestAnimationFrame(() => el.classList.add('open'))

  let dismissed = false
  const dismiss = (): void => {
    if (dismissed) return
    dismissed = true
    if (active?.panel === panel) active = null
    document.removeEventListener('keydown', onKey, true)
    el.classList.remove('open')
    el.classList.add('closing')
    setTimeout(() => {
      el.remove()
      opts.refocusOnClose?.focus({ preventScroll: true })
      opts.onDismiss?.()
    }, 180)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    }
  }

  closeBtn.addEventListener('click', dismiss)
  document.addEventListener('keydown', onKey, true)

  const panel: SidePanel = { el, dismiss }
  active = { panel, tag: opts.tag }
  return panel
}

export function dismissSidePanel(): boolean {
  if (!active) return false
  active.panel.dismiss()
  return true
}

export function isSidePanelOpen(): boolean {
  return active !== null
}

export function getActiveSidePanelTag(): string | undefined {
  return active?.tag
}
