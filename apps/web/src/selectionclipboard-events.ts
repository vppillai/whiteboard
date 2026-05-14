export interface SelectionClipboardEventDeps {
  isSelectActive: () => boolean
  selectionCount: () => number
  performCopy: () => Promise<boolean>
  deleteSelected: () => void
}

export function isTextEditableTarget(target: EventTarget | null): boolean {
  const hasInputs =
    typeof HTMLInputElement !== 'undefined' && typeof HTMLTextAreaElement !== 'undefined'
  const hasHtml = typeof HTMLElement !== 'undefined'
  return (
    (hasInputs && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) ||
    (hasHtml && target instanceof HTMLElement && target.isContentEditable)
  )
}

export function createSelectionClipboardHandlers(deps: SelectionClipboardEventDeps): {
  onCopy: (e: ClipboardEvent) => void
  onCut: (e: ClipboardEvent) => void
} {
  const onCopy = (e: ClipboardEvent): void => {
    if (isTextEditableTarget(e.target)) return
    if (!deps.isSelectActive()) return
    if (deps.selectionCount() === 0) return
    e.preventDefault()
    void deps.performCopy()
  }

  const onCut = (e: ClipboardEvent): void => {
    if (isTextEditableTarget(e.target)) return
    if (!deps.isSelectActive()) return
    if (deps.selectionCount() === 0) return
    e.preventDefault()
    void (async () => {
      const ok = await deps.performCopy()
      if (ok) deps.deleteSelected()
    })()
  }

  return { onCopy, onCut }
}
